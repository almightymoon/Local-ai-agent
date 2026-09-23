// Installs a local development app: runtime in ~/Applications, source stays in this repository.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {root, run} = require('./ide-runtime.cjs');
async function install() {
  if (process.platform !== 'darwin') throw new Error('This installer currently supports macOS. Use npm run start:desktop on other systems.');
  await run('npm', ['run','build:desktop']);
  const target = path.join(os.homedir(), 'Applications/Zentra.app');
  const marker = path.join(target,'Contents/Resources/zentra-local-install.json');
  if (fs.existsSync(target) && (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker)).root !== root)) {
    const legacy = path.join(target, 'Contents/MacOS/zentra-launcher');
    if (!fs.existsSync(legacy) || !fs.readFileSync(legacy, 'utf8').includes(`EMBEDDED_REPO='${root}'`)) throw new Error('A different Zentra.app already exists. It will not be overwritten.');
    const backup = path.join(path.dirname(target), `Zentra previous ${Date.now()}.app`);
    fs.renameSync(target, backup);
    console.log(`Preserved the old repository launcher at ${backup}`);
  }
  fs.mkdirSync(path.dirname(target), {recursive:true});
  await run('/usr/bin/ditto', [path.join(root,'node_modules/electron/dist/Electron.app'),target]);
  const resources = path.join(target,'Contents/Resources');
  const app = path.join(resources,'app'); fs.mkdirSync(app,{recursive:true});
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'zentra',version:'0.3.0',type:'module',main:'bootstrap.mjs'}));
  fs.writeFileSync(path.join(app,'bootstrap.mjs'), `import ${JSON.stringify(pathToFileURL(path.join(root,'apps/desktop/main.js')).href)};\n`);
  fs.writeFileSync(marker,JSON.stringify({root}));
  for (const [key,value] of [['CFBundleIdentifier','local.zentra.desktop'],['CFBundleName','Zentra'],['CFBundleDisplayName','Zentra']]) {
    await run('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,path.join(target,'Contents/Info.plist')]);
  }
  // The locally assembled app cannot retain Electron's vendor signature.
  await run('/usr/bin/codesign',['--force','--deep','--sign','-',target]);
  console.log(`Installed ${target}. Double-click to start Zentra, its API, and Ollama. Keep the source repository in place.`);
}
install().catch(error => {console.error(error.message); process.exitCode=1;});
