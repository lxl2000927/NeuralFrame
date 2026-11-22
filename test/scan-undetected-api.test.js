'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanGame } = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const renderingApi = require('../src/shared/rendering-api');

// A valid 64-bit PE that mentions no Direct3D entry point at all, which is what
// a protected or launcher-fronted build looks like from the outside.
function silentPe(file, { dll = false, size = 64 * 1024 } = {}) {
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x8664, 0x84);
  buf.writeUInt16LE(0, 0x86);
  buf.writeUInt16LE(240, 0x94);
  buf.writeUInt16LE(dll ? 0x2022 : 0x0022, 0x96);
  buf.writeUInt16LE(0x20b, 0x98);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

function game(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a game that ships DLSS is still found when its executable names no API', async (t) => {
  const dir = game(t, 'scan-undetected-');
  silentPe(path.join(dir, 'Game.exe'));
  silentPe(path.join(dir, 'nvngx_dlss.dll'), { dll: true });

  const scan = await scanGame(dir);
  assert.ok(scan.chosen, 'the game must not be dropped');
  assert.equal(scan.chosen.name, 'Game.exe');
  assert.equal(scan.chosen.via, 'undetected');
  assert.equal(scan.chosen.api, null, 'the renderer is reported as unknown, never guessed');
  assert.equal(scan.chosen.apiLabel, null);
  assert.equal(scan.emptyReason, null);
  assert.ok(scan.primaryDlss, 'the DLSS runtime is still reported');

  // Unknown means no route until the person picks one; picking one works.
  assert.deepEqual(routes.routesFor(scan.chosen), []);
  const picked = renderingApi.effective(scan.chosen, 'd3d12');
  assert.equal(picked.apiLabel, 'DirectX 12');
  assert.deepEqual(routes.routesFor(picked), ['native', 'feeder', 'optiscaler', 'renodx', 'encore']);
  assert.deepEqual(routes.routesFor(renderingApi.effective(scan.chosen, 'vulkan')), ['feeder', 'optiscaler', 'encore']);
});

test('a folder with no NVIDIA runtime is not turned into a game by this', async (t) => {
  const dir = game(t, 'scan-plain-');
  silentPe(path.join(dir, 'Tool.exe'));

  const scan = await scanGame(dir);
  assert.equal(scan.chosen, null, 'an ordinary folder of executables stays unrecognised');
  assert.equal(scan.emptyReason, 'no-graphics-exe');
});

test('optional Intel runtimes and NGX core do not identify which API a silent executable uses', async t => {
  const dir = game(t,'scan-sdk-only-');
  const {writePe,writeProvider} = require('./fixtures/pe');
  silentPe(path.join(dir,'Game.exe'));
  for (const name of ['libxell.dll','_nvngx.dll','nvngx.dll']) {
    const file = writePe(path.join(dir,name),{text:'D3D12CreateDevice'});
    assert.equal((await scanGame(dir)).chosen,null,name);
    fs.unlinkSync(file);
  }
  const unsupported = writePe(path.join(dir,'nvngx_dlss.dll'),{bitness:32});
  assert.equal((await scanGame(dir)).chosen,null);
  fs.unlinkSync(unsupported);
  for (const [name,functions] of [
    ['libxess.dll',['xessD3D12Execute','xessGetVersion']],
    ['libxess_fg.dll',['xefgSwapChainGetVersion','xefgSwapChainDestroy']]
  ]) {
    const file = path.join(dir,name);
    writeProvider(file,functions);
    const {chosen} = await scanGame(dir);
    assert.equal(chosen?.via,'undetected',name);
    assert.equal(chosen.api,null,name);
    fs.unlinkSync(file);
  }
});

test('unloadable engine modules and runtime lookalikes do not identify a game or grant it an API', async t => {
  const dir = game(t,'scan-invalid-engine-');
  const {writePe} = require('./fixtures/pe');
  silentPe(path.join(dir, 'Game.exe'));
  const engine = writePe(path.join(dir, 'Render.dll'), {text:'D3D12CreateDevice'});
  const bytes = fs.readFileSync(engine);
  bytes.writeUInt16LE(0xaa64, bytes.readUInt32LE(0x3c) + 4);
  fs.writeFileSync(engine,bytes);
  fs.writeFileSync(path.join(dir, 'nvngx_dlss.dll'), 'placeholder');
  const scan = await scanGame(dir);
  assert.equal(scan.chosen,null);
  assert.equal(scan.emptyReason,'no-graphics-exe');
});

