import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const API_BASE = 'http://127.0.0.1:8000';

const defaultExplorerItems = [
  { name: 'Local-AI-agent', type: 'folder', active: true },
  { name: '.pytest_cache', type: 'folder' },
  { name: '.venv', type: 'folder' },
  { name: 'apps', type: 'folder' },
  { name: 'docs', type: 'folder' },
  { name: 'node_modules', type: 'folder' },
  { name: 'packages', type: 'folder' },
  { name: 'scripts', type: 'folder' },
  { name: 'services', type: 'folder' },
  { name: '.gitignore', type: 'file' },
  { name: 'README.md', type: 'file' },
  { name: 'package-lock.json', type: 'file' },
  { name: 'package.json', type: 'file' },
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

async function streamChat(message, onChunk) {
  const response = await fetch(`${API_BASE}/api/chat/stream?message=${encodeURIComponent(message)}`);

  if (!response.ok) {
    throw new Error('Stream request failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const eventMatch = part.match(/event:\s*(.+)/);
      const dataMatch = part.match(/data:\s*(.+)/);
      if (eventMatch && dataMatch) {
        onChunk({
          event: eventMatch[1].trim(),
          data: dataMatch[1].trim(),
        });
      }
    }
  }
}

function App() {
  const [message, setMessage] = useState('List the repo files and summarize the project.');
  const [response, setResponse] = useState('');
  const [toolResult, setToolResult] = useState(null);
  const [approvalState, setApprovalState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [explorerItems, setExplorerItems] = useState(defaultExplorerItems);
  const [projectSummary, setProjectSummary] = useState('Loading workspace...');
  const [selectedFile, setSelectedFile] = useState('README.md');
  const [filePreview, setFilePreview] = useState('Loading file preview...');
  const [projectPlan, setProjectPlan] = useState('Generate a plan for the next milestone.');
  const [researchUrl, setResearchUrl] = useState('https://example.com');
  const [modelStatus, setModelStatus] = useState({
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    available: false,
    notes: 'Checking backend...',
  });
  const [memoryProfile, setMemoryProfile] = useState({
    preferred_package_manager: 'npm',
    preferred_editor: 'VS Code',
    style_preferences: ['concise', 'local-first'],
  });
  const [memoryDraft, setMemoryDraft] = useState('Project goal: build a local-first AI workspace assistant focused on repo-safe actions.');
  const [memoryStatus, setMemoryStatus] = useState('No saved note yet.');
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    fetchJson(`${API_BASE}/api/model/status`)
      .then((status) => setModelStatus(status))
      .catch(() =>
        setModelStatus({
          provider: 'ollama',
          model: 'qwen2.5-coder:7b',
          available: false,
          notes: 'Backend unreachable',
        })
      );

    fetchJson(`${API_BASE}/api/memory`)
      .then((memory) => setMemoryProfile(memory.profile || memoryProfile))
      .catch(() => setMemoryProfile({
        preferred_package_manager: 'npm',
        preferred_editor: 'VS Code',
        style_preferences: ['concise', 'local-first'],
      }));

    fetchJson(`${API_BASE}/api/tool/execute`, {
      method: 'POST',
      body: JSON.stringify({ tool_name: 'list_workspace_files', arguments: { path: '.' } }),
    })
      .then((result) => {
        const items = result.result?.items || [];
        const tree = [
          { name: 'Local-AI-agent', type: 'folder', active: true },
          ...items
            .filter((item) => item !== 'Local-AI-agent/')
            .map((item) => ({
              name: item.replace(/\/$/, ''),
              type: item.endsWith('/') ? 'folder' : 'file',
              active: item === 'README.md',
            }))
        ];
        setExplorerItems(tree);
      })
      .catch(() => setExplorerItems(defaultExplorerItems));

    fetchJson(`${API_BASE}/api/tool/execute`, {
      method: 'POST',
      body: JSON.stringify({ tool_name: 'inspect_project_structure', arguments: { path: '.' } }),
    })
      .then((result) => {
        setProjectSummary(result.result?.summary || 'Workspace inspection unavailable.');
      })
      .catch(() => setProjectSummary('Workspace inspection unavailable.'));
  }, []);

  const handleChat = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setApprovalState(null);

    // add user and assistant placeholder
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);
    setResponse('');

    try {
      await streamChat(message, ({ event, data }) => {
        if (event === 'message') {
          setResponse((prev) => `${prev}${data}`);
          setMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === 'assistant') {
                copy[i] = { ...copy[i], text: `${copy[i].text || ''}${data}` };
                break;
              }
            }
            return copy;
          });
        }
      });
    } catch (error) {
      setResponse('The local backend is not reachable.');
    } finally {
      setLoading(false);
      setMessage('');
    }
  };

  const handleNewSession = () => {
    setMessages([]);
    setMessage('');
    setResponse('');
    setFilePreview('');
    setToolResult(null);
    setApprovalState(null);
  };

  const handleToolCheck = async () => {
    setLoading(true);
    try {
      const result = await fetchJson(`${API_BASE}/api/tool/execute`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: 'terraform_apply', arguments: { environment: 'prod' } }),
      });
      setToolResult(result);
      setApprovalState(result.requires_approval ? 'pending approval' : 'allowed');
    } catch (error) {
      setToolResult({ status: 'error', message: 'Tool check failed' });
      setApprovalState('error');
    } finally {
      setLoading(false);
    }
  };

  const handleRepoSearch = async () => {
    const query = message.trim() || 'Local AI Agent';
    setLoading(true);
    setResponse('');
    setApprovalState(null);

    try {
      const result = await fetchJson(`${API_BASE}/api/tool/execute`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: 'search_workspace_files', arguments: { path: '.', query } }),
      });

      const matches = result.result?.matches || [];
      const formatted = matches.length
        ? matches.map((match) => `${match.file}:${match.line}\n${match.match}`).join('\n\n')
        : 'No repo matches were found for this query.';

      setResponse(formatted);
      setToolResult(result);
    } catch (error) {
      setResponse('Repository search failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (approved) => {
    setLoading(true);
    try {
      const result = await fetchJson(`${API_BASE}/api/tool/approve`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: 'terraform_apply', approved, environment: 'prod' }),
      });
      setApprovalState(result.status);
      setToolResult((prev) => ({ ...(prev || {}), approval: result }));
    } catch (error) {
      setApprovalState('error');
    } finally {
      setLoading(false);
    }
  };

  const handleResearch = async () => {
    const url = researchUrl.trim();
    if (!url) {
      setResponse('Add a URL before fetching a page.');
      return;
    }

    setLoading(true);
    try {
      const result = await fetchJson(`${API_BASE}/api/tool/execute`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: 'browser_navigate', arguments: { url } }),
      });
      const title = result.result?.title || 'Untitled page';
      const snippet = result.result?.snippet || 'No snippet available.';
      setResponse(`Title: ${title}\nURL: ${url}\n\n${snippet}`);
      setToolResult(result);
    } catch (error) {
      setResponse('Web research failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleMemorySave = async () => {
    const value = memoryDraft.trim();
    if (!value) {
      setMemoryStatus('Add a note before saving.');
      return;
    }

    setLoading(true);
    try {
      const result = await fetchJson(`${API_BASE}/api/memory/save`, {
        method: 'POST',
        body: JSON.stringify({ key: 'session_note', value }),
      });
      setMemoryStatus(`Saved memory key: ${result.key}`);
      setToolResult((prev) => ({ ...(prev || {}), memory: result }));
    } catch (error) {
      setMemoryStatus('Memory save failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanGeneration = async () => {
    setLoading(true);
    try {
      const result = await fetchJson(`${API_BASE}/api/tool/execute`, {
        method: 'POST',
        body: JSON.stringify({
          tool_name: 'generate_project_plan',
          arguments: { path: '.', goal: message.trim() || 'Ship the next milestone for the local AI agent' },
        }),
      });
      const plan = result.result?.steps || [];
      setProjectPlan(plan.map((step) => `- ${step}`).join('\n'));
      setToolResult(result);
    } catch (error) {
      setProjectPlan('Project planning is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFile = async (fileName) => {
    if (!fileName) return;
    setSelectedFile(fileName);
    setLoading(true);

    try {
      const result = await fetchJson(`${API_BASE}/api/tool/execute`, {
        method: 'POST',
        body: JSON.stringify({ tool_name: 'read_file', arguments: { path: fileName, max_lines: 120 } }),
      });
      const content = result.result?.content || 'No content available.';
      setFilePreview(`${fileName}\n\n${content}`);
    } catch (error) {
      setFilePreview(`Unable to read ${fileName}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="window-controls">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div className="topbar-title">Local AI Agent</div>
        <div className="topbar-actions">
          <span>⌁</span>
          <span>◫</span>
          <span>⎇</span>
        </div>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <div className="sidebar-header">Explorer</div>
          <div className="file-tree">
            {explorerItems.map((item) => (
              <div
                key={item.name}
                className={`tree-item ${item.type} ${item.active ? 'active' : ''}`}
                onClick={() => item.type === 'file' && handleOpenFile(item.name)}
                role="button"
                tabIndex={item.type === 'file' ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && item.type === 'file') {
                    handleOpenFile(item.name);
                  }
                }}
              >
                {item.name}
              </div>
            ))}
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-main">
            <section className="panel hero">
              <h2>AI workspace ready</h2>
              <p>Prompt repo and build process...</p>

                <div className="chat-panel">
                  <div className="sessions-row">
                    <button className="secondary-button" onClick={handleNewSession}>New Session</button>
                  </div>

                  <div className="messages-list">
                    {messages.length === 0 && <div className="empty-state">No messages yet — start a conversation.</div>}
                    {messages.map((m, i) => (
                      <div key={i} className={`message ${m.role}`}>
                        <div className="message-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                        <div className="message-text">{m.text}</div>
                      </div>
                    ))}
                  </div>
                <div className="composer">
                  <div className="composer-input-wrap">
                    <button className="icon-btn" title="Attach">📎</button>
                    <textarea
                      className="composer-input"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                      placeholder="Ask the repo assistant..."
                    />
                    <button className="icon-btn" title="Record">🎤</button>
                  </div>
                  <div className="composer-actions prompt-row">
                    <button className="primary-button" onClick={handleChat} disabled={loading}>
                      {loading ? 'Working...' : 'Send'}
                    </button>
                    <button className="secondary-button" onClick={handleRepoSearch} disabled={loading}>
                      Search repo
                    </button>
                    <button className="secondary-button" onClick={handlePlanGeneration} disabled={loading}>
                      Generate plan
                    </button>
                    <button className="secondary-button" onClick={handleResearch} disabled={loading}>
                      Fetch page
                    </button>
                    <button className="secondary-button" onClick={handleToolCheck} disabled={loading}>
                      Check tool policy
                    </button>
                  </div>

                </div>

                <textarea
                  className="memory-input"
                  value={researchUrl}
                  onChange={(event) => setResearchUrl(event.target.value)}
                  placeholder="https://example.com"
                />

                <div className="response-box">
                  <h3>Assistant response</h3>
                  <div className="response-content">{response || 'No response yet.'}</div>
                </div>

                <div className="response-box preview-box">
                  <h3>File preview: {selectedFile}</h3>
                  <div className="response-content">{filePreview}</div>
                </div>
              </div>
            </section>

            <aside className="panel right-rail">
              <button className="secondary-button">New Session</button>

              <div className="summary-box">
                <div className="mini-label">Status</div>
                <ul className="summary-list">
                  <li>Model: {modelStatus.model}</li>
                  <li>Provider: {modelStatus.provider}</li>
                  <li>Notes: {modelStatus.notes}</li>
                </ul>
                <div className={`status-pill ${modelStatus.available ? 'online' : 'offline'}`}>
                  {modelStatus.available ? 'online' : 'offline'}
                </div>
              </div>

              <div className="summary-box">
                <div className="mini-label">Memory</div>
                <ul className="summary-list">
                  <li>Package manager: {memoryProfile.preferred_package_manager}</li>
                  <li>Editor: {memoryProfile.preferred_editor}</li>
                  <li>Style: {memoryProfile.style_preferences?.join(', ')}</li>
                </ul>
                <textarea
                  className="memory-input"
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  placeholder="Write a project note or working goal..."
                />
                <div className="prompt-row">
                  <button className="secondary-button" onClick={handleMemorySave} disabled={loading}>
                    Save note
                  </button>
                </div>
                <div className="approval-state">{memoryStatus}</div>
              </div>

              <div className="summary-box">
                <div className="mini-label">Workspace</div>
                <div className="response-content">{projectSummary}</div>
              </div>

              <div className="summary-box">
                <div className="mini-label">Project plan</div>
                <div className="response-content">{projectPlan}</div>
              </div>

              {toolResult && (
                <div className="tool-box">
                  <h3>Tool result</h3>
                  <pre className="tool-output">{JSON.stringify(toolResult, null, 2)}</pre>
                  {toolResult.requires_approval && (
                    <div className="approval-row">
                      <button className="approve-button" onClick={() => handleApproval(true)} disabled={loading}>Approve</button>
                      <button className="reject-button" onClick={() => handleApproval(false)} disabled={loading}>Reject</button>
                    </div>
                  )}
                  {approvalState && <div className="approval-state">Approval: {approvalState}</div>}
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
