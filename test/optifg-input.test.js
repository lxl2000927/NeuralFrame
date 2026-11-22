'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {writePe,writeProvider} = require('./fixtures/pe');
const {scanGame} = require('../src/core/scan');

const providers = [
  ['fsr2','ffx_fsr2_api_x64.dll','ffxFsr2Context','ffx_fsr2_api_dx12_x64.dll','ffxFsr2GetInterfaceDX12'],
  ['fsr3','ffx_fsr3upscaler_x64.dll','ffxFsr3UpscalerContext','ffx_backend_dx12_x64.dll','ffxGetInterfaceDX12'],
];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'nf-optifg-input-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
const context = name => ['Create','Dispatch','Destroy'].map(suffix => name + suffix);
const ngx = api => ['CreateFeature','EvaluateFeature','ReleaseFeature'].map(suffix => 'NVSDK_NGX_' + api + '_' + suffix);
const game = (dir,bitness = 64) => writePe(path.join(dir,'Game.exe'),{bitness,text:'D3D12CreateDevice'});

for (const [kind,frontend,prefix,backend,dx12] of providers) {
  test(kind + ' requires the matching x64 DX12 backend and usable upscaler exports for the selected executable',async t => {
    const dir = fixture(t), first = path.join(dir,'One'), second = path.join(dir,'Two');
    const a = game(first), b = game(second), inputs = async exe => (await scanGame(dir,exe)).chosen.optiFgInputs;
    writeProvider(path.join(first,frontend),context(prefix));
    writeProvider(path.join(second,backend),[dx12]);
    assert.deepEqual(await inputs(a),[]);
    assert.deepEqual(await inputs(b),[]);
    writeProvider(path.join(first,backend),[dx12],32);
    assert.deepEqual(await inputs(a),[]);
    writeProvider(path.join(first,backend),['ffxGetInterfaceVK']);
    assert.deepEqual(await inputs(a),[]);
    writeProvider(path.join(first,backend),[dx12]);
    writeProvider(path.join(first,frontend),context(prefix).slice(0,2));
    assert.deepEqual(await inputs(a),[]);
    writeProvider(path.join(first,frontend),context(prefix));
    let scan = await scanGame(dir,a);
    assert.deepEqual(scan.chosen.optiFgInputs,[kind]);
    assert.equal(scan.chosen.hasOptiFgDx12Upscaler,true);
    assert.equal(scan.chosen.hasXeMfgDx12Upscaler,false);
    assert.equal(scan.upscalerFiles.find(file => file.name === frontend).optiFgDx12Input,kind);
    assert.deepEqual(await inputs(b),[]);
    const backup = path.join(dir,'_DLSS5_Backup');
    fs.mkdirSync(backup);
    const receipt = path.join(backup,'manifest.json');
    for (const managed of [backend,frontend]) {
      fs.writeFileSync(receipt,JSON.stringify({version:1,game:{exe:'One/Game.exe'},added:['One/'+managed],replaced:[]}));
      assert.deepEqual(await inputs(a),[]);
    }
    fs.unlinkSync(receipt);
    game(first,32);
    assert.deepEqual(await inputs(a),[]);
    game(first);
    fs.mkdirSync(path.join(first,'OptiScaler'));
    for (const name of [backend,frontend]) fs.renameSync(path.join(first,name),path.join(first,'OptiScaler',name));
    scan = await scanGame(dir,a);
    assert.equal(scan.chosen.hasOptiFgDx12Upscaler,false);
  });
}

test('OptiScaler config presence is scoped to the executable even when its host cannot be identified',async t => {
  const dir = fixture(t), gameDir = path.join(dir,'client'), other = path.join(dir,'other');
  const exe = game(gameDir), clear = game(other);
  for (const at of ['OptiScaler/OptiScaler.ini','OptiScaler.ini']) {
    const file = path.join(gameDir,at);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,'[Plugins]\nLoadAsiPlugins=true\n');
    const target = (await scanGame(dir,exe)).chosen;
    assert.equal(target.hasOptiScalerConfig,true);
    assert.equal(target.optiFgHost,false);
    assert.equal(target.xeMfgOptiHost,null);
    assert.equal((await scanGame(dir,clear)).chosen.hasOptiScalerConfig,false);
    fs.unlinkSync(file);
  }
});

test('XeMFG identifies native NGX SR, RR and FG separately by executable and render API',async t => {
  const dir = fixture(t), one = path.join(dir,'DX'), two = path.join(dir,'VK');
  const dx = game(one), vk = game(two);
  writeProvider(path.join(one,'nvngx_dlss.dll'),ngx('D3D12'));
  writeProvider(path.join(two,'nvngx_dlss.dll'),ngx('VULKAN'));
  writeProvider(path.join(two,'nvngx_dlssd.dll'),ngx('D3D12'));
  writeProvider(path.join(one,'nvngx_dlssg.dll'),ngx('D3D12'));
  let target = (await scanGame(dir,dx)).chosen;
  assert.equal(target.hasXeMfgDlssSrDx12,true);
  assert.equal(target.hasXeMfgDlssSrVk,false);
  assert.equal(target.hasXeMfgDlssRrDx12,false);
  assert.equal(target.hasXeMfgDlssFgDx12,true);
  assert.deepEqual(target.optiFgInputs,['dlss']);
  target = (await scanGame(dir,vk)).chosen;
  assert.equal(target.hasXeMfgDlssSrDx12,false);
  assert.equal(target.hasXeMfgDlssSrVk,true);
  assert.equal(target.hasXeMfgDlssRrDx12,true);
  assert.equal(target.hasXeMfgDlssRrVk,false);
  assert.equal(target.hasXeMfgDlssFgDx12,false);
  assert.deepEqual(target.optiFgInputs,[]);
  fs.renameSync(path.join(one,'nvngx_dlss.dll'),path.join(one,'_nvngx.dll'));
  writeProvider(path.join(one,'nvngx_dlss.dll'),ngx('D3D12'),32);
  fs.unlinkSync(path.join(one,'nvngx_dlssg.dll'));
  writeProvider(path.join(one,'sl.dlss_g.dll'),['slGetPluginFunction']);
  target = (await scanGame(dir,dx)).chosen;
  assert.equal(target.hasXeMfgDlssSrDx12,false);
  assert.equal(target.hasXeMfgDlssFgDx12,false);
  fs.appendFileSync(path.join(one,'sl.dlss_g.dll'),'slDLSSGGetState\0slDLSSGSetOptions\0');
  assert.equal((await scanGame(dir,dx)).chosen.hasXeMfgDlssFgDx12,true);
  fs.mkdirSync(path.join(dir,'_DLSS5_Backup'));
  fs.writeFileSync(path.join(dir,'_DLSS5_Backup/manifest.json'),JSON.stringify({
    version:1,game:{exe:'DX/Game.exe'},added:['DX/sl.dlss_g.dll','VK/nvngx_dlss.dll','VK/nvngx_dlssd.dll'],replaced:[],
  }));
  assert.equal((await scanGame(dir,dx)).chosen.hasXeMfgDlssFgDx12,false);
  target = (await scanGame(dir,vk)).chosen;
  assert.equal(target.hasXeMfgDlssSrVk,false);
  assert.equal(target.hasXeMfgDlssRrDx12,false);
});
