'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { writePe, writeNr } = require('./fixtures/pe');
const wuwa = require('../src/core/wuthering-waves');
const mfg = require('../src/core/mfg-manager');
const apply = require('../src/core/apply');
const { ComponentReview } = require('../src/core/component-review');
const preview = require('../src/core/preview-fs');
const { requiredPacks } = require('../src/core/runtime-payload');
const digest = (file, alg) => crypto.createHash(alg).update(fs.readFileSync(file)).digest('hex');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-kuro-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dir = path.join(temp, 'Game'),
    root = path.join(dir, 'Wuthering Waves Game'),
    payloadDir = path.join(temp, 'packs');
  const exe = writePe(path.join(root, 'Client/Binaries/Win64/Client-Win64-Shipping.exe'), {
    text: 'D3D12CreateDevice',
    size: 131072
  });
  fs.writeFileSync(path.join(root, 'Wuthering Waves.exe'), 'launcher');
  const bin = path.dirname(exe),
    src = writePe(path.join(payloadDir, 'MFGUnlocker.dll'));
  const sr = writePe(path.join(root, 'Engine/DLSS/nvngx_dlss.dll'), { version: [310, 5, 0, 0] });
  const fg = writePe(path.join(root, 'Engine/StreamlineCore/nvngx_dlssg.dll'), { version: [310, 6, 0, 0] });
  const resources = [exe, sr, fg].map((f) => ({
    dest: path.relative(root, f),
    size: fs.statSync(f).size,
    md5: digest(f, 'md5')
  }));
  fs.writeFileSync(path.join(root, 'LocalGameResources.json'), JSON.stringify({ resource: resources }));
  const original = mfg.MFG_UNLOCKERS;
  mfg.MFG_UNLOCKERS = {
    ...original,
    asiPlugin: { ...original.asiPlugin, relPath: 'MFGUnlocker.dll', sha256: digest(src, 'sha256') }
  };
  t.after(() => {
    mfg.MFG_UNLOCKERS = original;
  });
  const review = new ComponentReview(path.join(temp, 'profile')),
    scan = { chosen: { path: exe, bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' } };
  const configure = (patch) =>
    wuwa.configure(dir, root, scan, { payloadDir, hardwareProfile: 'rtx40_laptop', ...patch }, () => {});
  return { dir, root, bin, src, sr, fg, srcHash: digest(src, 'sha256'), review, configure, resources };
}

test('game status reports the native stack from launcher-listed files and ignores adjacent mod copies', async (t) => {
  const f = fixture(t);
  const index = path.join(f.root, 'LocalGameResources.json');
  const sl = writePe(path.join(f.root, 'Engine/StreamlineCore/sl.common.dll'), { version: [2, 13, 1, 0] });
  const rel = path.relative(f.root, sl);
  fs.writeFileSync(index, JSON.stringify({ resource: [...f.resources, {
    dest: rel, size: fs.statSync(sl).size, md5: digest(sl, 'md5')
  }] }));
  for (const name of ['sl.interposer.dll', 'nvngx_dlss.dll', 'nvngx_dlssg.dll']) {
    writePe(path.join(f.bin, name), { version: [9, 9, 9, 9] });
  }
  const status = await require('../src/core/combined-manager').inspectCombinedStatus(f.dir, {
    detectedHardware: { gpu: { name: 'NVIDIA GeForce RTX 4070 Laptop GPU', driver: '617.42' } },
    userDataDir: path.join(f.dir, '..', 'profile'),
    payloadDir: path.join(f.dir, '..', 'packs')
  });
  assert.equal(status.launcherProtected, true);
  assert.deepEqual(status.nativeRuntimeStack, {
    indexAvailable: true,
    sr: { rel: path.relative(f.root, f.sr), version: '310.5.0.0' },
    fg: { rel: path.relative(f.root, f.fg), version: '310.6.0.0' },
    streamline: { rel, version: '2.13.1.0' }
  });
  fs.unlinkSync(f.sr);
  writePe(f.fg);
  fs.writeFileSync(index, JSON.stringify({ resource: f.resources }));
  const changed = await wuwa.inspectNativeStack(f.root);
  assert.equal(changed.sr, undefined);
  assert.equal(changed.fg.version, null);
  assert.equal(changed.streamline, undefined);
  fs.unlinkSync(index);
  assert.deepEqual(await wuwa.inspectNativeStack(f.root), { indexAvailable: false });
});

test('stock SR and FG survive a confirmed proxy install, reconfiguration and restore', async (t) => {
  const f = fixture(t),
    request = { kind: 'enhanced', config: { mfgMode: 'x3' } };
  assert.equal(wuwa.gameRoot(f.dir), f.root);
  assert.equal(wuwa.gameRoot(f.root), f.root);
  const work = () => f.configure(request.config);
  const { preview: plan } = await f.review.run(f.dir, request, work);
  assert.deepEqual(
    plan.rows
      .filter((r) => r.action !== 'keep')
      .map((r) => path.basename(r.rel))
      .sort(),
    ['RTXMFG-Universal.json', 'version.dll']
  );
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  await f.review.run(f.dir, request, work, plan.token);
  assert.equal(wuwa.inspectProxy(f.bin).mfg.mode, 'x3');
  await f.configure({ mfgMode: 'off' });
  assert.equal(wuwa.inspectProxy(f.bin).mfg.mode, 'off');
  await apply.restore(f.dir);
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  for (const r of f.resources) assert.equal(digest(path.join(f.root, r.dest), 'md5'), r.md5);
});

test('default debug IPC prepares and repairs the proxy cache before previewing Wuthering Waves', async (t) => {
  const f = fixture(t);
  const vm = require('node:vm'), { createRequire } = require('node:module');
  const { RuntimePayload } = require('../src/core/runtime-payload');
  const profile = path.join(f.dir, '..', 'debug-profile');
  const pack = { id: 'mfg-universal', name: 'MFG fixture', bundled: true,
    contentId: f.srcHash, files: [{ path: 'MFGUnlocker.dll', size: fs.statSync(f.src).size, sha256: f.srcHash }] };
  const cache = new RuntimePayload(profile, { manifest: { schema: 1, packs: [pack] },
    bundledRoot: path.dirname(f.src), fetcher: () => { throw Error('offline test'); } });
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main), handlers = new Map();
  const env = { ...process.env }; delete env.DLSS5_LIGHTWEIGHT;
  const debugProcess = Object.create(process, { env: { value: env }, resourcesPath: { value: path.join(f.dir, '..', 'resources') } });
  const stubs = {
    electron: { app: { isPackaged: false, setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => profile },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    './src/core/combined-manager': { applyCombinedConfiguration: (dir, config) => f.configure(config) },
    './src/core/install-guards': { assertGameClosed: async () => {}, gpuInfo: async () => [], driverNeuralFault: () => false }
  };
  const context = vm.createContext({ require: id => stubs[id] || realRequire(id), __dirname: path.dirname(main),
    process: debugProcess, AbortController, Buffer, console, testCache: cache });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  vm.runInContext('runtimeCache = testCache', context);
  assert.equal(vm.runInContext('resolvePayloadRoot()', context), cache.payloadDir);
  const event = { sender: { send() {}, isDestroyed: () => false } };
  const operation = token => handlers.get('enhanced-apply')(event, f.dir, { mfgMode: 'x3' }, token);
  const missing = await operation();
  assert.equal(missing.code, 'errRuntimeComponents', JSON.stringify(missing));
  assert.deepEqual([...missing.dependencies], ['runtime:mfg-universal']);
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  const ready = await handlers.get('component-prepare')(event, missing.dependencies);
  assert.equal(ready.ok, true, JSON.stringify(ready));
  const source = path.join(cache.payloadDir, 'MFGUnlocker.dll');
  fs.unlinkSync(source); // Don't mutate the immutable store's hard link.
  fs.writeFileSync(source, Buffer.alloc(pack.files[0].size, 7));
  const corrupt = await operation();
  assert.equal(corrupt.code, 'errRuntimeComponents');
  assert.equal((await handlers.get('component-prepare')(event, corrupt.dependencies)).ok, true);
  const plan = await operation();
  assert.ok(plan.preview, JSON.stringify(plan));
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
  const installed = await operation(plan.preview.token);
  assert.equal(installed.ok, true, JSON.stringify(installed));
  assert.equal(digest(path.join(f.bin, 'version.dll'), 'sha256'), f.srcHash);
  for (const item of f.resources) assert.equal(digest(path.join(f.root, item.dest), 'md5'), item.md5);
});

test('RTXManager proxy and model are retained, its control fields survive and restore to the original bytes', async (t) => {
  const f = fixture(t),
    proxy = path.join(f.bin, 'version.dll'),
    control = path.join(f.bin, 'RTXMFG-Universal.json');
  fs.copyFileSync(f.src, proxy);
  const previous = JSON.stringify({
    version: 13,
    followGame: false,
    mode: 'fixed',
    multiplier: 4,
    dlss5: false,
    unknownField: 32
  });
  fs.writeFileSync(control, previous);
  const receipt = path.join(f.bin, '.rtx-fg-v3/install.json');
  fs.mkdirSync(path.dirname(receipt));
  fs.writeFileSync(
    receipt,
    JSON.stringify({
      backend: 'rtx40mfg',
      proxy: 'version.dll',
      hashes: { 'version.dll': f.srcHash, 'RTXMFG-Universal.json': 'initial' }
    })
  );
  const req = [];
  await f.configure({ mfgMode: 'x3', requirePayload: async (o) => req.push(...requiredPacks(o)) });
  assert.deepEqual(req, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(control)), { ...JSON.parse(previous), multiplier: 3 });
  await apply.restore(f.dir);
  assert.equal(fs.readFileSync(control, 'utf8'), previous);
  assert.equal(digest(proxy, 'sha256'), f.srcHash);
  assert.equal(apply.recoverableManifest(f.dir), null);
  const model = path.join(f.bin, 'nvngx_dlssnr.dll');
  fs.writeFileSync(model, 'external model');
  fs.mkdirSync(path.join(f.bin, '.rtx-fg-nr'));
  fs.writeFileSync(path.join(f.bin, '.rtx-fg-nr/ownership.json'), '{}');
  const rel = path.relative(f.dir, model);
  assert.deepEqual(
    wuwa.restoreManifest(
      f.dir,
      {
        game: { exe: path.relative(f.dir, path.join(f.bin, 'Client-Win64-Shipping.exe')) },
        replaced: [],
        added: [rel]
      },
      true
    ).added,
    []
  );
});

