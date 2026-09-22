const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let state = {};
const post = (type, extra = {}) => vscode.postMessage({type, ...extra});
for (const id of ['reconnect', 'clear', 'review', 'reject', 'approve', 'stop', 'output']) $(id).addEventListener('click', () => post(id));
function send() {
  const text = $('prompt').value.trim();
  if (!text || state.busy || state.pending || !state.connected) return;
  post('send', {text, mode: $('mode').value}); $('prompt').value = '';
}
$('form').addEventListener('submit', event => {event.preventDefault(); send();});
$('prompt').addEventListener('keydown', event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); send();}});
document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => {$('prompt').value = button.textContent; $('prompt').focus();}));
window.addEventListener('message', event => {
  if (event.data.type !== 'state') return;
  state = event.data;
  const main = $('messages'); const atEnd = main.scrollHeight - main.scrollTop - main.clientHeight < 90;
  $('status').textContent = state.connected ? `${state.workspace} · ${state.model}` : 'Local API disconnected';
  $('welcome').hidden = state.entries.length > 0;
  $('entries').replaceChildren(...state.entries.map(item => {
    const block = document.createElement('div'); block.className = `entry ${item.role}`;
    const label = document.createElement('span'); label.className = 'label'; label.textContent = item.role === 'assistant' ? 'ZENTRA' : item.role.toUpperCase();
    block.append(label, document.createTextNode(item.text)); return block;
  }));
  if (atEnd) main.scrollTop = main.scrollHeight;
  $('send').hidden = Boolean(state.busy); $('stop').hidden = !state.busy;
  $('send').disabled = !state.connected || Boolean(state.pending);
  $('clear').disabled = Boolean(state.busy || state.pending);
  $('reconnect').disabled = Boolean(state.busy);
  $('approval').hidden = !state.pending;
  $('approve').disabled = $('reject').disabled = Boolean(state.busy);
  $('context').textContent = state.selection ? `Selection · ${state.selection}` : 'Active file context included when available';
  if (state.pending) {
    const a = state.pending; $('action-title').textContent = a.tool;
    $('action-detail').textContent = a.tool === 'write_file' ? `${a.arguments.path}\n${a.arguments.content.length.toLocaleString()} characters · review the proposed diff` : JSON.stringify(a.arguments, null, 2);
  }
});
post('ready');
