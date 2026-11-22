'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routesFor, recommendedRoute } = require('../src/shared/install-routes');

test('OptiFG and standalone XeMFG respect the selected host and its DX12 input', () => {
  const {componentRoutesFor} = require('../src/shared/install-routes');
  const {requiredPacks} = require('../src/core/runtime-payload');
  const target = {api:'dxgi', apiLabel:'DirectX 12', bitness:64, optiFgHost:true, hasOptiFgDx12Upscaler:true};
  assert.deepEqual(componentRoutesFor(target), ['optifg']);
  assert.deepEqual(componentRoutesFor({...target, hasOptiFgDx12Upscaler:false, hasNativeDlss:true}), []);
  assert.deepEqual(requiredPacks({kind:'install', route:'optifg'}), []);
  for (const change of [{optiFgHost:false}, {hasOptiFgDx12Upscaler:false}, {bitness:32},
    {api:'vulkan'}, {apiLabel:'DirectX 11'}, {antiCheatWarning:true}, {emulator:{}}])
    assert.deepEqual(componentRoutesFor({...target, ...change}), []);
  const xess = {...target, optiFgHost:false, hasOptiFgDx12Upscaler:false, hasXeMfgDx12Upscaler:true};
  assert.deepEqual(componentRoutesFor(xess), ['xemfg']);
  assert.deepEqual(componentRoutesFor({...xess, hasOptiScalerConfig:true}), []);
});

test('native MFG requires a confirmed DX12 or Vulkan renderer and Feeder preferences follow their executable', () => {
  const {supportsMfg} = require('../src/shared/install-routes');
  const target={bitness:64,api:'dxgi',apiLabel:'DirectX 12',hasNativeDlss:true,rel:'Main/Game.exe'};
  assert.equal(supportsMfg(target),true);
  for (const apiLabel of ['DirectX 11/12','DirectX (DXGI)','DirectX 11',null]) assert.equal(supportsMfg({...target,apiLabel}),false);
  assert.equal(supportsMfg({...target,api:'vulkan'}),true);
  assert.equal(supportsMfg({...target,bitness:32}),false);
  const scan={chosen:target,install:{route:'feeder',exe:'Main\\Game.exe'}};
  assert.equal(recommendedRoute(scan),'feeder');
  assert.equal(recommendedRoute(scan,{...target,rel:'Alt/Game.exe'}),'native');
  assert.deepEqual(routesFor({...target,launcherProtected:true}),[]);
  assert.equal(recommendedRoute(scan,{...target,launcherProtected:true}),'wuwa-proxy');
});

test('SWTOR x64 DX9 always uses Feeder even with old injected DLSS DLLs', () => {
  const chosen = { bitness: 64, api: 'd3d9', apiLabel: 'DirectX 9' };
  // The DLSS Tool joins it here: it presents on D3D9 through its own D3D12
  // endpoint rather than through dgVoodoo. Feeder is still what a DX9 game
  // gets recommended, and still the only route with the translation layer.
  assert.deepEqual(routesFor(chosen), ['feeder', 'renodx']);
  assert.equal(recommendedRoute({ chosen, primaryDlss: { rel: 'nvngx_dlss.dll' }, install: { route: 'native' } }), 'feeder');
});
test('DX8 x86, DX10 and DX11 use Feeder', () => {
  assert.deepEqual(routesFor({ bitness: 32, api: 'd3d8' }), ['feeder']);
  assert.deepEqual(routesFor({ bitness: 64, api: 'd3d8' }), []);
  assert.deepEqual(routesFor({ bitness: 64, api: 'dxgi', apiLabel: 'DirectX 11' }), ['feeder', 'renodx']);
  for (const bitness of [32, 64]) {
    assert.deepEqual(routesFor({ bitness, api: 'd3d10' }), ['feeder']);
    assert.deepEqual(routesFor({ bitness, api: 'dxgi', apiLabel: 'DirectX 10' }), ['feeder']);
  }
});
test('real native DX12 stays available; injected DLLs never select native by themselves', () => {
  const chosen = { bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  const primaryDlss = { rel: 'Engine\\nvngx_dlss.dll' };
  assert.deepEqual(routesFor(chosen), ['native', 'feeder', 'renodx']);
  assert.equal(recommendedRoute({ chosen, primaryDlss }), 'native');
  assert.equal(recommendedRoute({ chosen, primaryDlss, install: { added: ['engine/nvngx_dlss.dll'] } }), 'feeder');
  assert.deepEqual(routesFor({ ...chosen, emulator: { key: 'xenia' } }), ['feeder', 'renodx']);
});