function externalNr(t) {
  const f = fixture(t);
  const model = writeNr(path.join(f.bin, 'nvngx_dlssnr.dll'), '310.9.0.0', 120);
  const compatible = writeNr(path.join(path.dirname(f.src), 'streamline/nvngx_dlssnr.dll'));
  const modelHash = digest(model, 'sha256'), nextHash = digest(compatible, 'sha256');
  const owner = path.join(f.bin, '.rtx-fg-nr/ownership.json');
  fs.mkdirSync(path.dirname(owner));
  const original = path.join(path.dirname(owner), 'original.dll');
  fs.writeFileSync(original, 'game model before RTXManager');
  const record = { schema: 1, game: path.join(f.bin, 'Client-Win64-Shipping.exe'), directory: f.bin,
    installed: modelHash, previous: null, original: digest(original, 'sha256') };
  const originalReceipt = JSON.stringify(record, null, 4);
  fs.writeFileSync(owner, originalReceipt);
  fs.copyFileSync(f.src, path.join(f.bin, 'version.dll'));
  const control = path.join(f.bin, 'RTXMFG-Universal.json');
  const originalControl = '{"followGame":false,"mode":"fixed","multiplier":4,"dlss5":false,"hud":true}';
  fs.writeFileSync(control, originalControl);
  const config = { neuralMode: 'latest_compatible', neuralModelId: 'custom-' + nextHash.slice(0, 12),
    mfgMode: 'x4', gpuName: 'NVIDIA GeForce RTX 4070 Laptop GPU' };
  return { ...f, compatible, model, modelHash, nextHash, original, owner, record, originalReceipt, control, originalControl, config };
}

