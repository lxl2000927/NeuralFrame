'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const { writePe } = require('./fixtures/pe');
const { ComponentReview } = require('../src/core/component-review');
const preview = require('../src/core/preview-fs');
const core = require('../src/core/apply');
const backends = require('../src/core/backend-manager');
const journal = require('../src/core/file-journal');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'game'), payload = path.join(root, 'payload');
  fs.mkdirSync(game); fs.mkdirSync(payload);
  writePe(path.join(game, 'Game.exe'), { bitness: 64, text: 'D3D12CreateDevice' });
  writePe(path.join(game, 'nvngx_dlss.dll'), { bitness: 64, version: [2, 0, 0, 0] });
  writePe(path.join(payload, 'nvngx_dlss.dll'), { bitness: 64, version: [3, 0, 0, 0] });
  writePe(path.join(payload, 'nvngx_dlssnr.dll'), { bitness: 64, version: [310, 8, 0, 0] });
  const review = new ComponentReview(path.join(root, 'profile'));
  const config = { gameDir: game, exePath: path.join(game, 'Game.exe'), api: 'dxgi', apiLabel: 'DirectX 12', bitness: 64, route: 'native', addMissingDlss: true, installReShade: false,
    source: { hasNeuralRendering: true, payload: ['nvngx_dlss.dll','nvngx_dlssnr.dll'].map(name => ({ name, path: path.join(payload, name), version: name.includes('nr') ? '310.8.0.0' : '3.0.0.0' })) } };
  const install = async () => { await backends.install(config); return { ok: true }; };
  return { root, game, payload, review, config, install, request: { kind: 'install' } };
}
test('enhanced deployment preview includes detected anti-cheat and rechecks it on confirmation', async t => {
  const { game, review } = fixture(t);
  const target = path.join(game, 'ReShade.ini');
  const work = async () => {
    await preview.fs.promises.writeFile(target, '[OVERLAY]\n');
    return {ok:true};
  };
  const request = {kind:'enhanced'};
  const first = (await review.run(game, request, work)).preview;
  assert.equal(first.antiCheat, undefined);
  fs.mkdirSync(path.join(game, 'EasyAntiCheat'));
  await assert.rejects(review.run(game, request, work, first.token), {code:'errPreviewChanged'});
  assert.equal(fs.existsSync(target), false);
  const next = (await review.run(game, request, work)).preview;
  assert.deepEqual(next.antiCheat.components, ['Easy Anti-Cheat']);
  assert.equal((await review.run(game, request, work, next.token)).ok, true);
  assert.equal((await review.run(game, request, work)).preview.antiCheat, undefined);
});
test('enhanced preview follows the explicitly selected executable rather than the old inventory target', async t => {
  const {game,review}=fixture(t),selected=path.join(game,'Other','OtherGame.exe');
  writePe(selected,{bitness:64,text:'D3D12CreateDevice'});
  const work=async()=>{await preview.fs.promises.writeFile(path.join(game,'Other','settings.ini'),'selected');return{ok:true};};
  const request={kind:'enhanced',config:{exePath:selected,route:'encore'}};
  assert.notEqual((await review.inventory(game)).exePath,selected,'the old scan still selects a different executable');
  const before=(await review.run(game,request,work)).preview;assert.equal(before.antiCheat,undefined);
  fs.mkdirSync(path.join(game,'Other','EasyAntiCheat'));
  await assert.rejects(review.run(game,request,work,before.token),{code:'errPreviewChanged'});
  assert.equal(fs.existsSync(path.join(game,'Other','settings.ini')),false);
  const after=(await review.run(game,request,work)).preview;
  assert.deepEqual(after.antiCheat.components,['Easy Anti-Cheat']);
  assert.equal((await review.run(game,request,work,after.token)).ok,true);
  const outsideWork=async()=>{await preview.fs.promises.writeFile(path.join(game,'Other','another.ini'),'changed');return{ok:true};};
  await assert.rejects(review.run(game,{kind:'enhanced',config:{exePath:path.join(game,'..','outside.exe')}},outsideWork),{code:'errUnsafeTarget'});
});

