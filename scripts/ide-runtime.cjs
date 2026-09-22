const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function executable() {
  const candidates = [process.env.ZENTRA_CODIUM, path.join(root, '.ide/runtime/VSCodium.app/Contents/Resources/app/bin/codium'), '/Applications/VSCodium.app/Contents/Resources/app/bin/codium'];
  return candidates.find(value => value && fs.existsSync(value));
}
function args() {
  return ['--user-data-dir', path.join(root, '.ide/profile'), '--extensions-dir', path.join(root, '.ide/extensions')];
}
function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {cwd: root, stdio: 'inherit', shell: false, ...options});
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}
async function openIde(folder = root) {
  const codium = executable();
  if (!codium) throw new Error('VSCodium is not installed. Run npm run setup:ide from the Zentra folder first.');
  const workspace = fs.realpathSync(folder);
  if (!fs.statSync(workspace).isDirectory()) throw new Error('Choose a project folder.');
  const env = {...process.env, ZENTRA_APP_ROOT: root};
  delete env.ELECTRON_RUN_AS_NODE;
  await run(codium, [...args(), '--new-window', workspace], {env});
  return {opened: true, workspace};
}
module.exports = {root, executable, args, run, openIde};