test('standalone hardware presets translate enums, preserve unrelated controls and never change launcher assets', async t => {
  const f = externalNr(t);
  let beforeInstall;
  for (const [hardwareProfile, scale] of [['rtx40_laptop', 75], ['rtx40_desktop', 100], ['rtx50_desktop', 100]]) {
    const old = JSON.parse(fs.readFileSync(f.control));
    fs.writeFileSync(f.control, JSON.stringify({ ...old, dlss5ResolutionScale: 42,
      dlss5UiCorrection: 2, dlss5CharacterMask: true, dlss5Boost: true, customHotkey: 115 }));
    beforeInstall ??= fs.readFileSync(f.control, 'utf8');
    await f.configure({ ...f.config, mfgMode: undefined, hardwareProfile });
    const saved = JSON.parse(fs.readFileSync(f.control));
    assert.equal(saved.dlss5ResolutionScale, scale);
    assert.equal(saved.dlss5ResolutionScaleAuto, false);
    assert.equal(saved.dlss5HookStage, 2, 'After SR is 2 in the standalone protocol');
    assert.equal(saved.dlss5UiCorrection, 1, 'Off is 1, not RenoDX 0 (which means Auto here)');
    assert.equal(saved.dlss5UpsampleFilter, 3);
    assert.equal(saved.dlss5CharacterMask, false);
    assert.equal(saved.dlss5Boost, false);
    assert.equal(saved.dlss5PassCount, 1);
    assert.equal(saved.dlss5DefaultsVersion, 3);
    assert.equal(saved.dlss5OverallIntensity, 1);
    assert.equal(saved.customHotkey, 115);
    assert.equal(saved.multiplier, 4, 'NR-only apply must preserve FG');
    assert.equal(saved.mode, 'fixed');
    assert.equal(Object.keys(saved).some(k => /workset|qualityguard|temporalfix/i.test(k)), false);
    for (const item of f.resources) assert.equal(digest(path.join(f.root, item.dest), 'md5'), item.md5);
  }
  await f.configure({ mfgMode: 'dynamic' });
  assert.equal(wuwa.inspectProxy(f.bin).mfg.mode, 'dynamic');
  assert.equal(wuwa.inspectProxy(f.bin).mfg.settings.dynamicTargetFrameRate, 0);
  assert.equal(wuwa.inspectProxy(f.bin).mfg.settings.dlss5ResolutionScale, 100, 'FG-only apply preserves NR');
  for (const mode of ['x5', 'follow', 'off']) {
    await f.configure({ mfgMode: mode });
    assert.equal(wuwa.inspectProxy(f.bin).mfg.mode, mode, 'never read dynamic/5x/follow as off');
  }
  await apply.restore(f.dir);
  assert.equal(fs.readFileSync(f.control, 'utf8'), beforeInstall);
  for (const item of f.resources) assert.equal(digest(path.join(f.root, item.dest), 'md5'), item.md5);
});

