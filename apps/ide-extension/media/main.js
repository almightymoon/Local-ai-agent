const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let state = {};
const post = (type, extra = {}) => vscode.postMessage({type, ...extra});
for (const id of ['reconnect', 'clear', 'review', 'reject', 'approve', 'stop', 'output', 'preview', 'rollback', 'refreshModels', 'refreshProposal', 'changeWorkspace']) $(id).addEventListener('click', () => post(id));
function send() {
  const text = $('prompt').value.trim();
  if (!text || state.busy || state.pending || !state.connected) return;
  post('send', {text, mode: $('mode').value}); $('prompt').value = '';
}
$('model').addEventListener('change', () => post('model', {model: $('model').value}));
$('approvalMode').addEventListener('change', () => post('approvalMode', {mode: $('approvalMode').value}));
$('form').addEventListener('submit', event => {event.preventDefault(); send();});
$('prompt').addEventListener('keydown', event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); send();}});
document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => {$('prompt').value = button.textContent; $('prompt').focus();}));
window.addEventListener('message', event => {
  if (event.data.type === 'prefill') { $('prompt').value = event.data.text || ''; $('prompt').focus(); return; }
  if (event.data.type !== 'state') return;
  state = event.data;
  const main = $('messages'); const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 90;
  $('model').replaceChildren(...(state.models || []).map(model => {const option = document.createElement('option'); option.value = model.name; option.textContent = `${model.name}${model.size ? ' · ' + (model.size / 1e9).toFixed(1) + ' GB' : ''}`; return option;}));
  $('model').value = state.model || '';
  $('model').disabled = !state.connected || Boolean(state.busy || state.pending);
  $('approvalMode').value = state.approvalMode || 'ask';
  $('approvalMode').disabled = !state.connected || Boolean(state.busy);
  $('approvalHint').textContent = state.approvalMode === 'all' ? 'Autopilot · Edits and project commands run automatically' : state.approvalMode === 'edits' ? 'Auto-approve edits · Commands still ask first' : 'Ask every time · Review edits and commands';
  $('refreshModels').disabled = Boolean(state.busy);
  $('workspace-path').textContent = state.workspace || 'Choose a project';
  $('workspace-path').title = state.workspacePath || '';
  $('changeWorkspace').disabled = Boolean(state.busy);
  $('status').textContent = state.connected ? `${state.workspace} · ${state.model}` : 'Local API disconnected';
  $('welcome').hidden = state.entries.length > 0;
  $('entries').replaceChildren(...state.entries.map(item => {
    const block = document.createElement('div'); block.className = `entry ${item.role}`;
    const label = document.createElement('span'); label.className = 'label'; label.textContent = item.role === 'assistant' ? 'ZENTRA' : item.role.toUpperCase();
    block.append(label, document.createTextNode(item.text));
    if (item.role === 'assistant' || item.role === 'user') {
      const action = document.createElement('button'); action.textContent = item.role === 'assistant' ? 'Copy' : 'Edit';
      action.addEventListener('click', () => {
        if (item.role === 'assistant') post('copy', {text: item.text});
        else {$('prompt').value = item.text; $('prompt').focus();}
      });
      block.append(action);
    }
    return block;
  }));
  const activity = state.entries.filter(item => item.role === 'tool' || item.role === 'error').slice(-20);
  $('activityList').replaceChildren(...activity.map(item => {const row = document.createElement('p'); row.textContent = item.text; return row;}));
  if (atEnd) main.scrollTop = main.scrollHeight;
  $('send').hidden = Boolean(state.busy); $('stop').hidden = !state.busy;
  $('send').disabled = !state.connected || Boolean(state.pending);
  $('clear').disabled = Boolean(state.busy || state.pending);
  $('reconnect').disabled = Boolean(state.busy);
  $('approval').hidden = !state.pending;
  $('diffDrawer').hidden = !state.pending?.diff;
  $('diffText').textContent = state.pending?.diff || '';
  $('approve').disabled = $('reject').disabled = Boolean(state.busy);
  $('context').textContent = state.selection ? `Selection · ${state.selection}` : 'Active file context included when available';
  if (state.pending) {
    const a = state.pending;
    const expired = a.expires * 1000 <= Date.now();
    $('refreshProposal').hidden = !expired;
    $('approve').disabled = $('reject').disabled = Boolean(state.busy || expired);
    $('action-title').textContent = a.tool;
    $('action-detail').textContent = a.tool === 'write_file' ? `${a.arguments.path}\n${a.arguments.content.length.toLocaleString()} characters · review the proposed diff` : a.tool === 'write_files' ? `${a.arguments.files.length} related files · review the combined diff below` : JSON.stringify(a.arguments, null, 2);
  }
});
post('ready');

setInterval(() => {if (state.pending && state.pending.expires * 1000 <= Date.now()) { $('refreshProposal').hidden = false; $('approve').disabled = $('reject').disabled = true; }}, 1000);
