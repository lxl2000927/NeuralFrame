'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { digest, safe } = require('./component-library');

const MiB = 1024 * 1024;
const idleMs = 60_000;
class RangeUnsupported extends Error {}
class Interrupted extends Error {}

// One small first request discovers range support. An ordinary 200 response
// can be consumed immediately without opening more connections.
function ranges(size) {
  const parts = [{ start: 0, end: MiB - 1 }];
  const width = 2 * MiB;
  for (let start = MiB; start < size; start += width) {
    parts.push({ start, end: Math.min(start + width, size) - 1 });
  }
  return parts;
}

async function transfer({ fetcher, url, originalUrl, signal, size, destination, part, allowFull, progress, rememberEndpoint }) {
  const idle = new AbortController();
  const requestSignal = AbortSignal.any([signal, idle.signal]);
  const timer = setTimeout(() => idle.abort(new Interrupted('下载连接长时间未传输数据，请重试。')), idleMs);
  const start = part && part.start + part.saved;
  let handle;
  try {
    requestSignal.throwIfAborted();
    const headers = part ? { Range: `bytes=${start}-${part.end}` } : {};
    const response = await fetcher(url, { signal: requestSignal, headers });
    const partial = part && response.status === 206;
    if (part && (response.status === 416 || (response.status === 200 && !allowFull))) {
      throw new RangeUnsupported();
    }
    if (url !== originalUrl && response.status === 403) throw new Interrupted('下载链接已过期。');
    if (response.status >= 500 || response.status === 408) throw new Interrupted('下载服务返回 HTTP ' + response.status);
    if (!partial && response.status !== 200) throw Error('下载服务返回 HTTP ' + response.status);
    if (partial && response.headers.get('content-range')?.toLowerCase() !== `bytes ${start}-${part.end}/${size}`) {
      throw Error('服务器返回的下载分段与请求不符。');
    }
    if (partial && response.url) rememberEndpoint(response.url);
    const expected = partial ? part.end - start + 1 : size;
    if (!partial) progress(0, true);
    handle = await fs.promises.open(partial ? part.file : destination, partial ? 'a' : 'wx');
    let received = 0;
    for await (const chunk of response.body) {
      requestSignal.throwIfAborted();
      timer.refresh();
      received += chunk.length;
      if (received > expected) throw Error('下载文件大小超出清单。');
      await handle.writeFile(chunk);
      if (partial) part.saved += chunk.length;
      progress(chunk.length);
    }
    if (received !== expected) throw new Interrupted('组件下载不完整，请重试。');
    return !partial;
  } catch (err) {
    if (idle.signal.aborted && !signal.aborted) throw idle.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    idle.abort();
    if (handle) await handle.close();
  }
}

async function transferPart(options) {
  for (let attempt = 0; ; attempt++) {
    try { return await transfer(attempt ? { ...options, url: options.originalUrl } : options); }
    catch (err) {
      options.signal.throwIfAborted();
      // Fetch reports connection failures as TypeError. Disk errors, bad
      // ranges and checksums must not enter the network retry loop.
      const networkError = err instanceof TypeError || /^net::ERR_(CONNECTION|NETWORK|TIMED_OUT)/.test(err.message);
      if (attempt >= 2 || !(err instanceof Interrupted || networkError)) throw err;
      if (options.part.saved === options.part.end - options.part.start + 1) return false;
      // A server that ignored Range may have already started a full response.
      if (options.allowFull) await fs.promises.rm(options.destination, { force: true });
      await delay(500 * (attempt + 1), undefined, { signal: options.signal });
    }
  }
}

