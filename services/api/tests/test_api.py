import hashlib
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.error import URLError
import pytest
from fastapi.testclient import TestClient
from app.main import app, SESSION_TOKEN, model_router
from app.model_runtime import LocalModelRouter
from app import store
from app.tools import registry, filesystem, browser

client = TestClient(app, headers={"X-Agent-Token": SESSION_TOKEN})


def execute(name, args=None):
    return client.post(
        "/api/tool/execute", json={"tool_name": name, "arguments": args or {}}
    ).json()


def chat(message="Inspect this repository", history=None):
    return client.post(
        "/api/chat", json={"message": message, "history": history or []}
    ).json()


def stream_chunks(content="", calls=None):
    yield {"message": {"content": content, "tool_calls": calls or []}}
    yield {"done": True}


def call(name, **args):
    return {"function": {"name": name, "arguments": args}}


def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(filesystem, "WORKSPACE_ROOT", tmp_path)
    monkeypatch.setattr(registry, "WORKSPACE_ROOT", tmp_path)


def test_health_and_token():
    assert client.get("/health").json()["ok"]
    assert client.get("/api/session").json()["token"] == SESSION_TOKEN
    assert TestClient(app).get("/api/tools").status_code == 401


def test_host_and_origin_restrictions():
    assert (
        client.get(
            "/api/session", headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/session", headers={"Origin": "null"}).status_code == 403
    assert (
        client.get("/api/session", headers={"Host": "evil.example"}).status_code == 400
    )
    response = client.options(
        "/api/chat/stream",
        headers={
            "Origin": "localagent://app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Agent-Token,Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "localagent://app"


def test_model_unavailable(monkeypatch):
    def fail(*_args, **_kwargs):
        raise URLError("refused")

    monkeypatch.setattr("app.model_runtime.request.urlopen", fail)
    assert not LocalModelRouter().status().available
    result = chat()
    assert any(e["event"] == "error" for e in result["events"])
    assert result["tool_plan"] == []


def test_read_tools():
    assert "README.md" in execute("list_workspace_files")["result"]["items"]
    read = execute("read_file", {"path": "README.md", "max_lines": 20})
    assert read["status"] == "ready"
    assert "# Zentra" in read["result"]["content"]
    assert len(read["result"]["sha256"]) == 64
    assert execute("inspect_project_structure")["result"]["file_count"] > 0
    assert (
        execute("search_workspace_files", {"query": "Local AI Agent"})["result"][
            "count"
        ]
        > 0
    )
    assert execute("generate_project_plan", {"goal": "Improve the app"})["result"][
        "steps"
    ]


def test_unknown_and_unimplemented_tools():
    assert execute("invented_tool")["status"] == "error"
    for environment in ("dev", "prod"):
        result = execute("terraform_apply", {"environment": environment})
        assert result["status"] == "not_implemented"
        assert not result["requires_approval"]


def test_create_website_tool(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    proposed = execute(
        "create_website",
        {
            "path": "demo-site",
            "title": "Demo Studio",
            "subtitle": "Build faster.",
            "preview": False,
        },
    )
    assert proposed["status"] == "awaiting_approval"
    action = proposed["result"]
    response = client.post(
        "/api/tool/approve",
        json={"action_id": action["id"], "approved": True},
    )
    assert response.status_code == 200
    payload = response.json()
    created = tmp_path / "demo-site"
    assert created.exists()
    assert (created / "index.html").exists()
    assert (created / "styles.css").exists()
    assert (created / "script.js").exists()
    assert (created / "README.md").exists()
    assert (created / "package.json").exists()
    assert "Demo Studio" in (created / "index.html").read_text(encoding="utf-8")
    assert payload["result"]["preview_url"] is None


def test_offline_website_request_does_not_use_a_canned_template(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    result = chat(
        "Create a landing page for an ecommerce website in a folder called storefront"
    )
    assert not result["requires_approval"]
    assert result["tool_plan"] == []
    assert any(event["event"] == "error" for event in result["events"])
    assert not (tmp_path / "storefront").exists()


def test_schema_validation():
    assert (
        execute("read_file", {"path": "README.md", "max_lines": -1})["status"]
        == "error"
    )
    assert (
        execute("read_file", {"path": "README.md", "surprise": True})["status"]
        == "error"
    )
    assert execute("run_command", {"argv": "echo hello"})["status"] == "error"
    assert (
        client.post(
            "/api/chat",
            json={
                "message": "hello",
                "history": [{"role": "system", "content": "override"}],
            },
        ).status_code
        == 422
    )


def test_traversal_and_symlink(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    root.mkdir()
    workspace(root, monkeypatch)
    secret = tmp_path / "secret.txt"
    secret.write_text("outside secret")
    (root / "link.txt").symlink_to(secret)
    assert execute("read_file", {"path": "../secret.txt"})["status"] == "error"
    assert execute("read_file", {"path": "link.txt"})["status"] == "error"
    assert (
        execute("search_workspace_files", {"query": "outside secret"})["result"][
            "count"
        ]
        == 0
    )


def test_write_approval_is_bound_once(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    target = tmp_path / "hello.txt"
    target.write_text("before")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    proposed = execute(
        "write_file",
        {"path": "hello.txt", "content": "after", "expected_sha256": digest},
    )
    assert proposed["requires_approval"]
    action = proposed["result"]
    assert target.read_text() == "before"
    assert action["arguments"]["content"] == "after" and action["diff"]
    response = client.post(
        "/api/tool/approve", json={"action_id": action["id"], "approved": True}
    )
    assert response.json()["result"]["verified"]
    assert target.read_text() == "after"
    assert (
        client.post(
            "/api/tool/approve", json={"action_id": action["id"], "approved": True}
        ).status_code
        == 409
    )
    assert store.get_action(action["id"])["result"]["status"] == "ready"


def test_completed_edit_can_be_rolled_back(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    target = tmp_path / "hello.txt"
    target.write_text("before")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    action = execute("write_file", {"path": "hello.txt", "content": "after", "expected_sha256": digest})["result"]
    assert client.post("/api/tool/approve", json={"action_id": action["id"], "approved": True}).status_code == 200
    rolled_back = client.post("/api/tool/rollback", json={"action_id": action["id"]})
    assert rolled_back.status_code == 200
    assert target.read_text() == "before"
    assert client.post("/api/tool/rollback", json={"action_id": action["id"]}).status_code == 409


def test_related_file_edits_share_one_review(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    existing = tmp_path / "existing.txt"
    existing.write_text("before")
    digest = hashlib.sha256(existing.read_bytes()).hexdigest()
    proposal = execute(
        "write_files",
        {
            "files": [
                {"path": "existing.txt", "content": "after", "expected_sha256": digest},
                {"path": "new.txt", "content": "created", "expected_sha256": "new"},
            ]
        },
    )
    assert proposal["requires_approval"]
    action = proposal["result"]
    assert action["tool"] == "write_files"
    assert "existing.txt" in action["diff"] and "new.txt" in action["diff"]
    assert existing.read_text() == "before" and not (tmp_path / "new.txt").exists()
    response = client.post("/api/tool/approve", json={"action_id": action["id"], "approved": True})
    assert response.status_code == 200
    assert response.json()["result"]["count"] == 2
    assert existing.read_text() == "after"
    assert (tmp_path / "new.txt").read_text() == "created"


def test_approval_modes_control_writes_and_commands(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    assert client.get("/api/approval-mode").json() == {"mode": "ask"}
    assert client.post("/api/approval-mode", json={"mode": "edits"}).json() == {"mode": "edits"}
    write = execute("write_file", {"path": "auto.txt", "content": "saved", "expected_sha256": "new"})
    assert write["status"] == "ready" and (tmp_path / "auto.txt").read_text() == "saved"
    command = execute("run_command", {"argv": [sys.executable, "-c", "print('check')"]})
    assert command["requires_approval"]
    assert client.post("/api/approval-mode", json={"mode": "all"}).json() == {"mode": "all"}
    command = execute("run_command", {"argv": [sys.executable, "-c", "print('check')"]})
    assert command["status"] == "ready" and "check" in command["result"]["output"]
    assert client.post("/api/approval-mode", json={"mode": "invalid"}).status_code == 422
    assert client.post("/api/approval-mode", json={"mode": "ask"}).json() == {"mode": "ask"}


def test_changed_file_rejects_approval(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    target = tmp_path / "new.txt"
    action = execute(
        "write_file",
        {"path": "new.txt", "content": "proposed", "expected_sha256": "new"},
    )["result"]
    target.write_text("user edit")
    response = client.post(
        "/api/tool/approve", json={"action_id": action["id"], "approved": True}
    ).json()
    assert response["status"] == "error"
    assert target.read_text() == "user edit"


def test_rejection_and_expiry(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    action = execute(
        "write_file", {"path": "new.txt", "content": "no", "expected_sha256": "new"}
    )["result"]
    assert (
        client.post(
            "/api/tool/approve", json={"action_id": action["id"], "approved": False}
        ).json()["status"]
        == "rejected"
    )
    assert not (tmp_path / "new.txt").exists()
    expired = store.create_action("write_file", {}, tmp_path, "write")
    with store.connection() as db:
        db.execute(
            "UPDATE actions SET expires=? WHERE id=?", (time.time() - 1, expired["id"])
        )
    assert (
        client.post(
            "/api/tool/approve", json={"action_id": expired["id"], "approved": True}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/tool/approve", json={"tool_name": "write_file", "approved": True}
        ).status_code
        == 422
    )


def test_concurrent_approval_claim(tmp_path):
    action = store.create_action("run_command", {}, tmp_path, "critical")

    def claim():
        try:
            store.claim_action(action["id"], True)
            return True
        except ValueError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: claim(), range(2))).count(True) == 1


def test_real_model_selected_loop_and_memory(monkeypatch):
    store.save_memory("package_manager", "pnpm")
    observed = []

    def provider(messages, tools):
        observed.append(json.loads(json.dumps(messages)))
        assert any(t["function"]["name"] == "read_file" for t in tools)
        if len(observed) == 1:
            yield from stream_chunks(
                calls=[call("read_file", path="README.md", max_lines=5)]
            )
        else:
            yield from stream_chunks("This project is a local agent.")

    monkeypatch.setattr(model_router, "stream_chat", provider)
    result = chat("Explain this", [{"role": "user", "content": "Earlier context"}])
    assert result["tool_plan"] == ["read_file"]
    assert result["response"] == "This project is a local agent."
    assert "pnpm" in observed[0][0]["content"]
    assert observed[0][1]["content"] == "Earlier context"
    assert observed[1][-1]["role"] == "tool"


def test_approval_resumes_remaining_calls(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    turns = []

    def provider(messages, _tools):
        turns.append(json.loads(json.dumps(messages)))
        if len(turns) == 1:
            yield from stream_chunks(
                calls=[
                    call(
                        "write_file",
                        path="new.txt",
                        content="hello",
                        expected_sha256="new",
                    ),
                    call("read_file", path="new.txt"),
                ]
            )
        else:
            yield from stream_chunks("Verified the edit.")

    monkeypatch.setattr(model_router, "stream_chat", provider)
    result = chat("Write hello")
    action = next(e["data"] for e in result["events"] if e["event"] == "approval")
    response = client.post(
        "/api/chat/resume", json={"action_id": action["id"], "approved": True}
    )
    assert "Verified the edit." in response.text
    assert (tmp_path / "new.txt").read_text() == "hello"
    assert turns[-1][-1]["tool_name"] == "read_file"
    assert (
        client.post(
            "/api/chat/resume", json={"action_id": action["id"], "approved": True}
        ).status_code
        == 409
    )


def test_step_budget(monkeypatch):
    monkeypatch.setattr(
        model_router,
        "stream_chat",
        lambda *_: stream_chunks(calls=[call("list_workspace_files")]),
    )
    result = chat()
    assert len(result["tool_plan"]) == 12
    assert any("12-step" in e["data"].get("message", "") for e in result["events"])


def test_stream_preserves_whitespace(monkeypatch):
    def provider(*_args):
        yield {"message": {"content": "first\n"}}
        yield {"message": {"content": "  second"}}

    monkeypatch.setattr(model_router, "stream_chat", provider)
    response = client.post("/api/chat/stream", json={"message": "hello"})
    data = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert "".join(d.get("text", "") for d in data) == "first\n  second"
    assert "event: done" in response.text


def test_ollama_stream_uses_chat(monkeypatch):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def __iter__(self):
            return iter([b'{"message":{"content":"hello"}}\n', b'{"done":true}\n'])

    seen = []

    def open_request(req, **_kwargs):
        seen.append(req)
        return Response()

    monkeypatch.setattr("app.model_runtime.request.urlopen", open_request)
    assert (
        list(LocalModelRouter().stream_chat([{"role": "user", "content": "Hi"}], []))[
            0
        ]["message"]["content"]
        == "hello"
    )
    assert seen[0].full_url.endswith("/api/chat")
    assert json.loads(seen[0].data)["stream"] is True


def test_chat_ask_mode_returns_plain_response(monkeypatch):
    # Provider that returns a simple message without tool calls
    def provider(messages, _tools):
        yield {"message": {"content": "Just an answer."}}

    monkeypatch.setattr(model_router, "stream_chat", provider)
    response = client.post(
        "/api/chat",
        json={"message": "hello", "history": [], "mode": "ask"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["response"] == "Just an answer."
    assert payload["tool_plan"] == []
    assert payload["requires_approval"] is False


def test_chat_plan_mode_requests_plan(monkeypatch):
    # Simulate a planner response
    def provider(messages, _tools):
        # The system role should be present for plan mode
        assert any(m.get("role") == "system" for m in messages)
        yield {"message": {"content": "1. Do A\n2. Do B"}}

    monkeypatch.setattr(model_router, "stream_chat", provider)
    response = client.post(
        "/api/chat",
        json={"message": "Plan how to refactor", "history": [], "mode": "plan"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "1. Do A" in payload["response"]
    assert payload["tool_plan"] == []
    assert payload["requires_approval"] is False


def test_memory_and_skills():
    assert client.get("/api/memory").json()["profile"] == {}
    assert (
        client.post(
            "/api/memory/save", json={"key": "manager", "value": "pnpm"}
        ).status_code
        == 200
    )
    assert client.get("/api/memory/manager").json()["value"] == "pnpm"
    assert client.get("/api/memory/missing").status_code == 404
    assert isinstance(client.get("/api/skills").json()["skills"], list)
    assert any(
        t["name"] == "write_file" for t in client.get("/api/tools").json()["tools"]
    )


def test_browser_blocks_private_dns(monkeypatch):
    monkeypatch.setattr(
        browser.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(2, 1, 6, "", ("127.0.0.1", 80))],
    )
    assert (
        execute("browser_navigate", {"url": "http://internal.example"})["status"]
        == "error"
    )
    with pytest.raises(ValueError):
        browser.fetch_webpage_title("file:///etc/passwd")


def test_browser_fetch_is_offline_and_redirect_checked(monkeypatch):
    seen = []

    class Socket:
        def close(self):
            pass

    class Response:
        status = 200

        def getheader(self, name, default=None):
            return "text/html" if name == "Content-Type" else default

        def read(self, _limit):
            return b"<title>Example</title><p>Public page</p>"

    class Connection:
        def __init__(self, *_args, **_kwargs):
            pass

        def request(self, *_args, **_kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(
        browser.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(2, 1, 6, "", ("93.184.216.34", 80))],
    )
    monkeypatch.setattr(
        browser.socket,
        "create_connection",
        lambda target, **_kwargs: seen.append(target) or Socket(),
    )
    monkeypatch.setattr(browser.http.client, "HTTPConnection", Connection)
    result = execute("browser_navigate", {"url": "http://example.com"})
    assert result["result"]["title"] == "Example"
    assert seen == [("93.184.216.34", 80)]
    Response.status = 302
    Response.getheader = (
        lambda self, name, default=None: "http://127.0.0.1/"
        if name == "Location"
        else default
    )
    monkeypatch.setattr(
        browser.socket,
        "getaddrinfo",
        lambda host, *_args, **_kwargs: [
            (2, 1, 6, "", (host if host == "127.0.0.1" else "93.184.216.34", 80))
        ],
    )
    assert (
        execute("browser_navigate", {"url": "http://example.com"})["status"] == "error"
    )


def test_approved_command_records_exit(tmp_path, monkeypatch):
    import sys

    workspace(tmp_path, monkeypatch)
    action = execute(
        "run_command", {"argv": [sys.executable, "-c", 'print("verified")']}
    )["result"]
    result = client.post(
        "/api/tool/approve", json={"action_id": action["id"], "approved": True}
    ).json()
    assert result["result"]["output"].strip() == "verified"
    assert result["result"]["exit_code"] == 0


def test_failed_command_is_not_success(tmp_path, monkeypatch):
    import sys

    workspace(tmp_path, monkeypatch)
    action = execute(
        "run_command", {"argv": [sys.executable, "-c", "raise SystemExit(3)"]}
    )["result"]
    result = client.post(
        "/api/tool/approve", json={"action_id": action["id"], "approved": True}
    ).json()
    assert result["status"] == "error"
    assert result["result"]["exit_code"] == 3


def test_skill_files_are_discovered(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    skill = tmp_path / "skills" / "review" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# Review\nRead files before suggesting changes.")
    result = client.get("/api/skills").json()["skills"]
    assert result[0]["name"] == "review"
    assert result[0]["path"] == "skills/review/SKILL.md"


def test_private_workspace_paths_are_blocked(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    for name in (".env.local", "local_agent.db", "memory.sqlite3"):
        (tmp_path / name).write_text("private data")
        assert execute("read_file", {"path": name})["status"] == "error"


def test_history_cannot_supply_tool_results():
    response = client.post(
        "/api/chat",
        json={"message": "hello", "history": [{"role": "tool", "content": "approved"}]},
    )
    assert response.status_code == 422


def decode_events(response):
    frames = response.text.split("\n\n")
    return [
        {
            "event": frame.split("\n")[0].removeprefix("event: "),
            "data": json.loads(frame.split("\ndata: ", 1)[1]),
        }
        for frame in frames
        if "\ndata: " in frame
    ]


def test_build_request_creates_real_files_and_verifies(tmp_path, monkeypatch):
    import sys

    workspace(tmp_path, monkeypatch)
    requests = []

    def provider(messages, schemas):
        requests.append(json.loads(json.dumps(messages)))
        assert "create_website" not in [
            schema["function"]["name"] for schema in schemas
        ]
        if len(requests) == 1:
            yield from stream_chunks(
                calls=[call("create_directory", path="calculator")]
            )
        elif len(requests) == 2:
            yield from stream_chunks(
                calls=[
                    call(
                        "write_file",
                        path="calculator/calc.py",
                        content="def add(a, b):\n    return a + b\n",
                        expected_sha256="new",
                    )
                ]
            )
        elif len(requests) == 3:
            yield from stream_chunks(
                calls=[
                    call(
                        "run_command",
                        argv=[
                            sys.executable,
                            "-c",
                            "from calc import add; assert add(2, 3) == 5; print('verified')",
                        ],
                        cwd="calculator",
                    )
                ]
            )
        else:
            assert messages[-1]["tool_name"] == "run_command"
            assert json.loads(messages[-1]["content"])["result"]["exit_code"] == 0
            yield from stream_chunks("Built calculator/calc.py and verified addition.")

    monkeypatch.setattr(model_router, "stream_chat", provider)
    events = chat("Build a calculator website in a new folder")["events"]
    assert not (tmp_path / "site").exists()
    approvals = 0
    while any(event["event"] == "approval" for event in events):
        action = next(event["data"] for event in events if event["event"] == "approval")
        assert action["tool"] in {"create_directory", "write_file", "run_command"}
        events = decode_events(
            client.post(
                "/api/chat/resume", json={"action_id": action["id"], "approved": True}
            )
        )
        approvals += 1
        assert approvals <= 3
    assert approvals == 3
    assert (tmp_path / "calculator/calc.py").read_text().startswith("def add")
    assert any(
        event["data"].get("text") == "Built calculator/calc.py and verified addition."
        for event in events
    )
    assert len(requests) == 4


@pytest.mark.parametrize("mode", ["ask", "plan"])
def test_non_agent_modes_do_not_offer_tools(monkeypatch, mode):
    def provider(messages, tools):
        assert tools == []
        assert mode.title() + " mode" in messages[0]["content"]
        yield from stream_chunks("Here is the response.")

    monkeypatch.setattr(model_router, "stream_chat", provider)
    response = client.post(
        "/api/chat", json={"message": "Build a website", "mode": mode}
    ).json()
    assert response["response"] == "Here is the response."
    assert response["tool_plan"] == []
    assert not response["requires_approval"]


def test_non_agent_error_finishes_stream():
    response = client.post("/api/chat/stream", json={"message": "hello", "mode": "ask"})
    events = decode_events(response)
    assert events[-1] == {"event": "done", "data": {"status": "stopped"}}
    assert any(event["event"] == "error" for event in events)


def test_rejected_build_continues_without_writing(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    count = 0

    def provider(messages, _tools):
        nonlocal count
        count += 1
        if count == 1:
            yield from stream_chunks(
                calls=[call("create_directory", path="new-project")]
            )
        else:
            assert json.loads(messages[-1]["content"])["status"] == "rejected"
            yield from stream_chunks("The action was rejected; no files were created.")

    monkeypatch.setattr(model_router, "stream_chat", provider)
    events = chat("Build a website")["events"]
    action = next(event["data"] for event in events if event["event"] == "approval")
    response = client.post(
        "/api/chat/resume", json={"action_id": action["id"], "approved": False}
    )
    assert "no files were created" in response.text
    assert not (tmp_path / "new-project").exists()


def test_ide_workspace_identity(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    data = client.get('/api/ide/workspace').json()
    assert data['root'] == str(tmp_path)
    assert data['protocol'] == 1
    assert TestClient(app).get('/api/ide/workspace').status_code == 401


def test_workspace_endpoint_reports_the_active_agent_root(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    data = client.get('/api/workspace').json()
    assert data == {'root': str(tmp_path), 'name': tmp_path.name}
    assert TestClient(app).get('/api/workspace').status_code == 401


def test_complete_text_tools_only():
    from app.agent.orchestrator import text_tool_calls
    valid = '{"name":"read_file","arguments":{"path":"file{a}.txt"}}'
    schemas = registry.schemas()
    assert len(text_tool_calls(valid, schemas)) == 1
    assert len(text_tool_calls('```json\n' + valid + '\n```', schemas)) == 1
    assert len(text_tool_calls('[' + valid + ',' + valid + ']', schemas)) == 2
    for text in ['Example: ' + valid, valid + ' Explanation', valid[:-1], '{"name":"unknown","arguments":{}}', '{"name":[],"arguments":{}}', '{"name":"read_file","arguments":{},"example":true}']:
        assert text_tool_calls(text, schemas) == []


def test_fragmented_text_call_executes_once(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    (tmp_path / 'example.txt').write_text('hello')
    turns = []
    def model(messages, _tools):
        turns.append(messages.copy())
        if len(turns) == 1:
            raw = '{"name":"read_file","arguments":{"path":"example.txt"}}'
            for char in raw:
                yield {'message': {'content': char}}
        else:
            yield {'message': {'content': 'The file says hello.'}}
    monkeypatch.setattr(model_router, 'stream_chat', model)
    response = chat()
    assert response['tool_plan'] == ['read_file']
    assert response['response'] == 'The file says hello.'
    assert len(turns) == 2


def test_native_call_takes_precedence_over_text(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    turns = []
    def model(messages, _tools):
        turns.append(messages.copy())
        if len(turns) == 1:
            yield {'message': {'content': '{"name":"list_workspace_files","arguments":{}}', 'tool_calls': [call('list_workspace_files')]}}
        else:
            yield {'message': {'content': 'Done.'}}
    monkeypatch.setattr(model_router, 'stream_chat', model)
    assert chat()['tool_plan'] == ['list_workspace_files']


def test_model_selection_lists_validates_and_persists(monkeypatch):
    installed = [{'name': name, 'size': 100} for name in ['gemma4:26b', 'qwen2.5-coder-32k:latest', 'qwen2.5-coder:7b']]
    monkeypatch.setattr(model_router, 'installed_models', lambda: installed)
    monkeypatch.setattr(model_router, 'model', 'qwen2.5-coder:7b')
    assert client.get('/api/models').json()['models'] == installed
    assert TestClient(app).post('/api/model/select', json={'model': 'gemma4:26b'}).status_code == 401
    assert client.post('/api/model/select', json={'model': 'not-installed'}).status_code == 400
    result = client.post('/api/model/select', json={'model': 'gemma4:26b'})
    assert result.status_code == 200
    assert result.json()['selected'] == model_router.model == 'gemma4:26b'
    assert store.get_setting('ollama_model') == 'gemma4:26b'


def test_model_selection_offline_does_not_change_model(monkeypatch):
    def offline():
        raise OSError('Ollama offline')
    monkeypatch.setattr(model_router, 'installed_models', offline)
    before = model_router.model
    assert client.get('/api/models').status_code == 503
    assert client.post('/api/model/select', json={'model': 'gemma4:26b'}).status_code == 503
    assert model_router.model == before


def test_approval_continuation_pins_original_model(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    monkeypatch.setattr(model_router, 'model', 'original-model')
    monkeypatch.setattr(model_router, 'stream_chat', lambda *_: stream_chunks(calls=[call('write_file', path='hello.txt', content='hello', expected_sha256='new')]))
    action = next(e['data'] for e in chat()['events'] if e['event'] == 'approval')
    assert store.get_action(action['id'])['continuation']['model'] == 'original-model'
    monkeypatch.setattr(model_router, 'model', 'new-selection')
    seen = []
    def resumed(self, *_):
        seen.append(self.model)
        yield from stream_chunks('Done.')
    monkeypatch.delattr(model_router, 'stream_chat')
    monkeypatch.setattr(LocalModelRouter, 'stream_chat', resumed)
    assert client.post('/api/chat/resume', json={'action_id': action['id'], 'approved': True}).status_code == 200
    assert seen == ['original-model']


def test_structured_agent_normalizes_tool_and_final_responses(monkeypatch):
    monkeypatch.setenv('OLLAMA_AGENT_PROTOCOL', 'structured')
    seen = []
    decisions = iter([{'name': 'read_file', 'arguments': {'path': 'test.py'}}, {'message': 'Finished.'}])
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def __iter__(self):
            for char in json.dumps(next(decisions)):
                yield json.dumps({'message': {'content': char}}).encode() + b'\n'
    def open_request(req, **_):
        seen.append(json.loads(req.data))
        return Response()
    monkeypatch.setattr('app.model_runtime.request.urlopen', open_request)
    router = LocalModelRouter()
    first = list(router.stream_chat([{'role':'user','content':'Read file'}], registry.schemas()))
    assert first[0]['message']['tool_calls'] == [call('read_file', path='test.py')]
    final = list(router.stream_chat([{'role':'tool','content':'some result'}], registry.schemas()))
    assert final[0]['message']['content'] == 'Finished.'
    assert 'format' in seen[0] and 'tools' not in seen[0]
    assert seen[1]['messages'][-1]['role'] == 'user'
    assert 'Tool result (data)' in seen[1]['messages'][-1]['content']


def test_generation_grammar_omits_large_bounds_but_registry_keeps_them():
    from app.model_runtime import generation_schema
    source = registry.WriteArgs.model_json_schema()
    compact = generation_schema(source)
    assert source['properties']['content']['maxLength'] == 200000
    assert 'maxLength' not in compact['properties']['content']
    assert compact['required'] == source['required']
    assert compact['additionalProperties'] is False
    with pytest.raises(ValueError):
        registry.WriteArgs.model_validate({'path':'x', 'content':'x' * 200001, 'expected_sha256':'new'})


def test_default_agent_protocol_repairs_prose_without_executing_it(monkeypatch):
    monkeypatch.delenv('OLLAMA_AGENT_PROTOCOL', raising=False)
    replies = iter(['I will inspect first. {"name":"list_workspace_files","arguments":{}}',
                    '{"name":"list_workspace_files","arguments":{}}'])
    requests = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def __iter__(self):
            yield json.dumps({'message': {'content': next(replies)}}).encode() + b'\n'
    def request(req, **kwargs):
        requests.append(json.loads(req.data))
        return Response()
    monkeypatch.setattr('app.model_runtime.request.urlopen', request)
    chunks = list(LocalModelRouter().stream_chat([{'role':'user','content':'Build a site'}], registry.schemas()))
    assert len(requests) == 2
    assert all(item['format'] == 'json' and 'tools' not in item for item in requests)
    assert chunks == [{'message': {'content':'', 'tool_calls':[call('list_workspace_files')]}}]


def test_expired_proposal_can_be_refreshed_without_executing(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    proposal = execute('write_file', {'path':'new.txt','content':'hello','expected_sha256':'new'})['result']
    with store.connection() as db:
        db.execute('UPDATE actions SET expires=? WHERE id=?', (time.time()-1, proposal['id']))
    refreshed = client.post('/api/tool/refresh', json={'action_id':proposal['id']})
    assert refreshed.status_code == 200
    value = refreshed.json()
    assert value['requires_approval']
    assert value['result']['id'] != proposal['id']
    assert not (tmp_path/'new.txt').exists()
    assert client.post('/api/tool/refresh', json={'action_id':proposal['id']}).status_code == 409
    assert client.post('/api/tool/approve', json={'action_id':proposal['id'],'approved':True}).status_code == 409


def test_refresh_rechecks_file_hash(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    proposal = execute('write_file', {'path':'new.txt','content':'hello','expected_sha256':'new'})['result']
    with store.connection() as db:
        db.execute('UPDATE actions SET expires=? WHERE id=?', (time.time()-1, proposal['id']))
    (tmp_path/'new.txt').write_text('someone else wrote this')
    response = client.post('/api/tool/refresh', json={'action_id':proposal['id']}).json()
    assert response['status'] == 'error'
    assert (tmp_path/'new.txt').read_text() == 'someone else wrote this'


def test_ask_prompt_is_contextual_and_does_not_execute(tmp_path, monkeypatch):
    workspace(tmp_path, monkeypatch)
    (tmp_path/'package.json').write_text('{"name":"sample-app","dependencies":{"react":"18"}}')
    def provider(messages, tools):
        assert not tools
        prompt = messages[0]['content']
        assert 'Ask mode' in prompt and 'sample-app' in prompt
        assert 'instead of repeating' in prompt
        assert 'Never create files' in prompt
        yield from stream_chunks('Try this concrete next step.')
    monkeypatch.setattr(model_router, 'stream_chat', provider)
    assert client.post('/api/chat', json={'message':'More ideas please', 'mode':'ask'}).json()['tool_plan'] == []
