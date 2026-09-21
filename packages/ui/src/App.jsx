import React, { useEffect, useRef, useState } from "react";
import { api, tool, stream, request } from "./api";
import { Icon } from "./icons";
import "./styles.css";
import useVoiceSession from "./voice/useVoiceSession";
import VoiceButton from "./voice/VoiceButton";
import VoiceToast from "./voice/VoiceToast";
import VoiceConversation from "./voice/VoiceConversation";
import { speakText, getTtsPreferences, setTtsPreferences } from "./voice/speakLocal";

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
function groupChatsByDate(chats) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = today - 86400000;
  const week = today - 7 * 86400000;
  const buckets = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const chat of chats) {
    const t = chat.updated || 0;
    if (t >= today) buckets[0].items.push(chat);
    else if (t >= yesterday) buckets[1].items.push(chat);
    else if (t >= week) buckets[2].items.push(chat);
    else buckets[3].items.push(chat);
  }
  return buckets.filter((b) => b.items.length);
}
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
  const [ttsVoice, setTtsVoice] = useState(
    () => getTtsPreferences().voice,
  );
  const [ttsRate, setTtsRate] = useState(() => getTtsPreferences().rate);
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsRates, setTtsRates] = useState([]);
  const [ttsPreviewBusy, setTtsPreviewBusy] = useState(false);
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
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const controller = useRef(null),
    end = useRef(null),
    input = useRef(null),
    recorder = useRef(null);
  const active = chats.find((chat) => chat.id === activeId) || chats[0];
  const [voiceFinalPending, setVoiceFinalPending] = useState(false);
  const [voiceConversationOpen, setVoiceConversationOpen] = useState(false);
  const voiceConversationRef = useRef(false);
  const voice = useVoiceSession(active?.id, (finalText) => {
    // Dictate-to-composer only; conversation mode consumes the transcript itself.
    if (voiceConversationRef.current) return;
    setDraft((d) => (d ? `${d} ${finalText}` : finalText));
    setVoiceFinalPending(false);
    setVoiceOpen(false);
  });
  const [voiceError, setVoiceError] = useState(null);
  useEffect(() => {
    if (voice.error) setVoiceError(voice.error);
  }, [voice.error]);
  useEffect(() => {
    if (voiceConversationOpen) return;
    if (
      voice.state === "unavailable" ||
      voice.state === "denied" ||
      voice.state === "error"
    ) {
      setVoiceOpen(false);
      setVoiceFinalPending(false);
    }
  }, [voice.state, voiceConversationOpen]);
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
    setTtsPreferences({ voice: ttsVoice, rate: ttsRate });
  }, [ttsVoice, ttsRate]);
  useEffect(() => {
    if (page !== "settings") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/tts/voices");
        if (cancelled) return;
        setTtsVoices(data.voices || []);
        setTtsRates(data.rates || []);
        if (data.voice && !localStorage.getItem("zentra_tts_voice")) {
          setTtsVoice(data.voice);
        }
        if (data.rate && !localStorage.getItem("zentra_tts_rate")) {
          setTtsRate(data.rate);
        }
      } catch (err) {
        if (!cancelled) setNotice(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);
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
  async function runStream(path, body, chatId, messageId, { throwOnError = false, onDelta } = {}) {
    setBusy(true);
    setNotice("");
    controller.current = new AbortController();
    let finished = false;
    let fullText = "";
    try {
      await stream(
        path,
        body,
        (event, data) => {
          if (event === "message") {
            const piece = data.text || "";
            fullText += piece;
            updateMessage(chatId, messageId, (m) => ({
              ...m,
              text: m.text + piece,
            }));
            if (piece && typeof onDelta === "function") {
              try {
                onDelta(piece, fullText);
              } catch {
                /* ignore speech callback errors */
              }
            }
          }
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
      return fullText;
    } catch (err) {
      updateMessage(chatId, messageId, (m) => ({
        ...m,
        error:
          err.name === "AbortError"
            ? "Response stopped. An already approved action may still finish."
            : err.message,
      }));
      if (throwOnError && err.name !== "AbortError") throw err;
      return fullText;
    } finally {
      setBusy(false);
      controller.current = null;
      input.current?.focus();
    }
  }
  async function sendText(text, chatMode = mode, { onDelta } = {}) {
    const cleaned = String(text || "").trim();
    if (!cleaned) return "";
    if (pending) {
      throw new Error(
        "A tool action is waiting for approval in chat. Finish that first.",
      );
    }
    if (busy || controller.current) {
      throw new Error("Zentra is still responding. Try again in a moment.");
    }
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
              title: chat.messages.length ? chat.title : cleaned.slice(0, 44),
              updated: Date.now(),
              messages: [
                ...chat.messages,
                { id: crypto.randomUUID(), role: "user", text: cleaned },
                { id, role: "assistant", text: "" },
              ],
            }
          : chat,
      ),
    );
    setDraft("");
    return runStream(
      "/api/chat/stream",
      { message: cleaned, history, mode: chatMode },
      chatId,
      id,
      { throwOnError: true, onDelta },
    );
  }
  async function send(event) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy || controller.current || pending) return;
    await sendText(text, mode).catch(() => {});
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
      await speakText(text);
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
    settings: "Settings",
  };
  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  const chatGroups = groupChatsByDate(filteredChats);
  const renameChat = (chatId, title) => {
    const next = title.trim().slice(0, 80) || "New conversation";
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId ? { ...c, title: next, updated: Date.now() } : c,
      ),
    );
    setEditingId(null);
    setEditTitle("");
  };
  const deleteChat = (chat) => {
    if (!window.confirm(`Delete conversation "${chat.title}"?`)) return;
    setChats((prev) => {
      const remaining = prev.filter((c) => c.id !== chat.id);
      return remaining.length ? remaining : [newChat()];
    });
    const timer = setTimeout(() => {
      setPendingDeletes((p) => p.filter((d) => d.id !== chat.id));
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
  };
  const clearAllChats = () => {
    if (
      !window.confirm(
        "Delete all conversations? This cannot be undone from this device.",
      )
    )
      return;
    const chat = newChat();
    setChats([chat]);
    setActiveId(chat.id);
    setNotice("All conversations cleared.");
    navigate("chat");
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
              <Icon name="spark" size={20} />
            </span>
            <span className="brand-text">
              Zentra
              <span className="local-label">local</span>
            </span>
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
          <Icon name="plus" size={16} />
          New chat
          <kbd>⌘N</kbd>
        </button>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {[
            ["chat", "chat", "Chats"],
            ["workspace", "folder", "Workspace"],
            ["memory", "memory", "Memory"],
            ["skills", "spark", "Skills & tools"],
            ["activity", "shield", "Activity"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} size={17} />
              <span>{label}</span>
              {id === "chat" && (
                <span className="nav-count">{chats.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="history-section">
          <div className="history-header">
            <span className="history-label">Conversations</span>
            {chats.length > 1 && (
              <button
                type="button"
                className="text-button history-clear"
                onClick={clearAllChats}
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>
          <label className="search-chats">
            <Icon name="search" size={14} />
            <input
              aria-label="Search conversations"
              placeholder="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="icon-button search-clear"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
          <div className="chat-history">
            {chatGroups.length === 0 && (
              <p className="history-empty">
                {query ? "No matching chats" : "No conversations yet"}
              </p>
            )}
            {chatGroups.map((group) => (
              <div className="history-group" key={group.label}>
                <div className="history-group-label">{group.label}</div>
                {group.items.map((chat) => (
                  <div
                    key={chat.id}
                    className={`history-item-row ${
                      active.id === chat.id && page === "chat" ? "selected" : ""
                    }`}
                  >
                    {editingId === chat.id ? (
                      <form
                        className="rename-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          renameChat(chat.id, editTitle);
                        }}
                      >
                        <input
                          autoFocus
                          value={editTitle}
                          maxLength={80}
                          aria-label="Rename conversation"
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={(e) => {
                            if (e.target.dataset.cancel === "1") return;
                            renameChat(chat.id, editTitle);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.target.dataset.cancel = "1";
                              setEditingId(null);
                              setEditTitle("");
                            }
                          }}
                        />
                      </form>
                    ) : (
                      <>
                        <button
                          disabled={busy && chat.id !== active.id}
                          className={`history-item ${
                            active.id === chat.id && page === "chat"
                              ? "selected"
                              : ""
                          }`}
                          onClick={() => {
                            setActiveId(chat.id);
                            navigate("chat");
                            setDraft("");
                          }}
                        >
                          <Icon name="chat" size={14} />
                          <span>{chat.title}</span>
                        </button>
                        <div className="history-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title="Rename"
                            aria-label={`Rename ${chat.title}`}
                            disabled={busy}
                            onClick={() => {
                              setEditingId(chat.id);
                              setEditTitle(chat.title);
                            }}
                          >
                            <Icon name="edit" size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Delete"
                            aria-label={`Delete ${chat.title}`}
                            disabled={busy}
                            onClick={() => deleteChat(chat)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {pendingDeletes.length > 0 && (
          <div className="snackbar" role="status">
            <div>Conversation deleted</div>
            <div className="snackbar-actions">
              {pendingDeletes.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
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
            className={`nav-item ${page === "quickstart" ? "active" : ""}`}
            onClick={() => navigate("quickstart")}
          >
            <Icon name="book" size={17} />
            <span>Quick Start</span>
          </button>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" size={17} />
            <span>Settings</span>
          </button>
          <div className="profile-row">
            <span className="avatar">Y</span>
            <div className="profile-meta">
              <strong>Your local space</strong>
              <small>
                {status?.available
                  ? status.model || "Model ready"
                  : "Setup needed"}
              </small>
            </div>
            <button
              className="icon-button"
              title="Toggle light / dark theme"
              aria-label="Toggle light / dark theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
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
              {page === "chat"
                ? active.messages.length
                  ? active.title
                  : "Zentra"
                : pageNames[page]}
            </span>
            {page === "chat" && (
              <span className="model-label">
                {status?.model || "Connecting…"}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {page === "chat" && (
              <button
                className="ghost-chip"
                onClick={startChat}
                disabled={busy}
                title="New chat"
              >
                <Icon name="plus" size={14} />
                New chat
              </button>
            )}
            <button
              className="connection"
              title={status?.notes}
              onClick={() => navigate(status?.available ? "settings" : "quickstart")}
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
          </div>
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
                    <Icon name="spark" size={28} />
                  </div>
                  <h1>How can I help you today?</h1>
                  <p>
                    Your local coding partner — inspect, plan, and build with
                    approval before anything changes.
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
                        <Icon name={starter.icon} size={18} />
                        <div>
                          <strong>{starter.title}</strong>
                          <span>{starter.description}</span>
                        </div>
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
                    voice.state === "listening"
                      ? voice.statusMessage || "Listening…"
                      : voice.state === "processing"
                        ? voice.statusMessage || "Processing speech…"
                        : voice.state === "unavailable"
                          ? "STT unavailable"
                          : voice.state === "denied"
                            ? "Microphone denied"
                            : voiceOpen
                              ? "Listening…"
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
                    <button
                      type="button"
                      className={`icon-button ${voiceConversationOpen ? "recording" : ""}`}
                      aria-label="Start voice conversation"
                      title="Voice conversation"
                      onClick={() => {
                        if (voiceOpen) {
                          voice.stop();
                          setVoiceOpen(false);
                        }
                        voiceConversationRef.current = true;
                        setVoiceConversationOpen(true);
                        setVoiceError(null);
                        voice.clearError?.();
                      }}
                    >
                      <Icon name="sound" size={18} />
                    </button>
                    <VoiceButton
                      recording={voiceOpen || voice.state === "listening"}
                      onClick={async () => {
                        if (voiceConversationOpen) return;
                        if (
                          voiceOpen ||
                          voice.state === "listening" ||
                          voice.state === "processing"
                        ) {
                          if (voice.state === "processing") return;
                          setVoiceOpen(false);
                          await voice.stop();
                          setVoiceFinalPending(false);
                        } else {
                          setVoiceError(null);
                          voice.clearError?.();
                          setVoiceOpen(true);
                          setVoiceFinalPending(true);
                          await voice.start();
                        }
                      }}
                    />
                    <VoiceToast
                      message={voiceError}
                      onClose={() => {
                        setVoiceError(null);
                        voice.clearError?.();
                      }}
                    />
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
              {page === "settings" && (
                <>
                  <p className="page-intro">
                    Appearance, voice, model connection, and local data for this
                    device.
                  </p>
                  <div className="settings-grid">
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Icon name={theme === "dark" ? "moon" : "sun"} />
                        <div>
                          <h3>Appearance</h3>
                          <p>Choose how Zentra looks on this device.</p>
                        </div>
                      </div>
                      <div className="theme-toggle" role="group" aria-label="Theme">
                        <button
                          type="button"
                          className={theme === "dark" ? "active" : ""}
                          onClick={() => setTheme("dark")}
                        >
                          <Icon name="moon" size={15} />
                          Dark
                        </button>
                        <button
                          type="button"
                          className={theme === "light" ? "active" : ""}
                          onClick={() => setTheme("light")}
                        >
                          <Icon name="sun" size={15} />
                          Light
                        </button>
                      </div>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Icon name="sound" />
                        <div>
                          <h3>Voice</h3>
                          <p>
                            Choose the speaking voice for conversation mode and
                            read-aloud. Free neural voices via edge-tts.
                          </p>
                        </div>
                      </div>
                      <label className="settings-field">
                        <span>Speaker</span>
                        <select
                          value={ttsVoice}
                          onChange={(e) => setTtsVoice(e.target.value)}
                          aria-label="TTS voice"
                        >
                          {(ttsVoices.length
                            ? ttsVoices
                            : [{ id: ttsVoice, name: ttsVoice, locale: "", style: "" }]
                          ).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                              {v.locale ? ` (${v.locale})` : ""}
                              {v.gender ? ` · ${v.gender}` : ""}
                              {v.style ? ` — ${v.style}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>Speaking speed</span>
                        <select
                          value={ttsRate}
                          onChange={(e) => setTtsRate(e.target.value)}
                          aria-label="TTS speaking rate"
                        >
                          {(ttsRates.length
                            ? ttsRates
                            : [
                                { id: "+0%", label: "Normal" },
                                { id: "+15%", label: "Slightly fast" },
                                { id: "+25%", label: "Fast" },
                                { id: "+40%", label: "Very fast" },
                                { id: "-10%", label: "Slightly slow" },
                              ]
                          ).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label} ({r.id})
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="settings-actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={ttsPreviewBusy}
                          onClick={async () => {
                            setTtsPreviewBusy(true);
                            try {
                              setTtsPreferences({
                                voice: ttsVoice,
                                rate: ttsRate,
                              });
                              await speakText(
                                "Hi, I'm Zentra. This is how I sound with your selected voice.",
                              );
                            } catch (err) {
                              setNotice(err.message);
                            } finally {
                              setTtsPreviewBusy(false);
                            }
                          }}
                        >
                          <Icon name="sound" size={15} />
                          {ttsPreviewBusy ? "Playing…" : "Preview voice"}
                        </button>
                      </div>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Icon name="terminal" />
                        <div>
                          <h3>Local model</h3>
                          <p>
                            {status?.notes ||
                              "Checking connection to your local model…"}
                          </p>
                        </div>
                      </div>
                      <div className="settings-row">
                        <div>
                          <strong>
                            {status?.model || "Local model"}
                          </strong>
                          <small>
                            {status?.available
                              ? "Connected and ready"
                              : "Not connected"}
                          </small>
                        </div>
                        <button className="secondary" onClick={refreshStatus}>
                          Refresh
                        </button>
                      </div>
                      {!status?.available && (
                        <button
                          className="primary settings-cta"
                          onClick={() => navigate("quickstart")}
                        >
                          Open Quick Start
                          <Icon name="arrow" size={15} />
                        </button>
                      )}
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Icon name="chat" />
                        <div>
                          <h3>Conversations</h3>
                          <p>
                            {chats.length} saved locally in this browser.
                          </p>
                        </div>
                      </div>
                      <div className="settings-actions">
                        <button
                          className="secondary"
                          onClick={startChat}
                          disabled={busy}
                        >
                          <Icon name="plus" size={15} />
                          New chat
                        </button>
                        <button
                          className="secondary danger"
                          onClick={clearAllChats}
                          disabled={busy || chats.length < 2}
                        >
                          <Icon name="trash" size={15} />
                          Clear all chats
                        </button>
                      </div>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Icon name="shield" />
                        <div>
                          <h3>Privacy</h3>
                          <p>
                            Chats, memory, and approvals stay on your machine.
                            Tool changes still need your approval.
                          </p>
                        </div>
                      </div>
                      <div className="settings-links">
                        <button
                          className="text-button"
                          onClick={() => navigate("memory")}
                        >
                          Manage memory
                        </button>
                        <button
                          className="text-button"
                          onClick={() => navigate("activity")}
                        >
                          View activity
                        </button>
                        <button
                          className="text-button"
                          onClick={() => navigate("skills")}
                        >
                          Skills & tools
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>
      <VoiceConversation
        open={voiceConversationOpen}
        voice={voice}
        busy={busy}
        onClose={() => {
          voiceConversationRef.current = false;
          setVoiceConversationOpen(false);
        }}
        onSendTurn={async (userText, { onDelta } = {}) => {
          // Ask mode keeps voice turns conversational (no tool-approval stalls).
          if (page !== "chat") navigate("chat");
          return sendText(userText, "ask", { onDelta });
        }}
      />
    </div>
  );
}
