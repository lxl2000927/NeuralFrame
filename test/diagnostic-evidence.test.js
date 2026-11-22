'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { evaluateCoExecutionChecks } = require('../src/core/combined-manager');
const { inspectGameMfgStatus } = require('../src/core/mfg-manager');
const { hasNeuralAddon } = require('../src/core/neural-models');
const { scanGame } = require('../src/core/scan');
const { writePe, writeProvider } = require('./fixtures/pe');
const payload = require('./fixtures/payload').root;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-evidence-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const local=name=>path.join(dir,name);
  const copy=(source,dest)=>{fs.mkdirSync(path.dirname(local(dest)),{recursive:true});fs.copyFileSync(path.join(payload,source),local(dest));};
  const exe=writePe(local('game.exe'),{text:'D3D12CreateDevice'});
  async function inspect({protectedRoute=false,applyScan}={}) {
    const scan=await scanGame(dir,exe);
    applyScan?.(scan);
    const mfg=await inspectGameMfgStatus(dir,{scanResult:scan,gpuName:'NVIDIA GeForce RTX 4070'});
    mfg.knownGame={hdrFix:true};
    mfg.streamline.reflexPluginVersion='unverified version';
    const consumerAddons=['renodx-dlss5.addon64','renodx-dlss.addon64'].filter(name=>hasNeuralAddon(dir,name));
    return evaluateCoExecutionChecks(dir,scan,{mode:'latest_compatible',installed:consumerAddons.length>0,dependencies:{consumerAddons}},
      mfg,{gpu:{vramTotalMB:16384}},'rtx50_desktop',protectedRoute);
  }
  return {dir,local,copy,inspect};
}

test('Reflex diagnostics require the named Streamline plugin export even when a version is reported',async t=>{
  const f=fixture(t),name='sl.reflex.dll';
  let checks=await f.inspect();
  assert.equal(checks.reflexCheck.hasReflexDll,false);
  assert.match(checks.dlssCompat.summary,/可评估.*不代表.*帧生成/);
  assert.match(checks.backupCheck.message,/不代表.*没有其他/);
  fs.writeFileSync(f.local(name),'file presence only');
  assert.equal((await f.inspect()).reflexCheck.hasReflexDll,false);
  f.copy('enhanced/streamline-2.14.16/sl.pcl.dll',name);
  checks=await f.inspect();
  assert.equal(checks.reflexCheck.hasReflexDll,false);assert.equal(checks.reflexCheck.reflexVersion,null);
  f.copy('enhanced/streamline-2.14.16/sl.reflex.dll',name);
  checks=await f.inspect();
  assert.equal(checks.reflexCheck.hasReflexDll,true);assert.ok(checks.reflexCheck.reflexVersion);
  assert.match(checks.reflexCheck.message,/是否执行需.*验证/);
});

