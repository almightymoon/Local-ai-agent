"""Free neural TTS via edge-tts (Microsoft Edge online voices).

MIT-licensed client. Voices are free to use and much more natural than
browser SpeechSynthesis. Requires network for synthesis.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from typing import Optional

from .base import TextToSpeechProvider
from .voices import EDGE_VOICES

logger = logging.getLogger("zentra.voice.tts")

DEFAULT_VOICE = "en-US-JennyNeural"
ALLOWED_VOICES = {v["id"] for v in EDGE_VOICES}


class EdgeTTS(TextToSpeechProvider):
    provider_name = "edge-tts"

    def __init__(self, voice: Optional[str] = None):
        try:
            import edge_tts  # noqa: F401
        except Exception as exc:  # pragma: no cover
            raise RuntimeError(
                "edge-tts is not installed. pip install edge-tts"
            ) from exc
        self.voice = voice or os.environ.get("TTS_VOICE", DEFAULT_VOICE)
        self.rate = os.environ.get("TTS_RATE", "+40%")
        self.state = "ready"
        self.last_error: Optional[str] = None

    def ensure_loaded(self) -> None:
        self.state = "ready"

    def set_voice(self, voice: str) -> None:
        if voice not in ALLOWED_VOICES:
            raise ValueError(f"Unsupported voice: {voice}")
        self.voice = voice

    def synthesize(self, text: str, **kwargs) -> bytes:
        cleaned = (text or "").strip()
        if not cleaned:
            raise ValueError("Empty text for speech synthesis.")
        cleaned = cleaned[:4000]
        voice = kwargs.get("voice") or self.voice
        rate = kwargs.get("rate") or self.rate
        if voice and voice not in ALLOWED_VOICES:
            # Allow any en-*Neural voice id for flexibility, but prefer curated.
            if not str(voice).endswith("Neural"):
                raise ValueError(f"Unsupported voice: {voice}")
        try:
            return asyncio.run(self._synthesize_async(cleaned, voice, rate))
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(
                    self._synthesize_async(cleaned, voice, rate)
                )
            finally:
                loop.close()

    async def _synthesize_async(self, text: str, voice: str, rate: str) -> bytes:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice, rate=rate or "+0%")
        fd, path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)
        try:
            await communicate.save(path)
            with open(path, "rb") as fh:
                data = fh.read()
            if not data:
                raise RuntimeError("edge-tts returned empty audio.")
            logger.info(
                "tts synthesized provider=edge-tts voice=%s rate=%s bytes=%s",
                voice,
                rate,
                len(data),
            )
            return data
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    @property
    def media_type(self) -> str:
        return "audio/mpeg"

    @property
    def voice_id(self) -> str:
        return self.voice
