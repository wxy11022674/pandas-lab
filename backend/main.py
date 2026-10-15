"""Pandas Lab: immutable local data versions and deterministic pandas recipes."""
from __future__ import annotations

import csv
import io
import json
import os
import inspect
import re
import secrets
from contextvars import ContextVar
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd
import sys
if sys.platform == 'emscripten':
    from backend.browser_transport import FastAPI, File, Form, HTTPException, UploadFile, RequestValidationError, JSONResponse, Response, StaticFiles
else:
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse, Response
    from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from backend.advanced import ADVANCED, advanced_transform

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get('PANDAS_LAB_DATA_DIR', ROOT / 'data'))
MAX_BYTES = 10 * 1024 * 1024
app = FastAPI(title='Pandas Lab')
SESSION_ISOLATION = os.environ.get('PANDAS_LAB_SESSION_ISOLATION') == '1'
_session_id: ContextVar[str | None] = ContextVar('pandas_lab_session', default=None)


def data_dir():
    ident = _session_id.get()
    return DATA_DIR / 'sessions' / ident if ident else DATA_DIR


@app.middleware('http')
async def browser_workspace(request, call_next):
    if not SESSION_ISOLATION or not request.url.path.startswith('/api/') or request.url.path == '/api/health':
        return await call_next(request)
    ident = request.cookies.get('pandas_lab_session', '')
    fresh = not re.fullmatch(r'[0-9a-f]{64}', ident)
    if fresh:
        ident = secrets.token_hex(32)
    token = _session_id.set(ident)
    try:
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        if fresh:
            response.set_cookie('pandas_lab_session', ident, httponly=True,
                                secure=os.environ.get('PANDAS_LAB_COOKIE_SECURE') == '1',
                                samesite='lax', max_age=60 * 60 * 24 * 30)
        return response
    finally:
        _session_id.reset(token)


def fail(code, **params):
    raise HTTPException(status_code=400 if code != 'NOT_FOUND' else 404,
                        detail={'code': code, 'params': params})


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(status_code=422, content={'detail': {'code': 'INVALID_VALUE', 'params': {}}})


class Operation(BaseModel):
    type: str
    params: dict = Field(default_factory=dict)


class CompareRequest(BaseModel):
    version_id: str
    column: str
    group_by: str | None = None
    aggregate: str = 'mean'
    a: Operation
    b: Operation


class ChartRequest(BaseModel):
    type: str
    x: str
    y: str | None = None
    aggregate: str = 'sum'
    bins: int = 12


def clean(value):
    """Convert pandas scalars and missing/nonfinite values into strict JSON."""
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat()
    if isinstance(value, np.generic):
        return clean(value.item())
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def keypath(kind, ident, suffix):
    # IDs are opaque; disallow path traversal before touching disk.
    if not ident or any(c not in '0123456789abcdef' for c in ident):
        fail('NOT_FOUND')
    return data_dir() / kind / f'{ident}.{suffix}'


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(clean(obj), ensure_ascii=False, allow_nan=False), encoding='utf-8')
    tmp.replace(path)


def read_meta(kind, ident):
    path = keypath(kind, ident, 'json')
    if not path.exists():
        fail('NOT_FOUND')
    return json.loads(path.read_text(encoding='utf-8'))


def frame(ident):
    read_meta('versions', ident)
    # Only our own cached, locally generated frames are unpickled, never uploads.
    return pd.read_pickle(keypath('versions', ident, 'pkl'))


def business(df):
    return df.drop(columns=['_row_id'])


def column(df, name):
    if name == '_row_id' or name not in df.columns:
        fail('INVALID_COLUMN', column=str(name))
    return df[name]


def numeric(s):
    return pd.api.types.is_numeric_dtype(s.dtype) and not pd.api.types.is_bool_dtype(s.dtype)


def require_numeric(s):
    if not numeric(s):
        fail('NUMERIC_REQUIRED', column=str(s.name))


def operation_dict(op):
    return op.model_dump() if isinstance(op, Operation) else op


