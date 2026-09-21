import time
import threading
import uuid
from dataclasses import dataclass, field
from typing import Optional, Dict


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

    def create_session(self, conversation_id: str) -> VoiceSession:
        with self.lock:
            sid = str(uuid.uuid4())
            s = VoiceSession(id=sid, conversation_id=conversation_id)
            self.sessions[sid] = s
            return s

    def get_session(self, sid: str) -> VoiceSession:
        return self.sessions[sid]

    def end_session(self, sid: str):
        with self.lock:
            try:
                self.sessions.pop(sid, None)
            except KeyError:
                pass

    def start_listening(self, sid: str):
        s = self.get_session(sid)
        s.state = "listening"
        s.last_activity = time.time()

    def stop_listening(self, sid: str):
        s = self.get_session(sid)
        s.state = "transcribing"
        s.last_activity = time.time()

    def receive_audio_chunk(self, sid: str, chunk: bytes):
        s = self.get_session(sid)
        s.last_activity = time.time()
        # In a real implementation we'd feed to VAD/STT. For now just update state.
        s.state = "listening"

