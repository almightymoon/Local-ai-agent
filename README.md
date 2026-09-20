# Local AI Agent

This repository is the initial monorepo scaffold for a local-first AI agent product based on the architecture and product specifications included in this folder.

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

## Current MVP status

This scaffold includes:

- a working React front-end shell,
- a FastAPI backend health endpoint,
- a shared package for cross-service contracts,
- a repo structure aligned to the architecture guide.

The next milestones are model runtime integration, tool policy enforcement, memory primitives, and domain adapters.
# Local-ai-agent
