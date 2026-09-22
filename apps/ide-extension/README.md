# Zentra Local Agent

A VSCodium / VS Code compatible extension connecting Zentra’s local Python agent and Ollama model to a real editor. Includes streamed Agent / Ask / Plan conversations, editor selection context, native proposed-file diffs, durable action approvals, and tool/command output.

Launch with `npm run start:ide` from the Zentra application repository after `npm run setup:ide`. Use the Zentra activity icon or Cmd/Ctrl+Shift+L. The app launcher supplies `ZENTRA_APP_ROOT`; it is required to start a dedicated API when the shared API is unavailable or controls another folder.

Trust one local workspace folder. Review exact file changes and commands before approving. Commands run with the logged-in user’s permissions. Save unsaved project buffers before approval; stale file hashes are rejected by the backend. Stop disconnects the stream and does not terminate an already approved command. Reconnect recovers unexpired pending approvals. The backend stops on extension deactivation; approved commands have their own time limit.

The extension uses no remote model service. It inherits the app’s configured local model. Quality and tool reliability depend on that model. Agent runs are bounded to 12 model steps; continue with a follow-up when the limit is reached.
