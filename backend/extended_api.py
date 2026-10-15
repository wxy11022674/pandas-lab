"""Workspace endpoints: prepared examples, visual profiling, linked exploration."""
import io
import json
import re
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from fastapi import Body, File, UploadFile
from fastapi.responses import FileResponse, Response
from backend.demo_pack import make_pack, LABELS, FIELDS, PACK_VERSION
from backend.advanced import advanced_transform


def walker_query(source, payload):
    """Execute the Graphic Walker structured query with pandas, without eval/SQL."""
    df=source.copy()
    if len(payload.get('workflow',[]))>40: raise ValueError('INVALID_VALUE')
    for step in payload.get('workflow',[]):
        typ=step['type']
        if typ=='filter':
            for f in step['filters']:
                s=df[f['fid']]; rule=f['rule']; value=rule['value']; kind=rule['type']
                if kind in ['one of','not in']:
                    mask=s.isin(value)
                    if None in value: mask=mask|s.isna()
                    if kind=='not in': mask=~mask
                elif kind in ['range','temporal range']:
                    if kind=='temporal range':
                        dates=pd.to_datetime(s,errors='coerce',utc=True)
                        s=dates.astype('datetime64[ms, UTC]').astype('int64').where(dates.notna())
                    mask=s.notna()
                    if value[0] is not None: mask &= s>=value[0]
                    if value[1] is not None: mask &= s<=value[1]
                elif kind=='regexp':
                    # Support literals, anchors and .* wildcards. Reject richer patterns
                    # rather than silently interpreting them as a different query.
                    pattern=str(value)
                    if len(pattern)>200 or pattern.count('.*')>2 or re.search(r'(?<!\\)[\[\](){}+?|]',pattern) or re.search(r'(?<!\.)\*',pattern):
                        raise ValueError('UNSUPPORTED_QUERY')
                    try: re.compile(pattern)
                    except re.error: raise ValueError('UNSUPPORTED_QUERY')
                    mask=s.astype('string').str.contains(pattern,regex=True,case=rule.get('caseSensitive',False),na=False)
                else: raise ValueError('UNSUPPORTED_QUERY')
                df=df.loc[mask].copy()
        elif typ=='transform':
            for transform in step['transform']:
                e=transform['expression']; op=e['op']; key=transform['key']; params=e.get('params',[])
                fields=[v['value'] for v in params if v['type']=='field']; constants=[v['value'] for v in params if v['type']=='constant']
                if op=='one': df[key]=1
                elif op in ['log','log2','log10']:
                    s=pd.to_numeric(df[fields[0]])
                    df[key]=getattr(np,op)(s.where(s>0))
                elif op in ['bin','binCount']:
                    s=pd.to_numeric(df[fields[0]]); count=int(e.get('num') or (constants[0] if constants else 10))
                    if not 1<=count<=100: raise ValueError('INVALID_VALUE')
                    edges=np.histogram_bin_edges(s.dropna(),bins=count)
                    df[key]=pd.cut(s,edges,include_lowest=True).astype('string')
                elif op in ['dateTimeDrill','dateTimeFeature']:
                    s=pd.to_datetime(df[fields[0]],errors='coerce'); level=constants[0] if constants else 'year'
                    if op=='dateTimeFeature':
                        attr={'year':'year','month':'month','day':'day','weekday':'dayofweek','hour':'hour','quarter':'quarter'}.get(level)
                        if not attr: raise ValueError('UNSUPPORTED_QUERY')
                        df[key]=getattr(s.dt,attr)
                    else:
                        freq={'year':'Y','quarter':'Q','month':'M','day':'D','hour':'h','minute':'min','second':'s'}.get(level)
                        if not freq: raise ValueError('UNSUPPORTED_QUERY')
                        df[key]=s.dt.to_period(freq).dt.to_timestamp()
                else: raise ValueError('UNSUPPORTED_QUERY')
        elif typ=='view':
            for q in step['query']:
                if q['op']=='raw': df=df[q['fields']]
                elif q['op']=='aggregate':
                    groups=q['groupBy']; measures=q['measures']; named={}
                    for m in measures:
                        field=m['field']; agg=m['agg']; alias=m['asFieldKey']
                        if field=='gw_count_fid' and field not in df: df[field]=1
                        if agg not in ['sum','count','mean','median','min','max','variance','stdev','distinctCount']: raise ValueError('UNSUPPORTED_QUERY')
                        func={'variance':'var','stdev':'std','distinctCount':'nunique'}.get(agg,agg)
                        if agg=='sum': func=lambda s:s.sum(min_count=1)
                        named[alias]=(field,func)
                    if groups:
                        df=df.groupby(groups,dropna=False,sort=False).agg(**named).reset_index() if named else df[groups].drop_duplicates()
                    else:
                        df=pd.DataFrame([{alias: (func(df[field]) if callable(func) else getattr(df[field],func)()) for alias,(field,func) in named.items()}])
                elif q['op']=='fold':
                    df=df.melt(id_vars=[c for c in df if c not in q['foldBy']],value_vars=q['foldBy'],var_name=q['newFoldKeyCol'],value_name=q['newFoldValueCol'])
                elif q['op']=='bin':
                    df[q['newBinCol']]=pd.cut(df[q['binBy']],bins=int(q['binSize'])).astype('string')
                else: raise ValueError('UNSUPPORTED_QUERY')
        elif typ=='sort': df=df.sort_values(step['by'],ascending=step['sort']=='ascending',kind='stable',na_position='last')
        else: raise ValueError('UNSUPPORTED_QUERY')
    offset=max(0,int(payload.get('offset',0))); requested=payload.get('limit',50000)
    limit=min(50000,max(0,int(50000 if requested is None else requested)))
    return df.iloc[offset:offset+limit]


