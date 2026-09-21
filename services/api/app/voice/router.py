from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import secrets
from fastapi.responses import JSONResponse
from .manager import VoiceManager
from fastapi import UploadFile, File
from .stt.mock_stt import get_stt_provider
import time
import os

router = APIRouter()
manager = VoiceManager()
# instantiate configured STT provider
STT_NAME = os.environ.get("STT_PROVIDER", "mock")
try:
    _stt = get_stt_provider(STT_NAME)
except Exception as e:
    _log(f"stt provider load failed: {e}")
    _stt = get_stt_provider("mock")
else:
    try:
        _log(f"stt provider: {type(_stt).__name__} loaded (name={STT_NAME})")
    except Exception:
        pass


def _log(msg: str):
    try:
        ts = time.strftime('%Y-%m-%d %H:%M:%S')
        with open('/tmp/voice.log', 'a') as fh:
            fh.write(f"{ts} {msg}\n")
    except Exception:
        pass


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
        _log(f"ws: session created {session.id} conversation={conversation_id}")
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
                    _log(f"ws:{session.id} voice.start")
                    await websocket.send_json({"event": "voice.state", "data": {"state": session.state}})
                elif event == "voice.stop":
                    manager.stop_listening(session.id)
                    _log(f"ws:{session.id} voice.stop")
                    await websocket.send_json({"event": "voice.state", "data": {"state": session.state}})
                    # try to get buffered audio and run transcription in background
                    try:
                        audio = manager.collect_session_audio(session.id)
                        if audio:
                            def _on_transcribed(sid, text):
                                try:
                                    websocket.send_json({"event": "stt.final", "data": {"text": text}})
                                except Exception:
                                    pass

                            manager.submit_audio_for_transcription(session.id, _stt.transcribe, audio, callback=_on_transcribed)
                    except Exception as e:
                        _log(f"stt background submit failed: {e}")
                elif event == "stt.final":
                    # forward final transcription to orchestrator by calling chat() directly
                    text = payload.get("text", "")
                    _log(f"ws:{session.id} stt.final text={text}")
                    try:
                        from app.main import chat, ChatRequest

                        body = ChatRequest(message=text, history=[], mode="agent")
                        resp = chat(body)
                    except Exception as e:
                        resp = {"error": str(e)}
                    await websocket.send_json({"event": "stt.final", "data": {"text": text, "assistant_response": resp}})
                else:
                    await websocket.send_json({"event": "error", "data": {"message": "unknown event"}})
            elif "bytes" in msg:
                # binary audio frame
                data = msg["bytes"]
                manager.receive_audio_chunk(session.id, data)
                _log(f"ws:{session.id} bytes {len(data)}")
    except WebSocketDisconnect:
        manager.end_session(session.id)
        _log(f"ws:{session.id} disconnect")
    except Exception as exc:
        await websocket.send_json({"event": "error", "data": {"message": str(exc)}})



@router.post("/api/stt/upload")
async def stt_upload(file: UploadFile = File(...)):
    try:
        data = await file.read()
        _log(f"http: /api/stt/upload received {len(data)} bytes")
        text = _stt.transcribe(data)
        _log(f"http: /api/stt/upload transcribed -> {text}")
        return JSONResponse({"text": text})
    except Exception as e:
        _log(f"http: /api/stt/upload error {e}")
        return JSONResponse({"error": str(e)}, status_code=500)



























    except WebSocketDisconnect:
        manager.end_session(session.id)
    except Exception as exc:
        await websocket.send_json({"event": "error", "data": {"message": str(exc)}})





















































