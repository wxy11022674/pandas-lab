import io
import json
from pathlib import Path
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from backend import main

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'DATA_DIR',tmp_path/'data')
    return TestClient(main.app)

def operate(client,ident,typ,**params):
    result=client.post(f'/api/versions/{ident}/operations',json={'type':typ,'params':params})
    assert result.status_code==200,result.text
    return result.json()

def test_bootstrap_prepared_data_is_idempotent(client):
    a=client.get('/api/workspace/bootstrap').json();b=client.get('/api/workspace/bootstrap').json()
    assert a['examples']==b['examples']
    assert len(a['datasets'])==5
    raw=client.get('/api/versions/'+a['examples']['energy_2025']).json()
    ready=client.get('/api/versions/'+a['default_version']).json()
    assert (raw['rows'],raw['duplicates'],raw['total_missing'])==(99,3,15)
    assert (ready['rows'],ready['total_missing'])==(96,0)
    assert ready['example_key']=='reference'


def test_filter_threshold_counts_empty_results_and_or(client):
    pack=client.get('/api/workspace/bootstrap').json()
    source=pack['examples']['energy_2025']
    def condition(column,operator,value=None):
        return {'column':column,'operator':operator,'value':value}
    applied=operate(client,source,'filter_multi',logic='and',conditions=[condition('electricity_kwh','gt','1000')])
    assert applied['rows']==93
    assert applied['history'][-2]['rows']==99
    page=client.post('/api/versions/'+applied['id']+'/query',json={'page_size':100}).json()
    assert page['total']==93 and len(page['rows'])==93
    assert all(row['electricity_kwh']>1000 for row in page['rows'])
    # Changing the threshold against the same source gives a visible reduction.
    stronger=operate(client,source,'filter_multi',logic='and',conditions=[condition('electricity_kwh','gt','40000')])
    assert stronger['rows']==32
    empty=operate(client,source,'filter_multi',logic='and',conditions=[condition('electricity_kwh','gt','1000000')])
    assert empty['rows']==0 and empty['preview']==[]
    assert client.post('/api/versions/'+empty['id']+'/query',json={}).json()['rows']==[]
    # AND narrows the result; OR unions matches without repeating records.
    for logic in ['and','or']:
        cs=[condition('electricity_kwh','gt','40000'),condition('building_id','eq','B01')]
        result=client.post('/api/versions/'+source+'/query',json={'conditions':cs,'logic':logic,'page_size':100}).json()
        raw=main.frame(source)
        left=raw.electricity_kwh.gt(40000);right=raw.building_id.eq('B01')
        expected=raw.loc[(left & right) if logic=='and' else (left | right),'_row_id'].tolist()
        assert [r['_row_id'] for r in result['rows']]==expected
    assert client.get('/api/versions/'+source).json()['rows']==99


def test_chart_preserves_all_58_color_groups(client):
    source=client.get('/api/workspace/bootstrap').json()['default_version']
    filtered=operate(client,source,'filter_multi',logic='and',conditions=[{'column':'water_m3','operator':'gt','value':'600'}])
    assert filtered['rows']==61
    path='/api/versions/'+filtered['id']+'/visual'
    config={'type':'bar','x':'water_m3','y':'occupancy_pct','color':'energy_per_person','aggregate':'mean'}
    response=client.post(path,json=config)
    assert response.status_code==200,response.text
    grouped=response.json()
    assert len(grouped['series'])==58
    expected_groups=main.frame(filtered['id']).groupby(['water_m3','energy_per_person']).occupancy_pct.mean()
    actual={(grouped['values'][i],float(series['name'])):value for series in grouped['series'] for i,value in enumerate(series['data']) if value is not None}
    assert actual==pytest.approx(expected_groups.to_dict())
    config['color']=''
    recovered=client.post(path,json=config)
    assert recovered.status_code==200
    chart=recovered.json()
    assert chart['source_rows']==61 and len(chart['labels'])==58
    assert len(chart['series'])==1
    expected=main.frame(filtered['id']).groupby('water_m3').occupancy_pct.mean()
    assert chart['series'][0]['data']==pytest.approx(expected.tolist())

