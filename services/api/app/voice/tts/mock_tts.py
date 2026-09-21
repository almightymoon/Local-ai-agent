from .base import TextToSpeechProvider


class MockTTS(TextToSpeechProvider):
    """Deterministic stub for unit tests only."""

    provider_name = "mock"
    media_type = "audio/wav"
    voice_id = "mock"
    state = "ready"
    last_error = None

    def ensure_loaded(self) -> None:
        self.state = "ready"

    def synthesize(self, text: str, **kwargs) -> bytes:
        # Minimal valid-ish WAV header + silence payload for tests.
        return (
            b"RIFF$\x00\x00\x00WAVEfmt "
            b"\x10\x00\x00\x00\x01\x00\x01\x00"
            b"\x40\x1f\x00\x00\x80\x3e\x00\x00"
            b"\x02\x00\x10\x00data\x00\x00\x00\x00"
        )

    def synthesize_stream(self, text: str):
        yield b"chunk1"
        yield b"chunk2"

    def stop(self):
        pass
