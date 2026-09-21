import os
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DB_PATH"] = "/tmp/local-agent-tests-bootstrap.sqlite3"


@pytest.fixture(autouse=True)
def isolated_runtime(tmp_path, monkeypatch):
    from app import store
    from app.main import model_router

    monkeypatch.setattr(store, "DB_PATH", tmp_path / "memory.sqlite3")

    def offline(*_args, **_kwargs):
        raise OSError("Offline test provider")
        yield

    monkeypatch.setattr(model_router, "stream_chat", offline)
