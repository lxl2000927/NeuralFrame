'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const ipcMain = new (require('node:events').EventEmitter)();

// Outside Electron, require('electron') hands back a path string, so the
// bridge's ipcMain listeners are stubbed before it is loaded.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true, children: [], paths: [],
  exports: { ipcMain }
};

const startBridge = require('../src/overlay-bridge.js');

// The bridge needs a window to render the panel into; these tests are about the
// pipe, so a stand-in that never paints is enough.
class FakeWindow {
  constructor() {
    this.webContents = {
      on() {}, once() {}, setFrameRate() {}, invalidate() {}, send() {},
      setWindowOpenHandler() {}, enableDeviceEmulation() {}, sendInputEvent() {},
      executeJavaScript: async () => 320,
      isDestroyed: () => false
    };
  }
  loadFile() { return Promise.resolve(); }
  setContentSize() {}
  on() {}
  destroy() { this.destroyed = true; }
  isDestroyed() { return Boolean(this.destroyed); }
}

const connect = (pipeName) => new Promise((resolve, reject) => {
  const socket = net.connect(pipeName);
  socket.on('connect', () => resolve(socket));
  socket.on('error', reject);
});

const settle = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));

function publish(socket, effects) {
  const body = Buffer.from(JSON.stringify({epoch:1, effects, tools:[]}));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x31534c44);
  header.writeUInt32LE(body.length, 4);
  socket.write(Buffer.concat([header, body]));
}

async function bridge(t, idleTakeoverMs = 5000) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-swapper-bridge-'));
  const live = await startBridge({ BrowserWindow: FakeWindow, userData, idleTakeoverMs });
  t.after(() => { live.close(); fs.rmSync(userData, { recursive: true, force: true }); });
  return live;
}

test('a game left holding the pipe does not lock every later game out', async (t) => {
  // A short takeover window keeps the test quick; the shipped one is 5 s.
  const live = await bridge(t, 400);
  assert.equal(live.state().listening, true);
  assert.equal(live.state().connected, false);

  const first = await connect(live.pipeName);
  const statuses = [];
  const sender = live.window.webContents;
  sender.send = (channel, status) => { if (channel === 'lab-overlay-status') statuses.push(status); };
  publish(first, true);
  await settle();
  assert.equal(live.state().connected, true, 'the first game is attached');
  assert.equal(live.getStatus().effects, true);
  const oldSession = statuses.at(-1).session;

  // A second game while the first is alive is refused, as designed: one game
  // at a time may drive the panel.
  const second = await connect(live.pipeName);
  await settle();
  assert.equal(second.destroyed, true, 'the second connection is closed');
  assert.equal(live.state().connected, true, 'and the first keeps the panel');

  // Now the first goes silent - a crashed or killed game whose end of the pipe
  // was never closed. Nothing arrives from it for longer than the takeover
  // window, and the next game knocks.
  await settle(600);
  const third = await connect(live.pipeName);
  await settle();
  assert.equal(third.destroyed, false, 'the next game is let in');
  assert.equal(live.state().connected, true);
  assert.equal(live.state().game, false, 'a new socket must publish its own status');
  assert.equal(statuses.at(-1), null);
  const packets = [];
  third.on('data', data => packets.push(data));
  publish(third, false);
  await settle();
  assert.equal(live.getStatus().effects, false);
  const session = statuses.at(-1).session;
  assert.notEqual(session, oldSession);
  const cmd = {epoch:1, id:0, kind:3, value:1};
  ipcMain.emit('lab-overlay-control', {sender}, {...cmd, session:oldSession});
  await settle();
  assert.equal(packets.length, 0, 'late control from the first game is ignored even when epochs match');
  ipcMain.emit('lab-overlay-control', {sender}, {...cmd, session});
  await settle();
  assert.equal(Buffer.concat(packets).readUInt32LE(0), 0x31434c44);
  first.destroy(); third.destroy();
});

test('the bridge reports what it is doing', async (t) => {
  const live = await bridge(t);
  assert.deepEqual(
    { listening: live.state().listening, connected: live.state().connected, game: live.state().game },
    { listening: true, connected: false, game: false });
  assert.ok(fs.existsSync(live.endpoint), 'the endpoint the add-on reads is written');
  assert.match(live.pipeName, /^\\\\\.\\pipe\\dlss5-swapper-bridge-/i);

  const socket = await connect(live.pipeName);
  await settle();
  assert.equal(live.state().connected, true);
  socket.destroy();
  await settle();
  assert.equal(live.state().connected, false, 'and it notices the game leaving');

  live.close();
  assert.equal(live.state().listening, false);
  assert.equal(fs.existsSync(live.endpoint), false, 'the endpoint is removed on close');
});
