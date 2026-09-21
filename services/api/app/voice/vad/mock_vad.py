from .base import VoiceActivityDetector


class MockVAD(VoiceActivityDetector):
    def __init__(self):
        self.counter = 0

    def process_audio(self, chunk: bytes) -> bool:
        # every third chunk reports speech
        self.counter += 1
        return self.counter % 3 == 0
