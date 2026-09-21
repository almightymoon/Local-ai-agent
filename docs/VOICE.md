# Voice Conversations (Local-first)

Zentra voice v0.1 uses **complete-utterance** transcription with a local
Faster Whisper model. Browser / cloud SpeechRecognition is not required.

## Voice conversation mode

Open the **sound** icon next to the mic for a ChatGPT-style voice call:

1. Overlay opens and listens hands-free (auto end-of-speech — no push-to-talk).
2. Pause briefly when finished; Whisper transcribes automatically.
3. Transcript is sent as a normal chat message (`ask` mode).
4. Zentra **writes and speaks at the same time** (sentence-by-sentence TTS).
5. When speech finishes, it listens again for the next turn.
6. Tap **Minimize** to keep a floating orb while you use the chat UI.
7. Tap **End** (or X) to leave conversation mode.
8. Orb / “Send now” still works if you want to force-send early; tap while speaking to interrupt.

The mic button alone still dictates into the composer without auto-sending.

### TTS voices

```bash
TTS_PROVIDER=edge
TTS_VOICE=en-US-JennyNeural
```

- `edge` — free neural voices (best quality; needs network). Try also `en-US-AriaNeural`, `en-US-GuyNeural`.
- `piper` — fully local open-source offline TTS (`PIPER_VOICE=en_US-lessac-medium`).
- Browser SpeechSynthesis is only a last-resort fallback.

## Architecture

```
Mic → MediaRecorder → Blob chunks
       → stop (wait for final dataavailable + onstop)
       → POST /api/stt/upload
       → Faster Whisper (local)
       → { text, provider, model, language }
       → composer draft (dictate) OR voice conversation turn
       → POST /api/tts → neural speech playback
```

WebSocket `/api/voice/session/{id}` remains for session state / future
real-time features. **v0.1 STT does not depend on WebSocket audio.**

## Requirements

- Local Ollama model for the assistant (chat)
- `faster-whisper` (pulls model once, then works offline from cache)
- PyAV (pulled with faster-whisper) decodes WebM/Opus — no ffmpeg CLI required

## Configuration

See `.env.example`:

```bash
STT_PROVIDER=faster-whisper
WHISPER_MODEL=small.en
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=auto
WHISPER_LANGUAGE=en
WHISPER_BEAM_SIZE=5
WHISPER_VAD_FILTER=true
```

Speed vs accuracy: default `small.en` is tuned for snappy local CPU dictation.
Use `medium.en` or `large-v3` only if you prefer accuracy over latency.

`STT_PROVIDER=mock` is for unit tests only. Runtime must not silently fall
back to MockSTT.

## Setup

```bash
# from repo root
python3 -m venv .venv
source .venv/bin/activate
pip install -r services/api/requirements.txt

# optional: copy env
cp .env.example .env

# start API
npm run dev:api
# or:
.venv/bin/python -m uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8000

# start UI
npm run dev:web
```

## Manual test (microphone)

1. Start the API (`npm run dev:api`).
2. Confirm status:
   ```bash
   TOKEN=$(curl -s http://127.0.0.1:8000/api/session | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
   curl -s -H "X-Agent-Token: $TOKEN" http://127.0.0.1:8000/api/voice/status
   ```
   Expect `"provider": "faster-whisper"` (state may be `not_loaded` until first use).
3. Start the frontend (`npm run dev:web`).
4. Open a chat, click the microphone, allow mic permission.
5. Speak for ~5 seconds (e.g. "Hello Zentra, can you hear me?").
6. Click the mic again to stop.
7. Confirm the real transcript appears in the composer.
8. After the first successful transcription (model cached), disconnect internet.
9. Repeat steps 4–7.
10. Confirm it still transcribes offline.

First use may show **"Preparing local speech recognition..."** while the
Whisper model downloads. After that, the cached model is used offline.

## API

### `GET /api/voice/status`

```json
{
  "ok": true,
  "stt": {
    "provider": "faster-whisper",
    "model": "small",
    "state": "ready"
  }
}
```

States: `not_loaded` | `loading` | `ready` | `error`

### `POST /api/stt/upload`

Multipart form field `file` (WebM/Opus or WAV).

Success:

```json
{
  "text": "...",
  "provider": "faster-whisper",
  "model": "small",
  "language": "en"
}
```

Failure: HTTP 4xx/5xx with `{ "error": "...", "provider": "faster-whisper" }`.

## Security & Privacy

- Audio is processed locally; not uploaded to cloud STT.
- Temporary decode files are deleted after transcription.
- Full recordings are not written to application logs.
