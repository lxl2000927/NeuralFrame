'use strict';
// Copy-on-write filesystem for installation previews. Production calls use
// Node's fs unchanged. In a preview, every write stays in memory, including
// backup/journal writes. Large copied DLLs are immutable source references.
const native = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
const key = p => path.resolve(String(p)).toLowerCase();
const missing = p => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT', path: p });
const failure = message => { active()?.blocked.add(message); return Object.assign(new Error(message), { code: 'errPreviewUnsupported' }); };
function active() { return context.getStore(); }
function external(message, dependency) {
  if (active()) { active().blocked.add(message); if (dependency) active().dependencies.add(dependency); throw failure(message); }
}
function entry(p) {
  const s = active(), k = key(p);
  if (s.entries.has(k)) { const e = s.entries.get(k); if (!e) throw missing(p); return e; }
  let parent = path.dirname(k);
  while (parent !== path.dirname(parent)) {
    if (s.entries.has(parent) && !s.entries.get(parent)) throw missing(p);
    parent = path.dirname(parent);
  }
  const stat = native.lstatSync(p);
  return { file: String(p), source: String(p), stat, directory: stat.isDirectory() };
}
function bytes(e) { return e.buffer || native.readFileSync(e.source); }
function put(p, e) {
  const s = active();
  // Junctions must never make a seemingly game-local plan target other data.
  let parent = path.resolve(String(p));
  while (parent !== path.dirname(parent)) {
    if (native.existsSync(parent) && native.lstatSync(parent).isSymbolicLink()) throw failure(`预览目标含符号链接或目录联接：${parent}`);
    parent = path.dirname(parent);
  }
  s.entries.set(key(p), e && { ...e, file: String(p) });
  s.touched.set(key(p), String(p));
}
function stats(e) {
  if (e.stat) return e.stat;
  return { size: e.directory ? 0 : e.buffer?.length ?? native.statSync(e.source).size,
    mtimeMs: 0, ctimeMs: 0, mode: e.directory ? 0o40755 : 0o100644,
    isDirectory: () => !!e.directory, isFile: () => !e.directory, isSymbolicLink: () => false };
}
const virtual = {
  existsSync(p) { try { entry(p); return true; } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; } },
  statSync: p => stats(entry(p)), lstatSync: p => stats(entry(p)),
  readFileSync(p, options) { const b = bytes(entry(p)); const enc = typeof options === 'string' ? options : options?.encoding; return enc ? b.toString(enc) : Buffer.from(b); },
  writeFileSync(p, data, options) { if (options?.flag === 'wx' && virtual.existsSync(p)) throw Object.assign(new Error(`EEXIST: ${p}`),{code:'EEXIST'}); put(p, { buffer: Buffer.from(data, typeof options === 'string' ? options : options?.encoding) }); },
  copyFileSync(src, dest) { const e = entry(src); if (e.directory) throw failure('无法复制目录'); put(dest, { source: e.source, buffer: e.buffer, origin: e.origin || String(src) }); },
  unlinkSync(p) { entry(p); put(p, null); },
  mkdirSync(p, options) {
    if (virtual.existsSync(p)) { if (!entry(p).directory) throw failure(`目标不是目录：${p}`); return; }
    const parent = path.dirname(path.resolve(p));
    if (options?.recursive && parent !== path.resolve(p)) virtual.mkdirSync(parent, options);
    else if (!virtual.existsSync(parent)) throw missing(parent);
    put(p, { directory: true });
  },
  readdirSync(p, options) {
    if (!entry(p).directory) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
    let names = new Map();
    try { for (const n of native.readdirSync(p)) names.set(n.toLowerCase(), n); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const [k, e] of active().entries) if (key(path.dirname(k)) === key(p)) {
      if (e) names.set(path.basename(k), path.basename(e.file)); else names.delete(path.basename(k));
    }
    return [...names.values()].map(name => {
      if (!options?.withFileTypes) return name;
      const st = stats(entry(path.join(p, name)));
      return { name, parentPath: String(p), path: String(p), isDirectory: st.isDirectory.bind(st), isFile: st.isFile.bind(st), isSymbolicLink: st.isSymbolicLink.bind(st) };
    });
  },
  renameSync(from, to) { const e = entry(from); if (e.directory) throw failure('暂不支持目录重命名的安装预览'); put(to, e); put(from, null); },
  realpathSync(p) { const e = entry(p); return e.source ? native.realpathSync(e.source) : path.resolve(p); },
  chmodSync(p) { entry(p); },
  rmdirSync(p) { if (virtual.readdirSync(p).length) throw Object.assign(new Error('Directory not empty'), { code: 'ENOTEMPTY' }); put(p, null); },
  rmSync(p, options) { if (!virtual.existsSync(p) && options?.force) return; const e = entry(p); if (e.directory) { if (!options?.recursive) return virtual.rmdirSync(p); for (const n of virtual.readdirSync(p)) virtual.rmSync(path.join(p, n), options); } put(p, null); },
  openSync(p, flags) {
    if (flags !== 'r') throw failure('预览禁止以写入模式打开文件');
    const e = entry(p);
    if (e.source && !e.buffer) return native.openSync(e.source, 'r');
    const fd = active().nextFd--; active().fds.set(fd, e); return fd;
  },
  readSync(fd, buffer, offset, length, position) {
    if (fd >= 0) return native.readSync(fd, buffer, offset, length, position);
    const data = bytes(active().fds.get(fd)); return data.copy(buffer, offset, position, position + length);
  },
  fstatSync(fd) { return fd >= 0 ? native.fstatSync(fd) : stats(active().fds.get(fd)); },
  closeSync(fd) { if (fd >= 0) native.closeSync(fd); else active().fds.delete(fd); }
};
const promises = new Proxy({}, { get(_, name) {
  if (!active()) return native.promises[name]?.bind(native.promises);
  const fn = virtual[`${name}Sync`];
  if (!fn) return async () => { throw failure(`预览不支持文件操作：${String(name)}`); };
  return async (...args) => fn(...args);
}});
const fs = new Proxy({}, { get(_, name) {
  if (name === 'promises') return promises;
  if (!active()) return typeof native[name] === 'function' ? native[name].bind(native) : native[name];
  if (virtual[name]) return virtual[name];
  if (name === 'constants') return native.constants;
  return () => { throw failure(`预览不支持文件操作：${String(name)}`); };
}});
async function simulate(work) {
  const state = { entries: new Map(), touched: new Map(), fds: new Map(), nextFd: -1, blocked: new Set(), dependencies: new Set(), externalSteps: [] };
  let result, cause;
  try { result = await context.run(state, work); } catch (error) { cause = error; }
  if (state.blocked.size) throw Object.assign(failure([...state.blocked].join('\n')), { dependencies: [...state.dependencies] });
  if (cause) throw cause;
  return { state, result };
}
module.exports = { fs, active, external, simulate, bytes, stats };
