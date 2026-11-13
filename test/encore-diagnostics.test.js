'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {writePe,writeNr}=require('./fixtures/pe');
const {inspectCombinedStatus}=require('../src/core/combined-manager');
const {scanGame}=require('../src/core/scan');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-encore-diagnostic-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=writePe(path.join(dir,'game.exe'),{text:'D3D11CreateDevice',size:131072});
  const files={};
  for(const name of ['version.dll','sl.interposer.dll','sl.common.dll','sl.dlss_g.dll','sl.reflex.dll','sl.pcl.dll','nvngx_dlssg.dll']) {
    const file=writePe(path.join(dir,name),{version:name==='nvngx_dlssg.dll'?[310,9,16,0]:[2,14,16,0]});
    files[name]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  fs.writeFileSync(path.join(dir,'rtx-encore.jsonc'),JSON.stringify({configVersion:4,
    frameGeneration:{frameGenerationWithoutGameFg:true,mode:'fixed',multiplier:3},renderingEngines:{frameGenerationEngine:'dlss-fg'}}));
  const manifest={version:1,route:'encore',game:{exe:'game.exe',api:'dxgi',bitness:64},added:[...Object.keys(files),'rtx-encore.jsonc'],replaced:[],encore:{version:'2.3.0',proxy:'version.dll',files}};
  fs.mkdirSync(path.join(dir,'_DLSS5_Backup'));fs.writeFileSync(path.join(dir,'_DLSS5_Backup','manifest.json'),JSON.stringify(manifest));
  const hardware={gpu:{name:'NVIDIA GeForce RTX 4070 Laptop GPU',driver:'621.14',vramTotalMB:8192,architecture:{code:'ada',sm:'89'}}};
  const inspect=extra=>inspectCombinedStatus(dir,{payloadDir:path.join(dir,'empty-payload'),userDataDir:path.join(dir,'profile'),detectedHardware:hardware,...extra});
  return {dir,exe,manifest,hardware,inspect};
}
test('Encore DX11 status uses added-FG requirements and does not claim a RenoDX VRAM estimate',async t=>{
  const f=fixture(t),status=await f.inspect();
  assert.equal(status.encore.installed,true);assert.equal(status.mfg.currentConfig.mode,'x3');
  assert.match(status.mfg.effectiveMultiplier,/x3.*待/);
  assert.equal(status.diagnostics.dllConflicts.some(c=>c.code==='UNSUPPORTED_API_FOR_MFG'),false);
  assert.equal(status.diagnostics.combinedStatus,'experimental');
  assert.deepEqual(status.neural.dependencies.missing,[],'SR and RenoDX are not required by this backend');
  assert.equal(status.diagnostics.coExecution.vramBudget.level,'unknown');
  assert.equal(status.diagnostics.coExecution.vramBudget.estimatedTotalMB,undefined);
  // A different injector conflict must not be suppressed by the DX11 exception.
  writePe(path.join(f.dir,'dlssg_to_fsr3_amd_is_better.dll'));
  const conflicted=await f.inspect();
  assert.ok(conflicted.diagnostics.dllConflicts.some(c=>c.code==='CONFLICT_DLSSG_TO_FSR3'));
  assert.equal(conflicted.diagnostics.combinedStatus,'incompatible');
});
test('Encore status preserves model architecture failures rather than replacing them with experimental',async t=>{
  const f=fixture(t);
  writeNr(path.join(f.dir,'nvngx_dlssnr.dll'),'310.9.16.0',120);
  fs.writeFileSync(path.join(f.dir,'rtx-encore.jsonc'),JSON.stringify({configVersion:4,neuralRendering:{core:{nrEnabled:true}}}));
  const status=await f.inspect();
  assert.equal(status.neural.dependencies.hasNeuralDll,true);
  assert.equal(status.neural.gpuCompatibility.status,'incompatible');
  assert.equal(status.neural.overallStatus,'incompatible');
  assert.equal(status.diagnostics.combinedStatus,'incompatible');
});
test('inspecting another executable does not attach the installed Encore backend to it',async t=>{
  const f=fixture(t),other=writePe(path.join(f.dir,'Other','Another.exe'),{text:'D3D12CreateDevice',size:131072});
  const scan=await scanGame(f.dir,other),status=await f.inspect({scanResult:scan});
  assert.equal(status.exePath,other);assert.equal(status.encore.installed,false);assert.equal(status.encore.error,undefined);
  assert.notEqual(status.mfg.currentConfig.backend,'encore');
  assert.doesNotMatch(status.neural.overallBadge,/Encore 配置已读取/);
});
