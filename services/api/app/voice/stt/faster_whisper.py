import os
import tempfile
from ..stt.base import SpeechToTextProvider

try:
    from faster_whisper import WhisperModel
except Exception:
    WhisperModel = None


class FasterWhisperSTT(SpeechToTextProvider):
    def __init__(self, model_size: str = None, device: str = "cpu"):
        if WhisperModel is None:
            raise RuntimeError("faster-whisper is not installed. Install faster-whisper in requirements.")
        self.model_size = model_size or os.environ.get("WHISPER_MODEL", "small")
        self.device = device
        # model will be lazy-loaded on first transcribe to avoid startup cost
        self._model = None

    def _load(self):
        if self._model is None:
            self._model = WhisperModel(self.model_size, device=self.device)

    def transcribe(self, audio_bytes: bytes) -> str:
        # write bytes to a temporary file and call model.transcribe
        self._load()
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            path = tmp.name
        try:
            # faster-whisper returns segments generator and info
            segments, info = self._model.transcribe(path, beam_size=5)
            texts = [seg.text for seg in segments]
            return " ".join(texts).strip()
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass

    def transcribe_stream(self, audio_iter):
        # not implemented for now
        for chunk in audio_iter:
            yield {"partial": ""}
        yield {"final": ""}
