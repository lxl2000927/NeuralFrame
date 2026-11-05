'use strict';
// Tie previewed loose dependency files to the last verified extraction. If
// anything changes, prepare the verified archive again before showing a plan.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const marker = '.preview-proof.json';
function files(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      if (entry.name === marker) continue;
      if (entry.isSymbolicLink()) throw Error('Linked dependency cache');
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.push([path.relative(root,full),crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  }
  walk(root); return result.sort((a,b)=>a[0].localeCompare(b[0]));
}
function valid(root, archiveHash) {
  try { const record=JSON.parse(fs.readFileSync(path.join(root,marker),'utf8')); return record.version===1 && record.archiveHash===archiveHash && JSON.stringify(record.files)===JSON.stringify(files(root)); } catch {return false;}
}
function save(root, archiveHash) { fs.writeFileSync(path.join(root,marker),JSON.stringify({version:1,archiveHash,files:files(root)}),'utf8'); }
module.exports={valid,save};
