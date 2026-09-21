from .base import SpeechToTextProvider


class MockSTT(SpeechToTextProvider):
    def transcribe(self, audio_bytes: bytes) -> str:
        # return a deterministic stub for tests
        text = "mock transcription"
        return text

    def transcribe_stream(self, audio_iter):
        for i, chunk in enumerate(audio_iter):
            yield {"partial": f"mock partial {i}"}
        yield {"final": "mock transcription"}
