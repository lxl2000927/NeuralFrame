const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { writePe } = require('./fixtures/pe');
const { createOverlayLibrary } = require('../src/overlays');
const preview = require('../src/core/preview-fs');
const journal = require('../src/core/file-journal');
const backend = require('../src/core/backend-manager');

test('confirmed native install rolls back F8 upgrade, DLLs and history if final component verification fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-native-component-tx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game'), profile = path.join(root, 'Profile'), sources = path.join(root, 'Sources');
  const exe = writePe(path.join(game, 'Game.exe'), { text: 'D3D12CreateDevice', size: 131072 });
  const original = writePe(path.join(game, 'nvngx_dlss.dll'), { version: [2, 3, 0, 0] });
  const originalBytes = fs.readFileSync(original);
  const payload = ['nvngx_dlss.dll', 'nvngx_dlssnr.dll'].map(name => {
    const file = writePe(path.join(sources, name), { version: [310, 8, 0, 0] });
    return { name, path: file, version: '310.8.0.0' };
  });
  function overlay(version) {
    const file = writePe(path.join(root, version, 'test.addon64'), { text: version });
    const bytes = fs.readFileSync(file);
    bytes.writeUInt16LE(0x2000, 0x96);
    fs.writeFileSync(file, bytes);
    return createOverlayLibrary(path.join(profile, 'overlays'), file);
  }
  const oldOverlay = overlay('old').install('builtin', exe), overlays = overlay('new');
  const next = path.join(game, 'dlss5-lab-overlay-' + overlays.resolve('builtin').sha256.slice(0, 16) + '.addon64');
  const oldOverlayBytes = fs.readFileSync(oldOverlay.file);
  const selected = { id: 'test-sr', component: 'dlss-sr', files: [{ rel: 'nvngx_dlss.dll', bitness: 64,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(payload[0].path)).digest('hex') }] };
  let checks = 0, inject = true;
  const library = {
    profile: () => ({ selected: { 'dlss-sr': selected.id } }),
    package: () => selected, directory: () => sources, compatibility: () => ({ ready: true }),
    verify: async () => {
      if (!preview.active() && ++checks === 2 && inject) {
        assert.ok(fs.existsSync(next));
        assert.ok(!fs.existsSync(oldOverlay.file));
        assert.ok(backend.readManifest(game).labOverlay);
        assert.notDeepEqual(fs.readFileSync(original), originalBytes);
        assert.deepEqual(overlays.list().installations.map(r => r.id), [oldOverlay.id]);
        throw Object.assign(new Error('source changed after base install'), { code: 'EBUSY' });
      }
    }
  };
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main), handlers = new Map();
  const stubs = {
    electron: { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => profile },
      ipcMain: { handle: (id, handler) => handlers.set(id, handler) } },
    './src/overlay-preferences': { read: () => ({ enabled: true }) },
    './src/core/install-guards': { assertGameClosed: async () => {}, gpuInfo: async () => [], driverNeuralFault: () => false }
  };
  const host = require('./fixtures/offline-process')();
  host.on = () => host;
  Object.defineProperty(host, 'platform', { value: 'win32' });
  const context = vm.createContext({ require: name => stubs[name] || realRequire(name), __dirname: path.dirname(main),
    process: host, Buffer, console, library, overlays, source: { hasNeuralRendering: true, payload } });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  vm.runInContext('unifiedComponents = library; overlayLibrary = () => overlays; payload = () => ({ source }); companionAddons = () => [];', context);
  const event = { sender: { send() {} } };
  const run = token => handlers.get('install')(event, game, exe, 'native', 'd3d12', token);
  const plan = await run();
  assert.ok(plan.preview?.token, JSON.stringify(plan));
  assert.ok(plan.preview.rows.some(row => row.rel === path.basename(next) && row.action === 'add'));
  assert.ok(plan.preview.rows.some(row => row.rel === path.basename(oldOverlay.file) && row.action === 'remove'));
  assert.equal((await run(plan.preview.token)).code, 'EBUSY');
  assert.deepEqual(fs.readFileSync(original), originalBytes);
  assert.deepEqual(fs.readFileSync(oldOverlay.file), oldOverlayBytes);
  assert.deepEqual(overlays.list().installations.map(r => r.id), [oldOverlay.id]);
  assert.equal(fs.existsSync(next), false);
  assert.equal(fs.existsSync(path.join(game, 'nvngx_dlssnr.dll')), false);
  assert.equal(fs.existsSync(journal.pendingPath(game)), false);
  assert.equal(backend.readManifest(game), null);
  assert.equal(handlers.get('history')().rows.length, 0);

  inject = false;
  const retry = await run();
  const success = await run(retry.preview.token);
  assert.ok(success.ok, JSON.stringify(success));
  assert.deepEqual(overlays.list().installations.map(r => r.file), [next]);
  assert.equal(handlers.get('history')().rows.length, 1);
  const restore = token => handlers.get('restore')(event, game, token);
  const restorePlan = await restore();
  assert.ok(restorePlan.preview?.token, JSON.stringify(restorePlan));
  const restored = await restore(restorePlan.preview.token);
  assert.ok(restored.ok, JSON.stringify(restored));
  assert.deepEqual(overlays.list().installations, []);
  assert.deepEqual(fs.readFileSync(original), originalBytes);
});
