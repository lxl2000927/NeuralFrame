'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { writePe } = require('./fixtures/pe');

function load(root, overrides = {}) {
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main), handlers = new Map();
  const electron = { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => root }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {} };
  const host = Object.create(process);
  host.on = () => host;
  const context = vm.createContext({ require: name => overrides[name] || (name === 'electron' ? electron : realRequire(name)), __dirname: path.dirname(main), process: host, Buffer, console });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return (name, ...args) => handlers.get(name)({}, ...args);
}

test('home library scans configure the persistent symbol cache before a detail page is opened', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-home-scan-cache-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const game = path.join(root, 'Game'), requests = [];
  const call = load(root, {'./src/core/game-inspection': {GameInspection:class {
    async run(task, dir, options) {
      requests.push({task, dir, options});
      return {chosen:{path:path.join(dir, 'Game.exe'), rel:'Game.exe', api:'dx12', apiLabel:'DirectX 12', bitness:64}, reshade:{installed:false}};
    }
  }}});
  assert.equal((await call('scan', game)).ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].task, 'scan');
  assert.equal(requests[0].dir, game);
  assert.equal(requests[0].options?.userDataDir, root);
});


test('component GPU reads do not wait for monitor enumeration; settings still includes it', async () => {
  const handlers = new Map();
  let monitorReads = 0;
  require('../src/hardware-ipc')({
    ipcMain:{handle:(name, handler)=>handlers.set(name,handler)},
    screen:{getPrimaryDisplay(){monitorReads++;return {bounds:{width:1920,height:1080},scaleFactor:1,displayFrequency:60};}},
    window:()=>null, loadState:()=>({}), saveState:()=>true, inspections:()=>({setHardware(){}})
  });
  const read = (...args) => handlers.get('enhanced-hardware')({},...args);
  assert.equal((await read(false,false)).hardware.display,null);
  assert.equal(monitorReads,0);
  assert.equal((await read()).hardware.display.resolution,'1920x1080');
  assert.equal(monitorReads,1);
});

test('retired global presets cannot override detected hardware or game selection; existing files are preserved', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-retired-profile-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const game = path.join(root, 'Game'), backup = path.join(game, '_DLSS5_Backup');
  fs.mkdirSync(backup, {recursive:true});
  const manifest = path.join(backup, 'manifest.json');
  const manifestText = JSON.stringify({hardwareProfile:'rtx40_laptop',neuralRendering:{mode:'off',hardwareProfile:'rtx40_laptop'}});
  fs.writeFileSync(manifest, manifestText);
  const stateFile = path.join(root,'library.json');
  const preferenceText = JSON.stringify({hardwareProfile:'rtx50_desktop',manual:[game]});
  fs.writeFileSync(stateFile, preferenceText);
  const requests = [];
  const call = load(root, {'./src/core/game-inspection':{GameInspection:class {
    run(task, dir, options) { requests.push({task,dir,options}); return Promise.resolve({status:{ok:true}}); }
  }}});
  const hardware = await call('enhanced-hardware',false,false);
  assert.equal(hardware.ok,true);assert.notEqual(hardware.hardwareProfileSource,'default');
  assert.equal(hardware.hardwareProfile,require('../src/core/hardware-profile').selectHardwareProfile({gpu:hardware.hardware.gpu}).id);
  await call('enhanced-status',game);
  await call('enhanced-status',game,'rtx40_desktop');
  await call('enhanced-models');
  await call('enhanced-models','rtx40_desktop');
  assert.ok(requests.every(r=>!Object.hasOwn(r.options,'defaultHardwareProfile')));
  assert.equal(requests[0].options.hardwareProfile,undefined);
  assert.equal(requests[1].options.hardwareProfile,'rtx40_desktop');
  assert.equal(requests[2].options.hardwareProfile,hardware.hardwareProfile);
  assert.equal(requests[3].options.hardwareProfile,'rtx40_desktop');
  assert.equal(fs.readFileSync(stateFile,'utf8'),preferenceText);
  assert.equal(fs.readFileSync(manifest,'utf8'),manifestText);
});

