'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadAsset, sweepPartials } = require('../src/core/asset-download');

const MiB = 1024 * 1024;
const payload = crypto.randomBytes(12 * MiB + 377);
const asset = { url: 'https://example.invalid/model.zip', size: payload.length,
  sha256: crypto.createHash('sha256').update(payload).digest('hex') };

async function fixture(t) {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-download-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  let attempt = 0;
  return async (fetcher, options = {}) => {
    const destination = path.join(cacheRoot, 'stage-' + ++attempt);
    await downloadAsset(asset, { cacheRoot, destination, fetcher,
      signal: new AbortController().signal, onProgress: () => {}, ...options });
    assert.deepEqual(await fs.readFile(destination), payload);
  };
}

function rangeResponse(start, end, bytes = payload.subarray(start, end + 1)) {
  return new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${payload.length}` } });
}

function offsets(headers) {
  return /^bytes=(\d+)-(\d+)$/.exec(headers.Range).slice(1).map(Number);
}

test('a large download reuses the original 200 response when the server ignores Range', async t => {
  const download = await fixture(t);
  let calls = 0;
  await download(async () => { calls++; return new Response(payload); });
  assert.equal(calls, 1);
});

test('parallel ranges resume at saved byte offsets after an interrupted transfer', async t => {
  const download = await fixture(t);
  let active = 0, peak = 0;
  await assert.rejects(download(async (_url, { headers }) => {
    const [start, end] = offsets(headers);
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 10));
    active--;
    if (start === MiB + 127) return new Response(null, { status: 503 });
    return start === MiB ? rangeResponse(start, end, payload.subarray(start, start + 127)) : rangeResponse(start, end);
  }), /HTTP 503/);
  assert.equal(peak, 4);
  const starts = [];
  await download(async (_url, { headers }) => {
    const [start, end] = offsets(headers);
    starts.push(start);
    return rangeResponse(start, end);
  });
  assert.ok(starts.includes(MiB + 127));
  assert.ok(!starts.includes(0));
});

test('a transient connection failure retries only the affected range', async t => {
  const download = await fixture(t);
  const starts = [];
  await download(async (_url, { headers }) => {
    const [start, end] = offsets(headers);
    starts.push(start);
    return start === MiB ? rangeResponse(start, end, payload.subarray(start, start + 127)) : rangeResponse(start, end);
  });
  assert.deepEqual(starts.filter(n => n === 0 || n === MiB || n === MiB + 127), [0, MiB, MiB + 127]);
});

test('cancelling removes the staged archive and every partial range', async t => {
  const download = await fixture(t);
  const controller = new AbortController();
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-cancel-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const destination = path.join(cacheRoot, 'stage');
  await assert.rejects(downloadAsset(asset, {
    cacheRoot, destination,
    fetcher: async (_url, { headers }) => {
      const [start, end] = offsets(headers);
      return rangeResponse(start, end);
    },
    signal: controller.signal,
    onProgress: bytes => { if (bytes >= MiB) controller.abort(); },
  }), { name: 'AbortError' });
  await assert.rejects(fs.stat(destination), 'the staging archive must not survive a cancel');
  await assert.rejects(fs.stat(path.join(cacheRoot, 'partial-downloads', asset.sha256)),
    'completed ranges must not survive a cancel');
});

test('a partial left by a killed process still resumes at the saved offset', async t => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-resume-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const parts = path.join(cacheRoot, 'partial-downloads', asset.sha256);
  await fs.mkdir(parts, { recursive: true });
  await fs.writeFile(path.join(parts, `0-${MiB - 1}.part`), payload.subarray(0, MiB));
  const starts = [];
  const destination = path.join(cacheRoot, 'stage');
  await downloadAsset(asset, {
    cacheRoot, destination,
    fetcher: async (_url, { headers }) => {
      const [start, end] = offsets(headers);
      starts.push(start);
      return rangeResponse(start, end);
    },
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.ok(!starts.includes(0), 'a complete range is never requested again');
  assert.ok(starts.includes(MiB), 'the next range continues where the file stopped');
  assert.deepEqual(await fs.readFile(destination), payload);
  await assert.rejects(fs.stat(parts), 'a finished download leaves no partial ranges');
});

test('sweeping drops abandoned partials and keeps the fresh ones', async t => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-sweep-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const stale = 'a'.repeat(64), fresh = 'b'.repeat(64);
  const root = path.join(cacheRoot, 'partial-downloads');
  await fs.mkdir(path.join(root, stale), { recursive: true });
  await fs.mkdir(path.join(root, fresh), { recursive: true });
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(path.join(root, stale), old, old);
  const removed = await sweepPartials(cacheRoot, { olderThanMs: 24 * 60 * 60 * 1000 });
  assert.deepEqual(removed, [stale]);
  await assert.rejects(fs.stat(path.join(root, stale)));
  assert.ok((await fs.stat(path.join(root, fresh))).isDirectory());
});

test('unrecognised entries are never removed by a sweep', async t => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-sweep-keep-'));
  t.after(() => fs.rm(cacheRoot, { recursive: true, force: true }));
  const root = path.join(cacheRoot, 'partial-downloads');
  await fs.mkdir(path.join(root, 'notes'), { recursive: true });
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.join(root, 'notes'), old, old);
  assert.deepEqual(await sweepPartials(cacheRoot), []);
  assert.ok((await fs.stat(path.join(root, 'notes'))).isDirectory());
});

test('invalid server offsets are rejected and corrupt cached bytes are discarded after checksum failure', async t => {
  const download = await fixture(t);
  await assert.rejects(download(async () => rangeResponse(1, MiB)), /分段/);
  await assert.rejects(download(async (_url, { headers }) => {
    const [start, end] = offsets(headers);
    return rangeResponse(start, end, Buffer.alloc(end - start + 1));
  }), /SHA-256/);
  const starts = [];
  await download(async (_url, { headers }) => {
    const [start, end] = offsets(headers);
    starts.push(start);
    return rangeResponse(start, end);
  });
  assert.equal(starts.length, 7);
  assert.equal(starts[0], 0);
});
