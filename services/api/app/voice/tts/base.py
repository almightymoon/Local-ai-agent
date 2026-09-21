from abc import ABC, abstractmethod


class TextToSpeechProvider(ABC):
    @abstractmethod
    def synthesize(self, text: str) -> bytes:
        raise NotImplementedError()

    def synthesize_stream(self, text: str):
        yield b""

    def stop(self):
        pass
