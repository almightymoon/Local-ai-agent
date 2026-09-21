import shutil
import json
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import Response

app = APIRouter()


@app.post("/api/stt")
def stt_stub():
    """Speech-to-text endpoint placeholder. Returns 501 until an STT backend is integrated."""
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=501,
        content={
            "error": "STT service not implemented. Add a local STT backend to enable microphone uploads."
        },
    )


@app.post("/api/stt/upload")
def stt_upload(file: UploadFile = File(...)):
    """Accept an audio file (form-data) and try to transcribe using available backends.

    Priority:
    1. Python `whisper` package if installed.
    2. External `whisper.cpp` CLI if environment variable `WHISPER_CPP_CMD` points to an executable.
    If neither is available, returns 501 with integration instructions.
    """
    from fastapi import UploadFile, File, HTTPException
    import tempfile
    import os
    import subprocess

    if file is None:
        raise HTTPException(
            status_code=400, detail="Missing form-data file field `file`."
        )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".webm")
    try:
        contents = file.file.read()
        tmp.write(contents)
        tmp.flush()
        tmp.close()

        # Try python whisper first
        try:
            import whisper

            model = whisper.load_model("small")
            result = model.transcribe(tmp.name)
            text = result.get("text", "").strip()
            return {"text": text, "engine": "whisper-python"}
        except Exception:
            pass

        # Next try whisper.cpp CLI via env var
        cmd = os.environ.get("WHISPER_CPP_CMD")
        if cmd and shutil.which(cmd):
            proc = subprocess.run(
                [cmd, tmp.name], capture_output=True, text=True, timeout=120
            )
            if proc.returncode == 0:
                out = proc.stdout.strip()
                return {"text": out, "engine": "whisper.cpp"}
            else:
                raise HTTPException(
                    status_code=500, detail=f"whisper.cpp failed: {proc.stderr}"
                )

        # Nothing available
        raise HTTPException(
            status_code=501,
            detail="No STT backend available. Install python-whisper or set WHISPER_CPP_CMD to a whisper.cpp binary.",
        )
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@app.post("/api/tts")
def tts_speak(payload: dict):
    """TTS endpoint: accepts JSON { text: str, voice: optional }

    Behaviors:
    - If OPEN_TTS_URL env var is set, proxy the request to that server.
    - Otherwise returns 501 with integration instructions (Coqui TTS / OpenTTS).
    """
    from fastapi.responses import JSONResponse, StreamingResponse
    import os
    from urllib import request as urlrequest

    text = str(payload.get("text", "") if isinstance(payload, dict) else "")
    if not text:
        return JSONResponse(status_code=400, content={"error": "Missing text field"})

    open_tts = os.environ.get("OPEN_TTS_URL")
    if open_tts:
        # proxy request to OpenTTS compatible endpoint
        try:
            req = urlrequest.Request(
                f"{open_tts.rstrip('/')}/api/tts",
                data=json.dumps({"text": text}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urlrequest.urlopen(req, timeout=30) as resp:
                return Response(
                    resp.read(20_000_000),
                    media_type=resp.headers.get("content-type", "audio/wav"),
                )
        except Exception as exc:
            return JSONResponse(
                status_code=500, content={"error": f"OpenTTS proxy failed: {exc}"}
            )

    return JSONResponse(
        status_code=501,
        content={
            "error": "TTS backend not configured. Install Coqui TTS or run OpenTTS and set OPEN_TTS_URL."
        },
    )