test('a library discovery finishing after a root edit or reset cannot publish old roots', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-library-view-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldRoot = path.join(root, 'Old library');
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({folders:[oldRoot]}));
  let finish;
  const requests = [];
  const call = load(root, {
    './src/core/game-inspection': { GameInspection: class {
      run(task, dir, options) {
        assert.equal(task, 'discover');
        requests.push(options);
        if (requests.length === 2) return Promise.resolve({roots:[],games:[]});
        return new Promise(resolve => { finish = resolve; });
      }
    } }
  });
  const beforeEdit = call('library');
  call('remove-folder', oldRoot);
  finish({roots:[oldRoot], games:[]});
  assert.equal((await beforeEdit).length, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(Array.from(requests[1].folders), []);
  assert.deepEqual(Array.from(call('settings').roots), []);
  const beforeReset = call('library');
  call('reset-library');
  finish({roots:[oldRoot], games:[]});
  await beforeReset;
  assert.deepEqual(Array.from(call('settings').roots), []);
});

test('settings saves are atomic, errors are reported and resetting cannot resurrect stale state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'library.json');
  fs.writeFileSync(stateFile, JSON.stringify({ folders: [], manual: ['X:/fixture'], hidden: [], lang: 'zh', closeToTray: false }));
  fs.writeFileSync(path.join(root, 'history.json'), 'history sentinel');
  fs.writeFileSync(path.join(root, 'overlay-preferences.json'), 'overlay sentinel');
  const call = load(root);
  call('set-lang', 'en');
  const saved = fs.readFileSync(stateFile, 'utf8');
  fs.mkdirSync(stateFile + '.tmp');
  assert.throws(() => call('set-lang', 'zh'), /save settings/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), saved);
  fs.rmdirSync(stateFile + '.tmp');
  call('set-theme', 'light');
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).lang, 'en', 'failed preference is not retained in memory');
  call('reset'); call('set-lang', 'zh');
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile)).manual, []);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).theme, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'history.json'), 'utf8'), 'history sentinel');
  assert.equal(fs.readFileSync(path.join(root, 'overlay-preferences.json'), 'utf8'), 'overlay sentinel');
});

for (const reset of ['reset-library', 'reset']) {
  test(`${reset} ignores inspection and cover fetches started before the reset`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-reset-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const stateFile = path.join(root, 'library.json'), game = path.join(root, 'Old game');
    fs.writeFileSync(stateFile, JSON.stringify({ lang: 'en', manual: [game] }));
    let finishScan, finishArt;
    const scan = new Promise(resolve => { finishScan = resolve; });
    const art = new Promise(resolve => { finishArt = resolve; });
    const call = load(root, {
      './src/core/game-inspection': { GameInspection: class { run() { return scan; } } },
      './src/steamart': { look: () => art }
    });
    const jobs = [call('scan', game), call('art-fetch', game, 'Old game')];
    call(reset);
    call('set-theme', 'dark');
    finishScan({ emptyReason: 'empty', reshade: { installed: false } });
    finishArt(null);
    const [completed] = await Promise.all(jobs);
    assert.equal(completed.reason, 'empty');
    const saved = JSON.parse(fs.readFileSync(stateFile));
    assert.deepEqual(saved.scans, {}); assert.deepEqual(saved.manual, []);
    assert.equal(saved.art, undefined); assert.equal(saved.theme, 'dark');
    assert.equal(saved.lang, reset === 'reset' ? undefined : 'en');
  });
}

test('old language settings resolve consistently in the desktop and native folder picker', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-locale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  let title;
  load(root, { electron: {
    app: {setAppUserModelId() {}, whenReady: () => ({then() {}}), on() {}, getPath: () => root},
    ipcMain: {handle: (key, fn) => handlers.set(key, fn)},
    dialog: {showOpenDialog: async (_win, options) => { title = options.title; return {canceled: true}; }}
  }});
  for (const [stored, resolved] of [['en', 'en'], ['en-US', 'en'], ['zh', 'zh'], ['ja', 'zh']]) {
    handlers.get('set-lang')({}, stored);
    assert.equal(handlers.get('boot')().lang, resolved);
    await handlers.get('add-folder')();
    assert.equal(title, resolved === 'en' ? 'Scan this folder for games' : '扫描游戏文件夹');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'library.json'))).lang, stored);
  }
});

