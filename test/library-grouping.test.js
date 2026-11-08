'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real IPC handlers and JSON persistence, with no Electron
// window or scanner. A new context represents a fresh app launch.
const mainPath = path.join(__dirname, '../main.js');
function launch(profile) {
  const handlers = new Map();
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    __dirname: path.dirname(mainPath),
    require(name) {
      if (name === 'electron') return {
        app: {
          getPath(key) { assert.equal(key, 'userData'); return profile; },
          setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}
        },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }
      };
      if (name === './package.json') return { version: 'test' };
      if (name === './src/core/preview-fs') return require('../src/core/preview-fs');
      if (name === './src/hardware-ipc') return require('../src/hardware-ipc');
      if (name.startsWith('./src/')) return {};
      return require(name);
    }
  }, { filename: mainPath });
  return (channel, ...args) => handlers.get(channel)(null, ...args);
}

test('store categories default to enabled for new and existing profiles', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-grouping-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  let call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
  fs.writeFileSync(path.join(profile, 'library.json'), JSON.stringify({ folders: [], theme: 'dark' }));
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
});

test('category preference persists across launches without changing library or scanning settings', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-grouping-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'library.json');
  const original = { folders: ['C:\\Games'], manual: ['C:\\DuckStation'], scans: { example: { ok: true } }, hidden: [], autoScanDrives: false, lang: 'ar', theme: 'dark' };
  fs.writeFileSync(file, JSON.stringify(original));
  let call = launch(profile);
  assert.equal(call('set-group-games-by-store', false), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, groupGamesByStore: false });
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, false);
  assert.equal(call('settings').groupGamesByStore, false);
  assert.equal(call('set-group-games-by-store', true), true);
  call = launch(profile);
  assert.equal(call('boot').groupGamesByStore, true);
  assert.equal(call('settings').groupGamesByStore, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, groupGamesByStore: true });
});

test('resetting the library preserves preferences, history, component cache and locks', t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-settings-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const original = { folders: ['D:\\Games'], excludedRoots: ['D:\\Old'], manual: ['D:\\Manual'], hidden: ['hidden'], scans: { game: {} }, posters: { game: 'cover.png' }, recents: [{ dir: 'D:\\Games' }], lang: 'en', theme: 'dark', rememberWindow: true, windowState: { x: 80, y: 60, width: 1100, height: 760 }, safeGraphics: true, groupGamesByStore: false };
  const file = path.join(profile, 'library.json');
  fs.writeFileSync(file, JSON.stringify(original));
  for (const name of ['history.jsonl', 'component-locks.json', 'component-cache.dat']) fs.writeFileSync(path.join(profile, name), 'preserve me');
  assert.equal(launch(profile)('reset-library'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { ...original, folders: [], excludedRoots: [], manual: [], hidden: [], scans: {}, posters: {}, recents: [] });
  for (const name of ['history.jsonl', 'component-locks.json', 'component-cache.dat']) assert.equal(fs.readFileSync(path.join(profile, name), 'utf8'), 'preserve me');
});

test('disabling window memory discards stale geometry while restoring a scan root preserves other exclusions', t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-settings-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'library.json');
  fs.writeFileSync(file, JSON.stringify({ rememberWindow: true, windowState: { x: 80, y: 60, width: 1100, height: 760 }, excludedRoots: ['D:\\Games', 'E:\\Games'], lang: 'en' }));
  const call = launch(profile);
  assert.equal(call('set-remember-window', false), false);
  assert.equal(call('restore-scan-root', 'd:\\games'), true);
  const state = JSON.parse(fs.readFileSync(file));
  assert.equal(state.windowState, undefined);
  assert.equal(state.lang, 'en');
  assert.deepEqual(state.excludedRoots, ['E:\\Games']);
});
