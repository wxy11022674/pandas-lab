from fastapi.testclient import TestClient

from backend import main


def test_hosted_workspaces_are_isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DATA_DIR', tmp_path / 'data')
    monkeypatch.setattr(main, 'SESSION_ISOLATION', True)
    monkeypatch.delenv('PANDAS_LAB_COOKIE_SECURE', raising=False)
    first = TestClient(main.app)
    second = TestClient(main.app)
    a = first.get('/api/workspace/bootstrap')
    b = second.get('/api/workspace/bootstrap')
    assert a.status_code == b.status_code == 200
    assert a.headers['cache-control'] == 'no-store'
    assert 'HttpOnly' in a.headers['set-cookie']
    assert a.json()['default_version'] != b.json()['default_version']
    uploaded = first.post('/api/upload', files={'file': ('private.csv', b'value\n42\n', 'text/csv')})
    assert uploaded.status_code == 200
    ident = uploaded.json()['id']
    assert first.get(f'/api/versions/{ident}').status_code == 200
    assert second.get(f'/api/versions/{ident}').status_code == 404
    assert second.post(f'/api/versions/{ident}/operations', json={'type': 'deduplicate', 'params': {'columns': []}}).status_code == 404
    assert uploaded.json()['dataset_id'] not in {d['id'] for d in second.get('/api/workspace/bootstrap').json()['datasets']}
    assert first.get('/api/workspace/bootstrap').json()['default_version'] == a.json()['default_version']
    assert main.data_dir() == tmp_path / 'data'


def test_hosted_cookie_validation_and_https(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DATA_DIR', tmp_path / 'data')
    monkeypatch.setattr(main, 'SESSION_ISOLATION', True)
    monkeypatch.setenv('PANDAS_LAB_COOKIE_SECURE', '1')
    client = TestClient(main.app, base_url='https://testserver')
    client.cookies.set('pandas_lab_session', '../../outside')
    response = client.get('/api/workspace/bootstrap')
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie']
    assert not (tmp_path / 'outside').exists()
    assert not client.get('/api/health').headers.get('set-cookie')
