const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const desktopDistIndex = path.join(projectRoot, 'apps', 'desktop', 'dist', 'index.html');
const pythonExecutable = process.env.VIRTUAL_ENV
  ? path.join(process.env.VIRTUAL_ENV, 'bin', 'python')
  : path.join(projectRoot, '.venv', 'bin', 'python');

function checkHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
  });
}

function waitForHealth(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const attempt = async () => {
      const alive = await checkHealth(url);
      if (alive) {
        resolve();
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function startProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
  });
}

function ensureDesktopBundle() {
  if (fs.existsSync(desktopDistIndex)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const build = startProcess('npm', ['--workspace', 'apps/desktop', 'run', 'build']);
    build.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Desktop build failed during startup.'));
      }
    });
    build.on('error', (error) => reject(error));
  });
}

async function main() {
  let backend = null;
  await ensureDesktopBundle();
  const backendReady = await checkHealth('http://127.0.0.1:8000/health');

  if (!backendReady) {
    backend = startProcess(pythonExecutable, [
      '-m',
      'uvicorn',
      'app.main:app',
      '--app-dir',
      'services/api',
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
    ]);

    try {
      await waitForHealth('http://127.0.0.1:8000/health');
    } catch (error) {
      console.error(error.message);
      if (backend) backend.kill();
      process.exit(1);
    }
  }

  console.log('Backend ready. Launching desktop app...');

  const desktop = startProcess('npm', ['--workspace', 'apps/desktop', 'run', 'start']);

  desktop.on('exit', (code) => {
    if (backend) backend.kill();
    process.exit(code ?? 0);
  });

  if (backend) {
    backend.on('exit', (code) => {
      desktop.kill();
      process.exit(code ?? 0);
    });
  }

  process.on('SIGINT', () => {
    desktop.kill();
    if (backend) backend.kill();
    process.exit(0);
  });
}

main();
