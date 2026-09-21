import time
from dataclasses import dataclass, field
from .manager import VoiceSession


@dataclass
class VoiceSessionState:
    session: VoiceSession

    def update_state(self, new_state: str):
        self.session.state = new_state
        self.session.last_activity = time.time()

