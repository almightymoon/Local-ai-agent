from abc import ABC, abstractmethod


class SpeechToTextProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_bytes: bytes) -> str:
        raise NotImplementedError()

    def transcribe_stream(self, audio_iter):
        for chunk in audio_iter:
            pass
        return ""
