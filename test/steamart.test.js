'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const art = require('../src/steamart');
const cache = require('../src/art-cache');

test('Chinese titles and empty names cannot select an unrelated first search result', () => {
  const rows = [{ id: 1, name: 'Another Game' }, { id: 2, name: '鸣潮', type: 'app' }];
  assert.equal(art.pick(rows, '鸣潮').id, 2);
  assert.equal(art.pick(rows, '未知游戏'), null);
  assert.equal(art.pick(rows, '???'), null);
  assert.equal(art.pick([{ name: '' }], 'A'), null);
});

test('Wuthering Waves uses its known Steam ID and the actual hashed store header', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /appdetails\?appids=3513350/);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ 3513350: { success: true, data: { name: 'Wuthering Waves', header_image: 'https://cdn.example/hashed/header.jpg' } } });
  });
  const result = await art.look('鸣潮');
  assert.equal(result.appid, 3513350);
  assert.equal(result.heroFallbackUrl, 'https://cdn.example/hashed/header.jpg');
});

test('Star Rail aliases use the official listing artwork without a wrong Steam match', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('should not search Steam'); });
  for (const title of ['崩坏：星穹铁道', 'Honkai: Star Rail', 'hkrpg_bilibili']) {
    const result = await art.look(title);
    assert.equal(result.appid, null);
    assert.match(result.heroUrl, /^https:\/\/cdn1\.epicgames\.com\//);
    assert.equal(result.source, 'https://store.epicgames.com/p/honkai-star-rail');
  }
});

test('cache retries empty and deleted artwork while preserving existing images on upgrade', () => {
  const onDisk = value => value === 'good';
  const now = 100000000;
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: null, cover: null }, onDisk, now), true);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now - 600001 }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: 'deleted' }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: 'good' }, onDisk, now), true);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now - 86400001, hero: 'good' }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: 4, cover: 'good' }, onDisk, now), false);
  assert.deepEqual(cache.usable({ rules: 4, cover: 'good', hero: 'deleted' }, onDisk), { cover: 'good', hero: null });
});

test('HTML returned with status 200 never replaces cached artwork', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enhanced-art-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cover.jpg');
  fs.writeFileSync(file, 'existing-art');
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>' + 'error'.repeat(1000)));
  await assert.rejects(art.download('https://cdn.example/art', file), /not supported artwork/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'existing-art');
});

test('oversized downloads are rejected before writing', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('small', { headers: { 'content-length': 32 * 1024 * 1024 } }));
  await assert.rejects(art.download('https://cdn.example/art', 'unused'), /too large/);
});
