'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {writePe} = require('./fixtures/pe');
const payload = require('./fixtures/payload').root;
const {applyMfgConfiguration,MFG_UNLOCKERS} = require('../src/core/mfg-manager');
const {ComponentReview} = require('../src/core/component-review');
const addon = MFG_UNLOCKERS.renodxAddon.fileName;
const host = (bits,ext='dll') => path.join(payload,'reshade-vulkan',`ReShade${bits}.${ext}`);
function fixture(t,api='d3d12') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-mfg-host-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const game=path.join(root,'game'),profile=path.join(root,'profile'),local=name=>path.join(game,name);
  const exePath=writePe(local('Game.exe'),{text:api==='vulkan' ? 'vkCreateInstance' : 'D3D12CreateDevice'});
  fs.copyFileSync(path.join(payload,'enhanced/streamline-2.14.16/nvngx_dlssg.dll'),local('nvngx_dlssg.dll'));
  const registry = new Set();
  const runner = async (_file,args)=>{
    if (args[0]==='query') return {code:0,stdout:[...registry].map(file=>`    ${file}    REG_DWORD    0x0`).join('\n')};
    if (!require('../src/core/preview-fs').active()) registry.add(args[args.indexOf('/v')+1]);
    return {code:0,stdout:''};
  };
  const reviews=new ComponentReview(profile);
  function actions(payloadDir=payload) {
    const options={exePath,apiOverride:api,backend:'renodx-mfgunlock',gpuName:'NVIDIA GeForce RTX 4070',
      mode:'x3',upgradeDlssg:false,payloadDir,userDataDir:profile,registryRunner:runner};
    const install=()=>applyMfgConfiguration(game,options);
    const run=token=>reviews.run(game,{kind:'mfg',config:{mode:'x3',api}},install,token);
    return {run,install};
  }
  const partial=path.join(root,'payload');
  const addonPath=path.join(partial,MFG_UNLOCKERS.renodxAddon.relPath);
  fs.mkdirSync(path.dirname(addonPath),{recursive:true});
  fs.copyFileSync(path.join(payload,MFG_UNLOCKERS.renodxAddon.relPath),addonPath);
  return {root,game,local,profile,partial,registry,actions};
}
test('DX12 MFG previews and installs a loadable host, keeping an unrelated D3D9 host and occupied DXGI',async t=>{
  const f=fixture(t),{run}=f.actions();
  fs.copyFileSync(host(64),f.local('d3d9.dll'));fs.writeFileSync(f.local('dxgi.dll'),'other renderer');
  const {preview}=await run();
  assert.ok(preview.rows.some(row=>row.rel==='d3d12.dll' && row.action==='add'));
  assert.equal(fs.existsSync(f.local(addon)),false);
  assert.equal((await run(preview.token)).ok,true);
  assert.deepEqual(fs.readFileSync(f.local('d3d12.dll')),fs.readFileSync(host(64)));
  assert.deepEqual(fs.readFileSync(f.local('d3d9.dll')),fs.readFileSync(host(64)));
  assert.equal(fs.readFileSync(f.local('dxgi.dll'),'utf8'),'other renderer');
});
test('DX12 MFG checks the active proxy architecture and never overwrites a wrong-bitness host',async t=>{
  const f=fixture(t),{run,install}=f.actions();
  fs.copyFileSync(host(32),f.local('dxgi.dll'));
  await assert.rejects(run(),/架构不匹配/);await assert.rejects(install(),/架构不匹配/);
  assert.deepEqual(fs.readFileSync(f.local('dxgi.dll')),fs.readFileSync(host(32)));
  assert.equal(fs.existsSync(f.local(addon)),false);
});
test('a wrong-bitness DXGI host does not hide a matching D3D12 add-on host',async t=>{
  const f=fixture(t),{run}=f.actions(f.partial);
  fs.copyFileSync(host(32),f.local('dxgi.dll'));fs.copyFileSync(host(64),f.local('d3d12.dll'));
  const {preview}=await run();
  assert.ok(preview.rows.every(row=>!['dxgi.dll','d3d12.dll'].includes(row.rel) || row.action==='keep'));
  assert.equal((await run(preview.token)).ok,true);
  assert.deepEqual(fs.readFileSync(f.local('dxgi.dll')),fs.readFileSync(host(32)));
  assert.deepEqual(fs.readFileSync(f.local('d3d12.dll')),fs.readFileSync(host(64)));
});
for (const api of ['d3d12','vulkan']) test(api+' MFG requires a complete host if none is already usable',async t=>{
  const f=fixture(t,api),{run,install}=f.actions(f.partial);
  // A DLL with a missing layer manifest must also fail before a Vulkan install.
  if (api==='vulkan') {
    fs.mkdirSync(path.join(f.partial,'reshade-vulkan'));
    fs.copyFileSync(host(64),path.join(f.partial,'reshade-vulkan/ReShade64.dll'));
  }
  await assert.rejects(run(),{code:'errReShadePayloadMissing'});await assert.rejects(install(),{code:'errReShadePayloadMissing'});
  assert.equal(fs.existsSync(f.local(addon)),false);assert.equal(f.registry.size,0);
});
test('Vulkan MFG verifies registered layer DLLs, accepts a matching external layer without a bundled host',async t=>{
  const f=fixture(t,'vulkan'),{run,install}=f.actions(f.partial),ext=path.join(f.root,'external');
  fs.mkdirSync(ext);
  for (const bits of [32,64]) for (const extn of ['json','dll'])
    fs.copyFileSync(host(bits,extn),path.join(ext,`ReShade${bits}.${extn}`));
  const wrong=path.join(ext,'ReShade32.json'),right=path.join(ext,'custom.json');
  fs.renameSync(path.join(ext,'ReShade64.json'),right);
  f.registry.add(wrong);
  await assert.rejects(run(),/Vulkan/);await assert.rejects(install(),/Vulkan/);
  assert.equal(fs.existsSync(f.local(addon)),false);
  f.registry.add(right);
  const {preview}=await run();
  assert.equal((await run(preview.token)).ok,true);
  const receipt=require('../src/core/backend-manager').readManifest(f.game);
  assert.deepEqual(receipt.vulkanLayer,{manifest:right,owned:false,global:true});
  assert.ok(fs.existsSync(f.local(addon)));
});
test('a registered managed Vulkan add-on layer remains usable after the downloaded pack has been cleared',async t=>{
  const f=fixture(t,'vulkan'),{run}=f.actions(),manifest=path.join(f.profile,'reshade-vulkan','ReShade64.json');
  const {preview}=await run();
  assert.equal(f.registry.size,0);assert.equal(fs.existsSync(manifest),false);
  assert.equal((await run(preview.token)).ok,true);assert.ok(f.registry.has(manifest));
  const original=fs.readFileSync(manifest);
  const repeat=f.actions(f.partial);
  assert.equal((await repeat.install()).ok,true);
  assert.deepEqual(fs.readFileSync(manifest),original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(manifest),'installs.json'))).games,[f.game]);
});
