'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const core = require('../src/core/apply');
const backend = require('../src/core/backend-manager');
const journal = require('../src/core/file-journal');
const layer = require('../src/core/vulkan-layer');

function fixture(t) {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-integrity-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(game)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(game).startsWith('restore-integrity-'));
    fs.rmSync(game, { recursive: true, force: true });
  });
  const exe = path.join(game, 'Game.exe');
  fs.writeFileSync(exe, 'fixture');
  return { game, manifest: core.beginManifest(game, exe, 'dxgi') };
}

test('full restore preserves an untracked localization add-on beside the game and host', async t => {
  const {game, manifest} = fixture(t);
  const rootFile = path.join(game, 'dlss5-zh-cn.addon64');
  const hostFile = path.join(game, 'host64', 'dlss5-zh-cn.addon64');
  fs.mkdirSync(path.dirname(hostFile));
  fs.writeFileSync(rootFile, 'custom game translation');
  fs.writeFileSync(hostFile, 'custom host translation');
  await core.saveActiveManifest(game, manifest);
  await backend.restore(game);
  assert.equal(fs.readFileSync(rootFile, 'utf8'), 'custom game translation');
  assert.equal(fs.readFileSync(hostFile, 'utf8'), 'custom host translation');
});

test('enabling one add-on retains disabled plugins with similar names and restores the original list', async t => {
  const {game,manifest} = fixture(t), file = path.join(game,'ReShade.ini');
  const original = '[ADDON]\r\nDisabledAddons=renodx-dlss,renodx-dlss5-extra.addon64,third-party,dlss5-zh-cn\r\n';
  fs.writeFileSync(file,original);
  await journal.transaction(game,()=>core.enableAddonInIni(game,'renodx-dlss.addon64',()=>{},game,manifest));
  assert.equal(fs.readFileSync(file,'utf8'),'[ADDON]\r\nDisabledAddons=renodx-dlss5-extra.addon64,third-party,dlss5-zh-cn\r\n');
  await core.restore(game);
  assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('localization deployment and full restore retain originals and remove managed additions', async t => {
  require('./fixtures/payload').use(t);
  const {game, manifest} = fixture(t);
  const host = path.join(game, 'host64');
  const original = path.join(host, 'dlss5-zh-cn.addon64');
  const added = path.join(game, 'dlss5-zh-cn.addon32');
  fs.mkdirSync(host);
  fs.writeFileSync(original, 'user localization');
  // Exercise the normal game deployment path with a disposable fixture.
  const tmp = t.mock.method(os, 'tmpdir', () => path.join(game, 'system-temp'));
  try {
    await core.enableAddonInIni(host, 'renodx-dlss5.addon64', () => {}, game, manifest);
    await core.enableAddonInIni(game, 'dlss5-feed.addon32', () => {}, game, manifest);
  } finally { tmp.mock.restore(); }
  assert.ok(manifest.replaced.some(item => item.rel === path.relative(game, original)));
  assert.ok(manifest.added.includes(path.relative(game, added)));
  assert.ok(!manifest.added.includes(path.relative(game, original)));
  assert.notEqual(fs.readFileSync(original).toString('utf8', 0, 2), 'us');
  // A previous release could append 'added' even after tracking the original.
  manifest.added.push(path.relative(game, original));
  await core.saveActiveManifest(game, manifest);
  await backend.restore(game);
  assert.equal(fs.readFileSync(original, 'utf8'), 'user localization');
  assert.equal(fs.existsSync(added), false);
});

test('transaction JSON leaves existing temporary hard links and neighboring files untouched', async t => {
  const {game} = fixture(t);
  const neighbor = path.join(game, 'user.cfg');
  const file = journal.pendingPath(game);
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(neighbor, 'important bytes');
  fs.linkSync(neighbor, file + '.tmp');
  await journal.transaction(game, async () => {});
  assert.equal(fs.readFileSync(neighbor, 'utf8'), 'important bytes');
  const collision = file + '.collision.tmp';
  fs.linkSync(neighbor, collision);
  t.mock.method(crypto, 'randomUUID', () => 'collision');
  await assert.rejects(journal.atomicJson(file, {}), {code:'EEXIST'});
  assert.equal(fs.readFileSync(collision, 'utf8'), 'important bytes');
});

test('failed full restore reverses files and empty-directory removal before a successful retry', async t => {
  const {game, manifest} = fixture(t);
  const file = path.join(game, 'base.dll');
  const managed = path.join(game, 'new.addon64');
  fs.writeFileSync(file, 'stock');
  await core.writeTracked(manifest, game, file, 'installed');
  await core.writeTracked(manifest, game, managed, 'managed');
  fs.mkdirSync(path.join(game, 'generated'));
  manifest.addedDirs.push('generated');
  manifest.reshade.filesAdded = ['ReShade.log'];
  fs.writeFileSync(path.join(game, 'ReShade.log'), 'log');
  await core.saveActiveManifest(game, manifest);
  const before = fs.readFileSync(path.join(core.backupRoot(game), 'manifest.json'));
  const unlink = fs.promises.unlink;
  const blocked = t.mock.method(fs.promises, 'unlink', async function(file, ...args) {
    if (path.basename(file) === 'ReShade.log') throw Object.assign(new Error('in use'), {code:'EBUSY'});
    return unlink.call(this, file, ...args);
  });
  await assert.rejects(backend.restore(game), {code:'EBUSY'});
  blocked.mock.restore();
  assert.equal(fs.readFileSync(file, 'utf8'), 'installed');
  assert.equal(fs.readFileSync(managed, 'utf8'), 'managed');
  assert.ok(fs.statSync(path.join(game, 'generated')).isDirectory());
  assert.deepEqual(fs.readFileSync(path.join(core.backupRoot(game), 'manifest.json')), before);
  assert.equal(fs.existsSync(journal.pendingPath(game)), false);
  assert.equal(await backend.restore(game), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'stock');
  assert.equal(fs.existsSync(managed), false);
  assert.equal(fs.existsSync(path.join(game, 'generated')), false);
});

test('a failed Vulkan detach can be retried without replaying the finished local restore', async t => {
  const {game, manifest} = fixture(t);
  manifest.vulkanLayer = {owned:true, dir:path.join(game, 'mock-layer')};
  const file = path.join(game, 'stock.dll');
  fs.writeFileSync(file, 'stock');
  await core.writeTracked(manifest, game, file, 'installed');
  const detach = t.mock.method(layer, 'detach', async () => { throw Error('registry unavailable'); });
  const restore = () => backend.restore(game, undefined, undefined, {vulkanLayerTarget: manifest.vulkanLayer.dir});
  await assert.rejects(restore(), /registry unavailable/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'stock');
  assert.equal(backend.readManifest(game).restorePhase, 'detach-vulkan');
  fs.writeFileSync(file, 'new game patch');
  detach.mock.mockImplementation(async () => true);
  assert.equal(await restore(), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new game patch');
  assert.equal(backend.readManifest(game), null);
  const archive = fs.readdirSync(core.backupRoot(game)).find(name => /^manifest\.json\.done-/.test(name));
  assert.equal(JSON.parse(fs.readFileSync(path.join(core.backupRoot(game), archive))).restorePhase, undefined);
});

test('an owned Vulkan manifest cannot redirect a restore to an unrelated directory or junction', async t => {
  const {game, manifest} = fixture(t);
  const target = path.join(game, 'profile', 'reshade-vulkan');
  const other = path.join(game, 'other');
  fs.mkdirSync(other);
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(path.join(other, 'ReShade64.dll'), 'foreign');
  const file = path.join(game, 'game.dll');
  fs.writeFileSync(file, 'original');
  manifest.vulkanLayer = {owned:true, dir:other};
  await core.writeTracked(manifest, game, file, 'installed');
  const detach = t.mock.method(layer, 'detach', async () => assert.fail('no registry operations expected'));
  const restore = () => backend.restore(game, undefined, undefined, {vulkanLayerTarget:target});
  await assert.rejects(restore(), {code:'errUnsafeTarget'});
  manifest.vulkanLayer.dir = target;
  await core.saveActiveManifest(game, manifest);
  fs.symlinkSync(other, target, 'junction');
  await assert.rejects(restore(), {code:'errUnsafeTarget'});
  assert.equal(detach.mock.callCount(), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'installed');
  assert.equal(fs.readFileSync(path.join(other, 'ReShade64.dll'), 'utf8'), 'foreign');
});

test('shared Vulkan cleanup requires ownership and preserves retry evidence on registry errors', async t => {
  const {game} = fixture(t);
  const dir = path.join(game, 'profile', 'reshade-vulkan');
  fs.mkdirSync(dir, {recursive:true});
  const owners = path.join(dir, 'installs.json'), dll = path.join(dir, 'ReShade64.dll');
  fs.writeFileSync(dll, 'shared');
  const info = {owned:true, dir};
  const unexpected = async () => assert.fail('registry work before validating ownership');
  assert.equal(await layer.detach(info, game, unexpected), false);
  fs.writeFileSync(owners, '{broken');
  await assert.rejects(layer.detach(info, game, unexpected), SyntaxError);
  const record = JSON.stringify({version:1, games:[game]});
  fs.writeFileSync(owners, record);
  const denied = async (_exe, args) => args[0] === 'delete'
    ? {code:1, stderr:'Access denied'} : {code:0, stdout:`    ${path.join(dir, 'ReShade64.json')}    REG_DWORD    0x0`};
  await assert.rejects(layer.detach(info, game, denied), /Access denied/);
  assert.equal(fs.readFileSync(owners, 'utf8'), record);
  assert.equal(fs.readFileSync(dll, 'utf8'), 'shared');
  const alreadyAbsent = async (_exe, args) => args[0] === 'delete' ? {code:1} : {code:0,stdout:''};
  assert.equal(await layer.detach(info, game, alreadyAbsent), true);
  assert.equal(fs.existsSync(dll), false);
});