@pytest.mark.parametrize('typ',['bar','line','area'])
def test_many_categories_and_colors_use_sparse_data_without_truncation(client,typ):
    records=[{'category':f'row-{i:04d}','color':f'group-{i:04d}','amount':i+1} for i in range(600)]
    records.append({'category':None,'color':None,'amount':601})
    upload=client.post('/api/upload',files={'file':('many.json',json.dumps(records),'application/json')})
    assert upload.status_code==200,upload.text
    response=client.post('/api/versions/'+upload.json()['id']+'/visual',json={'type':typ,'x':'category','y':'amount','color':'color','aggregate':'sum'})
    assert response.status_code==200,response.text
    chart=response.json()
    assert chart['sparse'] and len(chart['labels'])==601 and len(chart['series'])==601
    points=[point for series in chart['series'] for point in series['data']]
    assert len(points)==601
    assert sum(point[1] for point in points)==sum(range(1,602))
    assert {chart['values'][point[0]]:point[1] for point in points}=={row['category']:row['amount'] for row in records}


def test_full_teaching_pipeline_and_export(client,tmp_path,monkeypatch):
    pack=client.get('/api/workspace/bootstrap').json();id=pack['examples']['energy_2025']
    v=operate(client,id,'deduplicate',columns=[])
    for column in ['electricity_kwh','water_m3','temperature_c','occupancy_pct']:
        v=operate(client,v['id'],'fill_missing',column=column,method='median')
    v=operate(client,v['id'],'text',column='meter_status',method='strip')
    v=operate(client,v['id'],'merge',right_version=pack['examples']['buildings'],left_on='building_id',right_on='building_id',how='left',validate='many_to_one')
    for name,right in [('energy_per_m2','area_m2'),('energy_per_person','capacity')]:
        v=operate(client,v['id'],'calculate',left='electricity_kwh',operator='divide',right=right,name=name)
    expected=pd.read_csv(io.BytesIO(client.get('/api/versions/'+pack['examples']['reference']+'/export.csv').content))
    actual=pd.read_csv(io.BytesIO(client.get('/api/versions/'+v['id']+'/export.csv').content))
    pd.testing.assert_frame_equal(actual,expected)
    monkeypatch.chdir(tmp_path)
    exec(client.get('/api/versions/'+v['id']+'/export.py').text,{})
    pd.testing.assert_frame_equal(pd.read_csv('processed.csv'),expected)
    assert actual.electricity_kwh.sum()==pytest.approx(3365213.34)

def test_pivot_aggregate_melt_and_resample(client):
    p=client.get('/api/workspace/bootstrap').json();id=p['default_version']
    agg=operate(client,id,'aggregate',groups=['building_type','zone'],metrics=[{'column':'electricity_kwh','aggregate':'sum'},{'column':'water_m3','aggregate':'mean'}])
    assert 'water_m3_mean' in [c['name'] for c in agg['columns']]
    pivot=operate(client,id,'pivot',rows=['building_name'],columns=['date'],value='electricity_kwh',aggregate='sum')
    assert pivot['rows']==8 and len(pivot['columns'])==13
    long=operate(client,id,'melt',ids=['building_id','date'],values=['electricity_kwh','water_m3'],variable='metric',value_name='measurement')
    assert long['rows']==192
    monthly=operate(client,id,'resample',column='date',value='electricity_kwh',rule='MS',aggregate='sum')
    expected=pd.read_csv(io.BytesIO(client.get('/api/versions/'+p['examples']['monthly']+'/export.csv').content))
    assert monthly['rows']==12
    assert [r['electricity_kwh'] for r in monthly['preview']]==pytest.approx(expected.electricity_kwh.tolist())

