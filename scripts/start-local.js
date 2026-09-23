// Electron owns service startup; the same path runs when Zentra.app is double-clicked.
const {run, root} = require('./ide-runtime.cjs');
const path = require('node:path');
(async () => {
  await run('npm', ['run','build:desktop']);
  await run(path.join(root,'node_modules/.bin/electron'), [path.join(root,'apps/desktop')]);
})().catch(error => {console.error(error.message); process.exitCode=1;});