test('preview uses real installer, never writes game/profile; confirm matches, inventory and original restore', async t => {
  const f = fixture(t), old = fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll'));
  writePe(path.join(f.game,'sl.interposer.dll'),{bitness:64,version:[2,14,0,0]});
  const plan = (await f.review.run(f.game, f.request, f.install)).preview;
  assert.equal(plan.rows.find(r => r.rel === 'nvngx_dlss.dll').action, 'replace');
  assert.equal(plan.rows.find(r => r.rel === 'nvngx_dlssnr.dll').action, 'add');
  assert.deepEqual(fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll')), old);
  assert.equal(fs.existsSync(path.join(f.game, '_DLSS5_Backup')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'profile')), false);
  assert.equal((await f.review.run(f.game, f.request, f.install, plan.token)).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll')), fs.readFileSync(path.join(f.payload, 'nvngx_dlss.dll')));
  const rows = (await f.review.inventory(f.game)).rows;
  assert.equal(rows.find(r => r.rel === 'nvngx_dlss.dll').version, '3.0.0.0');
  assert.equal(rows.find(r => r.rel === 'nvngx_dlss.dll').backup.version, '2.0.0.0');
  assert.ok(rows.every(r => r.loaded === 'unknown'));
  assert.equal(rows.find(r=>r.rel==='sl.interposer.dll').writtenAt,null,'preserved files are not newly written');
  const restore = async () => ({ ok: await backends.restore(f.game) });
  const undo = (await f.review.run(f.game, {kind:'restore'}, restore)).preview;
  assert.equal(undo.rows.find(r => r.rel === 'nvngx_dlssnr.dll').action, 'remove');
  await f.review.run(f.game, {kind:'restore'}, restore, undo.token);
  assert.deepEqual(fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll')), old);
  assert.equal(fs.existsSync(path.join(f.game, 'nvngx_dlssnr.dll')), false);
});
test('changed source or destination invalidates preview; tokens cannot be replayed or reused for another game', async t => {
  const f = fixture(t);
  let plan = (await f.review.run(f.game, f.request, f.install)).preview;
  fs.appendFileSync(path.join(f.payload, 'nvngx_dlssnr.dll'), 'new bytes');
  await assert.rejects(f.review.run(f.game, f.request, f.install, plan.token), {code:'errPreviewChanged'});
  assert.equal(fs.existsSync(path.join(f.game, '_DLSS5_Backup')), false);
  plan = (await f.review.run(f.game, f.request, f.install)).preview;
  fs.appendFileSync(path.join(f.game, 'nvngx_dlss.dll'), 'game update');
  await assert.rejects(f.review.run(f.game, f.request, f.install, plan.token), {code:'errPreviewChanged'});
  await assert.rejects(f.review.run(f.game, f.request, f.install, plan.token), {code:'errPreviewExpired'});
  plan = (await f.review.run(f.game, f.request, f.install)).preview;
  await assert.rejects(f.review.run(f.game, {kind:'restore'}, f.install, plan.token), {code:'errPreviewExpired'});
});

test('a selected alternate executable survives rescans, scopes changes, and can be explicitly switched back', async t => {
  const f = fixture(t), {scanGame} = require('../src/core/scan');
  const first = f.config.exePath, altDir = path.join(f.game, 'Alternate');
  fs.mkdirSync(altDir);
  const alternate = path.join(altDir, 'AlternateGame.exe');
  writePe(alternate, {text:'D3D12CreateDevice'});
  const name = 'nvngx_dlss.dll', nativeA = path.join(f.game, name), nativeB = path.join(altDir, name);
  writePe(nativeB, {version:[2,5,0,0]});
  const oldA = fs.readFileSync(nativeA), oldB = fs.readFileSync(nativeB);
  const applyTo = async (exePath) => {
    const request = {kind:'install', exePath};
    const operation = async () => { await backends.install({...f.config,exePath}); return {ok:true}; };
    const plan = (await f.review.run(f.game, request, operation)).preview;
    assert.equal((await f.review.run(f.game, request, operation, plan.token)).ok, true);
    return plan;
  };
  assert.equal((await scanGame(f.game)).chosen.path, first);
  const previewB = await applyTo(alternate);
  assert.ok(previewB.rows.some(row => row.rel === path.relative(f.game,nativeB) && row.action === 'replace'));
  assert.deepEqual(fs.readFileSync(nativeA), oldA);
  assert.notDeepEqual(fs.readFileSync(nativeB), oldB);
  const fromDisk = await scanGame(f.game);
  assert.equal(fromDisk.chosen.path, alternate);
  assert.equal(fromDisk.primaryDlss.path, nativeB);
  assert.ok(!fromDisk.dlssFiles.some(file => file.path === nativeA));
  const switched = await scanGame(f.game, first);
  assert.equal(switched.chosen.path, first);
  assert.equal(switched.primaryDlss.path, nativeA);
  await applyTo(first);
  assert.deepEqual(fs.readFileSync(nativeB), oldB, 'switch restores the previous installation');
  assert.notDeepEqual(fs.readFileSync(nativeA), oldA);
  assert.equal((await scanGame(f.game)).chosen.path, first);
  assert.equal(await backends.restore(f.game), true);
  assert.deepEqual(fs.readFileSync(nativeA), oldA);
  fs.unlinkSync(nativeA);
  const targets = (await scanGame(f.game)).exeCandidates;
  assert.equal(targets.find(exe => exe.path === first).hasNativeDlss, false);
  assert.equal(targets.find(exe => exe.path === alternate).hasNativeDlss, true);
  const backup = path.join(f.game, '_DLSS5_Backup');
  fs.mkdirSync(backup, {recursive:true});
  for (const gameExe of ['missing.exe', '..' + path.sep + 'outside.exe']) {
    fs.writeFileSync(path.join(backup,'manifest.json'), JSON.stringify({version:1,game:{exe:gameExe},replaced:[],added:[]}));
    assert.equal((await scanGame(f.game)).chosen.path, first);
  }
});
test('per-game persisted version lock blocks changes/additions/drift, allows tuning and explicit restore', async t => {
  const f = fixture(t);
  let p = (await f.review.run(f.game, f.request, f.install)).preview;
  await f.review.run(f.game, f.request, f.install, p.token);
  await f.review.setLock(f.game, true);
  const reloaded = new ComponentReview(path.join(f.root, 'profile'));
  assert.ok((await reloaded.inventory(f.game)).lock);
  const tune = async () => {
    await journal.transaction(f.game, async () => { const m = core.beginManifest(f.game, f.config.exePath, 'dxgi'); await core.writeTracked(m, f.game, path.join(f.game,'ReShade.ini'), '[RenoDX.MFGUnlock]\nMultiplier=3\n'); });
    return {ok:true};
  };
  p = (await reloaded.run(f.game, {kind:'enhanced'}, tune)).preview;
  assert.deepEqual(p.conflicts, []);
  assert.equal((await reloaded.run(f.game, {kind:'enhanced'}, tune, p.token)).ok, true);
  const change = async () => { await preview.fs.promises.copyFile(path.join(f.payload,'nvngx_dlssnr.dll'), path.join(f.game,'extra.addon64')); return {ok:true}; };
  p = (await reloaded.run(f.game, {kind:'enhanced'}, change)).preview;
  assert.ok(p.conflicts.length);
  await assert.rejects(reloaded.run(f.game, {kind:'enhanced'}, change, p.token), {code:'errVersionLocked'});
  assert.equal(fs.existsSync(path.join(f.game,'extra.addon64')), false);
  fs.appendFileSync(path.join(f.game,'nvngx_dlss.dll'), 'external change');
  assert.equal((await reloaded.inventory(f.game)).rows.find(r => r.rel === 'nvngx_dlss.dll').lockState, 'drift');
  p = (await reloaded.run(f.game, {kind:'enhanced'}, tune)).preview;
  assert.ok(p.conflicts.some(x => x.includes('偏离')));
  await reloaded.setLock(f.game, false);
  assert.equal((await reloaded.inventory(f.game)).lock, null);
});
test('failed preview and unsupported external work never leave real backup/files', async t => {
  const f = fixture(t);
  const fail = async () => { await core.writeTracked(core.beginManifest(f.game,f.config.exePath,'dxgi'),f.game,path.join(f.game,'new.ini'),'x'); throw Error('fixture error'); };
  await assert.rejects(f.review.run(f.game, f.request, fail), /fixture error/);
  assert.equal(fs.existsSync(path.join(f.game,'new.ini')), false);
  assert.equal(fs.existsSync(path.join(f.game,'_DLSS5_Backup')), false);
  const swallowed = async () => { try { preview.external('dependency', 'lumenite'); } catch {} return {ok:true}; };
  await assert.rejects(f.review.run(f.game, f.request, swallowed), error => error.dependencies[0] === 'lumenite');
});
test('another game cannot replace a shared Vulkan component pinned by this game',async t=>{
  const f=fixture(t),shared=path.join(f.root,'profile','reshade-vulkan');fs.mkdirSync(shared,{recursive:true});
  const dll=path.join(shared,'ReShade64.dll');writePe(dll,{bitness:64,version:[6,7,0,0]});
  const manifest=core.beginManifest(f.game,f.config.exePath,'vulkan');manifest.vulkanLayer={owned:true,dir:shared};await core.saveActiveManifest(f.game,manifest);
  await f.review.setLock(f.game,true);
  assert.equal((await f.review.inventory(f.game)).rows.find(r=>r.scope==='shared').lockState,'match');
  const other=path.join(f.root,'OtherGame');fs.mkdirSync(other);writePe(path.join(other,'Other.exe'),{bitness:64,text:'D3D12CreateDevice'});
  const work=async()=>{await preview.fs.promises.copyFile(path.join(f.payload,'nvngx_dlss.dll'),dll);return {ok:true};};
  const plan=(await f.review.run(other,{kind:'enhanced'},work)).preview;
  assert.ok(plan.conflicts.some(c=>c.includes('共享组件锁')));
  await assert.rejects(f.review.run(other,{kind:'enhanced'},work,plan.token),{code:'errVersionLocked'});
});

test('unrelated game records and lock changes leave a game-local preview usable', async t => {
  const f = fixture(t);
  const other = path.join(f.root, 'other');
  fs.mkdirSync(other);
  writePe(path.join(other, 'Game.exe'), {text:'D3D12CreateDevice'});
  writePe(path.join(other, 'nvngx_dlss.dll'), {bitness:64, version:[2,0,0,0]});
  const plan = (await f.review.run(f.game, f.request, f.install)).preview;
  await f.review.setLock(other, true);
  // An unreadable record cannot answer questions about shared pins, but it has
  // no authority over a purely local change to another game's files.
  fs.writeFileSync(f.review.file(other), '{');
  assert.equal((await f.review.run(f.game, f.request, f.install, plan.token)).ok, true);
  assert.equal(fs.readFileSync(f.review.file(other), 'utf8'), '{');
  const shared = path.join(f.root, 'profile', 'reshade-vulkan', 'ReShade64.dll');
  const updateShared = async () => {
    await preview.fs.promises.mkdir(path.dirname(shared), {recursive:true});
    await preview.fs.promises.copyFile(path.join(f.payload, 'nvngx_dlss.dll'), shared);
    return {ok:true};
  };
  await assert.rejects(f.review.run(f.game, f.request, updateShared), {code:'errComponentRecord'});
  assert.equal(fs.existsSync(shared), false);
});
test('prepared dependency proof detects edited files and additional loose files',t=>{
  const f=fixture(t),proof=require('../src/core/cache-proof');
  proof.save(f.payload,'verified-archive');assert.equal(proof.valid(f.payload,'verified-archive'),true);
  fs.appendFileSync(path.join(f.payload,'nvngx_dlss.dll'),'tamper');assert.equal(proof.valid(f.payload,'verified-archive'),false);
  proof.save(f.payload,'verified-archive');fs.writeFileSync(path.join(f.payload,'new.dll'),'unplanned');assert.equal(proof.valid(f.payload,'verified-archive'),false);
});
