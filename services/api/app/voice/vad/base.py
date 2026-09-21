from abc import ABC, abstractmethod


class VoiceActivityDetector(ABC):
    @abstractmethod
    def process_audio(self, chunk: bytes) -> bool:
        """Return True when speech is detected in the chunk"""
        raise NotImplementedError()