test('both features use one preview and restore the exact pre-existing RTXManager setup', async (t) => {
  const f = externalNr(t), request = {kind: 'enhanced', config: f.config};
  const work = () => f.configure(f.config);
  const {preview: plan} = await f.review.run(f.dir, request, work);
  assert.deepEqual(plan.rows.filter(row => row.action !== 'keep').map(row => path.basename(row.rel)).sort(),
    ['RTXMFG-Universal.json', 'nvngx_dlssnr.dll', 'ownership.json']);
  assert.equal(fs.readFileSync(f.owner, 'utf8'), f.originalReceipt);
  await f.review.run(f.dir, request, work, plan.token);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.owner)), {...f.record, installed: f.nextHash, previous: f.modelHash});
  assert.equal(digest(f.model, 'sha256'), f.nextHash);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.control)), {...JSON.parse(f.originalControl),
    ...require('../src/core/wuwa-profile').neuralSettings('rtx40_laptop'), dlss5: true});
  const second = await f.review.run(f.dir, request, work);
  assert.ok(second.preview.rows.every(row => row.action === 'keep'));
  await f.review.run(f.dir, request, work, second.preview.token);
  const restore = () => apply.restore(f.dir);
  const {preview: undo} = await f.review.run(f.dir, {kind:'restore'}, restore);
  await f.review.run(f.dir, {kind:'restore'}, restore, undo.token);
  assert.equal(digest(f.model, 'sha256'), f.modelHash);
  assert.equal(fs.readFileSync(f.owner, 'utf8'), f.originalReceipt);
  assert.equal(fs.readFileSync(f.control, 'utf8'), f.originalControl);
  assert.equal(digest(f.original, 'sha256'), f.record.original);
  assert.equal(apply.recoverableManifest(f.dir), null);
  for (const item of f.resources) assert.equal(digest(path.join(f.root, item.dest), 'md5'), item.md5);
});

