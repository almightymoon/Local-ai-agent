const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {readEvents, localUrl, sameWorkspace, workspaceFile, Client} = require('../transport.cjs');
test('SSE handles UTF-8 and arbitrary split boundaries, multiple events, and terminal state', async () => {
  const bytes = Buffer.from('event: message\ndata: {"text":"héllo"}\n\nevent: done\ndata: {"status":"completed"}\n\n');
  async function* chunks() {for (const byte of bytes) yield Uint8Array.of(byte);}
  const events = []; await readEvents(chunks(), (...event) => events.push(event));
  assert.deepEqual(events, [['message', {text:'héllo'}], ['done', {status:'completed'}]]);
});
test('truncated streams fail instead of claiming completion', async () => {
  async function* chunks() {yield Buffer.from('event: message\ndata: {"text":"partial"}\n\n');}
  await assert.rejects(() => readEvents(chunks(), () => {}), /before the agent finished/);
});
test('API client only accepts an exact loopback base URL', () => {
  assert.equal(localUrl('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.test', 'http://user@127.0.0.1', 'http://127.0.0.1/a', 'http://127.0.0.1/?token=x']) assert.throws(() => localUrl(url));
});
test('workspace checks resolve symlinks and reject traversal', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zentra-ide-')));
  try {
    fs.mkdirSync(path.join(root, 'project')); fs.symlinkSync(path.join(root, 'project'), path.join(root, 'alias'));
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'));
    assert.ok(sameWorkspace(path.join(root, 'project'), path.join(root, 'alias')));
    assert.equal(workspaceFile(path.join(root, 'project'), path.join(root, 'alias', 'new.txt')), path.join(root, 'project', 'new.txt'));
    assert.equal(workspaceFile(root, 'new.txt'), path.join(root, 'new.txt'));
    assert.throws(() => workspaceFile(root, '../elsewhere'));
    assert.throws(() => workspaceFile(root, 'escape/new.txt'));
  } finally {fs.rmSync(root, {recursive:true, force:true});}
});
test('client rejects the wrong workspace before streaming a task', async () => {
  const original = global.fetch;
  global.fetch = async url => ({ok:true, json:async () => url.endsWith('/api/session') ? {token:'test-token'} : {root:os.tmpdir(), protocol:1}});
  try {await assert.rejects(() => new Client('http://127.0.0.1:8000').connect(__dirname), /different workspace/);}
  finally {global.fetch = original;}
});
