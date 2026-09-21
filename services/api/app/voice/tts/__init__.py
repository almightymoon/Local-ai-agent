"""Text-to-speech provider factory."""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import TextToSpeechProvider
from .mock_tts import MockTTS

logger = logging.getLogger("zentra.voice.tts")

# edge = free neural (best quality, needs network)
# piper = local open-source offline
DEFAULT_PROVIDER = "edge"


def get_tts_provider(name: Optional[str] = None) -> TextToSpeechProvider:
    selected = (name or os.environ.get("TTS_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    logger.info("tts provider selected: %s", selected)

    if selected in {"mock", "browser"}:
        return MockTTS()

    if selected in {"edge", "edge-tts", "edge_tts"}:
        from .edge_tts import EdgeTTS

        return EdgeTTS()

    if selected in {"piper", "piper-tts", "piper_tts"}:
        from .piper_tts import PiperTTS

        return PiperTTS()

    raise ValueError(f"Unknown TTS provider: {selected}")