test('restore keeps a model that RTXManager changed or removed after the joint install', async (t) => {
  for (const remove of [true, false]) {
    const f = externalNr(t);
    await f.configure(f.config);
    if (remove) {
      fs.unlinkSync(f.owner);
      fs.unlinkSync(f.model);
    } else {
      fs.writeFileSync(f.model, 'later RTXManager model');
      fs.writeFileSync(f.owner, JSON.stringify({...f.record, installed: digest(f.model,'sha256')}));
    }
    const laterControl = JSON.stringify({dlss5:false, mode:'fixed', multiplier:3});
    fs.writeFileSync(f.control, laterControl);
    await apply.restore(f.dir);
    assert.equal(fs.readFileSync(f.control,'utf8'), laterControl);
    assert.equal(fs.existsSync(f.model), !remove);
    assert.equal(fs.existsSync(f.owner), !remove);
    if (!remove) {
      assert.equal(fs.readFileSync(f.model,'utf8'), 'later RTXManager model');
      assert.equal(JSON.parse(fs.readFileSync(f.owner)).installed, digest(f.model,'sha256'));
    }
  }
});

test('mismatched receipts, failed model writes and unrelated component operations preserve external files', async (t) => {
  const f = externalNr(t);
  fs.writeFileSync(f.owner, JSON.stringify({...f.record, directory: path.dirname(f.bin)}));
  await assert.rejects(f.configure(f.config), /归属记录已变化/);
  fs.writeFileSync(f.owner, f.originalReceipt);
  const copy = t.mock.method(apply, 'copyTracked', async () => { throw Error('injected disk error'); });
  await assert.rejects(f.configure(f.config), /injected disk error/);
  copy.mock.restore();
  assert.equal(fs.readFileSync(f.owner, 'utf8'), f.originalReceipt);
  assert.equal(digest(f.model, 'sha256'), f.modelHash);
  assert.equal(fs.readFileSync(f.control, 'utf8'), f.originalControl);
  for (const file of [f.model, f.owner])
    await assert.rejects(f.review.run(f.dir, {kind:'enhanced'}, () => preview.fs.writeFileSync(file, 'unknown')), /RTXManager 管理/);
  await assert.rejects(f.review.run(f.dir, {kind:'enhanced'}, async () => {
    await f.configure(f.config);
    preview.fs.writeFileSync(f.model, 'unexpected component override');
  }), /RTXManager 管理/);
});

test('the shared Win32 game lock prevents overlapping confirmations', { skip: process.platform !== 'win32' }, async t => {
  const f = externalNr(t);
  await wuwa.withRtxLock(f.dir, () =>
    assert.rejects(wuwa.withRtxLock(f.dir, () => assert.fail('overlapping game operation')), /RTXManager 正在操作/)
  );
  assert.equal(await wuwa.withRtxLock(f.dir, () => 'released'), 'released');
});

