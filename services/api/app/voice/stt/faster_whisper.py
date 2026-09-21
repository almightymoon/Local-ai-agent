import os
import tempfile
from ..stt.base import SpeechToTextProvider

try:
    from faster_whisper import WhisperModel
import os
import tempfile
from ..stt.base import SpeechToTextProvider

try:
    from faster_whisper import WhisperModel
except Exception:
    WhisperModel = None

try:
    import ffmpeg
except Exception:
    ffmpeg = None


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

    def _ensure_wav(self, input_path: str) -> str:
        # convert arbitrary audio file to 16k mono WAV using ffmpeg if available
        if ffmpeg is None:
            # assume input_path is already a WAV
            return input_path
        out_fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(out_fd)
        try:
            stream = ffmpeg.input(input_path)
            stream = ffmpeg.output(stream, out_path, format="wav", ac=1, ar="16000")
            ffmpeg.run(stream, overwrite_output=True, quiet=True)
            return out_path
        except Exception:
            try:
                os.unlink(out_path)
            except Exception:
                pass
            raise

    def transcribe(self, audio_bytes: bytes) -> str:
        self._load()
        in_fd, in_path = tempfile.mkstemp(suffix=".input")
        os.close(in_fd)
        wav_path = None
        try:
            with open(in_path, "wb") as f:
                f.write(audio_bytes)
                f.flush()
            try:
                wav_path = self._ensure_wav(in_path)
            except Exception:
                # if conversion failed, try using the original file
                wav_path = in_path

            # faster-whisper returns segments generator and info
            segments, info = self._model.transcribe(wav_path, beam_size=5)
            texts = [seg.text for seg in segments]
            return " ".join(texts).strip()
        finally:
            for p in (in_path, wav_path):
                try:
                    if p and os.path.exists(p):
                        os.unlink(p)
                except Exception:
                    pass

    def transcribe_stream(self, audio_iter):
        # best-effort: collect bytes and yield an initial partial, then final
        buf = bytearray()
        for chunk in audio_iter:
            buf.extend(chunk)
            # yield a very small partial placeholder (not real ASR partials)
            yield {"partial": "processing..."}
        final = self.transcribe(bytes(buf))
        yield {"final": final}
