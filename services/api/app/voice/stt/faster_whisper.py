"""Local Faster Whisper speech-to-text provider."""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from typing import Optional

from .base import SpeechToTextProvider

logger = logging.getLogger("zentra.voice.stt")

try:
    from faster_whisper import WhisperModel
except Exception:  # pragma: no cover - exercised via factory when missing
    WhisperModel = None

# English small is a good accuracy/latency tradeoff on CPU laptops.
# medium.en is used by default for clearer recognition in conversation mode.
DEFAULT_MODEL = "medium.en"
DEFAULT_LANGUAGE = "en"
DEFAULT_BEAM_SIZE = 5
DEFAULT_INITIAL_PROMPT = (
    "Hello Zentra. This is clear English speech for a coding assistant. "
    "React, TypeScript, Python, API, git, file, folder, function, component."
)


def _resolve_device(requested: str) -> str:
    requested = (requested or "auto").lower()
    if requested != "auto":
        return requested
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _resolve_compute_type(device: str, requested: str) -> str:
    requested = (requested or "auto").lower()
    if requested != "auto":
        return requested
    # float16 on CUDA; int8 on CPU (good quality, practical latency).
    if device == "cuda":
        return "float16"
    return "int8"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


class FasterWhisperSTT(SpeechToTextProvider):
    """Lazy-loading Faster Whisper provider.

    Accepts WebM/Opus (and other formats) via Faster Whisper / PyAV decoding.
    Does not require a system ffmpeg CLI binary.
    """

    def __init__(
        self,
        model_size: Optional[str] = None,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
    ):
        if WhisperModel is None:
            raise RuntimeError(
                "Local speech-to-text provider is unavailable. "
                "Install faster-whisper (see services/api/requirements.txt)."
            )
        self.model_size = model_size or os.environ.get("WHISPER_MODEL", DEFAULT_MODEL)
        self.device_pref = device or os.environ.get("WHISPER_DEVICE", "auto")
        self.compute_pref = compute_type or os.environ.get(
            "WHISPER_COMPUTE_TYPE", "auto"
        )
        self.device = _resolve_device(self.device_pref)
        self.compute_type = _resolve_compute_type(self.device, self.compute_pref)
        self._model = None
        self._lock = threading.Lock()
        self.state = "not_loaded"
        self.last_error: Optional[str] = None

        lang = (os.environ.get("WHISPER_LANGUAGE") or DEFAULT_LANGUAGE).strip().lower()
        self.language = None if lang in {"", "auto"} else lang
        self.beam_size = max(1, _env_int("WHISPER_BEAM_SIZE", DEFAULT_BEAM_SIZE))
        self.vad_filter = _env_bool("WHISPER_VAD_FILTER", True)
        self.initial_prompt = os.environ.get(
            "WHISPER_INITIAL_PROMPT", DEFAULT_INITIAL_PROMPT
        ).strip() or None

    @property
    def provider_name(self) -> str:
        return "faster-whisper"

    def ensure_loaded(self) -> None:
        """Load the Whisper model if needed. Safe to call concurrently."""
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            self.state = "loading"
            self.last_error = None
            logger.info(
                "model loading started provider=faster-whisper model=%s device=%s compute=%s",
                self.model_size,
                self.device,
                self.compute_type,
            )
            try:
                self._model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=self.compute_type,
                )
                self.state = "ready"
                logger.info(
                    "model loaded provider=faster-whisper model=%s device=%s",
                    self.model_size,
                    self.device,
                )
            except Exception as primary:
                # Graceful CPU fallback when GPU/auto path fails.
                if self.device != "cpu":
                    logger.warning(
                        "GPU/auto load failed (%s); falling back to CPU", primary
                    )
                    try:
                        self.device = "cpu"
                        self.compute_type = _resolve_compute_type(
                            "cpu", self.compute_pref
                        )
                        self._model = WhisperModel(
                            self.model_size,
                            device="cpu",
                            compute_type=self.compute_type,
                        )
                        self.state = "ready"
                        logger.info(
                            "model loaded provider=faster-whisper model=%s device=cpu",
                            self.model_size,
                        )
                        return
                    except Exception as fallback_err:
                        primary = fallback_err
                self.state = "error"
                self.last_error = str(primary)
                logger.error("model load failed: %s", primary)
                raise RuntimeError(
                    "Local speech-to-text provider is unavailable."
                ) from primary

    def transcribe(self, audio_bytes: bytes) -> str:
        if not audio_bytes:
            raise ValueError("Empty audio recording.")
        self.ensure_loaded()
        assert self._model is not None

        suffix = ".webm"
        # Detect RIFF/WAV header so we keep a sensible extension.
        if audio_bytes[:4] == b"RIFF":
            suffix = ".wav"
        elif audio_bytes[:4] == b"OggS":
            suffix = ".ogg"

        in_fd, in_path = tempfile.mkstemp(suffix=suffix)
        os.close(in_fd)
        started = time.monotonic()
        logger.info("transcription started bytes=%s", len(audio_bytes))
        try:
            with open(in_path, "wb") as fh:
                fh.write(audio_bytes)
                fh.flush()

            # Accuracy-oriented decode for conversation utterances.
            kwargs = {
                "beam_size": self.beam_size,
                "best_of": 1,
                "temperature": 0.0,
                # Client already end-points audio; Whisper VAD can clip words.
                "vad_filter": False,
                "condition_on_previous_text": False,
                "without_timestamps": True,
                "compression_ratio_threshold": 2.6,
                "log_prob_threshold": -1.2,
                "no_speech_threshold": 0.4,
                "patience": 1.0,
            }
            if self.language:
                kwargs["language"] = self.language
            if self.initial_prompt:
                kwargs["initial_prompt"] = self.initial_prompt

            segments, info = self._model.transcribe(in_path, **kwargs)
            texts = [seg.text.strip() for seg in segments if seg.text]
            text = " ".join(texts).strip()
            # Collapse accidental repeated whitespace from segment joins.
            text = " ".join(text.split())

            duration = time.monotonic() - started
            detected = getattr(info, "language", self.language or "auto")
            logger.info(
                "transcription completed duration=%.2fs language=%s chars=%s beam=%s vad=%s",
                duration,
                detected,
                len(text),
                self.beam_size,
                self.vad_filter,
            )
            return text
        except Exception as exc:
            logger.error("transcription failed: %s", exc)
            raise
        finally:
            try:
                if os.path.exists(in_path):
                    os.unlink(in_path)
            except OSError:
                pass

    def transcribe_stream(self, audio_iter):
        buf = bytearray()
        for chunk in audio_iter:
            if chunk:
                buf.extend(chunk)
        final = self.transcribe(bytes(buf)) if buf else ""
        yield {"final": final}
