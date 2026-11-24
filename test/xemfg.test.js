'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writePe, writeNr, writeProvider } = require('./fixtures/pe');
const { root: payloadDir } = require('./fixtures/payload');
const backends = require('../src/core/backend-manager');
const xemfg = require('../src/core/xemfg');
const graphics = require('../src/core/optional-graphics');
const { ComponentReview } = require('../src/core/component-review');

function game(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-xemfg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'game');
  const exePath = writePe(path.join(gameDir, 'bin/game.exe'), { text: 'D3D12CreateDevice' });
  const bin = path.dirname(exePath);
  const control = path.join(bin, 'RTXMFG-Universal.json');
  const options = { gameDir, exePath, payloadDir, userDataDir: path.join(root, 'profile'), gpuName: 'AMD Radeon RX 7800 XT',
    route: 'xemfg', bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', target: { hasXeMfgDx12Upscaler: true } };
  return { gameDir, exePath, bin, control, options, read: () => JSON.parse(fs.readFileSync(control, 'utf8')),
    save: data => fs.writeFileSync(control, JSON.stringify(data)),
    inspect: () => graphics.inspect(gameDir, backends.readManifest(gameDir)) };
}

test('RTX 1.7.2 game-switch mode removes the compatibility override and restores individual JSON fields',async t=>{
  const f=game(t);
  const target={...f.options.target,hasGameStreamlineFg:true};
  const install=(mode,gpuName='NVIDIA GeForce RTX 3070',apiLabel='DirectX 12')=>
    backends.install({...f.options,target,gpuName,apiLabel,graphics:{xeMode:mode}});
  f.save({multiplier:1,mode:'follow',followGame:true,xemfgStreamline:1,custom:7});
  await assert.rejects(install('compatibility','AMD Radeon RX 6800'),/RTX/);
  await assert.rejects(install('compatibility',undefined,'DirectX 11'));
  await install('compatibility');
  assert.equal(f.read().xemfgStreamline,2);
  assert.equal(f.inspect().xeMode,'compatibility');
  await install('auto');
  assert.ok(!Object.hasOwn(f.read(),'xemfgStreamline'));
  f.save({...f.read(),custom:9});
  assert.ok(await backends.restore(f.gameDir));
  assert.deepEqual(f.read(),{multiplier:1,mode:'follow',followGame:true,xemfgStreamline:1,custom:9});
});

test('standalone XeMFG release binaries and licenses survive preview, install, menu tuning, repair and restore', async t => {
  const f = game(t);
  const reviews = new ComponentReview(f.options.userDataDir);
  const request = { kind: 'enhanced', config: { route: 'xemfg', exePath: f.exePath } };
  const run = token => reviews.run(f.gameDir, request, async () => ({ ok: true, manifest: await backends.install(f.options) }), token);
  const { preview } = await run();
  assert.ok(preview.rows.some(row => row.rel.endsWith('libxess_fg.dll')));
  assert.ok(!preview.rows.some(row => /nvngx|optiscaler|reshade/i.test(row.rel)));
  assert.equal(fs.existsSync(f.control), false);
  assert.ok((await run(preview.token)).ok);
  assert.deepEqual(f.read(), { followGame: true, mode: 'follow', multiplier: 1, xemfgStandalone: 1, xemfgFrames: 2, xemfgDynamic: 0 });
  const sdk = path.join(f.bin, 'RTXMFG-XeSS');
  assert.deepEqual(fs.readdirSync(sdk).sort(), ['LICENSE.txt', 'libxell.dll', 'libxess_fg.dll', 'third-party-programs.txt'].sort());
  assert.ok(fs.existsSync(path.join(f.bin, 'MFG-Unlocker-LICENSE.txt')));
  assert.equal(f.inspect().providerVersion, '1.7.2');
  f.save({ ...f.read(), xemfgStandalone: 0, xemfgDynamic: 1, xemfgFrames: 5, latencyPacing: 2 });
  const edited = fs.readFileSync(f.control);
  await backends.install(f.options);
  assert.deepEqual(fs.readFileSync(f.control), edited);
  assert.equal(f.inspect().enabled, false);
  assert.equal(f.inspect().dynamic, true);
  const ell = path.join(sdk, 'libxell.dll');
  fs.unlinkSync(ell);
  assert.equal(f.inspect().filesPresent, false);
  assert.equal(f.inspect().providerVersion, undefined);
  await backends.install({ ...f.options, graphics: { multiplier: 6 } });
  assert.ok(f.inspect().filesPresent);
  assert.equal(f.inspect().enabled, true);
  assert.equal(f.inspect().dynamic, false);
  assert.equal(f.inspect().multiplier, 6);
  assert.equal(f.read().multiplier, 1);
  assert.equal(f.read().latencyPacing, 2);
  const other = writePe(path.join(f.gameDir, 'second.exe'));
  await assert.rejects(xemfg.install({ ...f.options, exePath: other }), /所选游戏程序/);
  await backends.restore(f.gameDir);
  assert.equal(fs.existsSync(sdk), false);
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  assert.deepEqual(f.read(), { xemfgStandalone: 0, xemfgFrames: 5, xemfgDynamic: 1, latencyPacing: 2, followGame: true, multiplier: 1 });
});