test('RenoDX mitigation, dual-addon and conflict reports require identified, enabled components and their host',async t=>{
  const f=fixture(t),mfg='renodx-mfgunlock.addon64',nr='renodx-dlss5.addon64',asi='OptiScaler/plugins/MFGUnlocker.asi';
  const config='[RenoDX.MFGUnlock]\nEnabled=1\nBoundaryArtifactMitigationMode=1\nRuntimeSelectionMode=1\nQualityGuardMode=2\n';
  fs.writeFileSync(f.local('ReShade.ini'),config);
  fs.writeFileSync(f.local(mfg),'fixture');fs.writeFileSync(f.local(nr),'fixture');
  f.copy('enhanced/mfg-optiscaler-170/MFGUnlocker.dll',asi);
  let checks=await f.inspect();
  assert.equal(checks.bothActive,false);assert.equal(checks.motionVectorCheck.configurationSupported,false);
  assert.equal(checks.hudFlickerCheck.hdrGameNeedsGuard,false);
  assert.ok(!checks.dllConflicts.some(c=>c.code==='MIXED_BACKEND_HOOKS'));
  f.copy('enhanced/mfg/'+mfg,mfg);f.copy(nr,nr);
  f.copy('enhanced/streamline-2.14.16/nvngx_dlssg.dll','nvngx_dlssg.dll');
  assert.equal((await f.inspect()).motionVectorCheck.mitigationActive,false);
  f.copy('reshade-vulkan/ReShade64.dll','dxgi.dll');
  checks=await f.inspect();
  assert.equal(checks.motionVectorCheck.mitigationActive,true);assert.equal(checks.bothActive,true);
  assert.match(checks.slChainCheck.message,/已配置.*运行诊断/);
  assert.ok(!checks.dllConflicts.some(c=>c.code==='MIXED_BACKEND_HOOKS'),'an unused ASI file is not a mixed configuration');
  fs.writeFileSync(f.local('ReShade.ini'),config+'[ADDON]\nDisabledAddons='+mfg+'\n');
  checks=await f.inspect();
  assert.equal(checks.bothActive,false);assert.equal(checks.motionVectorCheck.configurationSupported,false);
  fs.writeFileSync(f.local('ReShade.ini'),config+'[ADDON]\nDisabledAddons='+nr+'\n');
  assert.equal((await f.inspect()).bothActive,false);
  fs.writeFileSync(f.local('ReShade.ini'),config.replace('Enabled=1','Enabled=0'));
  assert.equal((await f.inspect()).motionVectorCheck.mitigationActive,false);
  fs.writeFileSync(f.local('ReShade.ini'),config);
  checks=await f.inspect({protectedRoute:true});
  assert.equal(checks.motionVectorCheck.configurationSupported,false);assert.equal(checks.hudFlickerCheck.configurationSupported,false);
  assert.match(checks.hudFlickerCheck.message,/未配置 RenoDX QualityGuard/);
  fs.unlinkSync(f.local(mfg));
  checks=await f.inspect();
  assert.ok(!checks.dllConflicts.some(c=>c.code==='MIXED_BACKEND_HOOKS'));
  f.copy('enhanced/anr/dxgi.dll','dxgi.dll');f.copy('reshade-vulkan/ReShade64.dll','d3d12.dll');
  f.copy('streamline/nvngx_dlss.dll','nvngx_dlss.dll');
  require('./fixtures/optiscaler-streamline').addPrivateStreamline(f.dir);
  const opti='[FrameGen]\nFGInput=upscaler\nFGOutput=dlssg\n';
  fs.writeFileSync(f.local('OptiScaler.ini'),opti);
  checks=await f.inspect();
  assert.ok(checks.dllConflicts.some(c=>c.code==='MIXED_BACKEND_HOOKS'));
  assert.equal(checks.reflexCheck.hasReflexDll,true);
  fs.writeFileSync(f.local('OptiScaler.ini'),opti+'[Plugins]\nLoadAsiPlugins=false\n');
  checks=await f.inspect();
  assert.ok(!checks.dllConflicts.some(c=>c.code==='MIXED_BACKEND_HOOKS'));
  assert.equal(checks.reflexCheck.hasReflexDll,false);
});

test('native SR diagnostic separates a driver NGX core, wrong DLSS feature, and XeSS FG or latency helpers from upscaling inputs',async t=>{
  const f=fixture(t);
  f.copy('enhanced/streamline-2.14.16/nvngx_dlss.dll','_nvngx.dll');
  f.copy('enhanced/streamline-2.14.16/nvngx_dlssg.dll','nvngx_dlss.dll');
  for(const name of ['libxell.dll','libxess_fg.dll','libxess.dll']) writePe(f.local(name));
  let checks=await f.inspect();
  assert.equal(checks.dlssCompat.mode,'no_dlss_feeder');assert.doesNotMatch(checks.dlssCompat.summary,/FSR\/XeSS/);
  writeProvider(f.local('libxess.dll'),['xessGetVersion','xessD3D12Execute']);
  assert.match((await f.inspect()).dlssCompat.summary,/1 个 FSR\/XeSS/);
  f.copy('enhanced/streamline-2.14.16/nvngx_dlss.dll','nvngx_dlss.dll');
  assert.equal((await f.inspect()).dlssCompat.mode,'native_ready');
  fs.writeFileSync(f.local('dxgi.dll'),'external loader');
  // Exercise historical version policy using proven SR bytes with a legacy scanner version.
  const legacy={applyScan:scan=>{scan.dlssFiles.find(file=>file.name==='nvngx_dlss.dll').version='1.0.0.0';}};
  checks=await f.inspect(legacy);
  assert.equal(checks.dlssCompat.mode,'dlss1x_feeder');assert.match(checks.dlssCompat.summary,/安装预览将评估/);
  const backup=f.local('_DLSS5_Backup');fs.mkdirSync(backup);
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({version:1,route:'feeder',game:{exe:'game.exe'},added:[],replaced:[]}));
  assert.match((await f.inspect(legacy)).dlssCompat.summary,/已记录 Feeder 安装路线/);
  assert.equal(fs.readFileSync(f.local('dxgi.dll'),'utf8'),'external loader');
});