def register(app, c):
    @app.get('/api/workspace/bootstrap')
    def bootstrap():
        existing={}
        for path in (c.data_dir()/'datasets').glob('*.json'):
            ds=json.loads(path.read_text(encoding='utf-8'))
            if ds.get('pack_version')==PACK_VERSION: existing[ds['example_key']]=ds
        for key,df in make_pack().items():
            if key not in existing:
                v=c.create_dataset(df,LABELS[key][0],{'demo':True,'synthetic':True})
                ds=c.read_meta('datasets',v['dataset_id'])
                ds.update(example_key=key,pack_version=PACK_VERSION,labels=LABELS[key])
                c.save_json(c.keypath('datasets',ds['id'],'json'),ds)
                existing[key]=ds
        all_data=[]
        for path in (c.data_dir()/'datasets').glob('*.json'):
            ds=json.loads(path.read_text(encoding='utf-8'))
            all_data.append({k:ds.get(k) for k in ['id','name','original_version_id','latest_version_id','example_key','labels']})
        return {'datasets':all_data,'default_version':existing['reference']['original_version_id'],
                'examples':{k:v['original_version_id'] for k,v in existing.items()},'fields':FIELDS,'pack_version':PACK_VERSION}

    @app.post('/api/upload/sheets')
    async def sheets(file:UploadFile=File(...)):
        data=await file.read(c.MAX_BYTES+1)
        if len(data)>c.MAX_BYTES: c.fail('FILE_TOO_LARGE')
        try:
            book=pd.ExcelFile(io.BytesIO(data))
            return {'sheets':book.sheet_names}
        except Exception: c.fail('INVALID_FILE')

    @app.get('/api/examples/download/{filename}')
    def example_file(filename:str):
        allowed={f'{k}.{ext}' for k in LABELS for ext in ['csv','json']}|{'campus-data.xlsx','campus-data.zip','README.txt','manifest.json'}
        if filename not in allowed: c.fail('NOT_FOUND')
        path=c.ROOT/'examples'/'campus'/filename
        if not path.is_file(): c.fail('NOT_FOUND')
        return FileResponse(path,filename=filename)

    def selected_frame(ident,p):
        df=c.frame(ident)
        if p.get('conditions'):
            try: df=advanced_transform(df,{'type':'filter_multi','params':p},lambda _:None)
            except (ValueError,KeyError,TypeError): c.fail('INVALID_VALUE')
        if p.get('search'):
            mask=c.business(df).astype('string').apply(lambda s:s.str.contains(str(p['search']),regex=False,case=False,na=False)).any(axis=1)
            df=df.loc[mask]
        return df

    @app.post('/api/versions/{ident}/query')
    def query(ident:str,p:dict=Body(...)):
        df=selected_frame(ident,p)
        if p.get('sort'):
            c.column(df,p['sort']); df=df.sort_values(p['sort'],ascending=p.get('ascending',True),kind='stable')
        page=max(1,int(p.get('page',1))); size=min(100,max(1,int(p.get('page_size',30))))
        return c.clean({'rows':c.preview_records(df.iloc[(page-1)*size:page*size]),'total':len(df),'page':page,'page_size':size})

    @app.get('/api/versions/{ident}/profile')
    def profile(ident:str,column:str):
        df=c.frame(ident); s=c.column(df,column); n=len(s); missing=int(s.isna().sum())
        result={'column':column,'rows':n,'missing':missing,'unique':int(s.nunique()),'kind':'numeric' if c.numeric(s) else 'string'}
        if c.numeric(s):
            x=s.dropna().to_numpy(dtype=float)
            counts,edges=np.histogram(x,bins=12)
            q1=s.quantile(.25);q3=s.quantile(.75);iqr=q3-q1
            result.update(stats={k:getattr(s,k)() for k in ['min','max','mean','median','std','sum']},q1=q1,q3=q3,
                          lower=q1-1.5*iqr,upper=q3+1.5*iqr,outliers=int(((s<q1-1.5*iqr)|(s>q3+1.5*iqr)).sum()),
                          histogram={'counts':counts.tolist(),'edges':edges.tolist()})
        else:
            freq=s.value_counts(dropna=True).head(20)
            result['frequency']={'labels':[str(x) for x in freq.index],'counts':freq.tolist()}
        return c.clean(result)

    @app.get('/api/versions/{ident}/statistics')
    def statistics(ident:str):
        df=c.business(c.frame(ident)); names=[x for x in df if c.numeric(df[x])][:30]
        corr=df[names].corr(method='pearson',min_periods=3)
        return c.clean({'columns':c.column_info(c.frame(ident)), 'numeric':names,
            'describe':df[names].describe().reset_index().to_dict('records') if names else [],
            'correlation':[[i,j,corr.loc[y,x],int(df[[y,x]].dropna().shape[0])] for i,x in enumerate(names) for j,y in enumerate(names)]})

    @app.post('/api/versions/{ident}/visual')
    def visual(ident:str,p:dict=Body(...)):
        df=selected_frame(ident,p); typ=p.get('type','bar'); x=p['x']; y=p.get('y'); color=p.get('color'); agg=p.get('aggregate','sum')
        c.column(df,x)
        if y: c.column(df,y)
        if color: c.column(df,color)
        c.validate_aggregate(agg)
        result={'type':typ,'x':x,'y':y,'source_rows':len(df),'labels':[],'series':[],'points':[],'sampled':False}
        if typ in ['bar','line','area']:
            keys=list(dict.fromkeys([x]+([color] if color else [])))
            if y and agg!='count': c.require_numeric(df[y])
            grouped=df.groupby(keys,dropna=False,sort=True)
            if not y: out=grouped.size().reset_index(name='_value')
            else:
                g=grouped[y]; v=g.sum(min_count=1) if agg=='sum' else getattr(g,agg)()
                out=v.rename('_value').reset_index()
            # Type-aware groups, with a separate null sentinel for the UI filter.
            labels=list(out[x].drop_duplicates()); result['values']=c.clean(labels)
            result['labels']=[str(a) if pd.notna(a) else '(null)' for a in labels]
            groups=list(out[color].drop_duplicates()) if color else [None]
            # Keep every group. Sparse coordinates avoid allocating the Cartesian
            # product when category and color both have many distinct values.
            key=lambda value: None if pd.isna(value) else value
            indices={key(value):i for i,value in enumerate(labels)}
            series_indices={key(value):i for i,value in enumerate(groups)}
            sparse=len(labels)*len(groups)>100000
            result['sparse']=sparse
            for value in groups:
                result['series'].append({'name':str(value) if color else y or 'count','data':[] if sparse else [None]*len(labels)})
            for row in out.to_dict('records'):
                i=indices[key(row[x])]
                j=series_indices[key(row[color])] if color else 0
                data=result['series'][j]['data']
                if sparse: data.append([i,row['_value']])
                else: data[i]=row['_value']
        elif typ=='scatter':
            c.require_numeric(df[x]);c.require_numeric(c.column(df,y))
            valid=df.dropna(subset=[x,y]); result['total_points']=len(valid)
            if len(valid)>3000: valid=valid.iloc[np.linspace(0,len(valid)-1,3000,dtype=int)];result['sampled']=True
            result['points']=[[r[x],r[y],int(r['_row_id'])] for _,r in valid.iterrows()]
        elif typ=='histogram':
            c.require_numeric(df[x]);bins=int(p.get('bins',12))
            if not 2<=bins<=60: c.fail('INVALID_VALUE')
            values=df[x].dropna().to_numpy(dtype=float); counts,edges=np.histogram(values,bins=bins)
            result.update(edges=edges.tolist(),labels=[f'{a:.3g}–{b:.3g}' for a,b in zip(edges[:-1],edges[1:])],series=[{'name':'count','data':counts.tolist()}])
        elif typ=='boxplot':
            c.require_numeric(c.column(df,y));labels=[];values=[]
            for label,sub in df.groupby(x,dropna=False,sort=True):
                s=sub[y].dropna()
                if len(s):
                    q=s.quantile([0,.25,.5,.75,1]).tolist();labels.append(str(label));values.append(q)
            result.update(labels=labels,boxes=values)
        else: c.fail('INVALID_VALUE')
        return c.clean(result)

    @app.post('/api/versions/{ident}/walker')
    def walker(ident:str,p:dict=Body(...)):
        try: return c.clean(walker_query(c.business(c.frame(ident)),p).to_dict('records'))
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError): c.fail('UNSUPPORTED_QUERY')

    @app.post('/api/versions/{ident}/join-info')
    def join_info(ident:str,p:dict=Body(...)):
        left=c.column(c.frame(ident),p['left_on']); right=c.column(c.frame(p['right_version']),p['right_on'])
        return {'left_rows':len(left),'right_rows':len(right),'left_duplicates':int(left.duplicated().sum()),
                'right_duplicates':int(right.duplicated().sum()),'matched_left':int(left.isin(right.dropna()).sum()),
                'unmatched_left':int((~left.isin(right.dropna())).sum()),'left_null':int(left.isna().sum()),'right_null':int(right.isna().sum())}