def apply_operation(source, operation):
    """Single deterministic operation interpreter; never evaluates user code."""
    op = operation_dict(operation)
    p, typ = op['params'], op['type']
    df = source.copy(deep=True)
    changed, removed = [], []
    try:
        if typ == 'deduplicate':
            cols = p.get('columns', [])
            if not isinstance(cols, list):
                fail('INVALID_VALUE')
            for c in cols:
                column(df, c)
            mask = df.duplicated(subset=cols or list(business(df).columns))
            removed = df.loc[mask, '_row_id'].astype(int).tolist()
            df = df.loc[~mask].copy()
        elif typ == 'groupby':
            group, value, agg = p['column'], p['value_column'], p['aggregate']
            column(df, group)
            s = column(df, value)
            if group == value:
                fail('INVALID_VALUE')
            validate_aggregate(agg)
            if agg != 'count':
                require_numeric(s)
            grouped = df.groupby(group, dropna=False, sort=False)[value]
            result = grouped.sum(min_count=1) if agg == 'sum' else getattr(grouped, agg)()
            df = result.reset_index()
            df['_row_id'] = np.arange(1, len(df) + 1)
            changed = df['_row_id'].astype(int).tolist()
        elif typ in {'filter', 'sort', 'convert', 'fill_missing'}:
            name = p['column']
            s = column(df, name)
            if typ == 'filter':
                operator, value = p['operator'], p.get('value')
                if operator == 'is_null':
                    mask = s.isna()
                elif operator == 'not_null':
                    mask = s.notna()
                elif operator == 'contains':
                    mask = s.astype('string').str.contains(str(value), regex=False, na=False)
                else:
                    if numeric(s):
                        try:
                            value = pd.to_numeric(value)
                            if not np.isfinite(value):
                                fail('INVALID_VALUE')
                        except (TypeError, ValueError):
                            fail('INVALID_VALUE')
                    elif pd.api.types.is_datetime64_any_dtype(s):
                        value = pd.Timestamp(value)
                    methods = {'eq': 'eq', 'ne': 'ne', 'gt': 'gt', 'gte': 'ge', 'lt': 'lt', 'lte': 'le'}
                    if operator not in methods:
                        fail('INVALID_OPERATION')
                    mask = getattr(s, methods[operator])(value).fillna(False)
                removed = df.loc[~mask, '_row_id'].astype(int).tolist()
                df = df.loc[mask].copy()
            elif typ == 'sort':
                if not isinstance(p.get('ascending', True), bool):
                    fail('INVALID_VALUE')
                df = df.sort_values(name, ascending=p.get('ascending', True), kind='stable', na_position='last')
                before = source['_row_id'].to_numpy()
                after = df['_row_id'].to_numpy()
                changed = after[before != after].astype(int).tolist()
            elif typ == 'convert':
                target, errors = p['target'], p.get('errors', 'raise')
                if errors not in {'raise', 'coerce'}:
                    fail('INVALID_VALUE')
                try:
                    if target == 'numeric':
                        converted = pd.to_numeric(s, errors=errors)
                        converted = converted.replace([np.inf, -np.inf], np.nan)
                    elif target == 'date':
                        converted = pd.to_datetime(s, errors=errors)
                    elif target == 'string':
                        converted = s.astype('string')
                    else:
                        fail('INVALID_VALUE')
                except (ValueError, TypeError, OverflowError):
                    fail('CONVERSION_FAILED', column=name)
                mask = ~(s.eq(converted).fillna(False) | (s.isna() & converted.isna()))
                changed = df.loc[mask, '_row_id'].astype(int).tolist()
                # Dtype-only transformations still affect each nonmissing value.
                if str(s.dtype) != str(converted.dtype):
                    changed = df.loc[s.notna() | converted.notna(), '_row_id'].astype(int).tolist()
                df[name] = converted
            else:
                method = p['method']
                mask = s.isna()
                if method == 'drop':
                    removed = df.loc[mask, '_row_id'].astype(int).tolist()
                    df = df.loc[~mask].copy()
                else:
                    if method in {'mean', 'median'}:
                        require_numeric(s)
                        if s.notna().sum() == 0:
                            fail('ALL_MISSING', column=name)
                        value = getattr(s, method)()
                    elif method == 'constant':
                        value = p.get('value')
                        if value is None or isinstance(value, (list, dict, bool)):
                            fail('INVALID_VALUE')
                        if numeric(s):
                            value = pd.to_numeric(value)
                            if not np.isfinite(value):
                                fail('INVALID_VALUE')
                        elif pd.api.types.is_datetime64_any_dtype(s):
                            value = pd.Timestamp(value)
                        else:
                            value = str(value)
                    else:
                        fail('INVALID_OPERATION')
                    # Preserve exact integers and dtype for no-op fills. Only
                    # promote nullable integer data when a fractional fill needs it.
                    if mask.any():
                        try:
                            df[name] = s.fillna(value)
                        except TypeError:
                            if not numeric(s):
                                raise
                            df[name] = s.astype(float).fillna(value)
                    changed = df.loc[mask, '_row_id'].astype(int).tolist()
        elif typ in ADVANCED:
            result = advanced_transform(business(df), op, lambda ident: business(frame(ident)))
            if typ in {'aggregate','pivot','melt','merge','concat','resample'}:
                result['_row_id'] = np.arange(1,len(result)+1)
                changed = result['_row_id'].astype(int).tolist()
            else:
                result['_row_id'] = df.loc[result.index,'_row_id']
                removed = df.loc[~df.index.isin(result.index),'_row_id'].astype(int).tolist()
                if typ != 'filter_multi':
                    if list(result.columns) != list(df.columns):
                        changed = result['_row_id'].astype(int).tolist()
                    else:
                        prior = df.loc[result.index]
                        equal = result.eq(prior).fillna(False) | (result.isna() & prior.isna())
                        changed = result.loc[~equal.all(axis=1),'_row_id'].astype(int).tolist()
                        if typ == 'sort_multi':
                            changed = result.loc[result['_row_id'].to_numpy()!=df['_row_id'].to_numpy(),'_row_id'].astype(int).tolist()
            df = result
        else:
            fail('INVALID_OPERATION')
    except HTTPException:
        raise
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        known = {'INVALID_COLUMN','COLUMN_EXISTS','NUMERIC_REQUIRED','TOO_MANY_ROWS','TOO_MANY_COLUMNS','INVALID_AGGREGATE','NULL_JOIN_KEY','DUPLICATE_JOIN_KEY','SCHEMA_MISMATCH'}
        fail(str(exc) if str(exc) in known else 'INVALID_VALUE')
    return df.reset_index(drop=True), changed, removed


