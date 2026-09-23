const fs = require('node:fs');
const path = require('node:path');
function validateFolder(folder) {
  const resolved = fs.realpathSync(folder);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Choose a project folder.');
  return resolved;
}
function selectedWorkspace(appRoot) {
  try {return validateFolder(JSON.parse(fs.readFileSync(path.join(appRoot, '.ide/workspace.json'), 'utf8')).folder);}
  catch {return validateFolder(appRoot);}
}
function saveWorkspace(appRoot, folder) {
  const resolved = validateFolder(folder);
  fs.mkdirSync(path.join(appRoot, '.ide'), {recursive:true});
  const file = path.join(appRoot, '.ide/workspace.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify({folder:resolved}));
  fs.renameSync(file + '.tmp', file);
  return resolved;
}
module.exports = {validateFolder, selectedWorkspace, saveWorkspace};
