import React, { useEffect, useRef, useState } from "react";
import { api, tool, stream, request } from "./api";
import { Icon } from "./icons";
import "./styles.css";
import useVoiceSession from "./voice/useVoiceSession";
import VoiceButton from "./voice/VoiceButton";
import VoiceToast from "./voice/VoiceToast";

const starters = [
  {
    icon: "code",
    title: "Understand this project",
    description: "Explore the code and how it fits together",
    prompt:
      "Inspect this repository and explain its architecture and entry points.",
  },
  {
    icon: "search",
    title: "Find the right code",
    description: "Trace a feature through the workspace",
    prompt:
      "Find where model communication is implemented, read the relevant files, and explain how it works.",
  },
  {
    icon: "terminal",
    title: "Build a small website",
    description: "Explore the workspace and scaffold a local landing page",
    prompt:
      "Inspect this repo and build a small polished landing page or website in the workspace. Start by understanding the current project structure, then create the needed files and verify the app runs locally.",
  },
  {
    icon: "spark",
    title: "Make a thoughtful change",
    description: "Plan, edit, and verify with your approval",
    prompt:
      "Inspect the project and suggest one focused improvement. Explain your plan before proposing an edit.",
  },
];
const newChat = () => ({
  id: crypto.randomUUID(),
  title: "New conversation",
  messages: [],
  updated: Date.now(),
});
function loadChats() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("zentra_chats") ||
        localStorage.getItem("athar_chats") ||
        "null",
    );
    if (
      Array.isArray(saved) &&
      saved.length &&
      saved.every((c) => c.id && Array.isArray(c.messages))
    )
      return saved;
    const legacy = JSON.parse(localStorage.getItem("localai_messages") || "[]");
    if (Array.isArray(legacy) && legacy.length)
      return [
        {
          ...newChat(),
          title: "Previous conversation",
          messages: legacy.map((m) => ({ ...m, id: crypto.randomUUID() })),
        },
      ];
  } catch {
    /* Recover gracefully from old or malformed local state. */
  }
  return [newChat()];
}
function RichText({ text = "" }) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).map((part, i) => {
    if (part.startsWith("```")) {
      const raw = part.slice(3).replace(/```$/, "");
      const nl = raw.indexOf("\n");
      return (
        <div className="code-block" key={i}>
          <div>{nl >= 0 ? raw.slice(0, nl) || "Code" : "Code"}</div>
          <pre>
            <code>{nl >= 0 ? raw.slice(nl + 1) : raw}</code>
          </pre>
        </div>
      );
    }
    return (
      <div className="prose" key={i}>
        {part.split("\n").map((line, j) => {
          const content = line
            .replace(/^#{1,4} /, "")
            .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
            .map((chunk, k) =>
              chunk.startsWith("`") ? (
                <code key={k}>{chunk.slice(1, -1)}</code>
              ) : chunk.startsWith("**") ? (
                <strong key={k}>{chunk.slice(2, -2)}</strong>
              ) : (
                chunk
              ),
            );
          return /^#{1,4} /.test(line) ? (
            <h3 key={j}>{content}</h3>
          ) : (
            <div key={j}>{content || "\u00a0"}</div>
          );
        })}
      </div>
    );
  });
}
function ActionCard({ action, onDecide, busy }) {
  const expired = action.expires * 1000 < Date.now();
  return (
    <section className="approval-card">
      <div className="section-label">
        <Icon name="shield" />
        Your approval is needed <span className="tag">{action.risk}</span>
      </div>
      <h3>{action.tool.replaceAll("_", " ")}</h3>
      <p>
        This exact action will run once.{" "}
        {action.tool === "run_command" &&
          "Commands run with your user permissions and are not sandboxed."}
      </p>
      <dl>
        <dt>Working directory</dt>
        <dd>{action.cwd}</dd>
        <dt>Expires</dt>
        <dd>{new Date(action.expires * 1000).toLocaleTimeString()}</dd>
      </dl>
      <pre>{action.diff || JSON.stringify(action.arguments, null, 2)}</pre>
      <div className="row">
        <button
          className="primary"
          disabled={busy || expired}
          onClick={() => onDecide(true)}
        >
          Approve & continue
        </button>
        <button
          className="secondary"
          disabled={busy || expired}
          onClick={() => onDecide(false)}
        >
          Reject
        </button>
        {expired && <span>Expired — request a new action.</span>}
      </div>
    </section>
  );
}
export default function App() {
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(null);
  const [page, setPage] = useState("chat");
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 800);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("zentra_theme") || "dark",
  );
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("agent");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [directory, setDirectory] = useState(".");
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState(null);
  const [memory, setMemory] = useState({});
  const [memoryKey, setMemoryKey] = useState("preference");
  const [memoryValue, setMemoryValue] = useState("");
  const [skills, setSkills] = useState([]);
  const [tools, setTools] = useState([]);
  const [actions, setActions] = useState([]);
  const [recording, setRecording] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const controller = useRef(null),
    end = useRef(null),
    input = useRef(null),
    recorder = useRef(null);
  const active = chats.find((chat) => chat.id === activeId) || chats[0];
  const [voiceFinalPending, setVoiceFinalPending] = useState(false);
  const voice = useVoiceSession(active?.id, (finalText) => {
    // insert final transcription into draft
    setDraft((d) => (d ? d + " " + finalText : finalText));
    setVoiceFinalPending(false);
  });
  const [voiceError, setVoiceError] = useState(null);
  const pending = active.messages.findLast(
    (m) => m.action && !m.decided && m.action.expires * 1000 > Date.now(),
  );
  const navigate = (next) => {
    setPage(next);
    setNotice("");
    if (window.innerWidth <= 800) setSidebar(false);
  };
  const startChat = () => {
    if (busy) return;
    const chat = newChat();
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    setDraft("");
    navigate("chat");
  };
  useEffect(() => {
    try {
      localStorage.setItem("zentra_chats", JSON.stringify(chats));
    } catch {
      setNotice(
        "Browser storage is full. This conversation cannot be saved locally.",
      );
    }
  }, [chats]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("zentra_theme", theme);
  }, [theme]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [active.messages, busy]);
  useEffect(() => {
    const unsub = window.desktop?.onNavigate((next) => {
      if (next === "new") startChat();
      else navigate(next);
    });
    return unsub;
  }, [busy]);
  const refreshStatus = async () => {
    try {
      setStatus(await api("/api/model/status"));
    } catch {
      setStatus({
        available: false,
        model: "Local model",
        notes: "Backend is offline. Open Quick Start to connect.",
      });
    }
  };
  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 30000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (page === "workspace")
      tool("list_workspace_files", { path: directory })
        .then((data) => setFiles(data.items))
        .catch((err) => setNotice(err.message));
    if (page === "memory")
      api("/api/memory")
        .then((data) => setMemory(data.profile))
        .catch((err) => setNotice(err.message));
    if (page === "activity")
      api("/api/actions")
        .then((data) => setActions(data.actions))
        .catch((err) => setNotice(err.message));
    if (page === "skills")
      Promise.all([api("/api/skills"), api("/api/tools")])
        .then(([a, b]) => {
          setSkills(a.skills);
          setTools(b.tools);
        })
        .catch((err) => setNotice(err.message));
  }, [page, directory]);
  function updateMessage(chatId, messageId, change) {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((m) =>
                m.id === messageId ? change(m) : m,
              ),
            }
          : chat,
      ),
    );
  }
  async function runStream(path, body, chatId, messageId) {
    setBusy(true);
    setNotice("");
    controller.current = new AbortController();
    let finished = false;
    try {
      await stream(
        path,
        body,
        (event, data) => {
          if (event === "message")
            updateMessage(chatId, messageId, (m) => ({
              ...m,
              text: m.text + data.text,
            }));
          if (event === "tool_start")
            updateMessage(chatId, messageId, (m) => ({
              ...m,
              activity: [
                ...(m.activity || []),
                { name: data.tool_name, status: "running" },
              ],
            }));
          if (event === "tool_result")
            updateMessage(chatId, messageId, (m) => {
              const activity = [...(m.activity || [])];
              const index = activity.findLastIndex(
                (a) => a.name === data.tool_name && a.status === "running",
              );
              const item = {
                name: data.tool_name,
                status: data.status,
                detail: data.message,
                result: data.result,
              };
              if (index >= 0) activity[index] = item;
              else activity.push(item);
              return { ...m, activity };
            });
          if (event === "approval")
            updateMessage(chatId, messageId, (m) => ({
              ...m,
              action: data,
              activity: (m.activity || []).map((a) =>
                a.status === "running"
                  ? { ...a, status: "awaiting approval" }
                  : a,
              ),
            }));
          if (event === "error")
            updateMessage(chatId, messageId, (m) => ({
              ...m,
              error: data.message,
            }));
          if (event === "done") finished = true;
        },
        controller.current.signal,
      );
      if (!finished)
        throw new Error(
          "Connection ended before the agent finished. Check its action history before retrying.",
        );
    } catch (err) {
      updateMessage(chatId, messageId, (m) => ({
        ...m,
        error:
          err.name === "AbortError"
            ? "Response stopped. An already approved action may still finish."
            : err.message,
      }));
    } finally {
      setBusy(false);
      controller.current = null;
      input.current?.focus();
    }
  }
  async function send(event) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || controller.current || pending) return;
    const id = crypto.randomUUID();
    const chatId = active.id;
    const history = active.messages
      .filter((m) => m.text)
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.text.slice(0, 40000) }));
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: chat.messages.length ? chat.title : text.slice(0, 44),
              updated: Date.now(),
              messages: [
                ...chat.messages,
                { id: crypto.randomUUID(), role: "user", text },
                { id, role: "assistant", text: "" },
              ],
            }
          : chat,
      ),
    );
    setDraft("");
    await runStream(
      "/api/chat/stream",
      { message: text, history, mode },
      chatId,
      id,
    );
  }
  async function decide(message, approved) {
    if (busy || controller.current) return;
    updateMessage(active.id, message.id, (m) => ({ ...m, decided: true }));
    const id = crypto.randomUUID();
    const chatId = active.id;
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [...chat.messages, { id, role: "assistant", text: "" }],
            }
          : chat,
      ),
    );
    await runStream(
      "/api/chat/resume",
      { action_id: message.action.id, approved },
      chatId,
      id,
    );
    // A failed network request must not hide an action that never reached the API.
    try {
      const { actions: recorded } = await api("/api/actions");
      const action = recorded.find((a) => a.id === message.action.id);
      if (
        action?.status === "awaiting_approval" &&
        action.expires * 1000 > Date.now()
      ) {
        updateMessage(chatId, message.id, (m) => ({ ...m, decided: false }));
      }
    } catch {
      setNotice(
        "Check Activity & approvals when the backend reconnects to confirm this decision.",
      );
    }
  }
  function recoverAction(action) {
    if (busy) return;
    const chat = {
      ...newChat(),
      title: "Review " + action.tool,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Recovered this pending action from the local audit store.",
          action,
        },
      ],
    };
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    navigate("chat");
  }
  async function openFile(item) {
    const path = directory === "." ? item : `${directory}/${item}`;
    if (item.endsWith("/")) {
      setDirectory(path.replace(/\/$/, ""));
      setMatches(null);
      return;
    }
    try {
      setPreview(await tool("read_file", { path, max_lines: 500 }));
    } catch (err) {
      setNotice(err.message);
    }
  }
  async function saveMemory(event) {
    event.preventDefault();
    try {
      await api("/api/memory/save", {
        key: memoryKey.trim(),
        value: memoryValue.trim(),
      });
      setMemory((prev) => ({
        ...prev,
        [memoryKey.trim()]: memoryValue.trim(),
      }));
      setMemoryValue("");
      setNotice(
        "Memory saved. It will be included in your next conversation turn.",
      );
    } catch (err) {
      setNotice(err.message);
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice("Clipboard is unavailable in this environment.");
    }
  }
  async function speak(text) {
    try {
      const response = await request("/api/tts", { text });
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setNotice(err.message);
    }
  }
  async function mic() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    let source;
    try {
      source = await navigator.mediaDevices.getUserMedia({ audio: true });
      const capture = new MediaRecorder(source);
      recorder.current = capture;
      const chunks = [];
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onstop = async () => {
        source.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const data = new FormData();
        data.append(
          "file",
          new Blob(chunks, { type: capture.mimeType }),
          "recording.webm",
        );
        try {
          const result = await api("/api/stt/upload", data);
          setDraft(result.text || "");
        } catch (err) {
          setNotice(err.message);
        }
      };
      capture.start();
      setRecording(true);
    } catch (err) {
      source?.getTracks().forEach((track) => track.stop());
      setNotice(`Microphone: ${err.message}`);
    }
  }
  const pageNames = {
    chat: "Your workspace, in conversation",
    workspace: "Workspace",
    memory: "Memory",
    skills: "Skills & tools",
    activity: "Activity & approvals",
    quickstart: "Quick Start",
  };
  return (
    <div className={`app ${sidebar ? "" : "sidebar-closed"}`}>
      {sidebar && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <div className="brand-row">
          <button className="brand" onClick={() => navigate("chat")}>
            <span className="brand-mark">
              <Icon name="spark" size={22} />
            </span>
            Zentra<span className="local-label">local</span>
          </button>
          <button
            className="icon-button"
            aria-label="Collapse sidebar"
            onClick={() => setSidebar(false)}
          >
            <Icon name="sidebar" size={18} />
          </button>
        </div>
        <button className="new-chat" onClick={startChat} disabled={busy}>
          <Icon name="plus" size={18} />
          New chat<kbd>⌘ N</kbd>
        </button>
        <nav aria-label="Main navigation">
          {[
            ["chat", "chat", "Conversations"],
            ["workspace", "folder", "Workspace"],
            ["memory", "memory", "Memory"],
            ["skills", "spark", "Skills & tools"],
            ["activity", "shield", "Activity & approvals"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} size={18} />
              {label}
              {id === "chat" && (
                <span className="nav-count">{chats.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="history-label">RECENT CONVERSATIONS</div>
        <label className="search-chats">
          <Icon name="search" size={15} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chat-history">
          {chats
            .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
            .map((chat) => (
              <div key={chat.id} className="history-item-row">
                <button
                  disabled={busy && chat.id !== active.id}
                  className={`history-item ${active.id === chat.id && page === "chat" ? "selected" : ""}`}
                  onClick={() => {
                    setActiveId(chat.id);
                    navigate("chat");
                    setDraft("");
                  }}
                >
                  <span>{chat.title}</span>
                  <Icon name="chevron" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button text-button delete-chat"
                  title={`Delete ${chat.title}`}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete conversation "${chat.title}"?`))
                      return;
                    setChats((prev) => {
                      const remaining = prev.filter((c) => c.id !== chat.id);
                      return remaining.length ? remaining : [newChat()];
                    });
                    const timer = setTimeout(() => {
                      setPendingDeletes((p) =>
                        p.filter((d) => d.id !== chat.id),
                      );
                    }, 6000);
                    setPendingDeletes((p) => [...p, { ...chat, timer }]);
                    if (active.id === chat.id) {
                      setTimeout(() => {
                        setChats((prev) => {
                          if (prev.length) {
                            setActiveId(prev[0].id);
                            return prev;
                          }
                          const nc = newChat();
                          setActiveId(nc.id);
                          return [nc, ...prev];
                        });
                      }, 0);
                    }
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
        </div>

        {pendingDeletes.length > 0 && (
          <div className="snackbar" role="status">
            <div>Conversation deleted</div>
            <div style={{ display: "flex", gap: 8 }}>
              {pendingDeletes.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    // undo: clear timeout and restore
                    clearTimeout(d.timer);
                    setPendingDeletes((p) => p.filter((x) => x.id !== d.id));
                    setChats((prev) => [d, ...prev]);
                    setActiveId(d.id);
                  }}
                >
                  Undo
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            className={`quick-link ${page === "quickstart" ? "active" : ""}`}
            onClick={() => navigate("quickstart")}
          >
            <span className="quick-icon">
              <Icon name="book" size={18} />
            </span>
            <span>
              <strong>Quick Start</strong>
              <small>A little setup. A lot of possibility.</small>
            </span>
            <Icon name="chevron" size={14} />
          </button>
          <div className="profile-row">
            <span className="avatar">Y</span>
            <div>
              <strong>Your local space</strong>
              <small>On your device. In your control.</small>
            </div>
            <button
              className="icon-button"
              title="Toggle light / dark theme"
              aria-label="Toggle light / dark theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name="sun" size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="row">
            {!sidebar && (
              <button
                className="icon-button"
                aria-label="Open sidebar"
                onClick={() => setSidebar(true)}
              >
                <Icon name="sidebar" />
              </button>
            )}
            <span className="page-title">
              {page === "chat" ? "Zentra" : pageNames[page]}
            </span>
            {page === "chat" && (
              <span className="model-label">
                {status?.model || "Connecting…"}
              </span>
            )}
          </div>
          <button
            className="connection"
            title={status?.notes}
            onClick={() => navigate("quickstart")}
          >
            <span
              className={`status-dot ${status?.available ? "online" : ""}`}
            />
            {status?.available
              ? "Running locally"
              : status
                ? "Setup needed"
                : "Connecting"}
          </button>
        </header>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {page === "chat" ? (
          <div
            className={`chat-view ${active.messages.length ? "has-messages" : ""}`}
          >
            <div className="conversation-scroll">
              {active.messages.length === 0 ? (
                <section className="welcome">
                  <div className="welcome-symbol">
                    <Icon name="spark" size={30} />
                  </div>
                  <div className="eyebrow">
                    A LITTLE LESS FRICTION. A LITTLE MORE FLOW.
                  </div>
                  <h1>
                    What would you like
                    <br />
                    to build with Zentra?
                  </h1>
                  <p>
                    A thinking partner for your code, ideas, and everyday work.
                    <br className="desktop-break" /> Powered by your local
                    model. Guided by you.
                  </p>
                  <div className="starters">
                    {starters.map((starter) => (
                      <button
                        key={starter.title}
                        onClick={() => {
                          setDraft(starter.prompt);
                          input.current?.focus();
                        }}
                      >
                        <Icon name={starter.icon} />
                        <strong>{starter.title}</strong>
                        <span>{starter.description}</span>
                        <Icon name="chevron" size={15} />
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="messages" aria-live="polite">
                  {active.messages.map((m) => (
                    <article key={m.id} className={`message ${m.role}`}>
                      <div className="message-heading">
                        {m.role === "assistant" ? (
                          <>
                            <span className="assistant-mark">
                              <Icon name="spark" size={16} />
                            </span>
                            Zentra
                          </>
                        ) : (
                          "You"
                        )}
                      </div>
                      {m.activity?.length > 0 && (
                        <details className="activity">
                          <summary>
                            {m.activity.some((a) => a.status === "running") &&
                            busy
                              ? "Working in your workspace"
                              : `${m.activity.length} tool ${m.activity.length === 1 ? "action" : "actions"}`}
                          </summary>
                          {m.activity.map((a, i) => (
                            <div className="activity-item" key={i}>
                              <Icon name="terminal" size={15} />
                              <div>
                                <strong>{a.name}</strong>
                                <small>
                                  {a.status} · {a.detail || ""}
                                </small>
                                {a.result && (
                                  <pre>{JSON.stringify(a.result, null, 2)}</pre>
                                )}
                              </div>
                            </div>
                          ))}
                        </details>
                      )}
                      <RichText text={m.text} />
                      {m.error && (
                        <p className="error" role="alert">
                          {m.error}
                        </p>
                      )}
                      {m.action && !m.decided && (
                        <ActionCard
                          action={m.action}
                          busy={busy}
                          onDecide={(approved) => decide(m, approved)}
                        />
                      )}
                      {m.decided && (
                        <p className="muted">
                          Approval decision submitted. See the continuation
                          below.
                        </p>
                      )}
                      {m.role === "assistant" &&
                        !m.text &&
                        !m.error &&
                        !m.action &&
                        busy && (
                          <span className="thinking">
                            Thinking<span>···</span>
                          </span>
                        )}
                      {m.role === "assistant" && m.text && (
                        <div className="message-actions">
                          <button
                            className="icon-button"
                            aria-label="Copy response"
                            onClick={() => copy(m.text)}
                          >
                            <Icon name="copy" size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Read response aloud"
                            onClick={() => speak(m.text)}
                          >
                            <Icon name="sound" size={17} />
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  <div ref={end} />
                </div>
              )}
            </div>
            <div className="composer-area">
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={input}
                  aria-label="Message Zentra"
                  placeholder={
                    voiceOpen
                      ? voice.partials && voice.partials.length > 0
                        ? voice.partials
                        : "Listening…"
                      : pending
                        ? "Review the proposed action above to continue…"
                        : mode === "agent"
                          ? "Describe what to build. Zentra will inspect, implement, and verify…"
                          : mode === "plan"
                            ? "What would you like to plan?"
                            : "Ask a question…"
                  }
                  rows={2}
                  value={draft}
                  maxLength={20000}
                  disabled={!!pending}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <div className="mode-select" role="tablist" aria-label="Mode">
                    {[
                      ["ask", "Ask"],
                      ["agent", "Agent"],
                      ["plan", "Plan"],
                    ].map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        title={
                          m === "agent"
                            ? "Inspect, build, and verify using workspace tools"
                            : m === "plan"
                              ? "Discuss an implementation plan without making changes"
                              : "Ask a question without running tools"
                        }
                        className={`mode-button ${mode === m ? "active" : ""}`}
                        onClick={() => setMode(m)}
                        disabled={busy}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="workspace-chip"
                    onClick={() => navigate("workspace")}
                  >
                    <Icon name="folder" size={15} />
                    Browse workspace
                  </button>
                  <div className="row">
                    <VoiceButton
                      recording={voiceOpen}
                      onClick={() => {
                        // toggle voice recording
                        if (voiceOpen) {
                          voice.stop();
                          setVoiceOpen(false);
                        } else {
                          // stop any playing TTS or audio from the app before starting
                          if (voice && voice.stopPlayback) voice.stopPlayback();
                          voice.start();
                          setVoiceOpen(true);
                          setVoiceFinalPending(true);
                        }
                      }}
                    />
                    <VoiceToast message={voiceError} onClose={() => setVoiceError(null)} />
                    {busy ? (
                      <button
                        type="button"
                        className="send"
                        aria-label="Stop response"
                        onClick={() => controller.current?.abort()}
                      >
                        <span className="stop-square" />
                      </button>
                    ) : (
                      <button
                        className="send"
                        type="submit"
                        aria-label="Send message"
                        disabled={!draft.trim() || !!pending}
                      >
                        <Icon name="arrow" size={20} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              <p className="composer-note">
                <Icon name="shield" size={12} />
                Local by default. Changes only with your approval.
                <span>Enter to send · Shift + Enter for a new line</span>
              </p>
              {/* Voice panel removed — microphone remains as a toggle button only */}
            </div>
          </div>
        ) : (
          <div className="page-scroll">
            <section className="page-content">
              <div className="eyebrow">YOUR LOCAL WORKSPACE</div>
              <h1>{pageNames[page]}</h1>
              {page === "quickstart" && (
                <>
                  <p className="page-intro">
                    From first launch to your first useful conversation.
                  </p>
                  <div className="setup-status">
                    <Icon name={status?.available ? "check" : "terminal"} />
                    <div>
                      <strong>
                        {status?.available
                          ? "You’re ready to go"
                          : "Let’s connect your local model"}
                      </strong>
                      <p>{status?.notes || "Checking your connection…"}</p>
                    </div>
                    <button className="secondary" onClick={refreshStatus}>
                      Check again
                    </button>
                  </div>
                  <div className="steps">
                    {[
                      [
                        "01",
                        "Install the project dependencies",
                        "Run these commands from the Zentra project folder.",
                        "npm install\npython3 -m venv .venv\n.venv/bin/pip install -r services/api/requirements.txt",
                      ],
                      [
                        "02",
                        "Start your local model",
                        "Install Ollama first, then start it and download the configured model.",
                        "ollama serve\n# In another terminal:\nollama pull qwen2.5-coder:7b",
                      ],
                      [
                        "03",
                        "Open your workspace",
                        "This builds the desktop app, starts the API, and launches Electron.",
                        "npm run start:all",
                      ],
                    ].map(([number, title, description, command]) => (
                      <div className="step" key={number}>
                        <span className="step-number">{number}</span>
                        <div>
                          <h3>{title}</h3>
                          <p>{description}</p>
                          <div className="command">
                            <pre>{command}</pre>
                            <button
                              className="icon-button"
                              aria-label={`Copy ${title} commands`}
                              onClick={() => copy(command)}
                            >
                              <Icon name="copy" size={17} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="tip">
                    <Icon name="shield" />
                    <p>
                      The agent can inspect files immediately. Before editing a
                      file or running a command, it shows the exact action for
                      your approval. Voice needs a separately configured local
                      STT/TTS service.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => {
                      navigate("chat");
                      setDraft(starters[0].prompt);
                    }}
                  >
                    Try your first prompt
                    <Icon name="arrow" size={16} />
                  </button>
                </>
              )}
              {page === "workspace" && (
                <>
                  <p className="page-intro">
                    Explore the files your agent can work with.
                  </p>
                  <form
                    className="search-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        setMatches(
                          (
                            await tool("search_workspace_files", {
                              path: directory,
                              query: search,
                            })
                          ).matches,
                        );
                      } catch (err) {
                        setNotice(err.message);
                      }
                    }}
                  >
                    <Icon name="search" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search file contents…"
                      aria-label="Search workspace"
                      required
                    />
                    <button className="secondary">Search</button>
                  </form>
                  <div className="file-browser">
                    <div className="file-list">
                      <div className="directory">
                        <Icon name="folder" size={16} />
                        <span>{directory}</span>
                        {directory !== "." && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setDirectory(
                                directory.includes("/")
                                  ? directory.slice(
                                      0,
                                      directory.lastIndexOf("/"),
                                    )
                                  : ".",
                              );
                              setMatches(null);
                            }}
                          >
                            Up
                          </button>
                        )}
                      </div>
                      {matches ? (
                        <>
                          <button
                            className="text-button"
                            onClick={() => setMatches(null)}
                          >
                            Clear search results
                          </button>
                          {matches.length === 0 && (
                            <p className="muted">No matches found.</p>
                          )}
                          {matches.map((match, i) => (
                            <button
                              className="file-row"
                              key={i}
                              onClick={() => openFile(match.file)}
                            >
                              <Icon name="file" size={16} />
                              <span>
                                {match.file}:{match.line}
                                <small>{match.match}</small>
                              </span>
                            </button>
                          ))}
                        </>
                      ) : (
                        files.map((file) => (
                          <button
                            key={file}
                            className="file-row"
                            onClick={() => openFile(file)}
                          >
                            <Icon
                              name={file.endsWith("/") ? "folder" : "file"}
                              size={17}
                            />
                            <span>{file}</span>
                            {file.endsWith("/") && (
                              <Icon name="chevron" size={13} />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    <div className="file-preview">
                      {preview ? (
                        <>
                          <div className="directory">{preview.path}</div>
                          <pre>{preview.content}</pre>
                          {preview.truncated && (
                            <p className="muted">
                              Showing the first 500 lines.
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="preview-empty">
                          <Icon name="file" size={32} />
                          <p>Select a file to take a look.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              {page === "memory" && (
                <>
                  <p className="page-intro">
                    A few things worth remembering. Saved locally and included
                    in the agent’s context.
                  </p>
                  <form className="memory-form" onSubmit={saveMemory}>
                    <label>
                      Memory name
                      <input
                        value={memoryKey}
                        onChange={(e) => setMemoryKey(e.target.value)}
                        required
                        maxLength={100}
                      />
                    </label>
                    <label>
                      What should Zentra remember?
                      <textarea
                        placeholder="I prefer pnpm and concise explanations…"
                        value={memoryValue}
                        onChange={(e) => setMemoryValue(e.target.value)}
                        required
                        maxLength={10000}
                        rows={4}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={!memoryKey.trim() || !memoryValue.trim()}
                    >
                      Save memory
                    </button>
                  </form>
                  <div className="memory-list">
                    {Object.entries(memory).map(([key, value]) => (
                      <div className="memory-card" key={key}>
                        <Icon name="memory" />
                        <div>
                          <h3>{key}</h3>
                          <p>{value}</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setMemoryKey(key);
                            setMemoryValue(value);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                    {!Object.keys(memory).length && (
                      <p className="muted">
                        No saved memories yet. Add your first preference above.
                      </p>
                    )}
                  </div>
                </>
              )}
              {page === "activity" && (
                <>
                  <p className="page-intro">
                    Exact actions, decisions, and recorded results. Recover a
                    pending approval after a disconnected session.
                  </p>
                  <button
                    className="secondary"
                    onClick={() =>
                      api("/api/actions")
                        .then((data) => setActions(data.actions))
                        .catch((err) => setNotice(err.message))
                    }
                  >
                    Refresh activity
                  </button>
                  {!actions.length && (
                    <p className="empty-card">
                      No proposed actions yet. Read-only tool activity appears
                      in its conversation.
                    </p>
                  )}
                  {actions.map((action) => (
                    <details className="audit-card" key={action.id}>
                      <summary>
                        <strong>{action.tool.replaceAll("_", " ")}</strong>
                        <span className="tag">
                          {action.status === "awaiting_approval" &&
                          action.expires * 1000 < Date.now()
                            ? "expired"
                            : action.status}
                        </span>
                      </summary>
                      <p className="muted">
                        {new Date(action.created * 1000).toLocaleString()} ·{" "}
                        {action.cwd}
                      </p>
                      <pre>{JSON.stringify(action.arguments, null, 2)}</pre>
                      {action.result && (
                        <pre>{JSON.stringify(action.result, null, 2)}</pre>
                      )}
                      {action.status === "awaiting_approval" &&
                        action.expires * 1000 > Date.now() && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => recoverAction(action)}
                          >
                            Review action
                          </button>
                        )}
                    </details>
                  ))}
                </>
              )}
              {page === "skills" && (
                <>
                  <p className="page-intro">
                    See what your agent can do, and where it needs your say.
                  </p>
                  <h3>Local skills</h3>
                  {skills.length ? (
                    skills.map((skill) => (
                      <div className="capability" key={skill.path}>
                        <Icon name="book" />
                        <div>
                          <strong>{skill.name}</strong>
                          <p>{skill.description}</p>
                          <small>{skill.path}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-card">
                      No skill files yet. Add a <code>SKILL.md</code> under{" "}
                      <code>skills/</code> in your workspace to make it
                      discoverable. Ask the agent to read it when needed.
                    </p>
                  )}
                  <h3 className="tools-heading">Available tools</h3>
                  <div className="capabilities">
                    {tools.map((t) => (
                      <div className="capability" key={t.name}>
                        <Icon name={t.risk === "read" ? "code" : "shield"} />
                        <div>
                          <strong>{t.name.replaceAll("_", " ")}</strong>
                          <p>{t.description}</p>
                        </div>
                        <span
                          className={`tag ${!t.implemented ? "muted" : ""}`}
                        >
                          {!t.implemented
                            ? "Not implemented"
                            : t.requires_approval
                              ? "Approval required"
                              : "Ready"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
