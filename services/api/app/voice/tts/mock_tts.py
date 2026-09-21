from .base import TextToSpeechProvider


class MockTTS(TextToSpeechProvider):
    def synthesize(self, text: str) -> bytes:
        # return short wav-like bytes header for tests
        return b"RIFF....WAVEfmt "

    def synthesize_stream(self, text: str):
        # yield a couple chunks
        yield b"chunk1"
        yield b"chunk2"

    def stop(self):
        pass
