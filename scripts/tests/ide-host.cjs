// Runs inside a real VSCodium extension host against a temporary workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('zentra-local.zentra-agent');
  assert.ok(extension, 'Zentra extension was installed');
  const api = await extension.activate();
  await api.connect();
  assert.equal(api.getWorkspace(), fs.realpathSync(vscode.workspace.workspaceFolders[0].uri.fsPath));
  await vscode.commands.executeCommand('zentra.openAgent');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'hello.txt'));
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(0, 0, 0, 5);
  await vscode.commands.executeCommand('zentra.sendSelection');
  await vscode.commands.executeCommand('zentra.showOutput');
  fs.writeFileSync('/tmp/zentra-ide-host-result.txt', 'PASS: real extension host, backend workspace, agent view, selection, output');
  console.log('ZENTRA_IDE_HOST_OK: installed extension, dedicated API workspace, agent view, selected code, output channel');
};
