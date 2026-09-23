const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {selectedWorkspace, saveWorkspace} = require('../../../scripts/workspace-preferences.cjs');
test('project selection persists, resolves aliases, rejects files, and recovers from missing folders', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'zentra-project-')));
  try {
    const project = path.join(root,'project'); fs.mkdirSync(project);
    const alias = path.join(root,'alias'); fs.symlinkSync(project,alias);
    assert.equal(selectedWorkspace(root),root);
    saveWorkspace(root,alias);
    assert.equal(selectedWorkspace(root),project);
    fs.writeFileSync(path.join(root,'file.txt'),'data');
    assert.throws(() => saveWorkspace(root,path.join(root,'file.txt')));
    assert.equal(selectedWorkspace(root),project);
    fs.rmdirSync(project);
    assert.equal(selectedWorkspace(root),root);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
