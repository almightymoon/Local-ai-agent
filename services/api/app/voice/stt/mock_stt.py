from .base import SpeechToTextProvider


class MockSTT(SpeechToTextProvider):
    """Deterministic STT stub for unit tests only."""

    provider_name = "mock"
    model_size = "mock"
    language = "en"
    state = "ready"
    last_error = None
    device = "cpu"

    def ensure_loaded(self) -> None:
        self.state = "ready"

    def transcribe(self, audio_bytes: bytes) -> str:
        return "mock transcription"

    def transcribe_stream(self, audio_iter):
        for i, chunk in enumerate(audio_iter):
            yield {"partial": f"mock partial {i}"}
        yield {"final": "mock transcription"}
