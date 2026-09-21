"""Voice HTTP + WebSocket routes.

v0.1 transcription path: POST /api/stt/upload (complete utterance).
WebSocket remains for session state / future real-time features only.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import threading
import time
from typing import Optional

from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .manager import VoiceManager
from .stt import get_stt_provider
from .tts import get_tts_provider
from .tts.voices import EDGE_VOICES, PIPER_VOICES, RATE_PRESETS

logger = logging.getLogger("zentra.voice")

router = APIRouter()
manager = VoiceManager()

# Max upload size (~25 MB) — enough for a long utterance, rejects abuse.
MAX_UPLOAD_BYTES = int(os.environ.get("STT_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
DEFAULT_MODEL = "medium.en"

_stt = None
_stt_error: Optional[str] = None
_stt_name = (os.environ.get("STT_PROVIDER") or "faster-whisper").strip().lower()

_tts = None
_tts_error: Optional[str] = None
_tts_name = (os.environ.get("TTS_PROVIDER") or "edge").strip().lower()


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: Optional[str] = Field(default=None, max_length=80)
    rate: Optional[str] = Field(default=None, max_length=12)


def _log(msg: str) -> None:
    """Development-friendly voice log (stdout logger; optional file via VOICE_LOG_PATH)."""
    logger.info(msg)
    log_path = os.environ.get("VOICE_LOG_PATH")
    if not log_path:
        return
    try:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(f"{ts} {msg}\n")
    except OSError:
        pass


def _init_stt():
    global _stt, _stt_error
    try:
        _stt = get_stt_provider(_stt_name)
        _stt_error = None
        _log(
            f"stt provider selected: {getattr(_stt, 'provider_name', type(_stt).__name__)}"
        )
    except Exception as exc:
        _stt = None
        _stt_error = str(exc) or "Local speech-to-text provider is unavailable."
        _log(f"stt provider load failed: {_stt_error}")


def _init_tts():
    global _tts, _tts_error
    try:
        _tts = get_tts_provider(_tts_name)
        _tts_error = None
        _log(
            f"tts provider selected: {getattr(_tts, 'provider_name', type(_tts).__name__)}"
        )
    except Exception as exc:
        _tts = None
        _tts_error = str(exc) or "Text-to-speech provider is unavailable."
        _log(f"tts provider load failed: {_tts_error}")


def _preload_model() -> None:
    """Warm the Whisper model in the background so the first utterance is faster."""
    if _stt is None or not hasattr(_stt, "ensure_loaded"):
        return
    try:
        _log("stt preload started")
        _stt.ensure_loaded()
        _log(f"stt preload done state={getattr(_stt, 'state', None)}")
    except Exception as exc:
        _log(f"stt preload failed: {exc}")


_init_stt()
_init_tts()
# Don't block API startup on model download — warm in a daemon thread.
threading.Thread(target=_preload_model, daemon=True, name="stt-preload").start()


def _provider_meta():
    if _stt is None:
        return {
            "provider": _stt_name.replace("_", "-"),
            "model": os.environ.get("WHISPER_MODEL", DEFAULT_MODEL),
            "state": "error",
            "error": _stt_error or "Local speech-to-text provider is unavailable.",
        }
    return {
        "provider": getattr(_stt, "provider_name", _stt_name),
        "model": getattr(
            _stt, "model_size", os.environ.get("WHISPER_MODEL", DEFAULT_MODEL)
        ),
        "state": getattr(_stt, "state", "not_loaded"),
        "device": getattr(_stt, "device", None),
        "error": getattr(_stt, "last_error", None),
    }


def _tts_meta():
    if _tts is None:
        return {
            "provider": _tts_name.replace("_", "-"),
            "voice": os.environ.get("TTS_VOICE", "en-US-JennyNeural"),
            "state": "error",
            "error": _tts_error or "Text-to-speech provider is unavailable.",
        }
    return {
        "provider": getattr(_tts, "provider_name", _tts_name),
        "voice": getattr(_tts, "voice_id", os.environ.get("TTS_VOICE")),
        "state": getattr(_tts, "state", "ready"),
        "error": getattr(_tts, "last_error", None),
    }


@router.get("/api/voice/status")
def status():
    meta = _provider_meta()
    tts = _tts_meta()
    ok = _stt is not None and meta.get("state") != "error"
    return {
        "ok": ok,
        "stt": {
            "provider": meta["provider"],
            "model": meta["model"],
            "state": meta["state"],
            **({"error": meta["error"]} if meta.get("error") else {}),
            **({"device": meta["device"]} if meta.get("device") else {}),
        },
        "tts": {
            "provider": tts["provider"],
            "voice": tts.get("voice"),
            "state": tts["state"],
            **({"error": tts["error"]} if tts.get("error") else {}),
        },
    }


@router.get("/api/tts/voices")
def tts_voices():
    provider = (_tts_name or "edge").replace("_", "-")
    if provider in {"edge", "edge-tts"}:
        voices = EDGE_VOICES
    elif provider in {"piper", "piper-tts"}:
        voices = PIPER_VOICES
    else:
        voices = EDGE_VOICES
    current = getattr(_tts, "voice_id", None) or os.environ.get(
        "TTS_VOICE", "en-US-JennyNeural"
    )
    return {
        "provider": getattr(_tts, "provider_name", provider) if _tts else provider,
        "voice": current,
        "rate": getattr(_tts, "rate", None) or os.environ.get("TTS_RATE", "+25%"),
        "voices": voices,
        "rates": RATE_PRESETS,
    }


@router.post("/api/tts")
async def tts_synthesize(body: TtsRequest):
    provider = (_tts_name or "edge").replace("_", "-")
    if _tts is None:
        return JSONResponse(
            {
                "error": _tts_error or "Text-to-speech provider is unavailable.",
                "provider": provider,
            },
            status_code=503,
        )

    text = body.text.strip()
    if not text:
        return JSONResponse(
            {"error": "Empty text.", "provider": provider},
            status_code=400,
        )

    voice = (body.voice or "").strip() or None
    rate = (body.rate or "").strip() or None

    try:
        if hasattr(_tts, "ensure_loaded"):
            await asyncio.to_thread(_tts.ensure_loaded)
        audio = await asyncio.to_thread(
            lambda: _tts.synthesize(text, voice=voice, rate=rate)
        )
    except ValueError as exc:
        return JSONResponse(
            {"error": str(exc), "provider": provider},
            status_code=400,
        )
    except Exception as exc:
        _log(f"tts error: {exc}")
        return JSONResponse(
            {
                "error": str(exc) or "Speech synthesis failed.",
                "provider": provider,
            },
            status_code=500,
        )

    used_voice = voice or getattr(_tts, "voice_id", "")
    media = getattr(_tts, "media_type", "audio/mpeg")
    return Response(
        content=audio,
        media_type=media,
        headers={
            "X-TTS-Provider": getattr(_tts, "provider_name", provider),
            "X-TTS-Voice": str(used_voice),
            "Cache-Control": "no-store",
        },
    )


@router.post("/api/stt/upload")
async def stt_upload(file: UploadFile = File(...)):
    provider = (_stt_name or "faster-whisper").replace("_", "-")
    if _stt is None:
        return JSONResponse(
            {
                "error": _stt_error
                or "Local speech-to-text provider is unavailable.",
                "provider": provider,
            },
            status_code=503,
        )

    data = await file.read()
    _log(f"recording received bytes={len(data)} filename={file.filename!r}")

    if not data:
        return JSONResponse(
            {"error": "Empty audio recording.", "provider": provider},
            status_code=400,
        )
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {
                "error": f"Recording too large ({len(data)} bytes).",
                "provider": provider,
            },
            status_code=413,
        )

    # Surface "preparing" state while the model downloads / loads.
    if getattr(_stt, "state", None) in {None, "not_loaded", "loading"}:
        try:
            if hasattr(_stt, "ensure_loaded"):
                await asyncio.to_thread(_stt.ensure_loaded)
        except Exception as exc:
            _log(f"model load error: {exc}")
            return JSONResponse(
                {
                    "error": "Local speech-to-text provider is unavailable.",
                    "provider": provider,
                },
                status_code=503,
            )

    started = time.monotonic()
    try:
        # Keep the event loop responsive — Whisper is CPU-heavy.
        text = await asyncio.to_thread(_stt.transcribe, data)
    except ValueError as exc:
        return JSONResponse(
            {"error": str(exc), "provider": provider},
            status_code=400,
        )
    except Exception as exc:
        _log(f"transcription error: {exc}")
        return JSONResponse(
            {
                "error": str(exc) or "Transcription failed.",
                "provider": provider,
            },
            status_code=500,
        )

    elapsed = time.monotonic() - started
    _log(f"transcription completed duration={elapsed:.2f}s chars={len(text or '')}")
    return {
        "text": text or "",
        "provider": getattr(_stt, "provider_name", provider),
        "model": getattr(
            _stt, "model_size", os.environ.get("WHISPER_MODEL", DEFAULT_MODEL)
        ),
        "language": getattr(_stt, "language", None) or "en",
    }


@router.websocket("/api/voice/session/{conversation_id}")
async def ws_voice_session(websocket: WebSocket, conversation_id: str):
    token = websocket.query_params.get("token", "")
    session_token = getattr(websocket.app.state, "SESSION_TOKEN", "") or ""
    if not secrets.compare_digest(token, session_token):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    session = manager.create_session(conversation_id)
    session.stt_provider = (
        getattr(_stt, "provider_name", _stt_name) if _stt else _stt_name
    )
    try:
        await websocket.send_json(
            {"event": "voice.ready", "data": {"session": session.to_dict()}}
        )
        _log(f"ws: session created {session.id} conversation={conversation_id}")
        while True:
            msg = await websocket.receive()
            if "text" in msg:
                try:
                    payload = json.loads(msg["text"])
                except Exception:
                    await websocket.send_json(
                        {"event": "error", "data": {"message": "invalid payload"}}
                    )
                    continue
                event = payload.get("event")
                if event == "voice.start":
                    manager.start_listening(session.id)
                    await websocket.send_json(
                        {"event": "voice.state", "data": {"state": session.state}}
                    )
                elif event == "voice.stop":
                    manager.stop_listening(session.id)
                    await websocket.send_json(
                        {"event": "voice.state", "data": {"state": session.state}}
                    )
                elif event == "stt.final":
                    text = payload.get("text", "")
                    await websocket.send_json(
                        {"event": "stt.final", "data": {"text": text}}
                    )
                else:
                    await websocket.send_json(
                        {"event": "error", "data": {"message": "unknown event"}}
                    )
            elif "bytes" in msg:
                manager.receive_audio_chunk(session.id, msg["bytes"])
    except WebSocketDisconnect:
        manager.end_session(session.id)
        _log(f"ws:{session.id} disconnect")
    except Exception as exc:
        manager.end_session(session.id)
        _log(f"ws error: {exc}")
        try:
            await websocket.send_json(
                {"event": "error", "data": {"message": str(exc)}}
            )
        except Exception:
            pass
