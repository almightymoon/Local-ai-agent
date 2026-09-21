"""Voice / STT unit tests.

CI must not download Whisper models — providers are mocked.
"""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import SESSION_TOKEN, app
from app.voice import router as voice_router
from app.voice.stt import get_stt_provider
from app.voice.stt.mock_stt import MockSTT

client = TestClient(app, headers={"X-Agent-Token": SESSION_TOKEN})


@pytest.fixture
def mock_stt_provider(monkeypatch):
    provider = MockSTT()
    monkeypatch.setattr(voice_router, "_stt", provider)
    monkeypatch.setattr(voice_router, "_stt_error", None)
    monkeypatch.setattr(voice_router, "_stt_name", "mock")
    return provider


def test_provider_factory_default_is_faster_whisper(monkeypatch):
    monkeypatch.delenv("STT_PROVIDER", raising=False)

    class FakeFW:
        def __init__(self, *a, **k):
            self.provider_name = "faster-whisper"
            self.model_size = "small"
            self.state = "not_loaded"

    monkeypatch.setattr(
        "app.voice.stt.faster_whisper.FasterWhisperSTT",
        FakeFW,
    )
    provider = get_stt_provider(None)
    assert provider.provider_name == "faster-whisper"


def test_provider_factory_mock_only_when_requested():
    provider = get_stt_provider("mock")
    assert isinstance(provider, MockSTT)
    assert provider.transcribe(b"abc") == "mock transcription"


def test_provider_factory_unknown():
    with pytest.raises(ValueError, match="Unknown STT provider"):
        get_stt_provider("nope")


def test_faster_whisper_lazy_init(monkeypatch):
    from app.voice.stt import faster_whisper as fw

    class FakeModel:
        def __init__(self, *a, **k):
            self.loaded = True

        def transcribe(self, path, **kwargs):
            info = MagicMock()
            info.language = "en"

            class Seg:
                text = "hello zentra"

            return iter([Seg()]), info

    monkeypatch.setattr(fw, "WhisperModel", FakeModel)
    stt = fw.FasterWhisperSTT(model_size="tiny", device="cpu", compute_type="int8")
    assert stt.state == "not_loaded"
    assert stt._model is None
    text = stt.transcribe(b"RIFF" + b"\x00" * 64)
    assert text == "hello zentra"
    assert stt.state == "ready"
    assert stt._model is not None


def test_faster_whisper_unavailable_error(monkeypatch):
    from app.voice.stt import faster_whisper as fw

    monkeypatch.setattr(fw, "WhisperModel", None)
    with pytest.raises(RuntimeError, match="Local speech-to-text provider is unavailable"):
        fw.FasterWhisperSTT()


def test_faster_whisper_empty_audio(monkeypatch):
    from app.voice.stt import faster_whisper as fw

    class FakeModel:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, *a, **k):
            return iter([]), MagicMock(language="en")

    monkeypatch.setattr(fw, "WhisperModel", FakeModel)
    stt = fw.FasterWhisperSTT(model_size="tiny", device="cpu", compute_type="int8")
    with pytest.raises(ValueError, match="Empty audio"):
        stt.transcribe(b"")


