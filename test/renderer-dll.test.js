'use strict';
// #259, #249: Prey, Titanfall 2, Call of Duty 2 and Max Payne load their
// renderer from a DLL, so their executables import no Direct3D and the folder
// read as having no game in it. The game's own library says which API it uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writePe } = require('./fixtures/pe');
const { scanGame } = require('../src/core/scan');

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-renderer-dll-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('a game whose renderer is a DLL is offered with that API', async (t) => {
  const dir = temp(t);
  const bin = path.join(dir, 'Binaries', 'Danielle', 'x64', 'Release');
  writePe(path.join(bin, 'Prey.exe'), { bitness: 64, size: 256 * 1024 });
  writePe(path.join(bin, 'CryRenderD3D11.dll'), { bitness: 64, text: 'D3D11CreateDevice' });
  const found = await scanGame(dir);
  assert.ok(found.chosen, 'the folder is a game after all');
  assert.equal(found.chosen.name, 'Prey.exe');
  assert.equal(found.chosen.api, 'dxgi');
  assert.equal(found.chosen.apiLabel, 'DirectX 11');
  assert.equal(found.chosen.via, 'renderer-module:CryRenderD3D11.dll');
});

test('the executable has to match the renderer’s bitness', async (t) => {
  const dir = temp(t);
  writePe(path.join(dir, 'Game64.exe'), { bitness: 64 });
  writePe(path.join(dir, 'render32.dll'), { bitness: 32, text: 'Direct3DCreate9' });
  const found = await scanGame(dir);
  assert.equal(found.chosen, null);
  assert.equal(found.emptyReason, 'renderer-in-dll', 'still named, so the message is honest');
});

test('a UnityPlayer with two Direct3D backends does not qualify the game for DX12-only components', async t => {
  const dir = temp(t);
  writePe(path.join(dir,'Game.exe'));
  writePe(path.join(dir,'UnityCrashHandler64.exe'),{text:'D3D12CreateDevice'});
  const player = path.join(dir,'UnityPlayer.dll');
  writePe(player,{text:'D3D11CreateDevice D3D12CreateDevice'});
  const scan = await scanGame(dir);
  assert.deepEqual(scan.exeCandidates.map(exe=>exe.name),['Game.exe']);
  assert.equal(scan.chosen.apiLabel,'DirectX 11/12');
  assert.equal(require('../src/shared/install-routes').supportsMfg(scan.chosen),false);
  const wrapper = path.join(dir,'d3d12.dll');
  writePe(wrapper,{text:'vkd3d vkGetInstanceProcAddr'});
  assert.equal((await scanGame(dir)).chosen.apiLabel,'DirectX 11/12');
  fs.unlinkSync(wrapper);
  writePe(player,{text:'D3D11CreateDevice'});
  assert.equal((await scanGame(dir)).chosen.apiLabel,'DirectX 11');
});

test('independent renderer modules describe each build alongside an already detected executable', async t => {
  const dir = temp(t);
  const main = writePe(path.join(dir,'Direct','Main.exe'), {text:'D3D12CreateDevice'});
  const wrapped = writePe(path.join(dir,'Variant','Game.exe'));
  writePe(path.join(dir,'Variant','CryRender.dll'), {text:'D3D11CreateDevice'});
  writePe(path.join(dir,'Variant','d3d11.dll'), {text:'DXVK vkGetInstanceProcAddr'});
  const legacy = writePe(path.join(dir,'Classic','Game.exe'), {bitness:32});
  writePe(path.join(dir,'Classic','ClassicRender.dll'), {bitness:32,text:'Direct3DCreate9'});
  const scan = await scanGame(dir);
  assert.equal(scan.chosen.path, main);
  const variant = file => scan.exeCandidates.find(exe => exe.path === file);
  assert.equal(variant(wrapped)?.api, 'vulkan');
  assert.deepEqual(variant(wrapped).apiChoices.map(choice => choice.label), ['Vulkan','DirectX 11']);
  assert.equal(variant(legacy)?.apiLabel, 'DirectX 9');
});

test('a browser engine or a shader compiler is not a renderer', async (t) => {
  const dir = temp(t);
  writePe(path.join(dir, 'Tool.exe'), { bitness: 64 });
  writePe(path.join(dir, 'libGLESv2.dll'), { bitness: 64, text: 'D3D11CreateDevice' });
  writePe(path.join(dir, 'd3dcompiler_47.dll'), { bitness: 64, text: 'D3D11CreateDevice' });
  const found = await scanGame(dir);
  assert.equal(found.chosen, null, 'a folder of tools stays a folder of tools');
});

// #199: installing into Dota 2 broke it. Source 2 is recognised - the reason is
// shown - but never offered as something to install into.
test('Source 2 is recognised but not offered', async (t) => {
  // The folder someone adds by hand when the library does not find it: the
  // executable and the renderer side by side.
  const dir = temp(t);
  writePe(path.join(dir, 'dota2.exe'), { bitness: 64 });
  writePe(path.join(dir, 'rendersystemdx11.dll'), { bitness: 64, text: 'D3D11CreateDevice' });
  const found = await scanGame(dir);
  assert.equal(found.chosen, null);
  assert.equal(found.emptyReason, 'renderer-in-dll');
});