test('a readable GDK executable with no API appears only once', async t => {
  const dir = game(t,'scan-gdk-silent-');
  const exe = silentPe(path.join(dir,'Game.exe'));
  fs.writeFileSync(path.join(dir,'MicrosoftGame.config'),'<Game><Executable Name="Game.exe"/></Game>');
  const scan = await scanGame(dir);
  assert.deepEqual(scan.exeCandidates.map(item => item.path), [exe]);
});

test('the installed silent executable keeps ownership when another build has the same filename', async t => {
  const dir = game(t,'scan-silent-owner-');
  const {writePe} = require('./fixtures/pe');
  const a = silentPe(path.join(dir,'First','Game.exe')), b = silentPe(path.join(dir,'Second','Game.exe'));
  const firstDlss = writePe(path.join(path.dirname(a),'nvngx_dlss.dll'));
  const secondDlss = writePe(path.join(path.dirname(b),'nvngx_dlss.dll'));
  const initial = await scanGame(dir);
  const hidden = initial.chosen.path === a ? b : a;
  const expected = hidden === b ? secondDlss : firstDlss;
  assert.deepEqual((await scanGame(dir,hidden)).dlssFiles.map(file => file.path), [expected]);
  fs.mkdirSync(path.join(dir,'_DLSS5_Backup'));
  fs.writeFileSync(path.join(dir,'_DLSS5_Backup','manifest.json'), JSON.stringify({
    version:1, game:{exe:path.relative(dir,hidden)}, added:[], replaced:[]
  }));
  const installed = await scanGame(dir);
  assert.equal(installed.chosen.path, hidden);
  assert.deepEqual(installed.dlssFiles.map(file => file.path), [expected]);
});

test('silent x86 and x64 builds with the same filename remain separately selectable', async t => {
  const dir = game(t, 'scan-silent-architectures-');
  const {writePe} = require('./fixtures/pe');
  for (const bits of [32,64]) writePe(path.join(dir, 'Win'+bits,'Game.exe'), {bitness:bits});
  writePe(path.join(dir,'Win64','nvngx_dlss.dll'));
  const scan = await scanGame(dir);
  assert.deepEqual(scan.exeCandidates.map(item => item.bitness).sort(),[32,64]);
  assert.equal(scan.chosen.bitness,64,'prefer the build beside the matching runtime');
});

test('an executable that does name its API is preferred over a silent one', async (t) => {
  const dir = game(t, 'scan-mixed-');
  silentPe(path.join(dir, 'Launcher.exe'), { size: 300 * 1024 });
  const real = silentPe(path.join(dir, 'Engine.exe'), { size: 300 * 1024 });
  // Give the second one a D3D12 marker so detection has something to read.
  const buf = fs.readFileSync(real);
  buf.write('D3D12CreateDevice', 0x1000, 'ascii');
  fs.writeFileSync(real, buf);
  silentPe(path.join(dir, 'nvngx_dlss.dll'), { dll: true });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.name, 'Engine.exe');
  assert.equal(scan.chosen.apiLabel, 'DirectX 12');
  assert.notEqual(scan.chosen.via, 'undetected');
});

test('a hidden engine executable is offered in the picker beside the detected one', async (t) => {
  const dir = game(t, 'scan-picker-');
  // "launcher" is one of the names the scanner never treats as a game, so the
  // detected one here is the front-end binary under its real name.
  const front = silentPe(path.join(dir, 'Start.exe'), { size: 300 * 1024 });
  const buf = fs.readFileSync(front);
  buf.write('D3D11CreateDevice', 0x1000, 'ascii');
  fs.writeFileSync(front, buf);
  silentPe(path.join(dir, 'Game-Win64-Shipping.exe'), { size: 400 * 1024 });
  silentPe(path.join(dir, 'f4se_loader.exe'), { size: 90 * 1024 });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.name, 'Start.exe', 'the detected one still wins automatically');
  const names = scan.exeCandidates.map(e => e.name);
  assert.ok(names.includes('Game-Win64-Shipping.exe'), 'the hidden engine binary is selectable');
  assert.ok(names.includes('f4se_loader.exe'), 'a script extender is selectable');
  for (const exe of scan.exeCandidates.filter(e => e.via === 'undetected')) {
    assert.equal(exe.api, null);
    assert.equal(exe.apiLabel, null);
  }
});

test('a folder of tools with no game evidence offers nothing', async (t) => {
  const dir = game(t, 'scan-tools-');
  silentPe(path.join(dir, 'Tool.exe'));
  silentPe(path.join(dir, 'Helper.exe'));

  const scan = await scanGame(dir);
  assert.equal(scan.chosen, null);
  assert.equal(scan.exeCandidates.length, 0, 'nothing is offered for a folder that is not a game');
});