test('add-on metadata refreshes after a same-size replacement preserves its modification time', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-addon-refresh-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'custom','versioned.addon64'), time = new Date('2026-11-01T00:00:00Z');
  writePe(file,{version:[1,2,3,4]});
  fs.utimesSync(file,time,time);
  fs.writeFileSync(path.join(root,'library.json'),JSON.stringify({addonFiles:[file]}));
  const call = load(root), before = fs.statSync(file);
  assert.equal(call('addons').find(row => row.path === file).version,'1.2.3.4');
  writePe(file,{version:[2,3,4,5]});
  fs.utimesSync(file,time,time);
  const after = fs.statSync(file);
  assert.equal(after.size,before.size);
  assert.equal(after.mtimeMs,before.mtimeMs);
  assert.equal(call('addons').find(row => row.path === file).version,'2.3.4.5');
});

test('add-ons save metadata first, enable by full path, replace same-name builds and retain originals on removal', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-addons-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const call = load(root);
  const first = writePe(path.join(root, 'one', 'fixture.addon64'));
  const second = writePe(path.join(root, 'two', 'fixture.addon64'));
  for (const file of [first, second]) assert.equal(call('addon-save', { path: file, name: path.basename(path.dirname(file)), description: 'line 1\nline 2', tag: 'test' }), true);
  let entries = call('addons').filter(row => row.custom);
  assert.equal(entries.length, 2); assert.equal(entries.filter(row => row.active).length, 0);
  assert.deepEqual(Array.from(entries[0].notes), ['line 1', 'line 2']);
  assert.equal(call('addon-toggle', first, true).ok, true);
  assert.equal(call('addon-toggle', second, true).replaced, 'fixture.addon64');
  assert.equal(call('addons').find(row => row.path === first).active, false);
  assert.equal(call('addons').find(row => row.path === second).active, true);
  const pending = path.join(root, 'library.json.tmp'); fs.mkdirSync(pending);
  assert.equal(call('addon-toggle', second, false).ok, false);
  assert.equal(call('addons').find(row => row.path === second).active, true);
  fs.rmdirSync(pending);
  assert.equal(call('addon-remove', second), true);
  assert.ok(fs.existsSync(first) && fs.existsSync(second));
  assert.equal(call('addons').some(row => row.path === second), false);
});

test('restore remembers whether an excluded scan root was added manually, including after restart', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const custom = path.join(root, 'My games'), automatic = path.join(root, 'Steam');
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ folders: [custom] }));
  let call = load(root);
  call('remove-folder', custom.toUpperCase());
  call('exclude-root', automatic);
  call = load(root);
  assert.deepEqual(Array.from(call('settings').folders), []);
  call('restore-scan-root', custom);
  call('restore-scan-root', automatic);
  assert.deepEqual(Array.from(call('settings').folders), [custom]);
  assert.deepEqual(Array.from(call('settings').excludedRoots), []);
});

test('a missing custom build remains manageable and removing another build preserves a legacy selection', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-addon-legacy-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const file = writePe(path.join(root, 'chosen.addon64')), other = writePe(path.join(root, 'other.addon64'));
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({ addon: file, addonFiles: [file, other] }));
  const call = load(root);
  fs.unlinkSync(other);
  assert.equal(call('addon-toggle', other, true).ok, false);
  assert.equal(call('addons').find(r => r.path === file).active, true, 'a failed enable leaves the old single-file choice active');
  call('set-theme', 'dark');
  assert.equal(load(root)('addons').find(r => r.path === file).active, true, 'the selection also survives unrelated saves and restart');
  call('addon-remove', other);
  assert.equal(call('addons').find(r => r.path === file).active, true);
  fs.unlinkSync(file);
  const row = call('addons').find(r => r.path === file);
  assert.equal(row.missing, true);
  assert.equal(row.active, true);
  assert.equal(call('addon-toggle', file, true).ok, false);
  call('addon-toggle', file, false);
  writePe(file);
  assert.equal(call('addons').find(r => r.path === file).active, false);
});