test('restore can complete an interrupted first switch from the original model and ownership snapshots', async t => {
  const f = externalNr(t);
  const folder = '_DLSS5_Backup/.transactions/1234-abcd';
  fs.mkdirSync(path.join(f.dir, folder), {recursive:true});
  const files = [f.owner, f.model].map((file, i) => {
    const snapshot = folder + '/' + i + '.bin';
    fs.copyFileSync(file, path.join(f.dir, snapshot));
    return {rel:path.relative(f.dir,file), existed:true, snapshot};
  });
  fs.writeFileSync(require('../src/core/file-journal').pendingPath(f.dir),
    JSON.stringify({version:1,folder,files,dirs:[]}));
  fs.writeFileSync(f.owner, JSON.stringify({...f.record, installed:f.nextHash}));
  fs.copyFileSync(f.compatible, f.model);
  const recover = async () => {
    const restored = await require('../src/core/backend-manager').restore(f.dir);
    return {ok:restored,inventoryManifest:null};
  };
  const {preview: plan} = await f.review.run(f.dir, {kind:'restore'}, recover);
  await f.review.run(f.dir, {kind:'restore'}, recover, plan.token);
  assert.equal(fs.readFileSync(f.owner,'utf8'), f.originalReceipt);
  assert.equal(digest(f.model,'sha256'), f.modelHash);
});

test('classic installs and component overrides cannot replace an official resource', async (t) => {
  const f = fixture(t),
    before = digest(f.sr, 'md5');
  for (const kind of ['install', 'component-update', 'component-rollback']) {
    await assert.rejects(
      f.review.run(f.dir, { kind }, async () => {
        preview.fs.copyFileSync(f.src, f.sr);
        return { ok: true };
      }),
      /启动器校验的文件/
    );
  }
  assert.equal(digest(f.sr, 'md5'), before);
  fs.appendFileSync(f.fg, 'old patch');
  await assert.rejects(f.configure({ mfgMode: 'x4' }), /原版 DLSS 文件已改变/);
  assert.equal(fs.existsSync(path.join(f.bin, 'version.dll')), false);
});

test('occupied loader and unreadable official index do not start a deployment', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.bin, 'version.dll'), 'foreign proxy');
  await assert.rejects(f.configure({ mfgMode: 'x2' }), /其他插件占用/);
  fs.writeFileSync(path.join(f.root, 'LocalGameResources.json'), '{');
  await assert.rejects(f.configure({ mfgMode: 'x2' }), /启动器的资源清单/);
  assert.equal(fs.existsSync(path.join(f.dir, '_DLSS5_Backup')), false);
});

test('restoring a pre-protection install keeps a later official game update', async (t) => {
  const f = fixture(t),
    exe = path.join(f.bin, 'Client-Win64-Shipping.exe');
  const m = apply.beginManifest(f.dir, exe, 'dxgi');
  const journal = require('../src/core/file-journal');
  await journal.transaction(f.dir, () => apply.copyTracked(m, f.dir, f.src, f.sr, { kind: 'runtime' }));
  const original = f.resources.find((r) => r.dest.endsWith('nvngx_dlss.dll'));
  await apply.restore(f.dir);
  assert.equal(digest(f.sr, 'md5'), original.md5);
  const legacy = apply.beginManifest(f.dir, exe, 'dxgi');
  await journal.transaction(f.dir, () => apply.copyTracked(legacy, f.dir, f.src, f.sr, { kind: 'runtime' }));
  fs.appendFileSync(f.sr, 'official game update');
  Object.assign(original, { size: fs.statSync(f.sr).size, md5: digest(f.sr, 'md5') });
  fs.writeFileSync(path.join(f.root, 'LocalGameResources.json'), JSON.stringify({ resource: f.resources }));
  await apply.restore(f.dir);
  assert.equal(digest(f.sr, 'md5'), original.md5);
});
