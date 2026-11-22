'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const guards = require('../src/core/install-guards');
const manager = require('../src/core/combined-manager');
const {writePe} = require('./fixtures/pe');

test('display inventory distinguishes AMD-only, hybrid, unknown and unavailable adapters', async () => {
  const windows = cards => guards.displayAdapters(async () => JSON.stringify(cards),'win32');
  const card = (name, vendor) => ({Name:name,PNPDeviceID:'PCI\\VEN_' + vendor + '&DEV_1111'});
  const rx = card('AMD Radeon RX 7900 XT','1002'), igp = card('AMD Radeon Graphics','1002');
  const rtx = card('NVIDIA GeForce RTX 4070 Laptop GPU','10DE'), basic = {Name:'Microsoft Basic Display Adapter'};
  assert.deepEqual(await windows([igp,rx]),{name:rx.Name,nvidiaPresent:false});
  assert.deepEqual(await windows([rx,rtx]),{name:rtx.Name,nvidiaPresent:true});
  assert.deepEqual(await windows([rx,basic]),{name:rx.Name,nvidiaPresent:null});
  assert.deepEqual(await windows([]),{name:'',nvidiaPresent:null});
  assert.equal((await guards.displayAdapters(async () => {throw Error('offline');},'win32')).nvidiaPresent,null);
  const linux = await guards.displayAdapters(async () =>
    '0000:03:00.0 VGA compatible controller [0300]: Advanced Micro Devices Radeon RX 7900 XT [1002:744c] (rev c5)','linux');
  assert.equal(linux.nvidiaPresent,false);
  assert.match(linux.name,/Radeon/);
});

test('confirmed AMD-only stops classic neural rendering before payload preparation and still permits ANR FG and Off', async t => {
  t.mock.method(guards,'queryNvidiaSmi',async () => {throw Error('no NVIDIA driver');});
  t.mock.method(guards,'displayAdapters',async () => ({name:'AMD Radeon RX 7900 XT',nvidiaPresent:false}));
  t.mock.method(guards,'assertGameClosed',async () => {});
  const hardware = await manager.detectHardwareEnvironment(true);
  assert.equal(hardware.gpu.name,'AMD Radeon RX 7900 XT');
  assert.equal(hardware.gpu.nvidiaPresent,false);
  assert.equal(hardware.gpu.architecture.sm,null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-amd-only-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const game = path.join(root,'Game'), exePath = writePe(path.join(game,'Game.exe'),{text:'D3D12CreateDevice'});
  writePe(path.join(game,'nvngx_dlssg.dll'));
  const config = {exePath,payloadDir:require('./fixtures/payload').root,userDataDir:path.join(root,'profile')};
  const files = fs.readdirSync(game);
  await assert.rejects(() => manager.applyCombinedConfiguration(game,{...config,neuralMode:'latest_compatible',
    requirePayload:() => assert.fail('AMD neural rendering cannot request runtime files')}),{code:'errNeuralGpuUnsupported'});
  assert.deepEqual(fs.readdirSync(game),files);
  const prepare = [];
  const applied = await manager.applyCombinedConfiguration(game,{...config,route:'anr',
    requirePayload:async options => {prepare.push(options.route);}});
  assert.equal(applied.ok,true);
  assert.deepEqual(prepare,['anr']);
  await require('../src/core/backend-manager').restore(game);
  const off = await manager.applyCombinedConfiguration(game,{...config,neuralMode:'off'});
  assert.equal(off.ok,true);
});

test('a managed OptiScaler host can switch to FSR frame generation on Radeon and fully restore', async t => {
  const backends = require('../src/core/backend-manager');
  const {scanSource} = require('../src/core/scan');
  const {requiredPacks} = require('../src/core/runtime-payload');
  const {root: payloadDir} = require('./fixtures/payload');
  const optiRoot = path.resolve(__dirname, '../vendor/runtime-tests/components/OptiScaler-0.2.0-patch1');
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-optifg-managed-'));
  t.after(() => fs.rmSync(gameDir, {recursive:true, force:true}));
  const exePath = writePe(path.join(gameDir,'Game.exe'), {text:'D3D12CreateDevice'});
  const xess = path.join(gameDir, 'libxess.dll');
  fs.copyFileSync(path.join(optiRoot, 'OptiScaler', 'libxess.dll'), xess);
  const {digest} = require('../src/core/component-library');
  const original = await digest(xess);
  const options = {gameDir, exePath, api:'dxgi', apiLabel:'DirectX 12', bitness:64};
  await backends.install({...options, route:'optiscaler', optiRoot, source:scanSource(payloadDir)});
  const host = path.join(gameDir,'dxgi.dll');
  const hostHash = await digest(host);
  t.mock.method(guards, 'queryNvidiaSmi', async () => {throw Error('no NVIDIA driver');});
  t.mock.method(guards, 'displayAdapters', async () => ({name:'AMD Radeon RX 7800 XT', nvidiaPresent:false}));
  t.mock.method(guards, 'assertGameClosed', async () => {});
  await manager.detectHardwareEnvironment(true);
  const applied = await manager.applyCombinedConfiguration(gameDir, {exePath, payloadDir, route:'optifg',
    requirePayload: async request => assert.deepEqual(requiredPacks(request), [])});
  assert.equal(applied.ok, true);
  assert.equal(await digest(host), hostHash);
  const status = await manager.inspectCombinedStatus(gameDir, {exePath, payloadDir});
  assert.equal(status.graphicsRoute.route, 'optifg');
  assert.equal(status.graphicsRoute.filesPresent, true);
  assert.equal(status.neural.mode, 'off');
  assert.equal(status.diagnostics.combinedStatus, 'experimental');
  assert.equal(status.mfg.currentConfig.mode, 'host');
  await backends.restore(gameDir);
  assert.equal(await digest(xess), original);
  for (const name of ['dxgi.dll','OptiScaler.ini','nvngx_dlssnr.dll'])
    assert.equal(fs.existsSync(path.join(gameDir,name)), false, name);
});