def test_field_operations_and_filtering(client,tmp_path,monkeypatch):
    v=client.post('/api/upload',files={'file':('tiny.csv',b'id,date,a,b,text\nx,2025-01-01,10,2, alpha-one \ny,2025-02-01,5,0,beta-two\nz,2025-01-01,,2,gamma-three\n')}).json()
    source=v['id']
    v=operate(client,v['id'],'text',column='text',method='strip')
    v=operate(client,v['id'],'text',column='text',method='replace',find='alpha',replacement='A')
    v=operate(client,v['id'],'text',column='text',method='split',separator='-',position=1,name='part')
    v=operate(client,v['id'],'calculate',left='a',right='b',operator='divide',name='ratio')
    assert [r['ratio'] for r in v['preview']]==[5,None,None]
    v=operate(client,v['id'],'date_extract',column='date',part='month',name='month')
    v=operate(client,v['id'],'rename',column='part',name='suffix')
    v=operate(client,v['id'],'drop_columns',columns=['text'])
    v=operate(client,v['id'],'clip',column='a',lower=6,upper=9)
    v=operate(client,v['id'],'sort_multi',columns=['month','a'],ascending=[False,True])
    v=operate(client,v['id'],'filter_multi',logic='or',conditions=[{'column':'a','operator':'gte','value':9},{'column':'a','operator':'is_null'}])
    assert v['rows']==2
    monkeypatch.chdir(tmp_path)
    (tmp_path/'original.csv').write_bytes(client.get(f'/api/versions/{source}/original.csv').content)
    exec(v['code'],{})
    expected=pd.read_csv(io.BytesIO(client.get('/api/versions/'+v['id']+'/export.csv').content))
    pd.testing.assert_frame_equal(pd.read_csv('processed.csv'),expected)

def test_join_validation_append_and_no_orphan_preview(client):
    pack=client.get('/api/workspace/bootstrap').json();id=pack['examples']['energy_2025']
    info=client.post(f'/api/versions/{id}/join-info',json={'right_version':pack['examples']['buildings'],'left_on':'building_id','right_on':'building_id'}).json()
    assert info['matched_left']==99 and info['unmatched_left']==0
    count=len(list((main.DATA_DIR/'versions').glob('*.json')))
    preview=client.post(f'/api/versions/{id}/preview',json={'type':'concat','params':{'right_version':pack['examples']['energy_2026']}})
    assert preview.json()['rows']==195
    assert len(list((main.DATA_DIR/'versions').glob('*.json')))==count
    failed=client.post(f'/api/versions/{id}/operations',json={'type':'merge','params':{'right_version':pack['examples']['energy_2026'],'left_on':'building_id','right_on':'building_id'}})
    assert failed.status_code==400 and failed.json()['detail']['code']=='DUPLICATE_JOIN_KEY'
    failed=client.post(f'/api/versions/{id}/operations',json={'type':'concat','params':{'right_version':pack['examples']['buildings']}})
    assert failed.json()['detail']['code']=='SCHEMA_MISMATCH'
    assert len(list((main.DATA_DIR/'versions').glob('*.json')))==count

def test_json_excel_import_and_downloads(client):
    result=client.post('/api/upload',files={'file':('sample.json',json.dumps([{'name':'a','amount':3},{'name':'b','amount':None}]).encode())})
    assert result.status_code==200 and result.json()['rows']==2
    path=main.ROOT/'examples/campus/campus-data.xlsx'
    assert path.exists()
    data=path.read_bytes()
    sheets=client.post('/api/upload/sheets',files={'file':('data.xlsx',data)}).json()['sheets']
    assert 'buildings' in sheets
    result=client.post('/api/upload',files={'file':('data.xlsx',data)},data={'sheet':'buildings'})
    assert result.status_code==200 and result.json()['rows']==8
    result=client.post('/api/upload',files={'file':('data.xlsx',data)},data={'sheet':'reference'})
    assert result.status_code==200 and result.json()['total_missing']==0
    assert client.get('/api/examples/download/reference.csv').status_code==200

