"""In-memory voice session manager.

v0.1 transcription uses HTTP upload (POST /api/stt/upload), not WebSocket
audio streaming. Session state remains available for future real-time voice.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class VoiceSession:
    id: str
    conversation_id: str
    state: str = "idle"
    started_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    stt_provider: Optional[str] = None
    tts_provider: Optional[str] = None
    selected_voice: Optional[str] = None

    def to_dict(self):
        return {
            "voice_session_id": self.id,
            "conversation_id": self.conversation_id,
            "state": self.state,
            "started_at": self.started_at,
            "last_activity": self.last_activity,
            "stt_provider": self.stt_provider,
            "tts_provider": self.tts_provider,
            "selected_voice": self.selected_voice,
        }


class VoiceManager:
    def __init__(self):
        self.sessions: Dict[str, VoiceSession] = {}
        self.lock = threading.Lock()
        # Optional per-session buffers for future WS streaming (unused by v0.1 STT).
        self.buffers: Dict[str, bytearray] = {}

    def create_session(self, conversation_id: str) -> VoiceSession:
        with self.lock:
            sid = str(uuid.uuid4())
            session = VoiceSession(id=sid, conversation_id=conversation_id)
            self.sessions[sid] = session
            self.buffers[sid] = bytearray()
            return session

    def get_session(self, sid: str) -> VoiceSession:
        return self.sessions[sid]

    def end_session(self, sid: str) -> None:
        with self.lock:
            self.sessions.pop(sid, None)
            self.buffers.pop(sid, None)

    def start_listening(self, sid: str) -> None:
        session = self.get_session(sid)
        session.state = "listening"
        session.last_activity = time.time()

    def stop_listening(self, sid: str) -> None:
        session = self.get_session(sid)
        session.state = "idle"
        session.last_activity = time.time()

    def receive_audio_chunk(self, sid: str, chunk: bytes) -> None:
        session = self.get_session(sid)
        session.last_activity = time.time()
        buf = self.buffers.get(sid)
        if buf is None:
            self.buffers[sid] = bytearray(chunk)
        else:
            buf.extend(chunk)
        session.state = "listening"

    def collect_session_audio(self, sid: str) -> bytes:
        buf = self.buffers.get(sid)
        if not buf:
            return b""
        data = bytes(buf)
        self.buffers[sid] = bytearray()
        return data
