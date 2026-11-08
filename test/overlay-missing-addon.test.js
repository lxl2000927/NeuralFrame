'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOverlayLibrary } = require('../src/overlays');
const { writePe } = require('./fixtures/pe');
const gameOverlay = require('../src/game-overlay');

test('developer files open the source tree in development and the shipped resources in a package', async () => {
  const source = require.resolve('../src/overlay-ipc');
  const resourcesPath = path.resolve('fixture-resources');
  for (const isPackaged of [false, true]) {
    const appRoot = isPackaged ? path.join(resourcesPath, 'app.asar') : path.dirname(path.dirname(source));
    const context = { module: {}, require: require('node:module').createRequire(source),
      __dirname: path.join(appRoot, 'src'), process: { resourcesPath } };
    require('node:vm').runInNewContext(fs.readFileSync(source, 'utf8'), context);
    const handlers = new Map();
    let opened;
    context.module.exports({
      app: { isPackaged }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      shell: { openPath: async directory => { opened = directory; return ''; } }
    });
    assert.ok((await handlers.get('overlay-source')()).ok);
    assert.equal(opened, path.join(isPackaged ? resourcesPath : appRoot, 'overlay'));
  }
});

// The add-on the game loads is a file inside this app, and antivirus takes it:
// reported as Trojan:Win32/Kepavll!rfn, a machine-learning verdict on an
// unsigned native DLL. With the file gone the bridge still listened, so the
// Overlay page said "ready, waiting for a game" for as long as anyone cared to
// look, and no game could ever attach. Say what is actually wrong.
function library(t, present) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-addon-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const builtin = path.join(root, 'dlss5-lab-overlay.addon64');
  // A real add-on is a DLL: readNative checks the COFF characteristics bit,
  // so the fixture has to carry it or the library refuses its own file.
  if (present) {
    writePe(builtin, { text: 'overlay' });
    const bytes = fs.readFileSync(builtin);
    bytes.writeUInt16LE(bytes.readUInt16LE(0x96) | 0x2000, 0x96);
    fs.writeFileSync(builtin, bytes);
  }
  return { root, builtin, lib: createOverlayLibrary(path.join(root, 'library'), builtin, []) };
}

// What the Overlay page asks for, built the way src/overlay-ipc.js builds it.
function bridgeState(lib, live) {
  const entry = lib.resolve('builtin');
  return { ...live, addon: Boolean(entry.ready), addonFile: entry.file };
}

test('a removed add-on is reported, not hidden behind a listening service', (t) => {
  const { lib, builtin } = library(t, false);
  const state = bridgeState(lib, { listening: true, connected: false, game: false });

  assert.equal(state.listening, true, 'the service really is up - that was never the fault');
  assert.equal(state.addon, false);
  assert.equal(state.addonFile, builtin, 'the page can name the file to restore');
});

test('with the add-on in place nothing is claimed to be wrong', (t) => {
  const { lib } = library(t, true);
  const state = bridgeState(lib, { listening: true, connected: true, game: true });
  assert.equal(state.addon, true);
});

test('an add-on left corrupt counts as missing, not as a dead service', (t) => {
  const { lib, root } = library(t, true);
  fs.writeFileSync(path.join(root, 'dlss5-lab-overlay.addon64'), 'not a PE any more');
  const entry = lib.builtinStatus();
  assert.equal(entry.ready, false);
  assert.equal(entry.file, path.join(root, 'dlss5-lab-overlay.addon64'));
  const libraryState = lib.list();
  assert.equal(libraryState.overlays[0].ready, false);
  assert.ok(libraryState.errors.length);
});

test('a damaged custom entry stays removable even with an unavailable built-in plugin', t => {
  const {lib,builtin,root} = library(t,true);
  const original = path.join(root,'custom.addon64');
  fs.copyFileSync(builtin,original);
  const entry = lib.add(original);
  fs.appendFileSync(lib.resolve(entry.id).file, 'damaged');
  fs.writeFileSync(builtin, 'damaged');
  assert.equal(lib.list().overlays.find(x=>x.id===entry.id).ready,false);
  assert.equal(lib.add(original).id, entry.id);
  assert.equal(lib.list().overlays.find(x=>x.id===entry.id).ready,true);
  fs.unlinkSync(lib.resolve(entry.id).file);
  lib.remove(entry.id);
  assert.ok(fs.existsSync(original));
  assert.deepEqual(lib.list().overlays.map(x=>x.id), ['builtin']);
});

test('installing without the add-on says where the file went' , (t) => {
  const { lib, root, builtin } = library(t, false);
  const exe = path.join(root, 'Game.exe');
  fs.writeFileSync(exe, 'exe');

  assert.throws(() => gameOverlay.prepare({
    library: lib,
    target: { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12', path: exe },
    route: 'native'
  }), (error) => {
    assert.match(error.message, /missing from this app/);
    assert.match(error.message, /[Aa]ntivirus/, 'names the cause people actually hit');
    assert.ok(error.message.includes(builtin), 'names the file itself');
    return true;
  });
});

// The install does not stop when the overlay cannot be installed - DLSS is the
// job and the overlay rides along - so the reason lives in one line of the
// install log. That line was printed as a raw code, and its translation took a
// params object the spoken path never passes, so it read "undefined" if it had
// ever been reached at all.
test('the reason an overlay was skipped is said in words, not as a code', () => {
  const vm = require('node:vm');
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/i18n.js'), 'utf8'), context, { filename: 'i18n.js' });
  const ui = context.window.i18n;

  const event = { code: 'overlaySkipped', params: { error: 'The overlay add-on is missing from this app: dlss5-lab-overlay.addon64.' } };
  // Exactly how src/renderer/renderer.js renders a spoken job code.
  const spoken = code => ui.t(code, ...Object.values(event.params));

  for (const lang of ['en', 'ar']) {
    ui.setLang(lang);
    const line = spoken(event.code);
    assert.ok(line.includes(event.params.error), `${lang}: the reason itself is shown`);
    assert.ok(!line.includes('undefined'), `${lang}: no placeholder left unfilled`);
    assert.notEqual(line, event.code, `${lang}: not the bare code`);
  }

  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  assert.match(renderer, /SPOKEN_JOB_CODES = new Set\(\[[^\]]*'overlaySkipped'/,
    'and the renderer actually speaks it');
});