def validate_aggregate(agg):
    if agg not in {'sum', 'mean', 'median', 'count', 'min', 'max'}:
        fail('INVALID_AGGREGATE')


def create_dataset(df, name, import_config=None):
    df = df.copy()
    df.columns = [str(c) for c in df.columns]
    if not df.columns.is_unique or any(not c.strip() for c in df.columns):
        fail('INVALID_COLUMN')
    if '_row_id' in df.columns:
        fail('RESERVED_COLUMN')
    if len(df) > 50000:
        fail('TOO_MANY_ROWS')
    if len(df.columns) > 100:
        fail('TOO_MANY_COLUMNS')
    if len(df.columns) == 0 or len(df) == 0:
        fail('EMPTY_FILE')
    df = df.replace([np.inf, -np.inf], np.nan)
    df['_row_id'] = np.arange(1, len(df) + 1)
    did, vid = uuid4().hex, uuid4().hex
    ds = {'id': did, 'name': name, 'original_version_id': vid, 'latest_version_id': vid,
          'import_config': import_config or {'demo': True}}
    save_json(keypath('datasets', did, 'json'), ds)
    meta = {'id': vid, 'dataset_id': did, 'parent_id': None, 'operation': None,
            'rows': len(df), 'affected_rows': 0, 'changed_ids': [], 'removed_ids': []}
    persist_frame(meta, df)
    return version_view(vid)


def persist_frame(meta, df):
    path = keypath('versions', meta['id'], 'pkl')
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_pickle(path)
    save_json(keypath('versions', meta['id'], 'json'), meta)


def child(ident, operation, persist=True):
    parent = read_meta('versions', ident)
    df, changed, removed = apply_operation(frame(ident), operation)
    meta = {'id': uuid4().hex if persist else 'preview', 'dataset_id': parent['dataset_id'],
            'parent_id': ident, 'operation': operation_dict(operation), 'rows': len(df),
            'affected_rows': len(set(changed + removed)), 'changed_ids': changed, 'removed_ids': removed}
    if operation_dict(operation)['type'] == 'sort':
        meta['affected_rows'] = int((frame(ident)['_row_id'].to_numpy() != df['_row_id'].to_numpy()).sum())
    if persist:
        persist_frame(meta, df)
        ds = read_meta('datasets', meta['dataset_id'])
        ds['latest_version_id'] = meta['id']
        save_json(keypath('datasets', ds['id'], 'json'), ds)
    return version_view(meta['id'], _meta=meta, _df=df)


