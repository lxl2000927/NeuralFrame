'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ComponentReview } = require('../src/core/component-review');
const backend = require('../src/core/backend-manager');
const journal = require('../src/core/file-journal');
const preview = require('../src/core/preview-fs');
const { writePe } = require('./fixtures/pe');

function interrupted(t, { firstInstall = false, shared = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'game'), profile = path.join(root, 'profile');
  const folder = '_DLSS5_Backup/.transactions/1234-abcd';
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  writePe(path.join(dir, 'Game.exe'), { text: 'D3D12CreateDevice' });
  const manifest = { version: 1, route: 'native', game: { dir, exe: 'Game.exe', api: 'dxgi' }, replaced: [], added: ['injected.cfg'] };
  const layer = path.join(profile, 'reshade-vulkan');
  if (shared) {
    manifest.vulkanLayer = { owned: true, dir: layer };
    fs.mkdirSync(layer, { recursive: true });
    writePe(path.join(layer, 'ReShade64.dll'), {bitness: 64});
    fs.writeFileSync(path.join(layer, 'installs.json'), JSON.stringify({version:1, games:[dir]}));
  }
  const manifestRel = '_DLSS5_Backup/manifest.json', scratchRel = 'interrupted-setting.cfg';
  const files = [
    { rel: manifestRel, existed: !firstInstall, snapshot: folder + '/0.bin' },
    { rel: scratchRel, existed: true, snapshot: folder + '/1.bin' }
  ];
  if (!firstInstall) fs.writeFileSync(path.join(dir, files[0].snapshot), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, files[1].snapshot), 'previous setting');
  fs.writeFileSync(path.join(dir, manifestRel), '{broken');
  fs.writeFileSync(path.join(dir, scratchRel), 'partial write');
  fs.writeFileSync(path.join(dir, 'injected.cfg'), 'keep unless previously installed');
  fs.writeFileSync(journal.pendingPath(dir), JSON.stringify({version: 1, folder, files, dirs: []}));
  const review = new ComponentReview(profile);
  const restore = async () => {
    let inventoryManifest = null;
    const ok = await backend.restore(dir, undefined, manifest => { inventoryManifest = manifest; }, {vulkanLayerTarget:layer});
    return preview.active() ? {ok, inventoryManifest} : {ok};
  };
  return {dir, profile, layer, restore, review, request: {kind: 'restore'}, manifest, scratchRel};
}

for (const firstInstall of [false, true]) {
  test('previews an interrupted ' + (firstInstall ? 'first install' : 'update') + ' with a corrupt active manifest', async t => {
    const f = interrupted(t, {firstInstall});
    const original = file => fs.readFileSync(path.join(f.dir, file), 'utf8');
    const plan = (await f.review.run(f.dir, f.request, f.restore)).preview;
    assert.equal(plan.rows.find(row => row.rel === f.scratchRel).action, 'replace');
    assert.equal(plan.rows.some(row => row.rel === 'injected.cfg' && row.action === 'remove'), !firstInstall);
    assert.equal(original(f.scratchRel), 'partial write');
    assert.equal(original('_DLSS5_Backup/manifest.json'), '{broken');
    assert.ok(fs.existsSync(journal.pendingPath(f.dir)));
    assert.equal((await f.review.run(f.dir, f.request, f.restore, plan.token)).ok, true);
    assert.equal(original(f.scratchRel), 'previous setting');
    assert.equal(fs.existsSync(path.join(f.dir, 'injected.cfg')), firstInstall);
    assert.equal(fs.existsSync(journal.pendingPath(f.dir)), false);
  });
}

test('older restore callers revalidate journal snapshots when confirming a preview', async t => {
  const f = interrupted(t);
  const restore = async () => ({ok: await backend.restore(f.dir)});
  const plan = (await f.review.run(f.dir, f.request, restore)).preview;
  const pending = journal.pendingPath(f.dir);
  const { files } = JSON.parse(fs.readFileSync(pending, 'utf8'));
  fs.writeFileSync(path.join(f.dir, files[1].snapshot), 'different rollback value');
  await assert.rejects(f.review.run(f.dir, f.request, restore, plan.token), {code: 'errPreviewChanged'});
  assert.ok(fs.existsSync(pending));
  assert.equal(fs.readFileSync(path.join(f.dir, f.scratchRel), 'utf8'), 'partial write');
});

test('other operations still reject a corrupt manifest even when handed a substitute', async t => {
  const f = interrupted(t);
  const noRecovery = async () => ({ok: true, inventoryManifest: null});
  await assert.rejects(f.review.run(f.dir, {kind: 'install'}, noRecovery), SyntaxError);
  await assert.rejects(f.review.run(f.dir, f.request, noRecovery), SyntaxError);
  assert.ok(fs.existsSync(journal.pendingPath(f.dir)));
});

test('a different game’s shared lock still blocks a journal-assisted restore', async t => {
  const f = interrupted(t, {shared: true});
  const other = path.join(f.profile, 'other-game');
  fs.mkdirSync(path.join(other, '_DLSS5_Backup'), {recursive: true});
  writePe(path.join(other, 'Game.exe'), {text: 'D3D12CreateDevice'});
  fs.writeFileSync(path.join(other, '_DLSS5_Backup', 'manifest.json'), JSON.stringify({
    ...f.manifest, game: {...f.manifest.game, dir: other}, added: []
  }));
  await f.review.setLock(other, true);
  const work = () => {
    assert.ok(preview.active(), 'a conflict must stop before the real Vulkan operation');
    return f.restore();
  };
  const plan = (await f.review.run(f.dir, f.request, work)).preview;
  assert.ok(plan.conflicts.some(c => c.includes('ReShade64.dll')));
  await assert.rejects(f.review.run(f.dir, f.request, work, plan.token), {code: 'errVersionLocked'});
  assert.ok(fs.existsSync(journal.pendingPath(f.dir)));
  assert.ok(fs.existsSync(path.join(f.layer, 'ReShade64.dll')));
  assert.equal(fs.readFileSync(path.join(f.dir, f.scratchRel), 'utf8'), 'partial write');
});
