'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { writePe } = require('./fixtures/pe');
const combined = require('../src/core/combined-manager');
const apply = require('../src/core/apply');
const mfg = require('../src/core/mfg-manager');
const journal = require('../src/core/file-journal');
const previewFs = require('../src/core/preview-fs');
const vulkan = require('../src/core/vulkan-layer');
const payload = require('./fixtures/payload').root;
test.beforeEach(t => require('./fixtures/payload').use(t));
const config = { apiOverride: 'd3d12', hardwareProfile: 'rtx40_laptop', neuralMode: 'latest_compatible', mfgMode: 'x3' };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-combined-tx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game'), profile = path.join(root, 'Profile');
  fs.mkdirSync(game);
  const exe = writePe(path.join(game, 'Game.exe'), { bitness: 64, text: 'D3D12CreateDevice', size: 131072 });
  const original = writePe(path.join(game, 'nvngx_dlss.dll'), { bitness: 64, version: [2, 3, 0, 0] });
  const before = hash(original);
  function assertRestored() {
    assert.deepEqual(fs.readdirSync(game).filter(name => name !== '_DLSS5_Backup').sort(), ['Game.exe', 'nvngx_dlss.dll']);
    assert.equal(hash(original), before);
    assert.ok(!fs.existsSync(path.join(game, '_DLSS5_Backup/manifest.json')));
    assert.ok(!fs.existsSync(journal.pendingPath(game)));
    const backups = apply.backupRoot(game);
    if (fs.existsSync(backups)) {
      assert.equal(fs.readdirSync(backups, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length, 0);
    }
  }
  return { root, game, profile, exe, assertRestored };
}

test('an MFG failure after NR deployment restores the entire combined operation', async t => {
  const f = fixture(t);
  t.mock.method(mfg, 'applyMfgConfiguration', async () => {
    assert.ok(fs.existsSync(path.join(f.game, 'nvngx_dlssnr.dll')));
    assert.ok(fs.existsSync(path.join(f.game, 'renodx-dlss5.addon64')));
    throw Object.assign(new Error('MFG file locked'), { code: 'EBUSY' });
  });
  await assert.rejects(combined.applyCombinedConfiguration(f.game, {
    ...config, payloadDir: payload, userDataDir: f.profile
  }), { code: 'EBUSY' });
  f.assertRestored();
});

test('confirmed enhanced IPC rolls back NR and MFG if a selected component fails its final verification', async t => {
  const f = fixture(t), handlers = new Map();
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main);
  const electron = { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => f.profile },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
  const sr = path.join(payload, 'streamline/nvngx_dlss.dll');
  const component = { id: 'test-sr', component: 'dlss-sr', files: [{ rel: 'nvngx_dlss.dll', sha256: hash(sr), bitness: 64 }] };
  let checks = 0;
  const library = {
    profile: () => ({ selected: { 'dlss-sr': component.id } }),
    package: () => component, directory: () => path.dirname(sr), compatibility: () => ({ ready: true }),
    verify: async () => {
      if (!previewFs.active() && ++checks === 2) {
        assert.ok(fs.existsSync(path.join(f.game, 'renodx-dlss5.addon64')));
        assert.ok(fs.existsSync(path.join(f.game, 'renodx-mfgunlock.addon64')));
        throw Object.assign(new Error('selected file changed'), { code: 'EBUSY' });
      }
    }
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : realRequire(name),
    __dirname: path.dirname(main), process: require('./fixtures/offline-process')(), Buffer, console, library
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  vm.runInContext('unifiedComponents = library', context);
  const run = token => handlers.get('enhanced-apply')({ sender: { send() {} } }, f.game, config, token);
  const plan = await run();
  assert.ok(plan.preview?.token, JSON.stringify(plan));
  f.assertRestored();
  assert.equal((await run(plan.preview.token)).code, 'EBUSY');
  f.assertRestored();
  assert.equal(handlers.get('history')().rows.length, 0);
});

for (const [name, mfgMode] of [['NR alone', undefined], ['NR and MFG', 'x3']]) {
  test('Vulkan ' + name + ' preserves the pre-existing ReShade DXGI for full restore', async t => {
    const f = fixture(t), dxgi = path.join(f.game, 'dxgi.dll');
    fs.copyFileSync(path.join(payload, 'reshade-vulkan', 'ReShade64.dll'), dxgi);
    const original = hash(dxgi);
    t.mock.method(vulkan, 'register', async () => ({ owned: false, global: true }));
    const result = await combined.applyCombinedConfiguration(f.game, {
      ...config, apiOverride: 'vulkan', mfgMode, payloadDir: payload, userDataDir: f.profile
    });
    assert.equal(result.ok, true);
    assert.ok(!fs.existsSync(dxgi));
    const manifest = require('../src/core/backend-manager').readManifest(f.game);
    assert.ok(manifest.replaced.some(item => item.rel === 'dxgi.dll'));
    assert.equal(hash(apply.originalPath(f.game, manifest, 'dxgi.dll')), original);
    await apply.restore(f.game);
    assert.equal(hash(dxgi), original);
  });
}

