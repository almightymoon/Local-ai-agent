"""Speech-to-text provider factory."""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import SpeechToTextProvider
from .mock_stt import MockSTT

logger = logging.getLogger("zentra.voice.stt")

DEFAULT_PROVIDER = "faster-whisper"


def get_stt_provider(name: Optional[str] = None) -> SpeechToTextProvider:
    """Return the configured STT provider.

    Defaults to faster-whisper. MockSTT is only for tests (STT_PROVIDER=mock).
    Does not silently fall back to MockSTT when the real provider fails.
    """
    selected = (name or os.environ.get("STT_PROVIDER") or DEFAULT_PROVIDER).strip().lower()
    logger.info("voice provider selected: %s", selected)

    if selected == "mock":
        return MockSTT()

    if selected in {"faster-whisper", "faster_whisper"}:
        try:
            from .faster_whisper import FasterWhisperSTT

            return FasterWhisperSTT()
        except Exception as exc:
            raise RuntimeError(
                "Local speech-to-text provider is unavailable."
            ) from exc

    raise ValueError(f"Unknown STT provider: {selected}")
