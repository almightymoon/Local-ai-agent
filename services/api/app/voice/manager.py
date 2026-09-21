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
        # per-session audio buffers (list of bytes)
        self.buffers: Dict[str, bytearray] = {}

    def create_session(self, conversation_id: str) -> VoiceSession:
        with self.lock:
            sid = str(uuid.uuid4())
            s = VoiceSession(id=sid, conversation_id=conversation_id)
            self.sessions[sid] = s
            self.buffers[sid] = bytearray()
            return s

    def get_session(self, sid: str) -> VoiceSession:
        return self.sessions[sid]

    def end_session(self, sid: str):
        with self.lock:
            try:
                self.sessions.pop(sid, None)
                self.buffers.pop(sid, None)
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
        # append to session buffer for later transcription
        buf = self.buffers.get(sid)
        if buf is None:
            self.buffers[sid] = bytearray(chunk)
        else:
            try:
                buf.extend(chunk)
            except Exception:
                # if extend fails, replace buffer with new
                self.buffers[sid] = bytearray(chunk)
        s.state = "listening"

    def collect_session_audio(self, sid: str) -> bytes:
        """Return concatenated audio bytes for a session if buffered.

        Note: currently manager does not buffer; this method is a placeholder
        used by the router to request audio for final transcription if present.
        """
        buf = self.buffers.get(sid)
        if not buf:
            return b""
        # return bytes and clear buffer
        data = bytes(buf)
        self.buffers[sid] = bytearray()
        return data

    def submit_audio_for_transcription(self, sid: str, stt_callable, audio_bytes: bytes, callback=None):
        """Run transcription in background thread and call callback with result."""

        def _worker():
            try:
                text = stt_callable(audio_bytes)
            except Exception as e:
                text = None
            if callback:
                try:
                    callback(sid, text)
                except Exception:
                    pass

        t = threading.Thread(target=_worker, daemon=True)
        t.start()