def history(meta):
    steps = [meta]
    while steps[-1]['parent_id']:
        steps.append(read_meta('versions', steps[-1]['parent_id']))
    return list(reversed(steps))


def column_info(df):
    result = []
    for name in business(df).columns:
        s = df[name]
        kind = 'numeric' if numeric(s) else 'date' if pd.api.types.is_datetime64_any_dtype(s) else 'string'
        stats = None
        if kind == 'numeric':
            stats = {k: getattr(s, k)() for k in ['min', 'max', 'mean', 'median']} if s.notna().any() else dict.fromkeys(['min', 'max', 'mean', 'median'])
        result.append({'name': name, 'dtype': str(s.dtype), 'kind': kind, 'missing': int(s.isna().sum()),
                       'unique': int(s.nunique()), 'stats': stats})
    return clean(result)


def preview_records(df):
    records = df.to_dict('records')
    # JavaScript JSON.parse rounds integers outside its safe integer range.
    # Only display cells become decimal strings: numeric statistics and the
    # underlying pandas frames/CSV/recipes keep their original types and values.
    for record in records:
        for name, value in record.items():
            if name != '_row_id' and isinstance(value, (int, np.integer)) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
                record[name] = str(value)
    return records


def version_view(ident, page=1, page_size=20, affected_only=False, _meta=None, _df=None):
    meta = _meta or read_meta('versions', ident)
    df = _df if _df is not None else frame(ident)
    ds = read_meta('datasets', meta['dataset_id'])
    steps = history(meta)
    shown = df
    if affected_only:
        ids = set(meta['changed_ids'] + meta['removed_ids'])
        shown = df.loc[df['_row_id'].isin(ids)]
        if meta['parent_id'] and meta['removed_ids']:
            parent = frame(meta['parent_id'])
            shown = pd.concat([shown, parent.loc[parent['_row_id'].isin(meta['removed_ids'])]], ignore_index=True)
    page, page_size = max(1, page), min(100, max(1, page_size))
    return clean({**meta, 'dataset_name': ds['name'], 'example_key': ds.get('example_key'), 'original_version_id': ds['original_version_id'],
                  'columns': column_info(df), 'preview': preview_records(shown.iloc[(page - 1)*page_size:page*page_size]),
                  'page': page, 'page_size': page_size, 'total_preview_rows': len(shown),
                  'total_missing': int(business(df).isna().sum().sum()),
                  'duplicates': int(business(df).duplicated().sum()),
                  'history': [{k: s[k] for k in ['id', 'parent_id', 'operation', 'rows', 'affected_rows']} for s in steps],
                  'code': generate_code(ds, [s['operation'] for s in steps if s['operation']])})


def demo_frame():
    rows = []
    for month in range(1, 13):
        for idx, building in enumerate(['图书馆', '教学楼', '实验楼', '学生宿舍']):
            rows.append({'楼宇': building, '月份': f'2025-{month:02d}',
                         '用电量': float(18000 + idx * 6500 + month * 850 + (month % 3) * 1900),
                         '面积': float([8200, 13500, 9700, 18000][idx]),
                         '人数': float([600, 1600, 450, 2200][idx]), '区域': ['北区', '南区'][idx % 2]})
    df = pd.DataFrame(rows)
    df.loc[[2, 7, 18, 29, 36], '用电量'] = np.nan
    df.loc[[9, 20], '人数'] = np.nan
    return pd.concat([df, df.iloc[[4, 14]]], ignore_index=True)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'pandas_version': pd.__version__}