// Callers serialize cache mutations and supply a fresh staging destination.
// Only the SHA-256 addressed partials persist across an interrupted process:
// an explicit cancellation removes them, because the person asked to stop.
async function downloadAssetCore({ url, size, sha256 }, { cacheRoot, destination, fetcher, signal, onProgress }) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 512 * MiB || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw Error('组件下载大小或 SHA-256 无效。');
  }
  signal.throwIfAborted();
  let loaded = 0, last = 0;
  function progress(bytes, reset = false) {
    loaded = reset ? bytes : loaded + bytes;
    if (reset || loaded === size || Date.now() - last >= 200) {
      onProgress(loaded);
      last = Date.now();
    }
  }
  let endpoint = url;
  const rememberEndpoint = value => {
    // Reuse a fresh GitHub release redirect within this download only.
    if (new URL(value).origin === 'https://release-assets.githubusercontent.com') endpoint = value;
  };
  const options = { url, originalUrl: url, size, fetcher, signal, destination, progress, rememberEndpoint };
  let partsDir;
  if (size < 8 * MiB) {
    progress(0, true);
    await transfer(options);
  } else {
    partsDir = safe(cacheRoot, 'partial-downloads/' + sha256);
    await fs.promises.mkdir(partsDir, { recursive: true });
    const parts = ranges(size);
    for (const part of parts) {
      part.file = safe(partsDir, `${part.start}-${part.end}.part`);
      const stat = await fs.promises.stat(part.file).catch(err => {
        if (err.code !== 'ENOENT') throw err;
      });
      part.saved = stat?.size || 0;
      if (part.saved > part.end - part.start + 1) {
        await fs.promises.unlink(part.file);
        part.saved = 0;
      }
      loaded += part.saved;
    }
    progress(loaded, true);
    const missing = parts.filter(part => part.saved < part.end - part.start + 1);
    let full = false;
    try {
      if (missing[0] === parts[0]) {
        full = await transferPart({ ...options, part: missing.shift(), allowFull: true });
      }
      if (!full && missing.length) {
        const group = new AbortController();
        const workerSignal = AbortSignal.any([signal, group.signal]);
        const worker = async () => {
          while (missing.length) {
            workerSignal.throwIfAborted();
            await transferPart({ ...options, url: endpoint, part: missing.shift(), signal: workerSignal });
          }
        };
        const tasks = Array.from({ length: Math.min(4, missing.length) }, worker);
        try {
          await Promise.all(tasks);
        } catch (err) {
          group.abort();
          await Promise.allSettled(tasks);
          throw err;
        }
      }
    } catch (err) {
      if (!(err instanceof RangeUnsupported)) throw err;
      await transfer(options);
      full = true;
    }
    if (!full) {
      const archive = await fs.promises.open(destination, 'wx');
      try {
        for (const part of parts) {
          for await (const chunk of fs.createReadStream(part.file)) {
            signal.throwIfAborted();
            await archive.writeFile(chunk);
          }
        }
      } finally { await archive.close(); }
    }
  }
  signal.throwIfAborted();
  const valid = await digest(destination) === sha256;
  signal.throwIfAborted();
  if (partsDir) await fs.promises.rm(partsDir, { recursive: true, force: true });
  if (!valid) {
    // A rejected archive is never retried from disk; the staging file would
    // only collide with the next 'wx' open.
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw Error('组件下载 SHA-256 不匹配，请重试。');
  }
  signal.throwIfAborted();
}

function partialsRoot(cacheRoot) {
  return safe(cacheRoot, 'partial-downloads');
}

async function removePartials(cacheRoot, sha256) {
  if (!/^[a-f0-9]{64}$/.test(String(sha256 || ''))) return;
  await fs.promises.rm(safe(partialsRoot(cacheRoot), sha256), { recursive: true, force: true }).catch(() => {});
}

// Cancellation must leave the cache as it was before the transfer. Completed
// ranges only stay behind when the process died without asking to stop.
async function downloadAsset(spec, options) {
  const { cacheRoot, destination } = options;
  try {
    return await downloadAssetCore(spec, options);
  } catch (error) {
    if (options.signal?.aborted && options.purgeOnAbort !== false) {
      await removePartials(cacheRoot, spec.sha256);
      await fs.promises.rm(destination, { force: true }).catch(() => {});
    }
    throw error;
  }
}

// Leftovers from an older build, a killed process or a pack that is no longer
// in the catalogue must not accumulate. Only our own directory shapes are
// removed; anything unrecognised is left alone.
async function sweepPartials(cacheRoot, { olderThanMs = 24 * 60 * 60 * 1000, keep = [] } = {}) {
  const root = partialsRoot(cacheRoot);
  const retained = new Set(keep.filter(sha => /^[a-f0-9]{64}$/.test(sha)));
  const removed = [];
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return removed; }
  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    if (retained.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    let stamp;
    try { stamp = (await fs.promises.stat(dir)).mtimeMs; } catch { continue; }
    if (stamp > cutoff) continue;
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch { /* A busy file is retried on the next sweep. */ }
  }
  try {
    if (!(await fs.promises.readdir(root)).length) await fs.promises.rmdir(root);
  } catch { /* The directory is shared with other downloads. */ }
  return removed;
}

module.exports = { downloadAsset, downloadAssetCore, removePartials, sweepPartials };
