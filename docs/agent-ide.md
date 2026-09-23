# Agent IDE

Zentra opens a full VSCodium IDE in a separate window with its own profile. The bundled Zentra extension talks to the existing local agent, so it can inspect code, propose exact edits, and run approved checks. VSCodium provides the editor, explorer, Git UI, terminal, and extension ecosystem.

## Start

From the application folder:

```sh
npm run setup:ide
npm run start:ide
# Or choose another project:
npm run start:ide -- /absolute/path/to/project
```

The macOS setup downloads a pinned official VSCodium release for Intel or Apple silicon and verifies its SHA-256 digest before extraction. It installs the local extension from a VSIX under `.ide/`, which is ignored by Git. On other platforms install VSCodium yourself and set `ZENTRA_CODIUM` to its CLI executable before setup. The backend requires the application's `.venv` and installed API requirements, and your local model must be running.

Select any installed Ollama model in the sidebar’s model picker. Refresh after pulling a new model. The app has the same picker in its chat header and Settings. Selections persist in the connected API’s local database; an approval continuation retains the model that started that task. Separate project APIs can have separate selections.

In Electron, use **Agent IDE → Open Agent IDE**, **Choose project folder**, or **File → Open Agent IDE** (Cmd/Ctrl+Shift+I). Web previews show the equivalent terminal command. In the IDE select the **Zentra** activity icon or press Cmd/Ctrl+Shift+L. Trust the selected project, then ask the agent to implement a task. Right-click a selection to add it as context.

- **Agent** reads files, proposes edits, and runs checks after approval.
- **Ask / Plan** respond without tools.
- **View diff** opens the editor's native side-by-side comparison.
- **Approve & continue** executes exactly the stored action and resumes the original task.
- **Output** opens full tool results and captured command output.
- **Reconnect** recovers unexpired approvals after an interrupted stream.

The extension first attempts the app API at 127.0.0.1:8000, checking its canonical workspace root and protocol. Otherwise it starts a dedicated loopback API for the selected folder, with a separate action database. Multiple-root and remote workspaces are currently unsupported. The IDE preserves conversation history per workspace. There is no cloud completion provider or inline autocomplete in this version.

File writes keep the existing content-hash guard. Save unsaved editor files before approving actions. Native diffs are previews; reviewing does not apply a file. Commands run with your user permissions, not in a sandbox. Stop disconnects the current response; an already approved command can still finish. Actions expire after ten minutes and cannot be approved twice. A run allows up to twelve model steps, after which a follow-up is needed. Coding ability depends on your local model.

After changing extension code, rerun `npm run setup:ide` and reload the IDE window. Your existing VS Code/Cursor profile is not changed. `.ide/` holds the downloaded runtime, extension installation, and isolated IDE user data.

## Verification

```sh
npm run test:ide
.venv/bin/python -m pytest services/api/tests/test_api.py -q
npm run build
npm run build:desktop
```

Agent mode uses Ollama JSON-schema decisions by default so models that print tool requests can still drive tools. Set `OLLAMA_AGENT_PROTOCOL=native` to use a model’s native tool protocol. Ask and Plan retain normal text streaming. Structured agent responses appear after each complete decision.

## Open Zentra without a terminal

Run `npm run install:desktop` once on macOS. It installs `~/Applications/Zentra.app`; double-click it or keep it in your Dock. The app starts Ollama (if not already available) and the local API in the background, then connects the model picker. Existing Ollama processes are reused. The app never installs or downloads a model silently. Startup problems appear in the app with a Retry services button and are logged in `.agent-data/desktop-services.log`.

This is a local development app installation: it includes Electron and uses this repository's built UI, Python environment, and sources. Keep the repository at its current path. Rebuild the UI after source changes; reinstall if you move the repository. The API started by the app stops when the app quits; shared Ollama remains available.

Use the **Open IDE** button in the chat header. The connected IDE opens its Zentra panel automatically. Ask answers questions, Plan prepares an approach, and Agent can implement it. File edits and commands still require approval. Expired proposals can be refreshed and reviewed again; refresh never applies them, and changed files require a new proposal.

## Change projects

In the IDE agent panel, click **Change folder**, or run **Zentra: Change Workspace** from the command palette. The new project opens in a separate window so unsaved work and approvals stay in the old project. The agent connects to a backend for the new folder. Zentra remembers the selected IDE project for its next Open IDE launch. You can also use **File → Change IDE Workspace…** in the desktop app. This changes the IDE project; the desktop app’s own chat workspace remains the application repository.
