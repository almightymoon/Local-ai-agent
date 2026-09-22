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