@app.get('/api/datasets')
def datasets():
    folder = data_dir() / 'datasets'
    return [{k: ds[k] for k in ['id', 'name', 'original_version_id', 'latest_version_id']}
            for path in sorted(folder.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
            for ds in [json.loads(path.read_text(encoding='utf-8'))]]


@app.post('/api/demo')
def demo():
    return create_dataset(demo_frame(), '校园楼宇能耗示例')


@app.post('/api/upload')
async def upload(file: UploadFile = File(...), encoding: str = Form('utf-8-sig'), sheet: str = Form('')):
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        fail('FILE_TOO_LARGE')
    if not data:
        fail('EMPTY_FILE')
    suffix = Path(file.filename or '').suffix.lower()
    if suffix in {'.xlsx','.json'}:
        try:
            if suffix == '.xlsx':
                df = pd.read_excel(io.BytesIO(data), sheet_name=sheet or 0, nrows=50001)
            else:
                payload = json.loads(data.decode('utf-8-sig'))
                if not isinstance(payload,list) or not all(isinstance(x,dict) for x in payload): fail('INVALID_VALUE')
                df = pd.DataFrame(payload)
            return create_dataset(df,Path(file.filename).name + (f' / {sheet}' if sheet else ''),{'demo':False,'format':suffix,'sheet':sheet})
        except HTTPException: raise
        except Exception: fail('INVALID_FILE')
    try:
        text = data.decode(encoding)
    except (UnicodeError, LookupError):
        fail('ENCODING_ERROR')
    try:
        records = csv.reader(io.StringIO(text), strict=True)
        header = next((row for row in records if row and not (len(row) == 1 and not row[0].strip())), [])
        if any(len(row) > len(header) for row in records if row):
            fail('INVALID_CSV')
        df = pd.read_csv(io.StringIO(text), nrows=50001)
    except pd.errors.EmptyDataError:
        fail('EMPTY_FILE')
    except (csv.Error, pd.errors.ParserError, ValueError):
        fail('INVALID_CSV')
    return create_dataset(df, Path((file.filename or 'data.csv').replace('\\', '/')).name,
                          {'encoding': encoding, 'demo': False})


@app.get('/api/versions/{ident}')
def get_version(ident: str, page: int = 1, page_size: int = 20, affected_only: bool = False):
    return version_view(ident, page, page_size, affected_only)


@app.post('/api/versions/{ident}/preview')
def preview(ident: str, op: Operation):
    return child(ident, op, False)


@app.post('/api/versions/{ident}/operations')
def operate(ident: str, op: Operation):
    return child(ident, op)


def metrics(df, name, base_rows):
    s = column(df, name)
    require_numeric(s)
    return clean({'rows': len(df), 'non_null': int(s.notna().sum()), 'missing': int(s.isna().sum()),
                  'retention': len(df)/base_rows * 100 if base_rows else 0,
                  'mean': s.mean() if s.notna().any() else None,
                  'median': s.median() if s.notna().any() else None, 'sum': s.sum(min_count=1)})


def group_values(df, group, value, agg):
    validate_aggregate(agg)
    column(df, group)
    if value is None:
        if agg != 'count':
            fail('INVALID_VALUE')
        result = df.groupby(group, dropna=False, sort=False).size()
    else:
        s = column(df, value)
        if agg != 'count':
            require_numeric(s)
        grouped = df.groupby(group, dropna=False, sort=False)[value]
        result = grouped.sum(min_count=1) if agg == 'sum' else getattr(grouped, agg)()
    # Typed keys keep the real string '(missing)' distinct from a null group.
    return {(bool(pd.isna(k)), '' if pd.isna(k) else str(k)): clean(v) for k, v in result.items()}


def group_labels(keys):
    used = {value for missing, value in keys if not missing}
    missing_label = '(missing)'
    while missing_label in used:
        missing_label += ' [null]'
    return [missing_label if missing else value for missing, value in keys]


def distributions(frames, name, bins=12):
    arrays = [column(df, name).dropna().to_numpy(dtype=float) for df in frames]
    for df in frames:
        require_numeric(column(df, name))
    union = np.concatenate(arrays)
    edges = np.histogram_bin_edges(union, bins=bins) if len(union) else np.linspace(0, 1, bins + 1)
    labels = [f'{a:.6g} – {b:.6g}' for a, b in zip(edges[:-1], edges[1:])]
    values = [(np.histogram(arr, bins=edges)[0] / len(arr) * 100).tolist() if len(arr) else [0]*bins for arr in arrays]
    return labels, values


@app.post('/api/compare')
def compare(req: CompareRequest):
    base_df = frame(req.version_id)
    require_numeric(column(base_df, req.column))
    if req.group_by:
        column(base_df, req.group_by)
    if req.aggregate not in {'sum', 'mean', 'median', 'count'}:
        fail('INVALID_AGGREGATE')
    # Validate both before persistence, so a bad B does not leave an orphan A.
    for operation in [req.a, req.b]:
        candidate, _, _ = apply_operation(base_df, operation)
        require_numeric(column(candidate, req.column))
        if req.group_by:
            column(candidate, req.group_by)
    a, b = child(req.version_id, req.a), child(req.version_id, req.b)
    frames = [base_df, frame(a['id']), frame(b['id'])]
    names = ['base', 'a', 'b']
    labels, values = distributions(frames, req.column)
    if req.group_by:
        groups = [group_values(df, req.group_by, req.column, req.aggregate) for df in frames]
        keys = list(dict.fromkeys(key for group in groups for key in group))
        group_result = {'labels': group_labels(keys), **{name: [g.get(k) for k in keys] for name, g in zip(names, groups)}}
    else:
        group_result = {'labels': [], **{name: [] for name in names}}
    return clean({'base': version_view(req.version_id), 'a': a, 'b': b, 'column': req.column,
                  'distribution': {'labels': labels, **dict(zip(names, values))}, 'groups': group_result,
                  'summary': {name: metrics(df, req.column, len(base_df)) for name, df in zip(names, frames)}})


@app.post('/api/versions/{ident}/chart')
def chart(ident: str, req: ChartRequest):
    df = frame(ident)
    column(df, req.x)
    if req.y:
        column(df, req.y)
    if req.aggregate not in {'sum', 'mean', 'median', 'count'}:
        fail('INVALID_AGGREGATE')
    result = {'type': req.type, 'x_label': req.x, 'y_label': req.y or req.aggregate,
              'labels': [], 'series': [], 'points': [], 'sampled': False, 'total_points': 0}
    if req.type in {'bar', 'line'}:
        groups = group_values(df, req.x, req.y, req.aggregate)
        result.update(labels=group_labels(groups), series=[{'name': req.y or 'count', 'data': list(groups.values())}], total_points=len(groups))
    elif req.type == 'scatter':
        require_numeric(column(df, req.x))
        require_numeric(column(df, req.y))
        points = df[[req.x, req.y]].dropna().to_numpy(dtype=float)
        points = points[np.isfinite(points).all(axis=1)]
        total = len(points)
        if total > 3000:
            points = points[np.linspace(0, total - 1, 3000, dtype=int)]
        result.update(points=points.tolist(), total_points=total, sampled=total > 3000)
    elif req.type == 'histogram':
        if not 2 <= req.bins <= 60:
            fail('INVALID_VALUE')
        require_numeric(column(df, req.x))
        s = df[req.x].dropna().to_numpy(dtype=float)
        counts, edges = np.histogram(s, bins=req.bins)
        result.update(labels=[f'{a:.6g} – {b:.6g}' for a, b in zip(edges[:-1], edges[1:])],
                      series=[{'name': 'count', 'data': counts.tolist()}], total_points=len(s), y_label='count')
    else:
        fail('INVALID_VALUE')
    return clean(result)


def csv_response(df, filename):
    return Response(business(df).to_csv(index=False).encode('utf-8-sig'), media_type='text/csv; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})


@app.get('/api/versions/{ident}/export.csv')
def export_csv(ident: str):
    return csv_response(frame(ident), 'processed.csv')


@app.get('/api/versions/{ident}/original.csv')
def original_csv(ident: str):
    ds = read_meta('datasets', read_meta('versions', ident)['dataset_id'])
    # Export is always UTF-8 BOM; generated script uses that encoding as well.
    return csv_response(frame(ds['original_version_id']), 'original.csv')


@app.get('/api/versions/{ident}/recipe.json')
def recipe(ident: str):
    meta = read_meta('versions', ident)
    ds = read_meta('datasets', meta['dataset_id'])
    return {'schema_version': 1, 'dataset_name': ds['name'], 'import_parameters': ds['import_config'],
            'operations': [s['operation'] for s in history(meta) if s['operation']]}


@app.get('/api/versions/{ident}/export.py')
def export_python(ident: str):
    meta = read_meta('versions', ident)
    ds = read_meta('datasets', meta['dataset_id'])
    code = generate_code(ds, [s['operation'] for s in history(meta) if s['operation']])
    return Response(code, media_type='text/x-python; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename="analysis.py"'})


def generate_code(ds, operations):
    """Emit only fixed templates, with user values represented as Python literals."""
    lines = ['# Generated by Pandas Lab. Requires pandas and numpy.', 'import io', 'import pandas as pd', 'import numpy as np', '']
    if any(op['type'] in ADVANCED for op in operations):
        lines += [inspect.getsource(advanced_transform), 'external_tables = {}']
        for ident in dict.fromkeys(op['params']['right_version'] for op in operations if op['type'] in {'merge','concat'}):
            payload = business(frame(ident)).to_json(orient='table',date_format='iso',index=False)
            lines += [f'external_tables[{ident!r}] = pd.read_json(io.StringIO({payload!r}), orient="table")']
    if ds['import_config'].get('demo'):
        original = business(frame(ds['original_version_id'])).to_csv(index=False)
        lines += [f'df = pd.read_csv(io.StringIO({original!r}))']
    else:
        # original.csv is the canonical UTF-8 export of the imported data; source
        # encoding is retained in the recipe, but no longer applies to this file.
        lines += ['# Download original.csv beside this script (UTF-8 BOM).', "df = pd.read_csv('original.csv', encoding='utf-8-sig')"]
    lines += ['df = df.replace([np.inf, -np.inf], np.nan)']
    for op in operations:
        p, typ = op['params'], op['type']
        c = repr(p.get('column'))
        lines += ['', f'# {typ}']
        if typ == 'filter':
            operator, val = p['operator'], repr(p.get('value'))
            if operator in {'is_null', 'not_null'}:
                expression = f'df[{c}].{"isna" if operator == "is_null" else "notna"}()'
            elif operator == 'contains':
                expression = f'df[{c}].astype("string").str.contains(str({val}), regex=False, na=False)'
            else:
                lines += [f'value = {val}', f'if pd.api.types.is_numeric_dtype(df[{c}]) and not pd.api.types.is_bool_dtype(df[{c}]): value = pd.to_numeric(value)', f'elif pd.api.types.is_datetime64_any_dtype(df[{c}]): value = pd.Timestamp(value)']
                method = {'eq':'eq', 'ne':'ne', 'gt':'gt', 'gte':'ge', 'lt':'lt', 'lte':'le'}[operator]
                expression = f'df[{c}].{method}(value).fillna(False)'
            lines += [f'df = df.loc[{expression}].copy()']
        elif typ == 'sort':
            lines += [f'df = df.sort_values({c}, ascending={p.get("ascending", True)!r}, kind="stable", na_position="last")']
        elif typ == 'convert':
            target, errors = p['target'], repr(p.get('errors', 'raise'))
            expression = f'pd.to_numeric(df[{c}], errors={errors}).replace([np.inf, -np.inf], np.nan)' if target == 'numeric' else f'pd.to_datetime(df[{c}], errors={errors})' if target == 'date' else f'df[{c}].astype("string")'
            lines += [f'df[{c}] = {expression}']
        elif typ == 'deduplicate':
            lines += [f'df = df.drop_duplicates(subset={p.get("columns") or None!r}).copy()']
        elif typ == 'fill_missing':
            method = p['method']
            if method == 'drop':
                lines += [f'df = df.dropna(subset=[{c}]).copy()']
            else:
                expression = f'df[{c}].{method}()' if method in {'mean', 'median'} else repr(p['value'])
                lines += [f'value = {expression}', f'if df[{c}].isna().any():',
                          f'    if pd.api.types.is_numeric_dtype(df[{c}]) and not pd.api.types.is_bool_dtype(df[{c}]):',
                          '        value = pd.to_numeric(value)', '        try:', f'            df[{c}] = df[{c}].fillna(value)',
                          '        except TypeError:', f'            df[{c}] = df[{c}].astype(float).fillna(value)',
                          f'    elif pd.api.types.is_datetime64_any_dtype(df[{c}]):', f'        df[{c}] = df[{c}].fillna(pd.Timestamp(value))',
                          '    else:', f'        df[{c}] = df[{c}].fillna(str(value))']
        elif typ == 'groupby':
            value, agg = repr(p['value_column']), p['aggregate']
            tail = '.sum(min_count=1)' if agg == 'sum' else f'.{agg}()'
            lines += [f'df = df.groupby({c}, dropna=False, sort=False)[{value}]{tail}.reset_index()']
        elif typ in ADVANCED:
            lines += [f'df = advanced_transform(df, {op!r}, lambda ident: external_tables[ident].copy())']
        lines += ['df = df.reset_index(drop=True)']
    lines += ['', 'df.to_csv("processed.csv", index=False, encoding="utf-8-sig")', 'print(df)', '']
    return '\n'.join(lines)


from backend.extended_api import register
import sys
register(app, sys.modules[__name__])

if (ROOT / 'dist').is_dir():
    app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True), name='frontend')
