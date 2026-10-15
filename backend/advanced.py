"""Allowlisted pandas operations shared by the API and exported scripts."""
import numpy as np
import pandas as pd

ADVANCED = {'rename','drop_columns','calculate','text','date_extract','filter_multi',
            'sort_multi','aggregate','pivot','melt','merge','concat','resample','clip'}

def advanced_transform(source, op, resolve):
    df = source.copy(deep=True)
    p, typ = op['params'], op['type']
    def col(name):
        if name not in df.columns or name == '_row_id':
            raise ValueError('INVALID_COLUMN')
        return df[name]
    def cols(names):
        if not isinstance(names, list) or not names:
            raise ValueError('INVALID_VALUE')
        for name in names: col(name)
        return names
    def new_name(name):
        if not isinstance(name, str):
            raise ValueError('COLUMN_EXISTS')
        name = name.strip()
        if not name or name in df.columns or name == '_row_id':
            raise ValueError('COLUMN_EXISTS')
        return name.strip()
    def agg_value(value):
        if value not in ['sum','mean','median','min','max','count','std','nunique']:
            raise ValueError('INVALID_AGGREGATE')
        return (lambda s: s.sum(min_count=1)) if value == 'sum' else value
    if typ == 'rename':
        col(p['column'])
        df = df.rename(columns={p['column']:new_name(p['name'])})
    elif typ == 'drop_columns':
        df = df.drop(columns=cols(p['columns']))
        if not len(df.columns): raise ValueError('INVALID_VALUE')
    elif typ == 'calculate':
        name = new_name(p['name'])
        a = col(p['left'])
        b = col(p['right']) if p.get('right_kind','column') == 'column' else float(p['constant'])
        if not pd.api.types.is_numeric_dtype(a) or (isinstance(b,pd.Series) and not pd.api.types.is_numeric_dtype(b)):
            raise ValueError('NUMERIC_REQUIRED')
        method = {'add':'add','subtract':'sub','multiply':'mul','divide':'div'}.get(p['operator'])
        if not method: raise ValueError('INVALID_OPERATION')
        if method == 'div':
            b = b.replace(0,np.nan) if isinstance(b,pd.Series) else (np.nan if b == 0 else b)
        df[name] = getattr(a, method)(b).replace([np.inf,-np.inf],np.nan)
    elif typ == 'text':
        s = col(p['column']).astype('string')
        method = p['method']
        if method in ['strip','lower','upper']:
            df[p['column']] = getattr(s.str,method)()
        elif method == 'replace':
            df[p['column']] = s.str.replace(str(p['find']),str(p.get('replacement','')),regex=False)
        elif method == 'split':
            if not p.get('separator'): raise ValueError('INVALID_VALUE')
            name = new_name(p['name'])
            position = int(p.get('position',0))
            if not 0 <= position <= 50: raise ValueError('INVALID_VALUE')
            df[name] = s.str.split(str(p['separator']),regex=False).str[position]
        else: raise ValueError('INVALID_OPERATION')
    elif typ == 'date_extract':
        name = new_name(p['name'])
        s = pd.to_datetime(col(p['column']),errors='raise')
        part = p['part']
        if part not in ['year','month','day','dayofweek','quarter']: raise ValueError('INVALID_VALUE')
        df[name] = getattr(s.dt,part)
    elif typ == 'filter_multi':
        conditions = p.get('conditions',[])
        if not conditions or len(conditions)>20 or p.get('logic','and') not in ['and','or']: raise ValueError('INVALID_VALUE')
        masks=[]
        for item in conditions:
            s=col(item['column']); operator=item['operator']; value=item.get('value')
            if operator in ['is_null','not_null']: mask=s.isna() if operator=='is_null' else s.notna()
            elif operator=='contains': mask=s.astype('string').str.contains(str(value),regex=False,na=False)
            elif operator=='in': mask=s.isin(value)
            else:
                if pd.api.types.is_numeric_dtype(s): value=float(value)
                elif pd.api.types.is_datetime64_any_dtype(s): value=pd.Timestamp(value)
                method={'eq':'eq','ne':'ne','gt':'gt','gte':'ge','lt':'lt','lte':'le'}.get(operator)
                if not method: raise ValueError('INVALID_OPERATION')
                mask=getattr(s,method)(value).fillna(False)
            masks.append(mask)
        mask=masks[0]
        for other in masks[1:]: mask=(mask & other) if p.get('logic','and')=='and' else (mask | other)
        df=df.loc[mask].copy()
    elif typ == 'sort_multi':
        names=cols(p['columns']); ascending=p.get('ascending',True)
        if not isinstance(ascending,bool) and not (isinstance(ascending,list) and len(ascending)==len(names) and all(isinstance(x,bool) for x in ascending)):
            raise ValueError('INVALID_VALUE')
        df=df.sort_values(names,ascending=ascending,kind='stable',na_position='last')
    elif typ == 'aggregate':
        groups=cols(p['groups']); metrics=p['metrics']
        if not metrics or len(metrics)>20: raise ValueError('INVALID_VALUE')
        named={}
        for m in metrics:
            s=col(m['column']); agg=m['aggregate']
            if agg not in ['count','nunique'] and not pd.api.types.is_numeric_dtype(s): raise ValueError('NUMERIC_REQUIRED')
            name=f'{m["column"]}_{agg}'
            if name in groups or name in named: raise ValueError('COLUMN_EXISTS')
            named[name]=pd.NamedAgg(column=m['column'],aggfunc=agg_value(agg))
        df=df.groupby(groups,dropna=False,sort=False).agg(**named).reset_index()
    elif typ == 'pivot':
        rows=cols(p['rows']); axes=cols(p['columns']); value=p['value']; col(value)
        if set(rows)&set(axes) or value in rows+axes: raise ValueError('INVALID_VALUE')
        if p['aggregate'] not in ['count','nunique'] and not pd.api.types.is_numeric_dtype(df[value]): raise ValueError('NUMERIC_REQUIRED')
        if df[axes].drop_duplicates().shape[0]>80: raise ValueError('TOO_MANY_COLUMNS')
        df=df.pivot_table(index=rows,columns=axes,values=value,aggfunc=agg_value(p['aggregate']),observed=True,sort=True)
        df.columns=[' / '.join(map(str,x)) if isinstance(x,tuple) else str(x) for x in df.columns]
        if any(c in rows for c in df.columns) or not df.columns.is_unique: raise ValueError('COLUMN_EXISTS')
        df=df.reset_index()
    elif typ == 'melt':
        ids=p.get('ids',[]); values=cols(p['values'])
        for c in ids: col(c)
        if set(ids)&set(values): raise ValueError('INVALID_VALUE')
        variable=new_name(p.get('variable','variable')); value=new_name(p.get('value_name','value'))
        if variable==value: raise ValueError('COLUMN_EXISTS')
        if len(df)*len(values)>50000: raise ValueError('TOO_MANY_ROWS')
        df=df.melt(id_vars=ids,value_vars=values,var_name=variable,value_name=value)
    elif typ == 'merge':
        other=resolve(p['right_version']); left=p['left_on']; right=p['right_on']; col(left)
        if right not in other.columns: raise ValueError('INVALID_COLUMN')
        how=p.get('how','left')
        if how not in ['left','inner','right','outer']: raise ValueError('INVALID_VALUE')
        # Match real keys only; null identifiers must not silently match each other.
        if df[left].isna().any() or other[right].isna().any(): raise ValueError('NULL_JOIN_KEY')
        validation=p.get('validate','many_to_one')
        if validation not in ['one_to_one','many_to_one','one_to_many']: raise ValueError('INVALID_VALUE')
        try:
            df=df.merge(other,how=how,left_on=left,right_on=right,suffixes=('','_right'),validate=validation)
        except pd.errors.MergeError: raise ValueError('DUPLICATE_JOIN_KEY')
    elif typ == 'concat':
        other=resolve(p['right_version'])
        if set(other.columns)!=set(df.columns): raise ValueError('SCHEMA_MISMATCH')
        df=pd.concat([df,other[df.columns]],ignore_index=True)
    elif typ == 'resample':
        date=p['column']; value=p['value']; col(value)
        if not pd.api.types.is_numeric_dtype(df[value]): raise ValueError('NUMERIC_REQUIRED')
        rule=p['rule']
        if rule not in ['D','W','MS','QS','YS']: raise ValueError('INVALID_VALUE')
        df[date]=pd.to_datetime(col(date),errors='raise')
        df=df.set_index(date)[[value]].resample(rule).agg(agg_value(p['aggregate'])).reset_index()
    elif typ == 'clip':
        s=col(p['column'])
        if not pd.api.types.is_numeric_dtype(s): raise ValueError('NUMERIC_REQUIRED')
        low=float(p['lower']); high=float(p['upper'])
        if low>high or not np.isfinite([low,high]).all(): raise ValueError('INVALID_VALUE')
        df[p['column']]=s.clip(low,high)
    else: raise ValueError('INVALID_OPERATION')
    if len(df)>50000: raise ValueError('TOO_MANY_ROWS')
    if len(df.columns)>100: raise ValueError('TOO_MANY_COLUMNS')
    if not df.columns.is_unique: raise ValueError('COLUMN_EXISTS')
    return df
