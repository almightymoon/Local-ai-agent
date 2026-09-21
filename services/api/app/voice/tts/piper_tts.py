"""Local offline TTS via Piper (open source).

Good quality for fully-offline use. Prefer edge-tts when network is available
for more natural neural voices.
"""

from __future__ import annotations

import io
import logging
import os
import wave
from pathlib import Path
from typing import Optional

from .base import TextToSpeechProvider

logger = logging.getLogger("zentra.voice.tts")

DEFAULT_VOICE = "en_US-lessac-medium"


class PiperTTS(TextToSpeechProvider):
    provider_name = "piper"

    def __init__(self, voice: Optional[str] = None):
        try:
            from piper import PiperVoice  # noqa: F401
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "piper-tts is not installed. pip install piper-tts"
            ) from exc
        self.voice_name = voice or os.environ.get("PIPER_VOICE", DEFAULT_VOICE)
        self._voice = None
        self.state = "not_loaded"
        self.last_error: Optional[str] = None
        cache = os.environ.get("PIPER_MODEL_DIR") or str(
            Path.home() / ".cache" / "zentra" / "piper"
        )
        self.model_dir = Path(cache)

    def ensure_loaded(self) -> None:
        if self._voice is not None:
            return
        from piper import PiperVoice
        from piper.download_voices import download_voice

        self.state = "loading"
        self.model_dir.mkdir(parents=True, exist_ok=True)
        onnx = self.model_dir / f"{self.voice_name}.onnx"
        try:
            if not onnx.exists():
                logger.info("piper voice download started voice=%s", self.voice_name)
                download_voice(self.voice_name, self.model_dir)
            self._voice = PiperVoice.load(str(onnx))
            self.state = "ready"
            logger.info("piper voice loaded voice=%s", self.voice_name)
        except Exception as exc:
            self.state = "error"
            self.last_error = str(exc)
            raise RuntimeError(f"Piper voice unavailable: {exc}") from exc

    def synthesize(self, text: str, **kwargs) -> bytes:
        cleaned = (text or "").strip()
        if not cleaned:
            raise ValueError("Empty text for speech synthesis.")
        cleaned = cleaned[:4000]
        self.ensure_loaded()
        assert self._voice is not None

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            self._voice.synthesize_wav(cleaned, wav_file)
        data = buf.getvalue()
        logger.info(
            "tts synthesized provider=piper voice=%s bytes=%s",
            self.voice_name,
            len(data),
        )
        return data

    @property
    def media_type(self) -> str:
        return "audio/wav"

    @property
    def voice_id(self) -> str:
        return self.voice_name
