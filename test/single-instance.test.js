'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

// A second copy would write its own overlay endpoint over the first one's and
// listen on its own pipe, so the panel in the game could be driven by a window
// nobody is looking at.
function load(t, { gotLock = true, isPackaged = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-instance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const events = new Map();
  const calls = { quit: 0, relaunch: 0 };
  const window = {
    minimized: true, shown: 0, focused: 0, restored: 0,
    isDestroyed: () => false,
    isMinimized() { return this.minimized; },
    restore() { this.restored++; this.minimized = false; },
    show() { this.shown++; },
    focus() { this.focused++; },
    loadFile() {}, once() {}, on() {}, webContents: { on() {}, send() {} }
  };
  const stubs = {
    electron: {
      app: {
        isPackaged,
        relaunch() { calls.relaunch++; },
        setAppUserModelId() {}, whenReady: () => ({ then() {} }), getPath: () => root,
        getVersion: () => '0.0.0',
        requestSingleInstanceLock: () => gotLock,
        quit() { calls.quit++; },
        on: (name, fn) => events.set(name, fn)
      },
      BrowserWindow: Object.assign(function () { return window; }, { fromWebContents: () => null }),
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle() {} },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      clipboard: { writeText() {} }
    },
    './src/core/scan.js': { scanGame: async () => ({ chosen: null, exeCandidates: [] }), scanSource: () => ({ ok: false }) }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout, AbortSignal
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { events, calls, window, context };
}

test('a second copy quits instead of running beside the first', (t) => {
  const { calls, events } = load(t, { gotLock: false });
  assert.equal(calls.quit, 1, 'the copy that could not take the lock leaves');
  assert.equal(events.has('second-instance'), false, 'and does not listen for one either');
});

test('only the matching dev launcher restarts an idle main process, once', t => {
  const root = path.resolve(__dirname, '..');
  const { calls, events, context } = load(t);
  const launch = data => events.get('second-instance')(null, [], root, data);
  launch({});
  launch({ debugProject: path.join(root, 'other') });
  assert.equal(calls.relaunch, 0);
  vm.runInContext('mutationBusy = true', context);
  launch({ debugProject: root });
  assert.equal(calls.quit, 0);
  vm.runInContext('mutationBusy = false', context);
  launch({ debugProject: root });
  launch({ debugProject: root });
  assert.equal(calls.relaunch, 1);
  assert.equal(calls.quit, 1);
  const packaged = load(t, { isPackaged: true });
  packaged.events.get('second-instance')(null, [], root, { debugProject: root });
  assert.equal(packaged.calls.relaunch, 0);
});

test('opening the app again raises the window that is already running', (t) => {
  const { calls, events, window, context } = load(t, { gotLock: true });
  assert.equal(calls.quit, 0);
  const secondInstance = events.get('second-instance');
  assert.equal(typeof secondInstance, 'function', 'the running copy listens for the second one');

  // Before a window exists, nothing may be raised - and nothing may throw.
  secondInstance();
  assert.equal(window.shown, 0);

  vm.runInContext('createWindow()', context);
  secondInstance();
  assert.equal(window.restored, 1, 'a minimised window is restored');
  assert.equal(window.shown, 1);
  assert.equal(window.focused, 1);
});