test('only confirmed component file changes enter history and survive rollback and restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-component-history-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const game = path.join(root, 'Game');
  writePe(path.join(game, 'Game.exe'), {text: 'D3D12CreateDevice'});
  writePe(path.join(game, 'nvngx_dlss.dll'), {version: '2.0.0.0', text: 'nvngx_dlss.pdb'});
  const next = writePe(path.join(root, 'Library', 'next.dll'), {version: '3.0.0.0', text: 'nvngx_dlss.pdb'});
  fs.writeFileSync(path.join(root, 'library.json'), JSON.stringify({manual: [game]}));
  const { ComponentLibrary } = require('../src/core/component-library');
  const pkg = await new ComponentLibrary(root).importPackage({component:'dlss-sr', files:{'nvngx_dlss.dll':next}});
  const call = load(root), draft = {'dlss-sr':pkg.id};
  const review = await call('library-apply', game, undefined, draft);
  assert.equal(call('history').rows.length, 0);
  assert.equal((await call('library-apply', game, review.preview.token, draft)).ok, true);
  const noop = await call('library-apply', game, undefined, {});
  assert.equal((await call('library-apply', game, noop.preview.token, {})).ok, true);
  assert.equal(call('history').rows.length, 1);
  const { id } = require('../src/core/backend-manager').readManifest(game).componentHistory.at(-1);
  const undo = await call('library-rollback', game, id);
  assert.equal((await call('library-rollback', game, id, undo.preview.token)).ok, true);
  const rows = load(root)('history').rows;
  assert.deepEqual(rows.map(r => r.action), ['component-rollback', 'component-update']);
  const [restored, updated] = rows.map(r => r.files[0]);
  assert.equal(updated.before, '2.0.0.0'); assert.equal(updated.after, '3.0.0.0');
  assert.equal(restored.before, updated.after); assert.equal(restored.after, updated.before);
  assert.equal(restored.afterHash, updated.beforeHash); assert.match(restored.afterHash, /^[a-f0-9]{64}$/);
});

test('failed hardware detection does not invent an NVIDIA GPU, driver or monitor', async () => {
  const file = path.resolve(__dirname, '../src/core/combined-manager.js'), realRequire = createRequire(file);
  const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => name === 'child_process' ? { execFile: (_file, _args, _opts, callback) => callback(Error('not installed')) } : realRequire(name), console, Buffer });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const hardware = await context.module.exports.detectHardwareEnvironment(true);
  assert.equal(hardware.gpu.detected, false); assert.equal(hardware.gpu.name, ''); assert.equal(hardware.gpu.driver, '');
  assert.equal(hardware.gpu.vramTotalMB, null); assert.equal(hardware.display, null);
});

test('display snapshot uses the window monitor and keeps unavailable pixel size separate from refresh rate', async () => {
  const { createDisplayReader } = require('../src/core/display-info');
  const bounds = { x: -1707, y: 0, width: 1707, height: 1067 };
  const selected = { id: 1, bounds, scaleFactor: 1.5, displayFrequency: 165 };
  const screen = {
    getPrimaryDisplay: () => ({ id: 2, bounds: {width: 1920, height: 1080}, scaleFactor: 1 }),
    getDisplayMatching: () => selected,
    dipToScreenPoint: () => ({x:-1280, y:800})
  };
  let calls = 0, available = true;
  const read = createDisplayReader(screen, async () => {
    calls++;
    if (!available) throw Error('unavailable');
    return [{X:0,Y:0,Width:1920,Height:1080}, {X:-2560,Y:0,Width:2560,Height:1600}];
  });
  assert.deepEqual(await read(null), {resolution:'1920x1080'});
  const window = {isDestroyed: () => false, getBounds: () => bounds};
  if (process.platform === 'win32') {
    const pair = await Promise.all([read(window), read(window)]);
    for (const result of pair) assert.deepEqual(result, {resolution:'2560x1600',refreshRateHz:165});
    assert.equal(calls, 1);
  }
  available = false;
  assert.deepEqual(await read(window, true), { refreshRateHz:165 });
});
