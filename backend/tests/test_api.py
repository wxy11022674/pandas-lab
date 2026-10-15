import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DATA_DIR', tmp_path / 'data')
    return TestClient(main.app)


def upload(client, csv):
    response = client.post('/api/upload', files={'file': ('test.csv', csv.encode('utf-8'), 'text/csv')})
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, ident, typ, **params):
    return client.post(f'/api/versions/{ident}/operations', json={'type': typ, 'params': params})


def test_demo_and_persisted_version(client):
    original = client.post('/api/demo').json()
    assert original['columns'][0]['name'] == '楼宇'
    assert original['rows'] == 50
    assert original['duplicates'] == 2
    child = apply(client, original['id'], 'deduplicate', columns=[]).json()
    assert child['rows'] == 48
    assert child['parent_id'] == original['id']
    assert client.get(f'/api/versions/{original["id"]}').json()['rows'] == 50
    # Nothing lives in process memory; a fresh client reads the same version.
    assert TestClient(main.app).get(f'/api/versions/{child["id"]}').json()['rows'] == 48
    assert child['history'][0]['id'] == original['id']


def test_preview_and_conversion_failure_are_immutable(client):
    original = upload(client, '楼宇,用电量\nA,4\nB,bad\n')
    path = f'/api/versions/{original["id"]}'
    fail = client.post(path + '/operations', json={'type': 'convert', 'params': {'column': '用电量', 'target': 'numeric', 'errors': 'raise'}})
    assert fail.json()['detail']['code'] == 'CONVERSION_FAILED'
    assert len(list((main.DATA_DIR / 'versions').glob('*.json'))) == 1
    response = client.post(path + '/preview', json={'type': 'convert', 'params': {'column': '用电量', 'target': 'numeric', 'errors': 'coerce'}})
    assert response.json()['id'] == 'preview'
    assert response.json()['total_missing'] == 1
    assert client.get(path).json()['total_missing'] == 0
    assert len(list((main.DATA_DIR / 'versions').glob('*.json'))) == 1


