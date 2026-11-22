'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('real IPC persists per-EXE choices, validates selection, uses effective routes and keeps Vulkan switch guards', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-api-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game');
  fs.mkdirSync(game);
  const exes = ['Game.exe', 'Other.exe'].map(rel => ({ rel, path: path.join(game, rel), bitness: 64,
    api: 'opengl', apiLabel: 'OpenGL', apiChoices: [{ api: 'opengl', label: 'OpenGL' }] }));
  const scan = { chosen: exes[0], exeCandidates: exes, dlssFiles: [], streamlineFiles: [],
    primaryDlss: { rel: 'native/nvngx_dlss.dll' }, reshade: { installed: false } };
  let old = null, failOpen = false, nvidiaPresent = null;
  const installs = [], opened = [];
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  function load(platform = process.platform) {
    const handlers = new Map();
    const stubs = {
      './src/core/combined-manager': {...realRequire('./src/core/combined-manager'),
        detectHardwareEnvironment:async () => ({gpu:{nvidiaPresent}})},
      './src/overlay-preferences': { read: () => ({enabled:false}) },
      // This unit isolates route choice; preview/token behavior has its own
      // real-installer coverage in component-review.test.js.
      './src/core/component-review': { ComponentReview: class { run(_dir, _request, work) { return work(); } } },
      electron: { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => root },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        shell: { openExternal: async url => { if (failOpen) throw new Error('browser unavailable'); opened.push(url); } } },
      './src/core/scan.js': { scanGame: async () => scan },
      './src/core/game-inspection': { GameInspection: class { async run() { return { scan, status: { ok: true } }; } invalidate() {} } },
      './src/core/compatibility': { assertSafeTarget() {}, antiCheatDetails: () => ({ antiCheatWarning: false, antiCheatComponents: [] }), hasAntiCheat: () => false, targetIssue: () => null },
      './src/core/install-guards': { assertGameClosed: async () => {} },
      './src/core/runtime-components.js': { missingVCRuntime: () => [], ensureLumenite: async () => null, ensureDgVoodoo: async () => 'fixture' },
      './src/core/backend-manager': { readManifest: () => old, install: async config => {
        installs.push(config);
        return { version: 1, date: new Date().toISOString(), route: config.route,
          game: { dir: game, exe: path.basename(config.exePath), api: config.api }, replaced: [], added: [] };
      } }
    };
    const fixtureProcess = Object.create(require('./fixtures/offline-process')(),{platform:{value:platform}});
    const context = vm.createContext({ require: name => stubs[name] || realRequire(name), __dirname: path.dirname(main), process: fixtureProcess, Buffer, console });
    vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
    vm.runInContext('payload = () => ({ source: { feeder: { ok32: true, ok64: true } } }); companionAddons = () => [];', context);
    if (platform === 'linux') vm.runInContext('requireProtonContext = () => ({prefix:"/test/pfx"});',context);
    return handlers;
  }
  let handlers = load();
  const event = { sender: { send() {} } };
  const details = () => handlers.get('details')(event, game);
  const choose = value => handlers.get('set-api-override')(event, game, exes[0].path, value);
  const install = (value, route) => handlers.get('install')(event, game, exes[0].path, route, value);
  const vanished = await handlers.get('install')(event, game, path.join(game, 'Removed.exe'), 'native', 'd3d12');
  assert.equal(vanished.code, 'errSelectedExeMissing');
  assert.equal(installs.length, 0);
  assert.equal((await details()).exes[0].apiOverride, 'auto');
  assert.equal((await choose('d3d11')).ok, true);
  assert.equal(installs.length, 0, 'changing preference never installs');
  handlers = load(); // app restart: choice comes from disk, not a renderer Map
  let d = await details();
  assert.equal(d.exes[0].apiOverride, 'd3d11');
  assert.equal(d.exes[1].apiOverride, 'auto');
  assert.equal(d.exes[0].apiLabel, 'OpenGL', 'detection is still visible');
  assert.ok(d.exes[0].routes.includes('renodx'), 'DX11 override offers the DXGI routes');
  assert.ok(!d.exes[1].routes.includes('renodx'), 'the other executable still uses OpenGL');
  assert.equal(d.exes[0].recommendedRoute, 'feeder');
  assert.equal((await choose('d3d12')).ok, true);
  d = await details();
  assert.equal(d.recommendedRoute, 'native');
  assert.match(d.exes[0].classicMfgIssue,/DLSS-G 输入/);
  assert.equal(d.exes[0].hasAnrAddonHost,false);
  const otherSdk = {name:'libxess_fg.dll',rel:'bin/libxess_fg.dll',version:'2.0.0.0',featureMismatch:true};
  scan.upscalerFiles = [otherSdk];
  assert.equal((await details()).files.find(f=>f.rel===otherSdk.rel)?.featureMismatch,true);
  scan.upscalerFiles = [];
  assert.equal(d.exes[0].recommendedRoute, 'native');
  assert.equal(d.exes[1].recommendedRoute, 'feeder');
  nvidiaPresent = false;
  for (const route of ['native','feeder','renodx','optiscaler'])
    assert.equal((await install('d3d12',route)).code,'errNeuralGpuUnsupported');
  assert.equal(installs.length,0);
  nvidiaPresent = null;
  assert.equal((await choose('d3d11')).ok, true);
  assert.equal((await install(null)).ok, true);
  assert.equal(installs.at(-1).api, 'dxgi');
  assert.equal(installs.at(-1).apiLabel, 'DirectX 11');
  assert.equal(installs.at(-1).route, 'feeder');
  assert.equal((await install('d3d12')).ok, true);
  assert.equal(installs.at(-1).apiLabel, 'DirectX 12');
  assert.equal(installs.at(-1).route, 'native');
  const applied = installs.length;
  for (const route of ['native', 'renodx', 'unknown']) {
    const rejected = await install('vulkan', route);
    assert.equal(rejected.code, 'errSelectedRouteUnavailable');
    assert.match(rejected.message, /刷新/);
  }
  assert.equal((await install('opengl', 'optiscaler')).code, 'optiUnsupported');
  const nativeDll = scan.primaryDlss;
  scan.primaryDlss = null;
  const noInput = await install('d3d12', 'native');
  assert.equal(noInput.code, 'errSelectedRouteUnavailable');
  assert.equal((await install('d3d12', 'optiscaler')).code, 'optiNeedsDlss');
  scan.primaryDlss = nativeDll;
  assert.equal(installs.length, applied, 'an unavailable explicit route must never reach deployment');
  handlers = load('linux');
  assert.equal((await install('vulkan','feeder')).code,'errLinuxVulkanUnsupported');
  const vulkanGame = path.join(root,'LinuxVk');
  const vkExe = require('./fixtures/pe').writePe(path.join(vulkanGame,'Game.exe'),{text:'vkCreateInstance'});
  const hud = await handlers.get('enhanced-apply')(event,vulkanGame,{exePath:vkExe,apiOverride:'vulkan',performanceMonitor:{install:true}});
  assert.equal(hud.code,'errLinuxVulkanUnsupported');
  assert.deepEqual(fs.readdirSync(vulkanGame),['Game.exe']);
  handlers = load();
  // Older callers may leave the route unset. An empty selection also uses the recommendation.
  for (const route of [null, '', 'feeder']) assert.equal((await install('vulkan', route)).ok, true);
  assert.equal(installs.at(-1).api, 'vulkan');
  assert.equal(installs.at(-1).route, 'feeder');
  old = { route: 'native', game: { exe: 'Game.exe', api: 'dxgi' } };
  const before = installs.length;
  assert.equal((await install('vulkan')).code, 'errBackendVulkanSwitch');
  assert.equal((await install('d3d8')).code, 'unsupportedRendererHint');
  assert.equal((await install('bogus')).code, 'errApiChoice');
  assert.equal(installs.length, before);
  for (const value of ['bogus', {}, 'dxgi', '__proto__']) assert.equal((await choose(value)).ok, false);
  assert.equal((await handlers.get('set-api-override')(event, game, path.join(root, 'outside.exe'), 'vulkan')).ok, false);
  assert.equal((await choose('auto')).ok, true);
  handlers = load();
  assert.equal((await details()).exes[0].apiOverride, 'auto');
  old = null;
  assert.equal((await install('auto')).ok, true);
  assert.equal(installs.at(-1).api, 'opengl');
  assert.deepEqual(fs.readdirSync(game), [], 'mock install never creates game files');
  const client = path.join(game, 'Client/Binaries/Win64/Client-Win64-Shipping.exe');
  fs.mkdirSync(path.dirname(client), {recursive:true});
  fs.writeFileSync(client, 'fixture');
  fs.writeFileSync(path.join(game, 'Wuthering Waves.exe'), 'launcher');
  const protectedDetails = await details();
  assert.equal(protectedDetails.recommendedRoute, 'wuwa-proxy');
  assert.deepEqual(Array.from(protectedDetails.exes[0].routes), ['wuwa-proxy']);
  const beforeProtected = installs.length;
  assert.equal((await install('d3d12', 'native')).code, 'errWutheringWaves');
  assert.equal(installs.length, beforeProtected);
  for (const destination of ['github', 'releases']) assert.equal(await handlers.get('open-project')(event, destination), true);
  assert.equal(opened.length, 2);
  assert.equal(await handlers.get('open-project')(event, 'https://example.com'), false);
  failOpen = true;
  assert.equal(await handlers.get('open-project')(event, 'github'), false);
});
