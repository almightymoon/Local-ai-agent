"""Local memory and durable, single-use action records."""

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(
    os.getenv("DB_PATH", str(Path.home() / ".local/share/local-ai-agent/agent.sqlite3"))
).expanduser()


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    first_run = not DB_PATH.exists()
    db = sqlite3.connect(DB_PATH, timeout=10)
    if first_run:
        DB_PATH.chmod(0o600)
    db.row_factory = sqlite3.Row
    db.execute(
        "CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    db.execute("""CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, tool TEXT NOT NULL, arguments TEXT NOT NULL, cwd TEXT NOT NULL,
        risk TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL,
        status TEXT NOT NULL, decision INTEGER, result TEXT, continuation TEXT)""")
    legacy = Path(__file__).resolve().parent / "local_agent.db"
    if first_run and not os.getenv("DB_PATH") and legacy.is_file():
        with sqlite3.connect(f"file:{legacy}?mode=ro", uri=True) as old:
            has_memory = old.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='memory'"
            ).fetchone()
            if has_memory:
                db.executemany(
                    "INSERT OR IGNORE INTO memory(key,value) VALUES (?,?)",
                    old.execute("SELECT key,value FROM memory").fetchall(),
                )
    db.commit()
    try:
        with db:
            yield db
    finally:
        db.close()


def memories():
    with connection() as db:
        return dict(
            db.execute(
                "SELECT key, value FROM memory ORDER BY key LIMIT 100"
            ).fetchall()
        )


def save_memory(key, value):
    with connection() as db:
        db.execute(
            "INSERT INTO memory(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def create_action(tool, arguments, cwd, risk, continuation=None):
    now = time.time()
    action_id = str(uuid.uuid4())
    with connection() as db:
        db.execute(
            "INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                action_id,
                tool,
                json.dumps(arguments),
                str(cwd),
                risk,
                now,
                now + 600,
                "awaiting_approval",
                None,
                None,
                json.dumps(continuation) if continuation else None,
            ),
        )
    return get_action(action_id)


def get_action(action_id):
    with connection() as db:
        row = db.execute("SELECT * FROM actions WHERE id=?", (action_id,)).fetchone()
    if row is None:
        raise ValueError("Unknown action ID.")
    action = dict(row)
    for key in ("arguments", "result", "continuation"):
        if action[key] is not None:
            action[key] = json.loads(action[key])
    return action


def claim_action(action_id, approved):
    with connection() as db:
        cursor = db.execute(
            """UPDATE actions SET status=?, decision=?
            WHERE id=? AND status='awaiting_approval' AND expires>?""",
            (
                "executing" if approved else "rejected",
                int(approved),
                action_id,
                time.time(),
            ),
        )
        if cursor.rowcount != 1:
            raise ValueError(
                "Action is expired, already decided, or unknown. It cannot execute again."
            )
    return get_action(action_id)


def finish_action(action_id, result):
    with connection() as db:
        db.execute(
            "UPDATE actions SET status=?, result=?, continuation=NULL WHERE id=?",
            (
                "completed" if result["status"] == "ready" else result["status"],
                json.dumps(result),
                action_id,
            ),
        )
