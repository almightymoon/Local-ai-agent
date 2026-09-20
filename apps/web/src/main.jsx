import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { postChat, postToolApproval, postToolExecution } from './api';
import { memorySnapshot, skillsCatalog } from './agentData';
import { fetchModelStatus } from './modelStatus';
import { streamChat } from './streamApi';
import './styles.css';

function App() {
  const [message, setMessage] = useState('List the repo files');
  const [response, setResponse] = useState('');
  const [toolPlan, setToolPlan] = useState([]);
  const [toolResult, setToolResult] = useState(null);
  const [approvalState, setApprovalState] = useState(null);
  const [providerStatus, setProviderStatus] = useState({ provider: 'ollama', model: 'llama3.1:8b-instruct', available: true, notes: 'Local backend status' });
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [repoSearchText, setRepoSearchText] = useState('Local AI Agent');
  const [researchUrl, setResearchUrl] = useState('https://example.com');
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [projectSummary, setProjectSummary] = useState('Workspace inspection pending.');
  const [selectedFile, setSelectedFile] = useState('README.md');
  const [filePreview, setFilePreview] = useState('Select a file to preview it here.');

  useEffect(() => {
    fetchModelStatus().then(setProviderStatus).catch(() => {
      setProviderStatus({
        provider: 'ollama',
        model: 'llama3.1:8b-instruct',
        available: false,
        notes: 'Local backend not reachable'
      });
    });

    postToolExecution('list_workspace_files', { path: '.' })
      .then((result) => setWorkspaceFiles(result.result?.items || []))
      .catch(() => setWorkspaceFiles(['README.md', 'package.json', 'services/', 'apps/']));

    postToolExecution('inspect_project_structure', { path: '.' })
      .then((result) => setProjectSummary(result.result?.summary || 'Workspace inspection unavailable.'))
      .catch(() => setProjectSummary('Workspace inspection unavailable.'));
  }, []);

  const handleChat = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setToolPlan([]);

    // append user message and prepare assistant placeholder
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);
    setResponse('');
    setStreamingText('');
    try {
      await streamChat(message, ({ event, data }) => {
        if (event === 'message') {
          setStreamingText((prev) => `${prev}${data}`);
          setResponse((prev) => `${prev}${data}`);
          // append chunk to last assistant message
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
      setToolPlan(['reason_about_user_request']);
    } catch (error) {
      setResponse('The chat service is currently unavailable.');
    } finally {
      setLoading(false);
      setMessage('');
    }
  };

  const handleNewSession = () => {
    setMessages([]);
    setMessage('');
    setResponse('');
    setStreamingText('');
    setToolPlan([]);
    setToolResult(null);
    setApprovalState(null);
  };

  const handleRiskyToolCheck = async () => {
    setLoading(true);
    try {
      const result = await postToolExecution('terraform_apply', { environment: 'prod' });
      setToolResult(result);
      setApprovalState(result.requires_approval ? 'pending approval' : 'allowed');
    } catch (error) {
      setToolResult({ message: 'Tool check failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleRepoSearch = async () => {
    setLoading(true);
    try {
      const result = await postToolExecution('search_workspace_files', {
        path: '.',
        query: repoSearchText.trim() || 'Local AI Agent',
      });
      const matches = result.result?.matches || [];
      const summary = matches.length
        ? matches.map((match) => `${match.file}:${match.line} — ${match.match}`).join('\n')
        : 'No repo matches found.';
      setToolResult(result);
      setResponse(summary);
      setStreamingText(summary);
      setToolPlan(['search_workspace_files']);
    } catch (error) {
      setResponse('Repository search failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlanGeneration = async () => {
    setLoading(true);
    try {
      const result = await postToolExecution('generate_project_plan', {
        path: '.',
        goal: message.trim() || 'Ship the next milestone for the local AI agent',
      });
      const steps = result.result?.steps || [];
      setToolResult(result);
      setToolPlan(steps);
      setResponse(steps.map((step) => `- ${step}`).join('\n'));
      setStreamingText(steps.map((step) => `- ${step}`).join('\n'));
    } catch (error) {
      setResponse('Project planning failed.');
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
      const result = await postToolExecution('browser_navigate', { url });
      const title = result.result?.title || 'Untitled page';
      const snippet = result.result?.snippet || 'No snippet available.';
      const summary = `Title: ${title}\nURL: ${url}\n\n${snippet}`;
      setToolResult(result);
      setResponse(summary);
      setStreamingText(summary);
    } catch (error) {
      setResponse('Web research failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFile = async (fileName) => {
    if (!fileName) return;
    setSelectedFile(fileName);
    try {
      const result = await postToolExecution('read_file', { path: fileName, max_lines: 80 });
      const content = result.result?.content || 'No content available.';
      setFilePreview(`${fileName}\n\n${content}`);
    } catch (error) {
      setFilePreview(`Unable to read ${fileName}.`);
    }
  };

  const handleApproval = async (approved) => {
    setLoading(true);
    try {
      const result = await postToolApproval('terraform_apply', approved, 'prod');
      setApprovalState(result.status);
      setToolResult((prev) => ({ ...prev, approvalDecision: result }));
    } catch (error) {
      setApprovalState('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Local AI Agent</div>
        <nav>
          <button className="nav-item active">Chat</button>
          <button className="nav-item">Workspace</button>
          <button className="nav-item">Memory</button>
          <button className="nav-item">Skills</button>
          <button className="nav-item">Ops</button>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local-first orchestration</p>
            <h1>Desktop agent control plane</h1>
          </div>
          <div className="status-pill">{providerStatus.available ? 'Model router online' : 'Model router offline'}</div>
        </header>

        <section className="panel hero">
          <h2>AI assistant ready</h2>
          <p>
            This product uses local reasoning, policy-guarded actions, and explicit approvals before dangerous operations.
          </p>
        </section>

        <section className="panel controls-panel">
          <div className="chat-box">
            <div className="sessions-row">
              <button className="secondary" onClick={handleNewSession}>New Session</button>
            </div>

            <div className="messages-list">
              {messages.length === 0 && <div className="empty-state">No messages yet — start a conversation.</div>}
              {messages.map((m, idx) => (
                <div key={idx} className={`message ${m.role}`}>
                  <div className="message-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div className="message-text">{m.text}</div>
                </div>
              ))}
            </div>
            <div className="composer">
              <div className="composer-input-wrap">
                <button className="icon-btn" title="Attach">📎</button>
                <textarea
                  id="message"
                  className="composer-input"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                  placeholder="Ask the repo assistant..."
                />
                <button className="icon-btn" title="Record">🎤</button>
              </div>

              <div className="composer-actions action-row">
                <button className="primary btn" onClick={handleChat} disabled={loading}>
                  {loading ? 'Working...' : 'Send'}
                </button>
                <button className="secondary" onClick={handleRepoSearch} disabled={loading}>
                  Search repo
                </button>
                <button className="secondary" onClick={handlePlanGeneration} disabled={loading}>
                  Generate plan
                </button>
                <button className="secondary" onClick={handleResearch} disabled={loading}>
                  Fetch page
                </button>
              </div>
            </div>

            <label htmlFor="repo-search">Search query</label>
            <textarea
              id="repo-search"
              value={repoSearchText}
              onChange={(event) => setRepoSearchText(event.target.value)}
              rows={2}
            />
            <label htmlFor="research-url">Research URL</label>
            <textarea
              id="research-url"
              value={researchUrl}
              onChange={(event) => setResearchUrl(event.target.value)}
              rows={2}
            />
          </div>

          <div className="tool-box">
            <h3>Risk check</h3>
            <p>terraform_apply on prod is blocked until approval.</p>
            <button className="secondary" onClick={handleRiskyToolCheck} disabled={loading}>
              Check tool policy
            </button>
            {toolResult && (
              <div className="result-box">
                <pre>{JSON.stringify(toolResult, null, 2)}</pre>
              </div>
            )}
            {toolResult && toolResult.requires_approval && (
              <div className="approval-row">
                <button className="approve" onClick={() => handleApproval(true)} disabled={loading}>Approve</button>
                <button className="reject" onClick={() => handleApproval(false)} disabled={loading}>Reject</button>
              </div>
            )}
            {approvalState && <div className="approval-state">Approval state: {approvalState}</div>}
          </div>
        </section>

        <section className="panel grid">
          <div className="card">
            <h3>Assistant response</h3>
            <p>{streamingText || response || 'No response yet.'}</p>
          </div>
          <div className="card">
            <h3>Tool plan</h3>
            <ul>
              {toolPlan.length > 0 ? toolPlan.map((step) => <li key={step}>{step}</li>) : <li>No tool plan yet.</li>}
            </ul>
          </div>
          <div className="card">
            <h3>Memory</h3>
            <ul>
              <li>Package manager: {memorySnapshot.profile.preferred_package_manager}</li>
              <li>Editor: {memorySnapshot.profile.preferred_editor}</li>
              <li>Style: {memorySnapshot.profile.style_preferences.join(', ')}</li>
            </ul>
          </div>
          <div className="card">
            <h3>Model status</h3>
            <ul>
              <li>Provider: {providerStatus.provider}</li>
              <li>Model: {providerStatus.model}</li>
              <li>Status: {providerStatus.available ? 'available' : 'offline'}</li>
            </ul>
          </div>
          <div className="card span-two">
            <h3>Workspace summary</h3>
            <p>{projectSummary}</p>
            <div className="workspace-file-list">
              {workspaceFiles.map((item) => (
                <button key={item} className="mini-file" onClick={() => handleOpenFile(item.replace(/\/$/, ''))}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="card span-two">
            <h3>File preview: {selectedFile}</h3>
            <pre>{filePreview}</pre>
          </div>
          <div className="card span-two">
            <h3>Skills</h3>
            <ul>
              {skillsCatalog.map((skill) => (
                <li key={skill.name}>
                  <strong>{skill.name}</strong> — {skill.state} — {skill.description}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
