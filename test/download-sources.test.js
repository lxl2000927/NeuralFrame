'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {mirrorUrl, sourceUrls, downloadWithSources} = require('../src/core/download-sources');

test('custom mirrors are HTTPS-only prefixes and retain the official fallback', () => {
  const original = 'https://github.com/owner/repo/releases/download/v1/a.dll';
  assert.equal(mirrorUrl(original, 'https://mirror.example/gh'), 'https://mirror.example/gh/https://github.com/owner/repo/releases/download/v1/a.dll');
  assert.deepEqual(sourceUrls(original, ''), [original]);
  assert.deepEqual(sourceUrls(original, 'https://mirror.example/')[1], original);
  assert.deepEqual(sourceUrls(original, 'https://mirror.example/', 'official'), [original, 'https://mirror.example/https://github.com/owner/repo/releases/download/v1/a.dll']);
  assert.throws(() => mirrorUrl(original, 'http://mirror.example/'), /HTTPS/);
  assert.throws(() => mirrorUrl(original, 'https://user:pass@mirror.example/'), /HTTPS/);
});

test('a failed mirror falls back to the official bytes and reports the active source', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-sources-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const bytes = Buffer.from('verified'), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const original = 'https://github.com/owner/repo/releases/download/v1/a.dll';
  const urls = [], sources = [];
  await downloadWithSources({url:original, size:bytes.length, sha256}, {
    cacheRoot:root, destination:path.join(root, 'a.dll'), mirror:'https://mirror.example/',
    fetcher:async url => {
      urls.push(url);
      if (url.includes('mirror.example')) throw new TypeError('fetch failed');
      return new Response(bytes);
    },
    onProgress:(_loaded, source) => sources.push(source),
  });
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('mirror.example'));
  assert.equal(urls[1], original);
  assert.deepEqual([...new Set(sources)], ['mirror.example', 'github.com']);
  assert.deepEqual(fs.readFileSync(path.join(root, 'a.dll')), bytes);
});

test('invalid mirror content is removed before the official fallback', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-sources-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const bytes = Buffer.from('verified'), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const original = 'https://github.com/owner/repo/releases/download/v1/a.dll';
  await downloadWithSources({url:original, size:bytes.length, sha256}, {
    cacheRoot:root, destination:path.join(root, 'a.dll'), mirror:'https://mirror.example/',
    fetcher:async url => new Response(url.includes('mirror.example') ? Buffer.alloc(bytes.length) : bytes),
  });
  assert.deepEqual(fs.readFileSync(path.join(root, 'a.dll')), bytes);
});

test('a truncated mirror response leaves the official source a fresh staging file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-short-mirror-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const bytes = Buffer.from('verified'), destination = path.join(root, 'asset.dll');
  const url = 'https://github.com/owner/repo/releases/download/v1/asset.dll';
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const hosts = [];
  await downloadWithSources({url, size:bytes.length, sha256}, {
    cacheRoot:root, destination, mirror:'https://mirror.example/',
    fetcher:async address => {
      hosts.push(new URL(address).hostname);
      if (address === url) assert.equal(fs.existsSync(destination), false);
      return new Response(address === url ? bytes : bytes.subarray(0, 4));
    },
  });
  assert.deepEqual(hosts, ['mirror.example', 'github.com']);
  assert.deepEqual(fs.readFileSync(destination), bytes);
});
