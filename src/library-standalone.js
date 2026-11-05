'use strict';
// Recognise actual game binaries in bounded launcher folders. A launcher or
// an uninstall record alone must not turn an ordinary application into a game.
const fs = require('node:fs');
const path = require('node:path');
const container = /^(?:starward|hoyoplay|hoyo games|mihoyo|kuro(?: games)?|games?|wuthering waves(?: game)?|honkai[: ]*star rail(?: games?)?|star rail(?: games?)?|hkrpg_[a-z0-9_]+|鸣潮|崩坏[：:]?星穹铁道|米哈游)$/i;
const file = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function recognize(dir, launcher) {
  if (file(path.join(dir, 'StarRail.exe')) && file(path.join(dir, 'UnityPlayer.dll')))
    return {launcher:launcher || 'HoYoPlay / Starward', id:null, name:'崩坏：星穹铁道', dir:path.resolve(dir), poster:null};
  const client = path.join('Client', 'Binaries', 'Win64', 'Client-Win64-Shipping.exe');
  if (file(path.join(dir, 'Wuthering Waves Game', client)) ||
      (/^Wuthering Waves Game$/i.test(path.basename(dir)) && file(path.join(dir, client))))
    return {launcher:launcher || 'Kuro Games', id:null, name:'鸣潮', dir:path.resolve(dir), poster:null};
  return null;
}
function fromRoots(roots) {
  const found = [], visited = new Set();
  function visit(root, depth, launcher) {
    const dir = path.resolve(root), key = dir.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    try { const s=fs.lstatSync(dir); if (!s.isDirectory() || s.isSymbolicLink()) return; } catch { return; }
    const game = recognize(dir, launcher);
    if (game) { found.push(game); return; }
    if (!depth) return;
    let entries; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
    for (const e of entries.slice(0,512)) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const child=path.join(dir,e.name), label=/^starward$/i.test(e.name)?'Starward':launcher;
      // Always check an immediate child's exact game markers, even when the
      // user renamed that folder. Only known launcher containers are descended.
      const direct=recognize(child,label);
      if (direct) { const k=path.resolve(child).toLowerCase();if(!visited.has(k)){visited.add(k);found.push(direct);} }
      else if (container.test(e.name)) visit(child,depth-1,label);
    }
  }
  for (const root of new Set(roots.filter(Boolean))) visit(root,4,null);
  return found;
}
function commandDirectory(value) {
  if (typeof value !== 'string') return null;
  // DisplayIcon may end in ",0"; uninstall commands may contain arguments.
  // Read the executable path only. Never execute an installer command.
  const match=value.trim().match(/^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|,|$)/i);
  const executable=match && (match[1]||match[2]);
  return executable && path.isAbsolute(executable) ? path.dirname(executable) : null;
}
module.exports={recognize,fromRoots,commandDirectory};
