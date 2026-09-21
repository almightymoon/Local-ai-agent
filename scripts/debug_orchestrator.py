#!/usr/bin/env python3
"""Debug script: simulate model printing JSON tool-call text and run orchestrator."""
import sys
from pathlib import Path

# Ensure the app package is importable (match how the server runs with --app-dir services/api)
ROOT = Path(__file__).resolve().parents[1]
SYS_PATH = str((ROOT / "services" / "api").resolve())
if SYS_PATH not in sys.path:
    sys.path.insert(0, SYS_PATH)

try:
    from app.agent import orchestrator


    class FakeRouter:
        def stream_chat(self, messages, schemas):
            # Simulate a model that prints a JSON string representing a tool call
            # The orchestrator should detect this JSON and execute the tool.
            yield {"message": {"content": 'Hi — I will read the file:\n{"name":"read_file","arguments":{"path":"README.md"}}\nDone.'}}


    def run_once():
        router = FakeRouter()
        events = orchestrator.run(router, message="Read README", history=[])
        for ev in events:
            print(ev)
except Exception as exc:
    def run_once():
        print("Cannot import orchestrator (missing deps). Mock-run showing expected normalized call:")
        # Show what the orchestrator should extract and normalize
        print({"event": "message", "data": {"text": 'Hi — I will read the file:'}})
        print({"event": "tool_start", "data": {"tool_name": "read_file"}})
        print({"event": "tool_result", "data": {"path": "README.md", "content": "(file content)"}})
        print({"event": "done", "data": {"status": "completed"}})


if __name__ == "__main__":
    run_once()