def test_compare_common_bins_independence_and_affected(client):
    original = upload(client, '楼宇,用电量\nA,10\nA,\nB,30\nB,\n')
    response = client.post('/api/compare', json={
        'version_id': original['id'], 'column': '用电量', 'group_by': '楼宇', 'aggregate': 'sum',
        'a': {'type': 'fill_missing', 'params': {'column': '用电量', 'method': 'drop'}},
        'b': {'type': 'fill_missing', 'params': {'column': '用电量', 'method': 'median'}},
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['a']['parent_id'] == result['b']['parent_id'] == original['id']
    assert result['summary']['a']['rows'] == 2
    assert result['summary']['b']['rows'] == 4
    assert result['summary']['b']['sum'] == 80
    assert result['groups']['a'] == [10, 30]
    assert result['groups']['b'] == [30, 50]
    for name in ['base', 'a', 'b']:
        assert len(result['distribution'][name]) == len(result['distribution']['labels'])
        assert sum(result['distribution'][name]) == pytest.approx(100)
    affected = client.get(f'/api/versions/{result["a"]["id"]}?affected_only=true').json()
    assert affected['total_preview_rows'] == 2
    assert all(row['用电量'] is None for row in affected['preview'])
    assert client.get(f'/api/versions/{original["id"]}').json()['rows'] == 4


def test_all_missing_sum_and_string_column(client):
    original = upload(client, '组,值,文字\nA,,hello\nA,,world\nB,,\n')
    error = apply(client, original['id'], 'fill_missing', column='值', method='mean')
    assert error.json()['detail']['code'] == 'ALL_MISSING'
    result = apply(client, original['id'], 'groupby', column='组', value_column='值', aggregate='sum').json()
    assert [row['值'] for row in result['preview']] == [None, None]
    assert apply(client, original['id'], 'fill_missing', column='文字', method='median').json()['detail']['code'] == 'NUMERIC_REQUIRED'
    filled = apply(client, original['id'], 'fill_missing', column='文字', method='constant', value='unknown').json()
    assert filled['preview'][-1]['文字'] == 'unknown'


def test_operations_and_reproducible_script(client, tmp_path, monkeypatch):
    original = upload(client, '组,值,其他\nA,1,x\nA,3,x\nA,,y\nB,8,z\nB,8,z\n')
    ident = original['id']
    operations = [
        ('fill_missing', {'column': '值', 'method': 'median'}),
        ('deduplicate', {'columns': []}),
        ('filter', {'column': '值', 'operator': 'gte', 'value': '3'}),
        ('sort', {'column': '值', 'ascending': False}),
        ('groupby', {'column': '组', 'value_column': '值', 'aggregate': 'sum'}),
    ]
    for typ, params in operations:
        response = apply(client, ident, typ, **params)
        assert response.status_code == 200, response.text
        ident = response.json()['id']
    expected = pd.read_csv(io.BytesIO(client.get(f'/api/versions/{ident}/export.csv').content))
    assert expected.to_dict('records') == [{'组': 'B', '值': 8.0}, {'组': 'A', '值': 8.5}]
    (tmp_path / 'original.csv').write_bytes(client.get(f'/api/versions/{ident}/original.csv').content)
    monkeypatch.chdir(tmp_path)
    # Controlled generated code is executed only inside the test, never by API.
    exec(client.get(f'/api/versions/{ident}/export.py').text, {})
    pd.testing.assert_frame_equal(pd.read_csv('processed.csv'), expected)
    recipe = client.get(f'/api/versions/{ident}/recipe.json').json()
    assert len(recipe['operations']) == len(operations)
    assert recipe['import_parameters']['encoding'] == 'utf-8-sig'
    assert '_row_id' not in expected.columns


def test_demo_script_reproduces(client, tmp_path, monkeypatch):
    original = client.post('/api/demo').json()
    result = apply(client, original['id'], 'fill_missing', column='用电量', method='mean').json()
    monkeypatch.chdir(tmp_path)
    exec(result['code'], {})
    expected = pd.read_csv(io.BytesIO(client.get(f'/api/versions/{result["id"]}/export.csv').content))
    pd.testing.assert_frame_equal(pd.read_csv('processed.csv'), expected)


def test_empty_reserved_security_and_finite_json(client):
    assert client.post('/api/upload', files={'file': ('empty.csv', b'', 'text/csv')}).json()['detail']['code'] == 'EMPTY_FILE'
    response = client.post('/api/upload', files={'file': ('reserved.csv', b'_row_id,x\n1,2', 'text/csv')})
    assert response.json()['detail']['code'] == 'RESERVED_COLUMN'
    assert client.get('/api/versions/not-an-id').status_code == 404
    original = upload(client, 'x,y\n1,inf\n2,-inf\n')
    assert original['preview'][0]['y'] is None
    result = apply(client, original['id'], '__import__', column='x')
    assert result.json()['detail']['code'] == 'INVALID_OPERATION'


def test_chart_count_and_sum(client):
    original = upload(client, '组,值\nA,1\nA,\nB,\n')
    path = f'/api/versions/{original["id"]}/chart'
    count = client.post(path, json={'type': 'bar', 'x': '组', 'y': '值', 'aggregate': 'count'}).json()
    assert count['series'][0]['data'] == [1, 0]
    size = client.post(path, json={'type': 'bar', 'x': '组', 'y': None, 'aggregate': 'count'}).json()
    assert size['series'][0]['data'] == [2, 1]
    sums = client.post(path, json={'type': 'bar', 'x': '组', 'y': '值', 'aggregate': 'sum'}).json()
    assert sums['series'][0]['data'] == [1, None]


def test_missing_group_distinct_from_literal_and_compare_aligned(client):
    original = upload(client, 'g,v\n(missing),1\n,2\n')
    chart = client.post(f'/api/versions/{original["id"]}/chart', json={'type': 'bar', 'x': 'g', 'y': 'v', 'aggregate': 'sum'}).json()
    assert len(set(chart['labels'])) == 2
    assert chart['series'][0]['data'] == [1, 2]
    result = client.post('/api/compare', json={
        'version_id': original['id'], 'column': 'v', 'group_by': 'g', 'aggregate': 'sum',
        'a': {'type': 'filter', 'params': {'column': 'g', 'operator': 'not_null'}},
        'b': {'type': 'filter', 'params': {'column': 'g', 'operator': 'is_null'}},
    }).json()
    assert len(set(result['groups']['labels'])) == 2
    assert result['groups']['base'] == [1, 2]
    assert result['groups']['a'] == [1, None]
    assert result['groups']['b'] == [None, 2]


def test_wider_csv_rejected_and_quoted_newline_accepted(client):
    response = client.post('/api/upload', files={'file': ('bad.csv', b'x,y\n1,2,3\n4,5,6\n', 'text/csv')})
    assert response.status_code == 400
    assert response.json()['detail']['code'] == 'INVALID_CSV'
    original = upload(client, 'x,y\n"a\nb",2\nc,3\n')
    assert original['rows'] == 2
    assert original['preview'][0]['x'] == 'a\nb'


def test_noop_fill_keeps_exact_large_integers_and_script(client, tmp_path, monkeypatch):
    original = upload(client, 'n\n9007199254740993\n9007199254740995\n')
    result = apply(client, original['id'], 'fill_missing', column='n', method='median').json()
    assert [row['n'] for row in result['preview']] == ['9007199254740993', '9007199254740995']
    assert isinstance(result['preview'][0]['_row_id'], int)
    assert isinstance(result['columns'][0]['stats']['mean'], (float, int))
    assert result['changed_ids'] == []
    assert result['columns'][0]['dtype'] == original['columns'][0]['dtype']
    (tmp_path / 'original.csv').write_bytes(client.get(f'/api/versions/{result["id"]}/original.csv').content)
    monkeypatch.chdir(tmp_path)
    exec(result['code'], {})
    assert pd.read_csv('processed.csv')['n'].tolist() == [9007199254740993, 9007199254740995]


def test_boolean_filter_script_matches_interpreter(client, tmp_path, monkeypatch):
    original = upload(client, 'b\nTrue\nFalse\n')
    result = apply(client, original['id'], 'filter', column='b', operator='eq', value='True').json()
    assert result['rows'] == 0
    (tmp_path / 'original.csv').write_bytes(client.get(f'/api/versions/{result["id"]}/original.csv').content)
    monkeypatch.chdir(tmp_path)
    exec(result['code'], {})
    assert len(pd.read_csv('processed.csv')) == 0
