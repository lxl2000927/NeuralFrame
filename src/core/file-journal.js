'use strict';

// A write-ahead, file-level journal. Never snapshot or recursively delete a
// whole game. A failed/interrupted backend switch can restore the exact files
// that were present immediately before it, including user-tuned settings.
const fs = require('./preview-fs').fs;
const path = require('path');
const crypto = require('crypto');
const replaceFile = require('./replace-file');
const { AsyncLocalStorage } = require('node:async_hooks');
const ownership = new AsyncLocalStorage();
const active = new Map();
const rootKey = dir => path.resolve(dir).toLowerCase();
const pendingPath = dir => path.join(dir, '_DLSS5_Backup', 'pending-switch.json');
function error(code) { return Object.assign(new Error(code), { code }); }

function safePath(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes(':')) throw error('errUnsafeTarget');
  const dest = path.resolve(root, rel);
  const relative = path.relative(path.resolve(root), dest);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw error('errUnsafeTarget');
  // Refuse junctions/symlinks, including the selected root. A lexical prefix
  // alone does not guarantee that a write stays in the selected game folder.
  let item = dest;
  while (true) {
    try {
      if (fs.lstatSync(item).isSymbolicLink()) throw error('errUnsafeTarget');
    } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    if (rootKey(item) === rootKey(root)) break;
    item = path.dirname(item);
  }
  return dest;
}
async function atomicJson(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  if (require('./preview-fs').active()) {
    // The copy-on-write preview needs only the final bytes.
    await fs.promises.writeFile(file, json, 'utf8');
    return;
  }
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const handle = await fs.promises.open(temp, 'wx');
  try {
    try {
      await handle.writeFile(json, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.promises.rename(temp, file);
  } catch (cause) {
    await fs.promises.unlink(temp).catch(() => {});
    throw cause;
  }
}
async function captureFile(gameDir, target, state) {
  const rel = path.relative(gameDir, target);
  safePath(gameDir, rel);
  if (state.files.some(f => f.rel.toLowerCase() === rel.toLowerCase())) return;
  let parent = path.dirname(target);
  while (rootKey(parent) !== rootKey(gameDir)) {
    const dir = path.relative(gameDir, parent);
    if (!fs.existsSync(parent) && !state.dirs.includes(dir) && !state.removedDirs?.includes(dir)) state.dirs.push(dir);
    parent = path.dirname(parent);
  }
  const existed = fs.existsSync(target);
  if (existed && !fs.statSync(target).isFile()) throw error('errUnsafeTarget');
  const snapshot = `${state.folder}/${state.files.length}.bin`;
  if (existed) {
    const copy = safePath(gameDir, snapshot);
    await fs.promises.mkdir(path.dirname(copy), { recursive: true });
    await fs.promises.copyFile(target, copy, fs.constants.COPYFILE_EXCL);
  }
  state.files.push({ rel, existed, snapshot });
  await atomicJson(pendingPath(gameDir), state);
}
function owns(gameDir) {
  const owner = ownership.getStore();
  return !!owner && active.get(rootKey(gameDir)) === owner;
}
function hasPendingRecovery(gameDir) {
  return !owns(gameDir) && fs.existsSync(pendingPath(gameDir));
}
function deferExternal(gameDir, key, work) {
  if (!owns(gameDir) || !ownership.getStore().started) return false;
  ownership.getStore().external.set(key, work);
  return true;
}
async function startJournal(gameDir, owner) {
  safePath(gameDir, '_DLSS5_Backup/pending-switch.json');
  await atomicJson(pendingPath(gameDir), owner.state);
  await captureFile(gameDir, path.join(gameDir, '_DLSS5_Backup', 'manifest.json'), owner.state);
}
async function queueCapture(gameDir, save) {
  const owner = active.get(rootKey(gameDir));
  if (!owner) return;
  if (!owns(gameDir)) throw error('errJobBusy');
  owner.started ||= startJournal(gameDir, owner);
  // Concurrent writes in this operation must allocate distinct snapshot slots.
  owner.captures = (owner.captures || owner.started).then(() => save(owner.state));
  await owner.captures;
}
function capture(gameDir, target) {
  return queueCapture(gameDir, state => captureFile(gameDir, target, state));
}
async function removeEmptyDirectory(gameDir, target) {
  const rel = path.relative(gameDir, target);
  safePath(gameDir, rel);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory() || fs.readdirSync(target).length) return false;
  await queueCapture(gameDir, async state => {
    if (state.dirs.includes(rel) || state.removedDirs?.includes(rel)) return;
    (state.removedDirs ||= []).push(rel);
    await atomicJson(pendingPath(gameDir), state);
  });
  try {
    await fs.promises.rmdir(target);
    return true;
  } catch (cause) {
    if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(cause.code)) return false;
    throw cause;
  }
}
async function cleanup(gameDir, state) {
  // Only our numbered snapshots and now-empty transaction folder.
  for (const item of state.files) {
    const file = safePath(gameDir, item.snapshot);
    if (fs.existsSync(file)) await fs.promises.unlink(file);
  }
  try { await fs.promises.rmdir(safePath(gameDir, state.folder)); } catch {}
}
async function recover(gameDir) {
  const key = rootKey(gameDir);
  if (active.has(key)) throw error('errJobBusy');
  active.set(key, {});
  try { return await recoverPending(gameDir); }
  finally { active.delete(key); }
}
async function recoverPending(gameDir) {
  const pending = pendingPath(gameDir);
  if (!fs.existsSync(pending)) return false;
  safePath(gameDir, path.relative(gameDir, pending));
  const state = JSON.parse(await fs.promises.readFile(pending, 'utf8'));
  if (!state || state.version !== 1 || !Array.isArray(state.files) || !Array.isArray(state.dirs) ||
      !/^_DLSS5_Backup\/\.transactions\/[a-f0-9-]+$/.test(state.folder)) throw error('errBackupInvalid');
  // Validate everything before changing anything. Missing rollback bytes are
  // not permission to silently discard the journal and report success.
  for (const [index, item] of state.files.entries()) {
    // Version 1 always writes each snapshot directly into this transaction folder.
    if (!item || typeof item.existed !== 'boolean' || item.snapshot !== state.folder + '/' + index + '.bin') throw error('errBackupInvalid');
    safePath(gameDir, item.rel);
    const copy = safePath(gameDir, item.snapshot);
    if (item.existed && (!fs.existsSync(copy) || !fs.statSync(copy).isFile())) throw error('errBackendRecovery');
  }
  const removedDirs = state.removedDirs ?? [];
  if (!Array.isArray(removedDirs)) throw error('errBackupInvalid');
  for (const dir of [...state.dirs, ...removedDirs]) safePath(gameDir, dir);
  // Once shared registration has started, the installed manifest owns its
  // cleanup. Preserve that manifest for Restore, including after a restart.
  if (state.phase === 'external-commit') {
    await fs.promises.unlink(pending);
    await cleanup(gameDir, state).catch(() => {});
    return true;
  }
  for (const item of [...state.files].reverse()) {
    const target = safePath(gameDir, item.rel);
    if (item.existed) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const snapshot = safePath(gameDir, item.snapshot);
      // Windows refuses to overwrite a read-only destination. Clear only the
      // owned target; copying the snapshot restores its original attribute.
      await replaceFile.copyFile(snapshot, target, { clearReadOnly: true });
      const plan = require('./preview-fs').active();
      if (plan) (plan.recoveredSources ||= new Map()).set(rootKey(target), rootKey(snapshot));
    } else if (fs.existsSync(target)) await fs.promises.unlink(target);
  }
  for (const dir of removedDirs) await fs.promises.mkdir(safePath(gameDir, dir), { recursive: true });
  for (const dir of [...state.dirs].sort((a, b) => b.length - a.length)) {
    try { await fs.promises.rmdir(safePath(gameDir, dir)); } catch {}
  }
  await fs.promises.unlink(pending);
  await cleanup(gameDir, state).catch(() => {});
  return true;
}
// A composite operation can perform read-only preflight before its first
// transactional stage. Stages belonging to this owner share one rollback point.
async function group(gameDir, work) {
  const key = rootKey(gameDir);
  if (owns(gameDir)) {
    const owner = ownership.getStore();
    try {
      const result = await work();
      if (owner.started && result?.ok === false) owner.failure ||= result;
      return result;
    } catch (cause) {
      // There is one rollback point. A caller catching a failed nested stage
      // cannot turn its partial writes into a successful outer commit.
      if (owner.started) owner.failure ||= { cause };
      throw cause;
    }
  }
  if (active.has(key)) throw error('errJobBusy');
  if (fs.existsSync(pendingPath(gameDir))) throw error('errBackendRecovery');
  const state = { version: 1, folder: `_DLSS5_Backup/.transactions/${crypto.randomUUID()}`, files: [], dirs: [] };
  const owner = { state, external: new Map() };
  active.set(key, owner);
  try {
    let result = await ownership.run(owner, work);
    if (owner.failure && result?.ok !== false) {
      if (owner.failure.ok === false) result = owner.failure;
      else throw owner.failure.cause;
    }
    if (owner.started) {
      await owner.captures;
      if (result?.ok === false) await recoverPending(gameDir);
      else {
        if (owner.external.size) {
          state.phase = 'external-commit';
          await atomicJson(pendingPath(gameDir), state);
          owner.externalStarted = true;
          for (const commit of owner.external.values()) await commit();
        }
        await fs.promises.unlink(pendingPath(gameDir));
        await cleanup(gameDir, state).catch(() => {});
      }
    }
    return result;
  } catch (cause) {
    if (owner.externalStarted) throw Object.assign(error('errBackendRecovery'), { cause });
    try { if (owner.started) await recoverPending(gameDir); }
    catch (recoveryError) { throw Object.assign(error('errBackendRecovery'), { cause, recoveryError }); }
    throw cause;
  } finally {
    active.delete(key);
  }
}
async function transaction(gameDir, work) {
  return group(gameDir, async () => {
    const owner = ownership.getStore();
    owner.started ||= startJournal(gameDir, owner);
    await owner.started;
    return work();
  });
}
module.exports = { safePath, capture, removeEmptyDirectory, group, transaction, recover, hasPendingRecovery, deferExternal, pendingPath, atomicJson };
