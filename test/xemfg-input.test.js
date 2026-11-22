'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe, writeProvider} = require('./fixtures/pe');
const {scanGame} = require('../src/core/scan');
const routes = require('../src/shared/install-routes');

test('XeMFG routes use the selected API and executable’s usable upscaler exports', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-xemfg-input-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const ffx = ['ffxCreateContext','ffxDestroyContext','ffxConfigure','ffxDispatch'];
  const cases = [
    ['dx12-xess', 'libxess.dll', ['xessD3D12Execute','xessGetVersion'], true, false],
    ['vk-xess', 'libxess.dll', ['xessVKExecute','xessGetVersion'], false, true],
    ['dx12-fsr', 'amd_fidelityfx_upscaler_dx12.dll', ffx, true, false],
    ['vk-fsr', 'amd_fidelityfx_vk.dll', ffx, false, true],
    ['wrong-exports', 'amd_fidelityfx_dx12.dll', ffx.slice(1), false, false],
    ['wrong-arch', 'libxess.dll', ['xessD3D12Execute','xessGetVersion'], false, false, 32],
    ['fg-only', 'amd_fidelityfx_framegeneration_dx12.dll', ffx, false, false],
    ['old-fsr', 'ffx_fsr3upscaler_x64.dll', ffx, false, false],
    ['private', 'RTXMFG-XeSS/libxess.dll', ['xessD3D12Execute','xessGetVersion'], false, false],
  ];
  for (const [label, name, symbols, dx12Input, vkInput, bits] of cases) {
    const game = path.join(root, label);
    writePe(path.join(game,'Game.exe'), {text:'D3D12CreateDevice'});
    writeProvider(path.join(game,name), symbols, bits);
    const scan = await scanGame(game), dx12 = scan.chosen;
    const vk = {...dx12, api:'vulkan', apiLabel:'Vulkan'};
    assert.equal(dx12.hasXeMfgDx12Upscaler, dx12Input, label);
    assert.equal(dx12.hasXeMfgVkUpscaler, vkInput, label);
    assert.equal(routes.componentRoutesFor(dx12).includes('xemfg'), dx12Input, label);
    assert.ok(!routes.componentRoutesFor(vk).includes('xemfg'), label);
    assert.equal(routes.componentRoutesFor({...vk,xeMfgOptiHost:'dx12-vulkan'}).includes('xemfg-optiscaler'),vkInput,label);
    assert.equal(routes.componentRoutesFor({...dx12,xeMfgOptiHost:'dx12'}).includes('xemfg-optiscaler'),dx12Input,label);
    assert.equal(routes.nativeXeMfgDx12UpscalerPresent({...scan,install:{added:[name]}}), false, label);
  }
});

test('XeMFG distinguishes a Vulkan SR input, an existing host and protected games', () => {
  const dx = {bitness:64,api:'dxgi',apiLabel:'DirectX 12',hasNativeDlssFg:true,hasXeMfgDlssFgDx12:true};
  const vk = {...dx,api:'vulkan',apiLabel:'Vulkan'};
  assert.equal(routes.xemfgReason(dx),null);
  assert.ok(routes.xemfgReason(vk));
  assert.ok(routes.xemfgReason({...vk,hasNativeDlss:true,hasXeMfgDlssSrDx12:true}));
  assert.equal(routes.xemfgReason({...vk,hasXeMfgDlssSrVk:true}),null);
  assert.equal(routes.xemfgReason({...vk,hasXeMfgDlssRrVk:true}),null);
  assert.ok(routes.xemfgOptiReason({...vk,hasXeMfgDlssRrVk:true,xeMfgOptiHost:'dx12-vulkan'}));
  assert.ok(routes.xemfgOptiReason({...dx,xeMfgOptiHost:'dx12'}),'FG alone does not supply the plugin Upscaler input');
  assert.ok(routes.xemfgReason({...dx,xeMfgOptiHost:'dx12'}));
  for (const target of [{...dx,antiCheatWarning:true}, {...dx,launcherProtected:true}, {...dx,apiLabel:'DirectX 11'}, {...dx,emulator:{}}, {...dx,bitness:32}]) {
    assert.ok(routes.xemfgReason(target));
    assert.ok(routes.xemfgOptiReason({...target,hasNativeDlss:true,xeMfgOptiHost:'dx12-vulkan'}));
  }
});

test('a provider export must refer to a function or forwarder backed by actual file bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-export-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const file = path.join(root, 'libxess.dll'), symbols = ['xessD3D12Execute', 'xessGetVersion'];
  const pe = require('../src/core/pe');
  writeProvider(file, symbols);
  const valid = fs.readFileSync(file);
  for (const change of [
    bytes => bytes.writeUInt32LE(0, 0x250),
    bytes => bytes.writeUInt16LE(9, 0x260),
    bytes => bytes.writeUInt32LE(0x7fffffff, 0x250),
    bytes => bytes.writeUInt32LE(0x1180, 0x250), // Empty forwarder string inside the export directory.
    bytes => bytes.writeUInt32LE(0x200, 0x80 + 24 + 240 + 16), // Function in zero-filled virtual tail.
  ]) {
    const bytes = Buffer.from(valid);
    change(bytes);
    fs.writeFileSync(file, bytes);
    assert.equal(pe.hasExports(file, symbols), false);
  }
  fs.writeFileSync(file, valid.subarray(0, 0x401)); // Code RVA 0x1300 would map to offset 0x500.
  assert.equal(pe.hasExports(file, symbols), false);
  const forwarded = Buffer.from(valid);
  forwarded.writeUInt32LE(0x1180, 0x250);
  forwarded.write('provider.xessD3D12Execute\0', 0x380);
  fs.writeFileSync(file, forwarded);
  assert.equal(pe.hasExports(file, symbols), true);
});