test('standalone XeMFG reuses matching external files and restores the exact external control when untouched', async t => {
  const f = game(t);
  const proxy = path.join(f.bin, 'version.dll');
  const ell = path.join(f.bin, 'RTXMFG-XeSS/libxell.dll');
  fs.mkdirSync(path.dirname(ell));
  fs.copyFileSync(path.join(payloadDir, 'enhanced/mfg/MFGUnlocker.dll'), proxy);
  fs.copyFileSync(path.join(payloadDir, 'enhanced/xemfg-intel/libxell.dll'), ell);
  const original = '{\r\n  "followGame": true, "multiplier": 1, "dlss5": false, "xemfgFrames": 3, "custom": "留存"\r\n}';
  fs.writeFileSync(f.control, original);
  const receipt = await backends.install({ ...f.options, graphics: { multiplier: 4 } });
  assert.equal(f.inspect().multiplier, 4);
  assert.ok(!Object.hasOwn(receipt.graphicsRoute.files, path.relative(f.gameDir, proxy)));
  assert.ok(!Object.hasOwn(receipt.graphicsRoute.files, path.relative(f.gameDir, ell)));
  assert.ok(!receipt.replaced.some(item => item.rel.endsWith('version.dll')));
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(f.control, 'utf8'), original);
  assert.ok(fs.existsSync(proxy) && fs.existsSync(ell));
  await backends.install(f.options);
  f.save({ ...f.read(), custom: '菜单编辑', xemfgFrames: 5 });
  await backends.restore(f.gameDir);
  assert.equal(f.read().custom, '菜单编辑');
  assert.equal(f.read().xemfgFrames, 5);
  assert.equal(f.read().xemfgStandalone, undefined);
  assert.ok(fs.existsSync(proxy) && fs.existsSync(ell));
});