test('Vulkan failure keeps the managed DXGI record and a successful retry retires only the old file', async t => {
  const f = fixture(t), dxgi = path.join(f.game, 'dxgi.dll');
  fs.copyFileSync(path.join(payload, 'reshade-vulkan', 'ReShade64.dll'), dxgi);
  const original = hash(dxgi), manifest = apply.beginManifest(f.game, f.exe, 'dxgi');
  manifest.added = ['dxgi.dll'];
  manifest.reshade = { file: 'dxgi.dll', installedByUs: true, filesAdded: ['dxgi.dll'] };
  await apply.saveActiveManifest(f.game, manifest);
  t.mock.method(vulkan, 'register', async () => ({ owned: false, global: true }));
  const run = () => combined.applyCombinedConfiguration(f.game, {
    ...config, apiOverride: 'vulkan', payloadDir: payload, userDataDir: f.profile
  });
  const unlink = fs.promises.unlink;
  const lock = t.mock.method(fs.promises, 'unlink', async file => {
    if (file === dxgi) throw Object.assign(new Error('locked DXGI'), { code: 'EBUSY' });
    return unlink(file);
  });
  await assert.rejects(run(), { code: 'EBUSY' });
  assert.equal(hash(dxgi), original);
  assert.deepEqual(require('../src/core/backend-manager').readManifest(f.game), manifest);
  lock.mock.restore();
  await run();
  const deployed = require('../src/core/backend-manager').readManifest(f.game);
  assert.ok(!deployed.added.includes('dxgi.dll'));
  assert.ok(!deployed.replaced.some(item => item.rel === 'dxgi.dll'));
  fs.writeFileSync(dxgi, 'user replacement after install');
  await apply.restore(f.game);
  assert.equal(fs.readFileSync(dxgi, 'utf8'), 'user replacement after install');
});

test('nested steps share the owner while unrelated transactions and recovery are rejected', async t => {
  const f = fixture(t), value = path.join(f.game, 'tuning.ini');
  fs.writeFileSync(value, 'original');
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const operation = journal.group(f.game, async () => {
    for (const text of ['stage A', 'stage B']) {
      await journal.transaction(f.game, async () => {
        await journal.capture(f.game, value);
        fs.writeFileSync(value, text);
      });
    }
    entered();
    await resume;
    return { ok: false, code: 'cancelled' };
  });
  await waiting;
  try {
    assert.equal(fs.readFileSync(value, 'utf8'), 'stage B');
    assert.equal(journal.hasPendingRecovery(f.game), true);
    await assert.rejects(journal.transaction(f.game, () => {}), { code: 'errJobBusy' });
    await assert.rejects(journal.capture(f.game, value), { code: 'errJobBusy' });
    await assert.rejects(journal.recover(f.game), { code: 'errJobBusy' });
  } finally { release(); }
  assert.equal((await operation).ok, false);
  assert.equal(fs.readFileSync(value, 'utf8'), 'original');
  assert.ok(!fs.existsSync(journal.pendingPath(f.game)));
});

test('shared Vulkan registration runs after local stages and retains its cleanup manifest on registry failure', async t => {
  const f = fixture(t), source = path.join(f.root, 'source'), shared = path.join(f.profile, 'reshade-vulkan');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'ReShade64.dll'), 'sample');
  fs.writeFileSync(path.join(source, 'ReShade64.json'), '{"layer":{}}');
  let registrations = 0;
  const runner = async (_file, args) => {
    if (args[0] === 'add') registrations++;
    return { code: 1, stdout: '', stderr: '' };
  };
  const deploy = failLocal => journal.transaction(f.game, async () => {
    const manifest = apply.beginManifest(f.game, f.exe, 'vulkan');
    manifest.vulkanLayer = await vulkan.register({ sourceDir: source, targetDir: shared, gameDir: f.game, runner });
    await apply.saveActiveManifest(f.game, manifest);
    assert.equal(registrations, 0);
    if (failLocal) throw new Error('MFG stage failed');
  });
  await assert.rejects(deploy(true), /MFG stage failed/);
  assert.equal(registrations, 0);
  assert.ok(!fs.existsSync(shared));
  f.assertRestored();
  await assert.rejects(deploy(false), { code: 'errBackendRecovery' });
  assert.equal(registrations, 1);
  assert.equal(JSON.parse(fs.readFileSync(journal.pendingPath(f.game))).phase, 'external-commit');
  assert.equal(await journal.recover(f.game), true);
  assert.equal(require('../src/core/backend-manager').readManifest(f.game).vulkanLayer.dir, shared);
});
