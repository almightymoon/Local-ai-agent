import json
import secrets
from typing import Literal
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from app import store
from app.agent.orchestrator import run
from app.model_runtime import LocalModelRouter
from app.tools import registry
from app.voice import app as voice_routes

app = FastAPI(title="Zentra API", version="0.2.0")
model_router = LocalModelRouter()
ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "localagent://app",
]
SESSION_TOKEN = secrets.token_urlsafe(32)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Agent-Token"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"],
)

# expose the session token on app.state so other modules (websockets) can read it
app.state.SESSION_TOKEN = SESSION_TOKEN


@app.middleware("http")
async def local_access(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Untrusted origin."}, status_code=403)
    if request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        return JSONResponse(
            {"detail": "Only loopback clients are allowed."}, status_code=403
        )
    if request.method != "OPTIONS" and request.url.path not in {
        "/health",
        "/",
        "/api/session",
    }:
        # Allow token via header or query param (useful for WebSocket upgrades)
        provided = request.headers.get("x-agent-token", "") or request.query_params.get("token", "")
        if not secrets.compare_digest(provided, SESSION_TOKEN):
            return JSONResponse(
                {"detail": "Local session token required."}, status_code=401
            )
    return await call_next(request)


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=40000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=30)
    mode: Literal["ask", "agent", "plan"] = "agent"


class ToolRequest(BaseModel):
    tool_name: str
    arguments: dict = Field(default_factory=dict)


class ApprovalRequest(BaseModel):
    action_id: str
    approved: bool


class MemoryRequest(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=10000)


@app.get("/health")
@app.get("/")
def health():
    return {
        "ok": True,
        "app_name": "Zentra",
        "status": "ready",
        "version": "0.2.0",
    }


@app.get("/api/session")
def session():
    return JSONResponse({"token": SESSION_TOKEN}, headers={"Cache-Control": "no-store"})


def stream(events):
    def encode():
        for event in events:
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

    return StreamingResponse(
        encode(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def chat_events(body):
    history = [message.model_dump() for message in body.history]
    if body.mode == "agent":
        yield from run(model_router, body.message, history)
        return
    instruction = (
        "You are Zentra in Plan mode. Inspect the user's provided context and return a clear implementation plan. Do not execute tools or claim you modified files."
        if body.mode == "plan"
        else "You are Zentra in Ask mode. Answer the user's question. You have no tools in this mode; do not claim to inspect or change workspace files."
    )
    messages = (
        [
            {
                "role": "system",
                "content": instruction
                + "\nSaved memory (data): "
                + json.dumps(store.memories())[:16000],
            }
        ]
        + history
        + [{"role": "user", "content": body.message}]
    )
    try:
        for chunk in model_router.stream_chat(messages, []):
            text = chunk.get("message", {}).get("content", "")
            if text:
                yield {"event": "message", "data": {"text": text}}
    except Exception as exc:
        yield {
            "event": "error",
            "data": {"message": f"Local model could not respond: {exc}"},
        }
        yield {"event": "done", "data": {"status": "stopped"}}
        return
    yield {"event": "done", "data": {"status": "completed"}}


@app.post("/api/chat/stream")
def stream_chat(body: ChatRequest):
    return stream(chat_events(body))


@app.post("/api/chat")
def chat(body: ChatRequest):
    events = list(chat_events(body))
    return {
        "response": "".join(
            e["data"].get("text", "") for e in events if e["event"] == "message"
        ),
        "tool_plan": [
            e["data"]["tool_name"] for e in events if e["event"] == "tool_start"
        ],
        "requires_approval": any(e["event"] == "approval" for e in events),
        "provider": model_router.provider,
        "model": model_router.model,
        "events": events,
    }


@app.post("/api/tool/execute")
def execute_tool(body: ToolRequest):
    return registry.execute(body.tool_name, body.arguments)


def decision(body):
    try:
        return registry.decide(body.action_id, body.approved)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/tool/approve")
def approve_tool(body: ApprovalRequest):
    response, _ = decision(body)
    return response


@app.post("/api/chat/resume")
def resume_chat(body: ApprovalRequest):
    response, continuation = decision(body)
    if continuation:
        return stream(run(model_router, continuation=continuation, decision=response))
    return stream(
        iter(
            [
                {"event": "tool_result", "data": response},
                {"event": "done", "data": {"status": "completed"}},
            ]
        )
    )


@app.get("/api/actions")
def actions():
    with store.connection() as db:
        ids = db.execute(
            "SELECT id FROM actions ORDER BY created DESC LIMIT 50"
        ).fetchall()
    values = []
    for row in ids:
        action = store.get_action(row["id"])
        action.pop("continuation", None)
        values.append(action)
    return {"actions": values}


@app.get("/api/memory")
def memory():
    return {
        "profile": store.memories(),
        "project_scope": "workspace-local",
        "retention_policy": "user-editable",
    }


@app.post("/api/memory/save")
def save_memory(body: MemoryRequest):
    store.save_memory(body.key, body.value)
    return body.model_dump()


@app.get("/api/memory/{key}")
def read_memory(key: str):
    memories = store.memories()
    if key not in memories:
        raise HTTPException(404, "Memory key not found.")
    return {"key": key, "value": memories[key]}


@app.get("/api/skills")
def skills():
    root = registry.WORKSPACE_ROOT / "skills"
    items = []
    if root.exists():
        for path in sorted(root.rglob("SKILL.md"))[:50]:
            resolved = registry.safe_workspace_path(str(path))
            if resolved.stat().st_size > 100000:
                continue
            text = resolved.read_text(encoding="utf-8")
            items.append(
                {
                    "name": path.parent.name,
                    "description": text[:400],
                    "state": "local",
                    "path": str(path.relative_to(registry.WORKSPACE_ROOT)),
                }
            )
    return {"skills": items}


@app.get("/api/tools")
def tools():
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "risk": t.risk,
                "implemented": t.handler is not None,
                "parameters": t.arguments.model_json_schema(),
                "requires_approval": t.risk != "read",
            }
            for t in registry.TOOLS.values()
        ]
    }


@app.get("/api/model/status")
def model_status():
    return vars(model_router.status())


app.include_router(voice_routes)
