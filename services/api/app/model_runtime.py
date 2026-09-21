"""Local model runtime adapter layer.

This is intentionally lightweight and local-first. It exposes a single provider interface
that can later connect to Ollama, llama.cpp, or an OpenAI-compatible endpoint.
"""

import json
import os
from dataclasses import dataclass
from typing import Any, Optional
from urllib import error as urlerror
from urllib import request


@dataclass
class ProviderStatus:
    provider: str
    model: str
    available: bool
    endpoint: Optional[str] = None
    notes: str = ""


class LocalModelRouter:
    def __init__(self) -> None:
        self.provider = "ollama"
        self.model = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
        self.endpoint = os.getenv("OLLAMA_ENDPOINT", "http://127.0.0.1:11434").rstrip(
            "/"
        )

    def status(self) -> ProviderStatus:
        url = f"{self.endpoint}/api/tags"
        try:
            with request.urlopen(url, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
                models = payload.get("models", [])
                model_names = [
                    model.get("name", "") for model in models if isinstance(model, dict)
                ]
                available = bool(model_names)
                notes = (
                    f"Ollama is reachable at {self.endpoint}."
                    if available
                    else f"Ollama is reachable but the model '{self.model}' is not currently available."
                )
                if not available:
                    return ProviderStatus(
                        provider=self.provider,
                        model=self.model,
                        available=False,
                        endpoint=self.endpoint,
                        notes=notes,
                    )
                if self.model not in model_names and not any(
                    name.startswith(self.model) for name in model_names
                ):
                    return ProviderStatus(
                        provider=self.provider,
                        model=self.model,
                        available=False,
                        endpoint=self.endpoint,
                        notes=f"Ollama is reachable but the configured model '{self.model}' is not installed.",
                    )
                return ProviderStatus(
                    provider=self.provider,
                    model=self.model,
                    available=True,
                    endpoint=self.endpoint,
                    notes=notes,
                )
        except (urlerror.URLError, TimeoutError, ValueError, OSError):
            return ProviderStatus(
                provider=self.provider,
                model=self.model,
                available=False,
                endpoint=self.endpoint,
                notes=f"Ollama endpoint is not reachable at {self.endpoint}.",
            )

    def generate(self, prompt: str, **kwargs: Any) -> dict[str, Any]:
        status = self.status()
        if not status.available:
            return {
                "provider": self.provider,
                "model": self.model,
                "prompt": prompt,
                "response": (
                    f"The local Ollama endpoint at {self.endpoint} is not available. "
                    "Start the provider or set OLLAMA_ENDPOINT to a reachable instance."
                ),
                "metadata": {
                    "endpoint": self.endpoint,
                    "kwargs": kwargs,
                    "status": status.notes,
                },
            }

        payload = {"model": self.model, "prompt": prompt, "stream": False, **kwargs}
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{self.endpoint}/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=60) as response:
                content = response.read().decode("utf-8")
                data = json.loads(content or "{}")
                generated = (
                    data.get("response", "").strip()
                    or "I could not produce a model response."
                )
                return {
                    "provider": self.provider,
                    "model": self.model,
                    "prompt": prompt,
                    "response": generated,
                    "metadata": {
                        "endpoint": self.endpoint,
                        "kwargs": kwargs,
                        "status": status.notes,
                    },
                }
        except (urlerror.URLError, TimeoutError, ValueError, OSError) as exc:
            return {
                "provider": self.provider,
                "model": self.model,
                "prompt": prompt,
                "response": f"Local model request failed: {exc}",
                "metadata": {
                    "endpoint": self.endpoint,
                    "kwargs": kwargs,
                    "error": str(exc),
                },
            }

    def stream_chat(self, messages, tools):
        """Yield Ollama NDJSON chunks as they arrive, preserving tool calls."""
        payload = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": True,
        }
        req = request.Request(
            f"{self.endpoint}/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=120) as response:
            for line in response:
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if chunk.get("error"):
                    raise RuntimeError(chunk["error"])
                yield chunk
