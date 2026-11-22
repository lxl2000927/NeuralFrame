'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { fs } = require('./preview-fs');
const journal = require('./file-journal');
const revisions = require('./delta-revisions.json');

function location(exePath) {
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA))
    throw Error('无法定位三角洲运行库缓存。');
  const exe = path.resolve(exePath);
  const id = crypto
    .createHash('sha256')
    .update(exe.replaceAll('/', '\\').toLowerCase())
    .digest('hex')
    .slice(0, 32);
  const rel = path.join('RTXFG-Delta4X', 'games', id);
  return {
    exe,
    id,
    folder: journal.safePath(process.env.LOCALAPPDATA, rel),
    owner: journal.safePath(process.env.LOCALAPPDATA, path.join(rel, 'owner.json')),
  };
}
function readOwner(loc) {
  if (!fs.existsSync(loc.owner)) return null;
  if (!fs.statSync(loc.owner).isFile() || fs.statSync(loc.owner).size > 8192)
    throw Error('三角洲缓存归属记录无效。');
  const value = JSON.parse(fs.readFileSync(loc.owner, 'utf8'));
  if (
    value.schema !== 1 ||
    value.id !== loc.id ||
    typeof value.exe !== 'string' ||
    value.exe.toLowerCase() !== loc.exe.toLowerCase()
  )
    throw Error('三角洲缓存已由其他游戏使用。');
  return value;
}
async function register(gameDir, exePath) {
  const loc = location(exePath);
  const existing = readOwner(loc);
  if (existing) return { id: loc.id, owned: existing.manager === 'NeuralFrame' };
  if (fs.existsSync(loc.folder) && fs.readdirSync(loc.folder).length)
    throw Error('三角洲缓存目录有未登记的文件，请先核对。');
  const save = async () => {
    const again = readOwner(location(exePath));
    if (again?.manager === 'NeuralFrame') return;
    await fs.promises.mkdir(loc.folder, { recursive: true });
    await fs.promises.writeFile(
      loc.owner,
      JSON.stringify({ schema: 1, id: loc.id, exe: loc.exe, manager: 'NeuralFrame' }),
      { flag: 'wx' },
    );
  };
  if (!journal.deferExternal(gameDir, loc.owner, save)) await save();
  return { id: loc.id, owned: true };
}
async function detach(gameDir, manifest) {
  const record = manifest.graphicsRoute?.deltaCache;
  if (manifest.route !== 'sm86-delta' || !record?.owned) return;
  const exe = journal.safePath(gameDir, manifest.game.exe);
  const loc = location(exe);
  // Copied games have a different path-derived id. Their original remains owned by the original installation.
  if (record.id !== loc.id || !fs.existsSync(loc.folder) || readOwner(loc)?.manager !== 'NeuralFrame') return;
  for (const [revision, files] of Object.entries(revisions)) {
    const dir = journal.safePath(loc.folder, revision);
    if (!fs.existsSync(dir)) continue;
    for (const [name, sha] of Object.entries(files)) {
      const file = journal.safePath(dir, name);
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      if (
        stat.isFile() &&
        stat.size < 8 * 1024 * 1024 &&
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sha
      )
        await fs.promises.unlink(file);
    }
    if (!fs.readdirSync(dir).length) await fs.promises.rmdir(dir);
  }
  if (fs.readdirSync(loc.folder).every((file) => file === 'owner.json')) {
    await fs.promises.unlink(loc.owner);
    await fs.promises.rmdir(loc.folder);
  }
}
module.exports = { register, detach };
