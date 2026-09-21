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


# factory helper used by router to pick provider
def get_stt_provider(name: str):
    name = (name or "mock").lower()
    if name == "mock":
        return MockSTT()
    if name == "faster-whisper" or name == "faster_whisper":
        try:
            from .faster_whisper import FasterWhisperSTT

            return FasterWhisperSTT()
        except Exception as e:
            raise RuntimeError("faster-whisper provider not available: " + str(e))
    raise ValueError(f"Unknown STT provider: {name}")
