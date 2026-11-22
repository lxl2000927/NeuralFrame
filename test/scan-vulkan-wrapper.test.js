'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanGame } = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const { writePe } = require('./fixtures/pe');

function game(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a game running through DXVK is reported as Vulkan, not DirectX', async (t) => {
  const dir = game(t, 'scan-dxvk-');
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, text: 'Direct3DCreate9', imports: ['d3d9.dll'] });
  writePe(path.join(dir, 'd3d9.dll'), { bitness: 64, dll: true, text: 'DXVK vkGetInstanceProcAddr' });
  writePe(path.join(dir, 'nvngx_dlss.dll'), { bitness: 64, dll: true });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.apiLabel, 'Vulkan');
  assert.equal(scan.chosen.api, 'vulkan');
  assert.equal(scan.chosen.via, 'vulkan-wrapper');
  assert.equal(scan.chosen.dx12, false);
  // The renderer the executable itself names stays selectable, for a wrapper
  // that is present but not in use.
  assert.deepEqual(scan.chosen.apiChoices.map(c => c.label), ['Vulkan', 'DirectX 9']);
  assert.deepEqual(routes.routesFor(scan.chosen), ['feeder', 'optiscaler', 'encore']);
});

test('the same game without the wrapper stays DirectX', async (t) => {
  const dir = game(t, 'scan-plain-d3d9-');
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, text: 'Direct3DCreate9', imports: ['d3d9.dll'] });
  writePe(path.join(dir, 'nvngx_dlss.dll'), { bitness: 64, dll: true });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.apiLabel, 'DirectX 9');
  assert.notEqual(scan.chosen.via, 'vulkan-wrapper');
});

test("ReShade's own proxy of the same name is not mistaken for a wrapper", async (t) => {
  const dir = game(t, 'scan-reshade-proxy-');
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, text: 'D3D12CreateDevice', imports: ['d3d12.dll'] });
  // ReShade installed as dxgi.dll: it mentions Vulkan entry points too, and
  // reading it as a wrapper would move an installed game to the wrong route.
  writePe(path.join(dir, 'dxgi.dll'), { bitness: 64, dll: true, text: 'ReShade DXVK vkGetInstanceProcAddr' });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.apiLabel, 'DirectX 12');
  assert.equal(scan.chosen.dx12, true);
});

test('a 32-bit wrapper beside a 64-bit game is not the wrapper for it', async (t) => {
  const dir = game(t, 'scan-mixed-bitness-');
  writePe(path.join(dir, 'Game.exe'), { bitness: 64, text: 'Direct3DCreate9', imports: ['d3d9.dll'] });
  writePe(path.join(dir, 'd3d9.dll'), { bitness: 32, dll: true, text: 'DXVK vkGetInstanceProcAddr' });

  const scan = await scanGame(dir);
  assert.equal(scan.chosen.apiLabel, 'DirectX 9');
});

test('a wrapper only applies to the Direct3D version the selected executable loads', async t => {
  const dir = game(t, 'scan-dx-variants-');
  const dx11 = writePe(path.join(dir,'Game11.exe'), {text:'D3D11CreateDevice'});
  const dx12 = writePe(path.join(dir,'Game12.exe'), {text:'D3D12CreateDevice'});
  const wrapper = writePe(path.join(dir,'d3d11.dll'), {text:'DXVK vkGetInstanceProcAddr'});
  let scan = await scanGame(dir);
  const label = file => scan.exeCandidates.find(item => item.path === file).apiLabel;
  assert.equal(label(dx11), 'Vulkan');
  assert.equal(label(dx12), 'DirectX 12');
  fs.renameSync(wrapper, path.join(dir,'d3d12.dll'));
  scan = await scanGame(dir);
  assert.equal(label(dx11), 'DirectX 11');
  assert.equal(label(dx12), 'Vulkan');
});

test('a Vulkan installation receipt belongs only to its recorded executable', async t => {
  const dir = game(t, 'scan-layer-owner-');
  const exe = writePe(path.join(dir,'First','Game.exe'), {text:'vkCreateInstance'});
  const other = writePe(path.join(dir,'Second','Other.exe'), {text:'D3D11CreateDevice'});
  const layer = path.join(dir,'ReShade64.json');
  fs.writeFileSync(layer, '{}');
  fs.mkdirSync(path.join(dir,'_DLSS5_Backup'));
  fs.writeFileSync(path.join(dir,'_DLSS5_Backup','manifest.json'), JSON.stringify({
    version:1, game:{exe:path.relative(dir,exe),api:'vulkan'}, route:'feeder', added:[], replaced:[],
    vulkanLayer:{manifest:layer}
  }));
  assert.equal((await scanGame(dir,exe)).reshade.kind,'vulkan-layer');
  assert.equal((await scanGame(dir,other)).reshade.installed,false);
});
