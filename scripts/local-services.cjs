const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {root} = require('./ide-runtime.cjs');
const {selectedWorkspace, saveWorkspace, validateFolder} = require('./workspace-preferences.cjs');

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, {headers}, response => {
      let data = ''; response.on('data', chunk => {data += chunk;});
      response.on('end', () => {try {if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`); resolve(JSON.parse(data));} catch (error) {reject(error);}});
    });
    request.setTimeout(2000, () => request.destroy(new Error('Connection timeout')));
    request.on('error', reject);
  });
}
function localConfig() {
  const values = {};
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*(OLLAMA_ENDPOINT|OLLAMA_HOST)\s*=\s*["']?([^"'\s#]+)/);
    if (match) values[match[1]] = match[2];
  }
  return process.env.OLLAMA_ENDPOINT || values.OLLAMA_ENDPOINT || process.env.OLLAMA_HOST || values.OLLAMA_HOST || 'http://127.0.0.1:11434';
}
function ollamaExecutable() {
  return ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama', ...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'ollama'))].find(file => fs.existsSync(file));
}
function createServices(onStatus = () => {}) {
  let api, starting, stopped = false;
  let workspace = selectedWorkspace(root);
  let status = {phase: 'starting', message: 'Starting your local services…'};
  const log = path.join(root, '.agent-data/desktop-services.log');
  fs.mkdirSync(path.dirname(log), {recursive: true});
  const update = (phase, message) => {status = {phase, message, log, workspace}; onStatus(status);};
  function launch(command, args, env, detached = false) {
    const descriptor = fs.openSync(log, 'a', 0o600);
    let child;
    try {child = spawn(command, args, {cwd:root, env:{...process.env, ...env}, detached, stdio:['ignore', descriptor, descriptor], shell:false});}
    finally {fs.closeSync(descriptor);}
    child.on('error', error => update('error', error.message));
    if (detached) child.unref();
    return child;
  }
  async function waitFor(check, child, label) {
    for (let i = 0; i < 120; i++) {
      if (stopped) throw new Error('App is closing.');
      if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`${label} exited. Check ${log}`);
      try {return await check();} catch {await new Promise(resolve => setTimeout(resolve, 500));}
    }
    throw new Error(`${label} did not become ready. Check ${log}`);
  }
  async function stopApi() {
    if (!api || api.exitCode !== null) return;
    const child = api;
    child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    api = null;
  }
  async function start() {
    if (starting) return starting;
    stopped = false;
    starting = (async () => {
      update('starting', 'Connecting to Ollama…');
      const endpoint = new URL(localConfig());
      if (endpoint.protocol !== 'http:') throw new Error('Desktop auto-start requires an HTTP Ollama endpoint.');
      try {await getJson(new URL('/api/tags', endpoint));}
      catch {
        if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)) throw new Error('Configured remote Ollama is unavailable. Start it on that machine.');
        const executable = ollamaExecutable();
        if (!executable) throw new Error('Install Ollama once from ollama.com, then click Retry.');
        update('starting', 'Starting Ollama in the background…');
        const child = launch(executable, ['serve'], {OLLAMA_HOST: endpoint.origin}, true);
        await waitFor(() => getJson(new URL('/api/tags', endpoint)), child, 'Ollama');
      }
      update('starting', 'Starting the workspace agent…');
      const base = 'http://127.0.0.1:8000';
      const checkApi = async () => {
        const health = await getJson(base + '/health');
        if (health.app_name !== 'Zentra' || health.version !== '0.3.0') throw new Error('The running API needs an update.');
        const session = await getJson(base + '/api/session');
        const headers = {'X-Agent-Token': session.token};
        const info = await getJson(base + '/api/ide/workspace', headers);
        if (fs.realpathSync(info.root) !== workspace) throw new Error('API belongs to another project.');
        await getJson(base + '/api/models', headers);
      };
      try {await checkApi();}
      catch {
        // Do not terminate an unknown service occupying this port.
        let occupied = false;
        try {await getJson(base + '/health'); occupied = true;} catch {}
        if (occupied) throw new Error('An older or different agent is running on port 8000. Close that instance, then retry.');
        const python = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
        if (!fs.existsSync(python)) throw new Error('The local Python environment is missing. Complete the one-time setup in Quick Start.');
        api = launch(python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', path.join(root,'services/api'), '--host','127.0.0.1','--port','8000'], {AGENT_WORKSPACE:workspace, OLLAMA_ENDPOINT:endpoint.origin});
        await waitFor(checkApi, api, 'Workspace agent');
      }
      update('ready', `Ready to work in ${workspace}.`);
      return status;
    })().catch(error => {update('error', error.message); return status;}).finally(() => {starting = null;});
    return starting;
  }
  async function changeWorkspace(folder) {
    const next = validateFolder(folder);
    if (next === workspace) return status;
    update('starting', `Switching workspace to ${next}…`);
    await stopApi();
    workspace = saveWorkspace(root, next);
    return start();
  }
  return {start, changeWorkspace, status: () => status, stop() {stopped = true; api?.kill();}};
}
module.exports = {createServices, getJson, ollamaExecutable};