def test_visual_linkage_statistics_and_query(client):
    p=client.get('/api/workspace/bootstrap').json();id=p['default_version']
    result=client.post(f'/api/versions/{id}/visual',json={'type':'bar','x':'building_name','y':'electricity_kwh','aggregate':'sum'}).json()
    assert len(result['labels'])==8
    assert sum(result['series'][0]['data'])==pytest.approx(3365213.34)
    rows=client.post(f'/api/versions/{id}/query',json={'conditions':[{'column':'building_name','operator':'eq','value':result['values'][0]}]}).json()
    assert rows['total']==12
    profile=client.get(f'/api/versions/{id}/profile?column=electricity_kwh').json()
    assert sum(profile['histogram']['counts'])==96
    hist=client.post(f'/api/versions/{id}/visual',json={'type':'histogram','x':'electricity_kwh','bins':12}).json()
    edge=hist['edges']; total=0
    for i,n in enumerate(hist['series'][0]['data']):
        rows=client.post(f'/api/versions/{id}/query',json={'conditions':[{'column':'electricity_kwh','operator':'gte','value':edge[i]},{'column':'electricity_kwh','operator':'lte' if i==11 else 'lt','value':edge[i+1]}]}).json()
        assert rows['total']==n;total+=n
    assert total==96
    stats=client.get(f'/api/versions/{id}/statistics').json()
    assert len(stats['correlation'])==len(stats['numeric'])**2

def test_walker_computation_and_reject_arbitrary_code(client):
    p=client.get('/api/workspace/bootstrap').json();id=p['default_version']
    query={'workflow':[{'type':'view','query':[{'op':'aggregate','groupBy':['zone'],'measures':[{'field':'electricity_kwh','agg':'sum','asFieldKey':'electricity_sum'}]}]},{'type':'sort','by':['electricity_sum'],'sort':'descending'}]}
    r=client.post(f'/api/versions/{id}/walker',json=query)
    assert r.status_code==200,r.text
    assert sum(row['electricity_sum'] for row in r.json())==pytest.approx(3365213.34)
    count={'workflow':[{'type':'transform','transform':[{'key':'gw_count_fid','expression':{'op':'one','params':[],'as':'gw_count_fid'}}]},{'type':'view','query':[{'op':'aggregate','groupBy':[],'measures':[{'field':'gw_count_fid','agg':'sum','asFieldKey':'total'}]}]}]}
    assert client.post(f'/api/versions/{id}/walker',json=count).json()==[{'total':96}]
    bad={'workflow':[{'type':'transform','transform':[{'key':'bad','expression':{'op':'expr','params':[{'type':'sql','value':'select something'}]}}]}]}
    assert client.post(f'/api/versions/{id}/walker',json=bad).status_code==400


def test_query_date_units_regex_limits_and_trimmed_names():
    from backend.extended_api import walker_query
    from backend.advanced import advanced_transform
    df=pd.DataFrame({'date':pd.to_datetime(['2025-01-01','2025-02-01',None]),'name':['Lab A','Dorm A','Lab B']})
    def filtered(field,rule):
        return walker_query(df,{'workflow':[{'type':'filter','filters':[{'fid':field,'rule':rule}]}]})
    start=pd.Timestamp('2025-01-01').timestamp()*1000
    end=pd.Timestamp('2025-01-31').timestamp()*1000
    assert len(filtered('date',{'type':'temporal range','value':[start,end]}))==1
    assert len(filtered('name',{'type':'regexp','value':'^Lab.*'}))==2
    with pytest.raises(ValueError): filtered('name',{'type':'regexp','value':'(a+)+'})
    assert walker_query(df,{'limit':0}).empty
    with pytest.raises(ValueError):
        advanced_transform(df,{'type':'rename','params':{'column':'date','name':' name '}},lambda _:None)
