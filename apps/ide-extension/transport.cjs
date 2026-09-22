// The webview never receives the local API token or performs network requests.
const fs = require('node:fs');
const path = require('node:path');
function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Expected a loopback API URL.');
  return url.origin;
}
function sameWorkspace(a, b) {
  return fs.realpathSync(a) === fs.realpathSync(b);
}
function workspaceFile(root, relative) {
  const target = path.resolve(root, relative);
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('File path cannot be resolved.');
    existing = parent;
  }
  const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, target));
  if (!resolved.startsWith(root + path.sep)) throw new Error('File is outside the workspace.');
  return resolved;
}
async function readEvents(body, emit) {
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, {stream: true}).replace(/\r/g, '');
    if (buffer.length > 4000000) throw new Error('Agent response exceeded the stream limit.');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (event && data) { await emit(event, JSON.parse(data)); if (event === 'done') done = true; }
    }
  }
  if (!done) throw new Error('Connection ended before the agent finished. Reconnect to recover pending actions.');
}
class Client {
  constructor(url) { this.url = localUrl(url); }
  async connect(root) {
    const response = await fetch(this.url + '/api/session', {signal: AbortSignal.timeout(3000)});
    if (!response.ok) throw new Error('Local API session unavailable.');
    this.token = (await response.json()).token;
    const info = await this.json('/api/ide/workspace');
    if (info.protocol !== 1 || !sameWorkspace(info.root, root)) throw new Error('API is connected to a different workspace or needs updating.');
    return info;
  }
  async json(route) {
    const res = await fetch(this.url + route, {headers: {'X-Agent-Token': this.token}, signal: AbortSignal.timeout(5000)});
    if (!res.ok) throw new Error(`Local API: ${res.status} ${await res.text()}`);
    return res.json();
  }
  async stream(route, payload, signal, emit) {
    const res = await fetch(this.url + route, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Agent-Token': this.token}, body: JSON.stringify(payload), signal});
    if (!res.ok) throw new Error(`Local API: ${res.status} ${await res.text()}`);
    await readEvents(res.body, emit);
  }
}
module.exports = {Client, readEvents, sameWorkspace, workspaceFile, localUrl};
