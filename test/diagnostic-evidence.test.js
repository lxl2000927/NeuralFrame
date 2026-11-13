'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { evaluateCoExecutionChecks } = require('../src/core/combined-manager');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-evidence-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const scan = {chosen:{path:path.join(dir, 'game.exe'),api:'dxgi',apiLabel:'DirectX 12'},dlssFiles:[]};
  const mfg = {currentConfig:{installed:true,mode:'x3',backend:'renodx'},streamline:{present:true},dlssg:{valid:true},gpuSupport:{hardwareFlipMetering:true}};
  const inspect = (protectedRoute=false) => evaluateCoExecutionChecks(dir, scan, {mode:'latest_compatible'}, mfg,
    {gpu:{architecture:{code:'blackwell'},vramTotalMB:16384}}, 'rtx50_desktop', protectedRoute);
  return {dir,scan,mfg,inspect};
}

test('static diagnostics do not infer running Reflex or installed Feeder from a hardware profile', t => {
  const f = fixture(t), result = f.inspect();
  assert.equal(result.reflexCheck.hasReflexDll, false);
  assert.equal(result.reflexCheck.ok, false);
  assert.match(result.reflexCheck.message, /无法据此判断/);
  assert.match(result.dlssCompat.summary, /可评估.*不代表.*帧生成/);
  assert.doesNotMatch(result.dlssCompat.summary, /已自动|已启用|1\.19\.0/);
  assert.match(result.backupCheck.message, /不代表.*没有其他/);
  fs.writeFileSync(path.join(f.dir, 'sl.reflex.dll'), 'file presence only');
  assert.match(f.inspect().reflexCheck.message, /是否执行需.*验证/);
});

test('mitigation requires the matching plugin and configuration, not an ASI backend name', t => {
  const f = fixture(t);
  f.mfg.currentConfig.backend = 'mfg-unlocker-asi';
  fs.writeFileSync(path.join(f.dir, 'ReShade.ini'), '[RenoDX.MFGUnlock]\nBoundaryArtifactMitigationMode=1\nRuntimeSelectionMode=1\n');
  assert.equal(f.inspect().motionVectorCheck.mitigationActive, false);
  assert.equal(f.inspect().motionVectorCheck.configurationSupported, false);
  fs.writeFileSync(path.join(f.dir, 'renodx-mfgunlock.addon64'), 'fixture');
  fs.writeFileSync(path.join(f.dir, 'renodx-dlss5.addon64'), 'fixture');
  let checks = f.inspect();
  assert.equal(checks.motionVectorCheck.mitigationActive, true);
  assert.match(checks.slChainCheck.message, /已配置.*运行诊断/);
  checks = f.inspect(true);
  assert.equal(checks.motionVectorCheck.configurationSupported, false);
  assert.equal(checks.motionVectorCheck.mitigationActive, false);
  assert.equal(checks.hudFlickerCheck.configurationSupported, false);
  assert.match(checks.hudFlickerCheck.message, /未配置 RenoDX QualityGuard/);
});

test('old DLSS, collision fallback and deployed Feeder descriptions reflect evidence without writing files', t => {
  const f = fixture(t);
  f.scan.dlssFiles = [{path:path.join(f.dir,'nvngx_dlss.dll'),name:'nvngx_dlss.dll',version:'1.0.0.0',rel:'nvngx_dlss.dll'}];
  fs.writeFileSync(path.join(f.dir, 'dxgi.dll'), 'external loader');
  const before = fs.readFileSync(path.join(f.dir, 'dxgi.dll'));
  let checks = f.inspect();
  assert.equal(checks.dlssCompat.mode, 'dlss1x_feeder');
  assert.match(checks.dlssCompat.summary, /请先预览安装/);
  assert.match(checks.dlssCompat.summary, /安装预览将评估/);
  const backup = path.join(f.dir, '_DLSS5_Backup');
  fs.mkdirSync(backup);
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({version:1,route:'feeder',game:{exe:'game.exe'},added:[],replaced:[]}));
  checks = f.inspect();
  assert.match(checks.dlssCompat.summary, /已记录 Feeder 安装路线/);
  assert.doesNotMatch(checks.dlssCompat.summary, /1\.19\.0|已启用/);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'dxgi.dll')), before);
});
