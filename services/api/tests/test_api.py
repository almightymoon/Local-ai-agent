from pathlib import Path
import sys
from urllib.error import URLError

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from app.model_runtime import LocalModelRouter

client = TestClient(app)


def test_health_route():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['ok'] is True


def test_chat_route_accepts_message():
    response = client.post('/api/chat', json={'message': 'List the repo files'})
    assert response.status_code == 200
    payload = response.json()
    assert payload['response']
    assert payload['tool_plan']


def test_local_model_router_marks_unreachable_provider_unavailable(monkeypatch):
    def raise_url_error(_url, *_args, **_kwargs):
        raise URLError('connection refused')

    monkeypatch.setattr('app.model_runtime.request.urlopen', raise_url_error)

    router = LocalModelRouter()
    status = router.status()

    assert status.provider == 'ollama'
    assert status.available is False
    assert 'reachable' in status.notes.lower() or 'not available' in status.notes.lower()


def test_workspace_file_listing_tool_reads_repo_tree():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'list_workspace_files',
        'arguments': {'path': '.'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert payload['result']['items']
    assert 'README.md' in payload['result']['items']


def test_read_file_tool_reads_repo_file():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'read_file',
        'arguments': {'path': 'README.md', 'max_lines': 20}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert '# Local AI Agent' in payload['result']['content']


def test_inspect_project_structure_tool_reports_repo_summary():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'inspect_project_structure',
        'arguments': {'path': '.'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert payload['result']['file_count'] > 0
    assert 'README.md' in payload['result']['files']
    assert 'README.md' in payload['result']['key_files']


def test_search_workspace_files_tool_finds_repo_text():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'search_workspace_files',
        'arguments': {'path': '.', 'query': 'Local AI Agent'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert payload['result']['count'] > 0
    assert any(match['file'] == 'README.md' for match in payload['result']['matches'])


def test_generate_project_plan_tool_creates_actionable_plan():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'generate_project_plan',
        'arguments': {'path': '.', 'goal': 'Ship a working local AI agent prototype'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert payload['result']['goal']
    assert payload['result']['steps']
    assert any('validate' in step.lower() or 'verify' in step.lower() for step in payload['result']['steps'])


def test_browser_navigate_tool_reads_web_page():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'browser_navigate',
        'arguments': {'url': 'https://example.com'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ready'
    assert 'example' in payload['result']['title'].lower()


def test_risky_tool_requires_approval():
    response = client.post('/api/tool/execute', json={
        'tool_name': 'terraform_apply',
        'arguments': {'environment': 'prod'}
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['requires_approval'] is True
    assert payload['status'] == 'blocked'


def test_tool_approval_endpoint_accepts_decision():
    response = client.post('/api/tool/approve', json={
        'tool_name': 'terraform_apply',
        'approved': True,
        'environment': 'prod'
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload['approved'] is True
    assert payload['status'] == 'approved'


def test_memory_route_returns_profile_snapshot():
    response = client.get('/api/memory')
    assert response.status_code == 200
    payload = response.json()
    assert payload['profile']['preferred_package_manager']


def test_skills_route_lists_verified_skills():
    response = client.get('/api/skills')
    assert response.status_code == 200
    payload = response.json()
    assert payload['skills']
    assert any(skill['state'] == 'verified' for skill in payload['skills'])


def test_tool_registry_lists_available_tools():
    response = client.get('/api/tools')
    assert response.status_code == 200
    payload = response.json()
    assert payload['tools']
    assert any(tool['name'] == 'terraform_apply' for tool in payload['tools'])


def test_memory_write_and_read_round_trip():
    write_response = client.post('/api/memory/save', json={
        'key': 'project_name',
        'value': 'local-ai-agent'
    })
    assert write_response.status_code == 200
    read_response = client.get('/api/memory/project_name')
    assert read_response.status_code == 200
    payload = read_response.json()
    assert payload['value'] == 'local-ai-agent'


def test_chat_reports_model_provider_status():
    response = client.post('/api/chat', json={'message': 'What model are you using?'})
    assert response.status_code == 200
    payload = response.json()
    assert 'provider' in payload
    assert 'model' in payload


def test_model_status_route_reports_provider_health():
    response = client.get('/api/model/status')
    assert response.status_code == 200
    payload = response.json()
    assert 'provider' in payload
    assert 'available' in payload


def test_chat_stream_route_emits_events():
    response = client.get('/api/chat/stream?message=hello')
    assert response.status_code == 200
    text = response.text
    assert 'event:' in text or 'data:' in text