def test_voice_status_shape(mock_stt_provider):
    resp = client.get("/api/voice/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "stt" in body
    assert body["stt"]["provider"] == "mock"
    assert body["stt"]["state"] in {"ready", "not_loaded", "loading", "error"}
    assert "model" in body["stt"]
    assert "tts" in body
    assert body["tts"]["provider"] in {"mock", "edge-tts", "edge", "piper"}
    assert body["tts"]["state"] in {"ready", "not_loaded", "loading", "error"}


def test_tts_voices_list():
    resp = client.get("/api/tts/voices")
    assert resp.status_code == 200
    body = resp.json()
    assert "voices" in body and len(body["voices"]) >= 1
    assert "rates" in body
    assert "voice" in body
    assert all("id" in v and "name" in v for v in body["voices"])


def test_tts_synthesize_with_voice_override(monkeypatch):
    from app.voice.tts.mock_tts import MockTTS

    class TrackingMock(MockTTS):
        def __init__(self):
            super().__init__()
            self.last_kwargs = None

        def synthesize(self, text: str, **kwargs):
            self.last_kwargs = kwargs
            return super().synthesize(text, **kwargs)

    mock = TrackingMock()
    monkeypatch.setattr(voice_router, "_tts", mock)
    monkeypatch.setattr(voice_router, "_tts_error", None)
    monkeypatch.setattr(voice_router, "_tts_name", "mock")
    resp = client.post(
        "/api/tts",
        json={"text": "Hello", "voice": "en-US-AriaNeural", "rate": "+25%"},
    )
    assert resp.status_code == 200
    assert mock.last_kwargs["voice"] == "en-US-AriaNeural"
    assert mock.last_kwargs["rate"] == "+25%"


def test_tts_synthesize_mock(monkeypatch):
    from app.voice.tts.mock_tts import MockTTS

    monkeypatch.setattr(voice_router, "_tts", MockTTS())
    monkeypatch.setattr(voice_router, "_tts_error", None)
    monkeypatch.setattr(voice_router, "_tts_name", "mock")
    resp = client.post("/api/tts", json={"text": "Hello Zentra"})
    assert resp.status_code == 200
    assert resp.headers.get("content-type", "").startswith("audio/")
    assert len(resp.content) > 0


def test_tts_empty_text(monkeypatch):
    from app.voice.tts.mock_tts import MockTTS

    monkeypatch.setattr(voice_router, "_tts", MockTTS())
    monkeypatch.setattr(voice_router, "_tts_error", None)
    monkeypatch.setattr(voice_router, "_tts_name", "mock")
    resp = client.post("/api/tts", json={"text": "   "})
    assert resp.status_code == 422 or resp.status_code == 400


def test_tts_unavailable(monkeypatch):
    monkeypatch.setattr(voice_router, "_tts", None)
    monkeypatch.setattr(voice_router, "_tts_error", "Text-to-speech provider is unavailable.")
    monkeypatch.setattr(voice_router, "_tts_name", "edge")
    resp = client.post("/api/tts", json={"text": "Hello"})
    assert resp.status_code == 503
    assert "unavailable" in resp.json()["error"].lower()


def test_voice_status_faster_whisper_meta(monkeypatch):
    fake = MagicMock()
    fake.provider_name = "faster-whisper"
    fake.model_size = "small"
    fake.state = "ready"
    fake.device = "cpu"
    fake.last_error = None
    monkeypatch.setattr(voice_router, "_stt", fake)
    monkeypatch.setattr(voice_router, "_stt_error", None)
    monkeypatch.setattr(voice_router, "_stt_name", "faster-whisper")

    resp = client.get("/api/voice/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["stt"]["provider"] == "faster-whisper"
    assert body["stt"]["model"] == "small"
    assert body["stt"]["state"] == "ready"


def test_stt_upload_empty_file(mock_stt_provider):
    resp = client.post(
        "/api/stt/upload",
        files={"file": ("recording.webm", b"", "audio/webm")},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert "error" in body
    assert body["provider"] == "mock"


def test_stt_upload_mocked_transcription(mock_stt_provider):
    audio = b"\x1aE\xdf\xa3" + b"\x00" * 128
    resp = client.post(
        "/api/stt/upload",
        files={"file": ("recording.webm", audio, "audio/webm")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "mock transcription"
    assert body["provider"] == "mock"
    assert "model" in body
    assert "language" in body


def test_stt_upload_provider_unavailable(monkeypatch):
    monkeypatch.setattr(voice_router, "_stt", None)
    monkeypatch.setattr(
        voice_router,
        "_stt_error",
        "Local speech-to-text provider is unavailable.",
    )
    monkeypatch.setattr(voice_router, "_stt_name", "faster-whisper")
    resp = client.post(
        "/api/stt/upload",
        files={"file": ("recording.webm", b"abc", "audio/webm")},
    )
    assert resp.status_code == 503
    body = resp.json()
    assert "unavailable" in body["error"].lower()
    assert body["provider"] == "faster-whisper"


def test_stt_upload_too_large(mock_stt_provider, monkeypatch):
    monkeypatch.setattr(voice_router, "MAX_UPLOAD_BYTES", 10)
    resp = client.post(
        "/api/stt/upload",
        files={"file": ("recording.webm", b"x" * 20, "audio/webm")},
    )
    assert resp.status_code == 413
    assert "error" in resp.json()


def test_stt_upload_final_transcript_format(monkeypatch):
    fake = MagicMock()
    fake.provider_name = "faster-whisper"
    fake.model_size = "small"
    fake.language = "en"
    fake.state = "ready"
    fake.last_error = None
    fake.ensure_loaded = MagicMock()
    fake.transcribe = MagicMock(return_value="Hello Zentra, can you hear me?")
    monkeypatch.setattr(voice_router, "_stt", fake)
    monkeypatch.setattr(voice_router, "_stt_error", None)
    monkeypatch.setattr(voice_router, "_stt_name", "faster-whisper")

    resp = client.post(
        "/api/stt/upload",
        files={"file": ("recording.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "text": "Hello Zentra, can you hear me?",
        "provider": "faster-whisper",
        "model": "small",
        "language": "en",
    }
    fake.transcribe.assert_called_once()


def test_voice_ws_session_basic(mock_stt_provider):
    with client.websocket_connect(
        f"/api/voice/session/testconv?token={SESSION_TOKEN}"
    ) as ws:
        msg = ws.receive_json()
        assert msg["event"] == "voice.ready"
        ws.send_json({"event": "voice.start"})
        msg = ws.receive_json()
        assert msg["event"] == "voice.state"
        assert msg["data"]["state"] == "listening"
        ws.send_json({"event": "voice.stop"})
        msg = ws.receive_json()
        assert msg["event"] == "voice.state"
