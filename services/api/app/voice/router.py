from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import secrets
from fastapi.responses import JSONResponse
from .manager import VoiceManager
from fastapi import UploadFile, File
from .stt.mock_stt import MockSTT

router = APIRouter()
manager = VoiceManager()
_stt = MockSTT()


@router.get("/api/voice/status")
def status():
    return {"ok": True, "manager": "voice manager running"}


@router.websocket("/api/voice/session/{conversation_id}")
async def ws_voice_session(websocket: WebSocket, conversation_id: str):
    # Validate token from query params before accepting websocket
    token = websocket.query_params.get("token", "")
    session_token = websocket.app.state.SESSION_TOKEN if hasattr(websocket.app.state, 'SESSION_TOKEN') else ""
    if not secrets.compare_digest(token, session_token):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session = manager.create_session(conversation_id)
    try:
        await websocket.send_json({"event": "voice.ready", "data": {"session": session.to_dict()}})
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                data = msg["text"]
                # expect JSON events
                try:
                    import json

                    payload = json.loads(data)
                except Exception:
                    await websocket.send_json({"event": "error", "data": {"message": "invalid payload"}})
                    continue
                event = payload.get("event")
                if event == "voice.start":
                    manager.start_listening(session.id)
                    await websocket.send_json({"event": "voice.state", "data": {"state": session.state}})
                elif event == "voice.stop":
                    manager.stop_listening(session.id)
                    await websocket.send_json({"event": "voice.state", "data": {"state": session.state}})
                elif event == "stt.final":
                    # forward final transcription to orchestrator as normal chat
                    text = payload.get("text", "")
                    # make a simple HTTP call to /api/chat
                    from fastapi.testclient import TestClient
                    from app.main import app as main_app

                    client = TestClient(main_app)
                    resp = client.post("/api/chat", json={"message": text, "history": [], "mode": "agent"})
                    await websocket.send_json({"event": "stt.final", "data": {"text": text, "assistant_response": resp.json()}})
                else:
                    await websocket.send_json({"event": "error", "data": {"message": "unknown event"}})
            elif "bytes" in msg:
                # binary audio frame
                data = msg["bytes"]
                manager.receive_audio_chunk(session.id, data)
    except WebSocketDisconnect:
        manager.end_session(session.id)
    except Exception as exc:
        await websocket.send_json({"event": "error", "data": {"message": str(exc)}})



@router.post("/api/stt/upload")
async def stt_upload(file: UploadFile = File(...)):
    try:
        data = await file.read()
        text = _stt.transcribe(data)
        return JSONResponse({"text": text})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)



























    except WebSocketDisconnect:
        manager.end_session(session.id)
    except Exception as exc:
        await websocket.send_json({"event": "error", "data": {"message": str(exc)}})




























