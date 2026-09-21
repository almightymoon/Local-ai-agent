# Voice Conversations (Local-first)

This project includes a local-first voice conversation prototype.

Requirements

- A local Ollama model for the assistant
- STT model: faster-whisper or whisper.cpp (optional; mock provider available)
- TTS model: Coqui/OpenTTS or local provider (optional; mock provider available)

Quick start

1. Configure environment variables (see `.env.example`).
2. Start the API and model:

```bash
.venv/bin/python -m uvicorn app.main:app --reload
# ensure Ollama or other LLM is running locally
```

3. Start the UI (web or desktop) and open a conversation. Click the mic to start a Voice Session.

Notes

- Voice sessions use a WebSocket at `/api/voice/session/{conversation_id}`.
- The backend provides pluggable providers under `services/api/app/voice/`.
- By default the repository includes mock STT/TTS/VAD implementations for offline testing.

Security & Privacy

- Audio data is processed locally and not uploaded by default.
- Temporary audio chunks are not persisted unless explicitly enabled.

