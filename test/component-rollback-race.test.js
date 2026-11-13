'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe, writeNr} = require('./fixtures/pe');
const {ComponentLibrary} = require('../src/core/component-library');
const backends = require('../src/core/backend-manager');
const guards = require('../src/core/install-guards');
const apply = require('../src/core/apply');

for (const changed of ['target', 'snapshot', 'manifest']) {
  test(`component rollback preserves a ${changed} changed while checking whether the game is closed`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-rollback-drift-'));
    t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    const game = path.join(root, 'game'), target = path.join(game, 'nvngx_dlss.dll');
    const source = path.join(root, 'source.dll');
    writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
    writePe(target, {version:[2,0,0,0], text:'nvngx_dlss.pdb'});
    writePe(source, {version:[3,0,0,0], text:'nvngx_dlss.pdb'});
    const library = new ComponentLibrary(path.join(root, 'profile'));
    const pkg = await library.importPackage({component:'dlss-sr', files:{'nvngx_dlss.dll':source}});
    t.mock.method(guards, 'assertGameClosed', async () => {});
    await library.apply(game, {'dlss-sr':pkg.id}, {strict:true});
    const manifestFile = path.join(game, '_DLSS5_Backup', 'manifest.json');
    const manifest = backends.readManifest(game), revision = manifest.componentHistory.at(-1);
    const snapshot = path.join(game, revision.files[0].snapshot);
    const files = {target, snapshot, manifest:manifestFile};
    let expected;
    t.mock.method(guards, 'assertGameClosed', async () => {
      // Process enumeration is asynchronous; another tool can finish writing
      // after the initial validation, before the guarded operation resumes.
      if (changed === 'manifest') fs.writeFileSync(manifestFile, JSON.stringify({...manifest, externalNote:'keep'}));
      else fs.writeFileSync(files[changed], 'external change');
      expected = Object.fromEntries(Object.entries(files).map(([key,file]) => [key, fs.readFileSync(file)]));
    });
    await assert.rejects(library.rollback(game, revision.id), /已变化|已被其他操作更改|快照损坏或缺失/);
    for (const [key,file] of Object.entries(files)) assert.deepEqual(fs.readFileSync(file), expected[key]);
    assert.equal(fs.existsSync(path.join(game, '_DLSS5_Backup', 'pending-switch.json')), false);
  });
}

for (const changed of ['target', 'source', 'manifest']) {
  test(`component update preserves a ${changed} changed while checking whether the game is closed`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-update-drift-'));
    t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    const game = path.join(root, 'game'), target = path.join(game, 'nvngx_dlss.dll');
    const source = path.join(root, 'source.dll');
    writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
    writePe(target, {version:[2,0,0,0], text:'nvngx_dlss.pdb'});
    writePe(source, {version:[3,0,0,0], text:'nvngx_dlss.pdb'});
    const library = new ComponentLibrary(path.join(root, 'profile'));
    const first = await library.importPackage({component:'dlss-sr', files:{'nvngx_dlss.dll':source}});
    t.mock.method(guards, 'assertGameClosed', async () => {});
    await library.apply(game, {'dlss-sr':first.id}, {strict:true});
    writePe(source, {version:[4,0,0,0], text:'nvngx_dlss.pdb'});
    const next = await library.importPackage({component:'dlss-sr', files:{'nvngx_dlss.dll':source}});
    const manifestFile = path.join(game, '_DLSS5_Backup', 'manifest.json');
    const manifest = backends.readManifest(game);
    const files = {target, source:path.join(library.directory(next),'nvngx_dlss.dll'), manifest:manifestFile};
    let expected;
    t.mock.method(guards, 'assertGameClosed', async () => {
      if (changed === 'manifest') fs.writeFileSync(manifestFile, JSON.stringify({...manifest, externalNote:'keep'}));
      else fs.writeFileSync(files[changed], 'external change');
      expected = Object.fromEntries(Object.entries(files).map(([key,file]) => [key, fs.readFileSync(file)]));
    });
    await assert.rejects(library.apply(game, {'dlss-sr':next.id}, {strict:true}), /已变化|已被其他操作更改|缺失/);
    for (const [key,file] of Object.entries(files)) assert.deepEqual(fs.readFileSync(file), expected[key]);
    assert.equal(fs.existsSync(path.join(game, '_DLSS5_Backup', 'pending-switch.json')), false);
  });
}

