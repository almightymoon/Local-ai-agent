# Zentra

This repository is the initial monorepo scaffold for a local-first AI agent product based on the architecture and product specifications included in this folder.

Zentra is designed to work like an agentic local coding partner: it can inspect the workspace, reason about the repo, plan a change, create or edit files, and verify the result with local build/test checks before reporting back.

## Product direction

- Local-first execution with optional internet-assisted research.
- A desktop shell with a local orchestration service behind it.
- Policy-guarded tool execution and human approval for risky actions.
- Persistent memory, skills, and model routing.
- Coding, browser, desktop automation, and DevOps adapters.

## Monorepo layout

- `apps/web` – React + Vite desktop/client shell.
- `packages/shared` – shared contracts and types.
- `services/api` – Python FastAPI orchestration layer.
- `docs` – project specification and design references.

## Local development

1. Install the workspace dependencies:
   npm install
2. Start Ollama locally and ensure a model is available, for example:
   ollama serve
   ollama list
3. Start the backend and desktop shell together:
   npm run start:all
4. Alternative single-service commands:
   npm run dev:api
   npm run start:desktop
5. The web shell remains available at http://localhost:5173 when needed.

### Starting everything (recommended)

Use the npm helper which ensures the script runs from the repository root:

```bash
npm run start:all
```

Avoid running `node scripts/start-local.js` from a subdirectory (for example `apps/web`) — Node will try to resolve the relative path from your current working directory and fail with "Cannot find module". If you need a single-file launcher you can run the included wrapper instead (see below).

## New features

- Conversation modes: `Ask`, `Agent`, and `Plan`.
  - `Ask`: Plain assistant responses — no tool usage or filesystem changes.
  - `Agent`: Full agentic mode (default). The agent may call tools, propose edits, and request approval.
  - `Plan`: Request a concise, step-by-step plan from the model without executing tools.

- Conversation management:
  - You can now delete conversations from the sidebar. A temporary undo snackbar appears for 6 seconds.

## Manual verification

1. Start the web UI:

```bash
cd apps/web
npm install
npm run dev
```

2. Open http://127.0.0.1:5173/ and confirm:
   - Composer now has a mode selector with `Ask`, `Agent`, and `Plan`.
   - Selecting `Ask` returns plain responses and does not propose tool actions.
   - Selecting `Plan` returns a compact step list from the model.

3. Delete a conversation from the sidebar and click `Undo` in the snackbar to restore it.

## Tests

Run the backend test suite to verify behavior (the repo includes tests covering modes and tool approvals):

```bash
cd services/api
/path/to/venv/bin/python -m pytest -q
```

## Current MVP status

This scaffold includes:

- a working React front-end shell,
- a FastAPI backend health endpoint,
- a shared package for cross-service contracts,
- a repo structure aligned to the architecture guide.

The next milestones are model runtime integration, tool policy enforcement, memory primitives, and domain adapters.

## Coding-agent workflow

Select **Agent** in the composer and describe the result you want. Zentra asks the model to inspect the workspace, create folders and files, and run validation. Each proposed edit or command shows its exact operation for approval; approving resumes the same task, including remaining tool calls. Failed commands return their output to the model so it can correct the implementation. A website prompt no longer bypasses the model with a fixed template.

**Ask** and **Plan** do not execute or advertise tools. The existing static website template remains available as an explicit manual tool; general Agent tasks use filesystem and command tools to produce the requested implementation.

Example: “Build a small calculator in a new `calculator` folder with keyboard support. Create the actual files and run a check before reporting completion.”
