from fastapi.testclient import TestClient
from app.main import app as main_app

client = TestClient(main_app)

def run_test():
    token = client.get("/api/session").json().get("token")
    print("token:", token)
    with client.websocket_connect(f"/api/voice/session/testconv?token={token}") as ws:
        ready = ws.receive_json()
        print("ws ready:", ready)
        ws.send_json({"event": "voice.start"})
        state = ws.receive_json()
        print("after start:", state)
        # simulate upload
        resp = client.post("/api/stt/upload", files={"file": ("rec.webm", b"", "audio/webm")}, headers={"X-Agent-Token": token})
        print("upload resp:", resp.status_code, resp.json())
        # send final
        ws.send_json({"event": "stt.final", "text": resp.json().get("text", "")})
        final = ws.receive_json()
        print("stt.final response:", final)

if __name__ == '__main__':
    run_test()
