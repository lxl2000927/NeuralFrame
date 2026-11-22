'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writePe} = require('./fixtures/pe');
const payload = require('./fixtures/payload');
const backends = require('../src/core/backend-manager');
const anr = require('../src/core/anr');
const {ComponentLibrary, digest} = require('../src/core/component-library');
const {ComponentReview} = require('../src/core/component-review');

const runtime = 'nvngx_dlssg.dll';
test('a renamed SR stays visible and is excluded from standalone FG updates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-fg-identity-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const game = path.join(root,'Game'), profile = path.join(root,'profile');
  writePe(path.join(game,'Game.exe'),{text:'D3D12CreateDevice'});
  const wrongFile = path.join(game,runtime);
  fs.copyFileSync(path.join(payload.root,'streamline','nvngx_dlss.dll'),wrongFile);
  const before = await digest(wrongFile);
  const review = new ComponentReview(profile), library = new ComponentLibrary(profile);
  const {request,work} = await selectBaseline({game,library});
  const row = (await review.inventory(game)).rows.find(r=>r.rel===runtime);
  assert.equal(row.featureMismatch,true);
  assert.equal(row.selectionTarget,false);
  await assert.rejects(review.run(game,request,work),/组件身份不匹配/);
  const native = path.join(game,'Engine','Plugins','NVIDIA',runtime);
  fs.mkdirSync(path.dirname(native),{recursive:true});
  fs.copyFileSync(path.join(payload.root,'enhanced','streamline-2.14.16',runtime),native);
  const {preview} = await review.run(game,request,work);
  assert.equal(preview.rows.find(r=>r.rel===runtime).action,'keep');
  assert.equal((await review.run(game,request,work,preview.token)).changed,1);
  assert.equal(await digest(wrongFile),before);
});
async function installedAnr(t, {nativeCopy = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-route-copies-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const game = path.join(root, 'Game'), profile = path.join(root, 'profile');
  const exe = writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
  writePe(path.join(game, 'sl.dlss_g.dll'));
  const nativeRel = path.join('Engine','Plugins','NVIDIA',runtime), native = path.join(game,nativeRel);
  if (nativeCopy) {
    fs.mkdirSync(path.dirname(native), {recursive:true});
    fs.copyFileSync(path.join(payload.root,'enhanced','streamline-2.14.16',runtime), native);
  }
  const options = {gameDir:game, exePath:exe, api:'dxgi', apiLabel:'DirectX 12', bitness:64,
    target:{hasNativeDlssFg:true}, route:'anr', payloadDir:payload.root, userDataDir:profile, gpuName:'AMD Radeon RX 7800 XT'};
  await backends.install(options);
  const privateRel = path.join(anr.privatePath,runtime), privateFile = path.join(game,privateRel);
  const review = new ComponentReview(profile), library = new ComponentLibrary(profile);
  return {game, options, nativeRel, native, privateRel, privateFile, review, library};
}

async function selectBaseline({game, library}) {
  const pkg = await library.importPackage({component:'dlss-fg', files:{[runtime]:path.join(payload.root,'streamline',runtime)}});
  assert.equal(library.compatibility(pkg).ready, true);
  const selection = {'dlss-fg':pkg.id};
  return {selectedSha:pkg.files[0].sha256, request:{kind:'component-update', selection},
    work:() => library.apply(game, selection, {strict:true})};
}

test('the component preview, update and rollback affect only the native copy alongside the ANR provider', async t => {
  const f = await installedAnr(t, {nativeCopy:true});
  const {request, work, selectedSha} = await selectBaseline(f);
  const nativeBefore = await digest(f.native), privateBefore = await digest(f.privateFile);
  assert.notEqual(nativeBefore, selectedSha);
  const rows = (await f.review.inventory(f.game)).rows;
  const native = rows.find(row => row.rel === f.nativeRel), provider = rows.find(row => row.rel === f.privateRel);
  assert.equal(native.selectionTarget, true);
  assert.equal(provider.selectionTarget, false);
  assert.equal(provider.routeSha256, privateBefore);

  const {preview} = await f.review.run(f.game, request, work);
  assert.equal(preview.rows.find(row => row.rel === f.nativeRel).action, 'replace');
  assert.equal(preview.rows.find(row => row.rel === f.privateRel).action, 'keep');
  assert.equal(await digest(f.native), nativeBefore);
  assert.equal((await f.review.run(f.game, request, work, preview.token)).changed, 1);
  assert.equal(await digest(f.native), selectedSha);
  assert.equal(await digest(f.privateFile), privateBefore);

  const revision = backends.readManifest(f.game).componentHistory.at(-1);
  assert.deepEqual(revision.files.map(file => file.rel), [f.nativeRel]);
  const rollback = () => f.library.rollback(f.game, revision.id);
  const undo = {kind:'component-rollback', id:revision.id};
  const plan = (await f.review.run(f.game, undo, rollback)).preview;
  assert.equal((await f.review.run(f.game, undo, rollback, plan.token)).changed, 1);
  assert.equal(await digest(f.native), nativeBefore);
  assert.equal(await digest(f.privateFile), privateBefore);
});

test('a private ANR provider alone reports route ownership and keeps its bytes', async t => {
  const f = await installedAnr(t);
  const {request, work} = await selectBaseline(f), before = await digest(f.privateFile);
  await assert.rejects(f.review.run(f.game, request, work), /由已安装路线管理/);
  assert.equal(await digest(f.privateFile), before);
  assert.equal(backends.readManifest(f.game).componentHistory, undefined);
});

test('the inventory uses the F7 receipt alongside ANR when comparing installed files', async t => {
  const f = await installedAnr(t);
  await backends.install({...f.options, route:'hud', activeManifest:backends.readManifest(f.game)});
  const installed = backends.readManifest(f.game), receipts = installed.performanceMonitor.files;
  const rows = (await f.review.inventory(f.game)).rows;
  assert.ok(receipts['ReShade64.dll']);
  for (const [rel, expected] of Object.entries(receipts)) {
    const row = rows.find(item => item.rel === rel);
    assert.equal(row.routeSha256, expected);
    assert.equal(row.sha256, expected);
    assert.equal(row.selectionTarget, false);
  }
  assert.equal(rows.find(item => item.rel === f.privateRel).routeSha256, installed.graphicsRoute.files[f.privateRel]);
});
