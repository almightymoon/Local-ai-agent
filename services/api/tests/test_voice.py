import json
from fastapi.testclient import TestClient
from app.main import app, SESSION_TOKEN

client = TestClient(app, headers={"X-Agent-Token": SESSION_TOKEN})


def test_voice_status_and_ws_session():
    resp = client.get("/api/voice/status")
    assert resp.status_code == 200 and resp.json()["ok"]

    with client.websocket_connect(f"/api/voice/session/testconv?token={SESSION_TOKEN}") as ws:
        msg = ws.receive_json()
        assert msg["event"] == "voice.ready"
        # start listening
        ws.send_json({"event": "voice.start"})
        msg = ws.receive_json()
        assert msg["event"] == "voice.state"
        # send final stt event and expect a chat response wrapper
        ws.send_json({"event": "stt.final", "text": "Hello world"})
        resp = ws.receive_json()
        assert resp["event"] == "stt.final"
        assert "assistant_response" in resp["data"]
