// Official VSCodium release, isolated from the user's existing IDE profiles.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {Readable} = require('node:stream');
const {root, executable, args, run} = require('./ide-runtime.cjs');
const version = '1.135.06055';
async function setup() {
  fs.mkdirSync(path.join(root, '.ide/runtime'), {recursive: true});
  if (!executable()) {
    if (process.platform !== 'darwin') throw new Error('Install VSCodium from vscodium.com, then set ZENTRA_CODIUM to its CLI executable and run setup again.');
    const metadata = await fetch(`https://api.github.com/repos/VSCodium/vscodium/releases/tags/${version}`, {headers: {'User-Agent': 'Zentra-IDE-Setup'}, signal: AbortSignal.timeout(30000)});
    if (!metadata.ok) throw new Error(`Cannot fetch official release: ${metadata.status}`);
    const release = await metadata.json();
    const asset = release.assets.find(a => a.name === `VSCodium-darwin-${process.arch}-${version}.zip`);
    if (!asset?.digest?.startsWith('sha256:') || !asset.browser_download_url.startsWith('https://github.com/VSCodium/vscodium/releases/download/')) throw new Error('Official release archive/checksum not found.');
    const file = path.join(root, '.ide/vscodium.zip');
    console.log(`Downloading VSCodium ${version} (${process.arch})…`);
    const response = await fetch(asset.browser_download_url, {signal: AbortSignal.timeout(600000)});
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if ('sha256:' + hash.digest('hex') !== asset.digest) {fs.unlinkSync(file); throw new Error('VSCodium checksum mismatch.');}
    await run('/usr/bin/ditto', ['-x', '-k', file, path.join(root, '.ide/runtime')]);
    fs.unlinkSync(file);
  }
  await run(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, 'scripts/package-ide.py')]);
  await run(executable(), [...args(), '--install-extension', path.join(root, '.ide/zentra-agent.vsix'), '--force']);
  const user = path.join(root, '.ide/profile/User'); fs.mkdirSync(user, {recursive: true});
  const settings = path.join(user, 'settings.json');
  if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({
    'workbench.colorTheme': 'Default Dark Modern', 'workbench.startupEditor': 'none',
    'editor.fontSize': 14, 'editor.minimap.enabled': false, 'editor.padding.top': 16,
    'workbench.sideBar.location': 'left', 'telemetry.telemetryLevel': 'off',
    'workbench.activityBar.location': 'default', 'window.title': '${rootName} — Zentra IDE',
  }, null, 2));
  console.log('Zentra IDE is ready. Run npm run start:ide, or choose Open Agent IDE in the app.');
}
setup().catch(error => {console.error(error.message); process.exitCode = 1;});