test('standalone XeMFG refuses conflicts, protected targets, bad inputs and accidental NVIDIA settings before writing', async t => {
  const f = game(t);
  const proxy = path.join(f.bin, 'version.dll');
  for (const options of [
    { api: 'vulkan', target: { hasNativeDlssFg: true } },
    { apiLabel: 'DirectX 11' }, { bitness: 32 }, { target: { emulator: true } }, { target: {} },
    { target: { ...f.options.target, antiCheatWarning: true } }, { target: { ...f.options.target, launcherProtected: true } },
    ...[1, 7, 3.5, '3', null].map(multiplier => ({ graphics: { multiplier } })),
    { graphics: { neural: true } }, { graphics: { engine: 'DLSS' } },
  ]) await assert.rejects(xemfg.install({ ...f.options, ...options }), /XeMFG/);
  const marker = path.join(f.bin, 'EasyAntiCheat');
  fs.mkdirSync(marker);
  await assert.rejects(xemfg.install({ ...f.options, antiCheatAcknowledged: true }), /反作弊/);
  fs.rmdirSync(marker);
  for (const name of ['OptiScaler.ini', 'MFGUnlocker.asi', 'version.dll', 'RTXMFG-XeSS/libxess_fg.dll']) {
    const file = path.join(f.bin, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'external');
    await assert.rejects(xemfg.install(f.options), /目标已由/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'external');
    fs.unlinkSync(file);
  }
  const existingLoader = path.join(f.bin, 'winmm.dll');
  fs.copyFileSync(path.join(payloadDir, 'enhanced/mfg/MFGUnlocker.dll'), existingLoader);
  await assert.rejects(xemfg.install(f.options), /winmm.dll/);
  fs.unlinkSync(existingLoader);
  const anrLoader = path.join(f.bin, 'dxgi.dll');
  fs.copyFileSync(path.join(payloadDir, 'enhanced/anr/dxgi.dll'), anrLoader);
  await assert.rejects(xemfg.install(f.options), /dxgi.dll/);
  fs.unlinkSync(anrLoader);
  for (const txt of ['{', '{"multiplier":1,"multiplier":2}', '{"multiplier":1,"dlss5":true}',
    '{"mode":"dynamic","multiplier":3}', '{"multiplier":2,"private":{}}', '{"multiplier":1,"xemfgDynamic":true}', ' '.repeat(4100)]) {
    fs.writeFileSync(f.control, txt);
    await assert.rejects(xemfg.install(f.options));
    assert.equal(fs.readFileSync(f.control, 'utf8'), txt);
  }
  const invalidEncoding = Buffer.concat([Buffer.from('{"multiplier":1,"label":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  fs.writeFileSync(f.control, invalidEncoding);
  await assert.rejects(xemfg.install(f.options), /UTF-8/);
  assert.deepEqual(fs.readFileSync(f.control), invalidEncoding);
  assert.equal(fs.existsSync(proxy), false);
  assert.equal(backends.readManifest(f.gameDir), null);
});

test('XeMFG verifies release bytes, diagnoses changed files and leaves edited unparseable control intact', async t => {
  const f = game(t);
  await assert.rejects(xemfg.install({ ...f.options, payloadDir: f.bin }), error => error.dependencies?.includes('runtime:mfg-universal'));
  assert.equal(fs.existsSync(f.control), false);
  await backends.install(f.options);
  const proxy = path.join(f.bin, 'version.dll');
  const data = fs.readFileSync(proxy);
  const changed = Buffer.from(data);
  changed[0] ^= 0xff;
  fs.writeFileSync(proxy, changed);
  assert.equal(f.inspect().filesPresent, false);
  assert.equal(f.inspect().providerVersion, undefined);
  await assert.rejects(backends.install(f.options), /文件已变化/);
  await assert.rejects(backends.restore(f.gameDir), /文件已变化/);
  fs.writeFileSync(proxy, data);
  fs.writeFileSync(f.control, 'external text');
  assert.equal(f.inspect().multiplier, null);
  assert.match(f.inspect().error, /JSON/);
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(f.control, 'utf8'), 'external text');
  assert.equal(fs.existsSync(proxy), false);
});

test('combined AMD XeMFG setup and status use a scanned XeSS SR input, keep menu modes, and ignore inactive NVIDIA NR', async t => {
  const f = game(t);
  const guards = require('../src/core/install-guards');
  const combined = require('../src/core/combined-manager');
  const { scanGame } = require('../src/core/scan');
  t.mock.method(guards, 'queryNvidiaSmi', async () => { throw Error('no NVIDIA device'); });
  t.mock.method(guards, 'displayAdapters', async () => ({ name: f.options.gpuName, nvidiaPresent: false }));
  t.mock.method(guards, 'assertGameClosed', async () => {});
  const hardware = await combined.detectHardwareEnvironment(true);
  const sr = path.join(f.bin, 'libxess.dll');
  writeProvider(sr, ['xessD3D12Execute', 'xessGetVersion']);
  const nr = writeNr(path.join(f.bin, 'nvngx_dlssnr.dll'));
  const originals = new Map([sr, nr, f.exePath].map(file => [file, fs.readFileSync(file)]));
  const initial = await scanGame(f.gameDir, f.exePath);
  assert.equal(initial.chosen.hasXeMfgDx12Upscaler, true);
  assert.equal(initial.chosen.hasNativeDlssFg, false);
  assert.equal(initial.chosen.hasNativeDlss, false);
  const prepared = [];
  const config = { exePath: f.exePath, route: 'xemfg', payloadDir, userDataDir: f.options.userDataDir,
    requirePayload: async request => prepared.push(request.route) };
  const inspect = detectedHardware => combined.inspectCombinedStatus(f.gameDir, { ...config, detectedHardware });
  assert.ok((await combined.applyCombinedConfiguration(f.gameDir, { ...config, mfgMode: 'x4', neuralMode: 'latest_compatible' })).ok);
  let s = await inspect(hardware);
  assert.equal(s.graphicsRoute.providerVersion, '1.7.2');
  assert.equal(s.mfg.currentConfig.mode, 'x2');
  assert.equal(s.mfg.currentConfig.multiplier, 2);
  assert.equal(s.neural.installed, false);
  assert.equal(s.neural.mode, 'off');
  assert.equal(s.diagnostics.combinedStatus, 'experimental');
  // A mismatched NVIDIA model can be present beside this exe without a
  // consumer. Its own compatibility check must not override XeMFG's status.
  const mismatch = await inspect({ ...hardware, gpu: { ...hardware.gpu, name: 'NVIDIA GeForce RTX 2060', nvidiaPresent: true } });
  assert.equal(mismatch.neural.overallStatus, 'incompatible');
  assert.equal(mismatch.neural.installed, false);
  assert.equal(mismatch.diagnostics.combinedStatus, 'experimental');
  assert.equal(mismatch.diagnostics.combinedBadge, s.diagnostics.combinedBadge);
  f.save({ ...f.read(), xemfgDynamic: 1, xemfgFrames: 5 });
  assert.ok((await combined.applyCombinedConfiguration(f.gameDir, config)).ok);
  s = await inspect(hardware);
  assert.equal(s.mfg.currentConfig.mode, 'dynamic');
  assert.equal(s.mfg.currentConfig.multiplier, null);
  assert.equal(s.graphicsRoute.multiplier, 5);
  f.save({ ...f.read(), xemfgStandalone: 0 });
  s = await inspect(hardware);
  assert.equal(s.mfg.currentConfig.mode, 'off');
  assert.equal(s.mfg.currentConfig.multiplier, null);
  assert.ok((await combined.applyCombinedConfiguration(f.gameDir, { ...config, graphics: { multiplier: 4 } })).ok);
  s = await inspect(hardware);
  assert.equal(s.mfg.currentConfig.mode, 'x4');
  assert.equal(s.mfg.currentConfig.multiplier, 4);
  assert.deepEqual(prepared, ['xemfg', 'xemfg', 'xemfg']);
  assert.equal(f.read().multiplier, 1);
  assert.equal(f.read().dlss5, undefined);
  await backends.restore(f.gameDir);
  for (const [file, original] of originals) assert.deepEqual(fs.readFileSync(file), original);
  s = await inspect(hardware);
  assert.equal(s.graphicsRoute, null);
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  assert.equal(fs.existsSync(path.join(f.bin, 'RTXMFG-XeSS')), false);
});