test('model identity-only repair preserves a manifest changed during the process check', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-identity-drift-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const game = path.join(root, 'game'), exe = path.join(game, 'Game.exe');
  writePe(exe, {text:'D3D12CreateDevice'});
  const target = writeNr(path.join(game, 'nvngx_dlssnr.dll'));
  const library = new ComponentLibrary(path.join(root, 'profile'));
  const pkg = await library.importPackage({component:'dlss-nr', files:{'nvngx_dlssnr.dll':target}});
  const manifest = apply.beginManifest(game, exe, 'dxgi');
  manifest.neuralRendering = {mode:'latest_compatible', modelId:'outdated-record'};
  await apply.saveActiveManifest(game, manifest);
  const manifestFile = path.join(game, '_DLSS5_Backup', 'manifest.json');
  const modelBytes = fs.readFileSync(target);
  let expected;
  t.mock.method(guards, 'gpuInfo', async () => [{name:'RTX 4070',driver:'fixture'}]);
  const check = t.mock.method(guards, 'assertGameClosed', async () => {
    expected = JSON.stringify({...manifest, externalNote:'keep'});
    fs.writeFileSync(manifestFile, expected);
  });
  await assert.rejects(library.apply(game, {'dlss-nr':pkg.id}, {strict:true}), /安装记录已变化/);
  assert.equal(fs.readFileSync(manifestFile,'utf8'),expected);
  assert.deepEqual(fs.readFileSync(target),modelBytes);
  check.mock.restore();
  t.mock.method(guards, 'assertGameClosed', async () => {});
  assert.equal((await library.apply(game, {'dlss-nr':pkg.id}, {strict:true})).changed,0);
  assert.equal(backends.readManifest(game).externalNote,'keep');
  assert.equal(backends.readManifest(game).neuralRendering.modelVersion,'310.9.16.0');
});

for (const operation of ['update','rollback']) {
test(`component ${operation} restores its starting state if copied bytes no longer match the verified source`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-copy-drift-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const game = path.join(root, 'game'), target = path.join(game, 'nvngx_dlss.dll');
  const source = path.join(root, 'source.dll');
  writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
  writePe(target, {version:[2,0,0,0], text:'nvngx_dlss.pdb'});
  writePe(source, {version:[3,0,0,0], text:'nvngx_dlss.pdb'});
  const library = new ComponentLibrary(path.join(root, 'profile'));
  const pkg = await library.importPackage({component:'dlss-sr', files:{'nvngx_dlss.dll':source}});
  t.mock.method(guards, 'assertGameClosed', async () => {});
  if (operation === 'rollback') await library.apply(game, {'dlss-sr':pkg.id}, {strict:true});
  const before = fs.readFileSync(target), manifest = backends.readManifest(game);
  const revision = manifest?.componentHistory.at(-1);
  const snapshot = revision && path.join(game,revision.files[0].snapshot);
  const snapshotBytes = snapshot && fs.readFileSync(snapshot);
  const copy = apply.copyTracked;
  t.mock.method(apply, 'copyTracked', async (...args) => {
    const result = await copy(...args);
    fs.writeFileSync(args[3], 'changed before publication');
    return result;
  });
  const work = operation === 'rollback' ? library.rollback(game,revision.id) : library.apply(game, {'dlss-sr':pkg.id}, {strict:true});
  await assert.rejects(work, /复制期间.*发生变化/);
  assert.deepEqual(fs.readFileSync(target), before);
  assert.deepEqual(backends.readManifest(game), manifest);
  if (snapshot) assert.deepEqual(fs.readFileSync(snapshot),snapshotBytes);
  assert.equal(fs.existsSync(path.join(game, '_DLSS5_Backup', 'pending-switch.json')), false);
});
}
