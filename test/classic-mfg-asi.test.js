'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writePe,writeProvider} = require('./fixtures/pe');
const {root:payload} = require('./fixtures/payload');
const {addPrivateStreamline} = require('./fixtures/optiscaler-streamline');
const {classicMfgTarget} = require('../src/core/mfg-manager');
const {scanGame} = require('../src/core/scan');
const combined = require('../src/core/combined-manager');
const ini = require('../src/core/feeder-config');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-classic-asi-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const game = path.join(root,'Game'), local = name => path.join(game,name);
  const exe = writePe(local('Game.exe'),{text:'D3D12CreateDevice'});
  fs.copyFileSync(path.join(payload,'enhanced/components/XeMFG-OptiScaler-v1.7.1.dll'),local('dxgi.dll'));
  const config = '[FrameGen]\nEnabled=auto\nFGInput=dlssg\nFGOutput=dlssg\nFGNvngxReplacement=auto\n';
  const save = text => fs.writeFileSync(local('OptiScaler.ini'),text);
  save(config);
  return {root,game,local,exe,config,save,scan:async () => (await scanGame(game,exe)).chosen,
    issue:target => classicMfgTarget(target,null,'mfg-unlocker-asi').issue};
}

test('private Streamline does not supply game inputs; native DLSS-G does not override the configured route', async t => {
  const f = fixture(t);
  const stack = addPrivateStreamline(f.game);
  let target = await f.scan();
  assert.equal(target.hasGameStreamlineFg,false);
  assert.ok(f.issue(target));
  fs.copyFileSync(path.join(payload,'streamline/sl.dlss_g.dll'),f.local('sl.dlss_g.dll'));
  target = await f.scan();
  assert.equal(target.hasGameStreamlineFg,true);
  assert.equal(f.issue(target),null);
  for (const [key,value] of [['FGOutput','XeFG'],['FGInput','NvngxFG'],['FGInput','auto'],['FGInput','FSRFG'],
    ['FGNvngxReplacement','FFX'],['FGNvngxReplacement','Apex Neural Rendering FG']]) {
    f.save(ini.setIni(f.config,'FrameGen',key,value));
    assert.ok(f.issue(target),key + '=' + value);
  }
  f.save(ini.setIni(f.config,'FrameGen','FGOutput','XeFG'));
  await assert.rejects(combined.applyCombinedConfiguration(f.game,{exePath:f.exe,gpuName:'NVIDIA GeForce RTX 4070',
    mfgMode:'x3',userDataDir:path.join(f.root,'data'),requirePayload:() => assert.fail('invalid route requested a download')}),
    {code:'errMfgInput'});
  assert.ok(!fs.existsSync(f.local('OptiScaler/plugins/MFGUnlocker.asi')));
  f.save(f.config);
  for (const name of ['sl.interposer.dll','sl.common.dll','sl.dlss_g.dll','sl.reflex.dll','sl.pcl.dll','nvngx_dlssg.dll']) {
    const file = path.join(stack,name);
    fs.renameSync(file,file + '.old');
    assert.ok(f.issue(target)?.includes(name),name);
    if (name === 'sl.common.dll') {
      fs.copyFileSync(path.join(stack,'sl.reflex.dll'),file);
      assert.ok(f.issue(target)?.includes(name),'another plugin has the same entry point');
      fs.unlinkSync(file);
    }
    fs.renameSync(file + '.old',file);
  }
  fs.renameSync(path.join(stack,'nvngx_dlssg.dll'),f.local('nvngx_dlssg.dll'));
  assert.equal(f.issue(await f.scan()),null,'the host also searches game NGX folders');
  fs.copyFileSync(path.join(payload,'streamline/nvngx_dlss.dll'),path.join(stack,'nvngx_dlssg.dll'));
  assert.ok(f.issue(await f.scan())?.includes('nvngx_dlssg.dll'),'wrong private provider precedes a working fallback');
});

test('classic ASI matches the game SDK and host input switches before reporting an available route', async t => {
  const f = fixture(t);
  addPrivateStreamline(f.game);
  const setInput = value => ini.setIni(f.config,'FrameGen','FGInput',value);
  f.save(setInput('upscaler'));
  fs.copyFileSync(path.join(payload,'streamline/nvngx_dlss.dll'),f.local('nvngx_dlss.dll'));
  let target = await f.scan();
  assert.equal(f.issue(target),null);
  f.save(ini.setIni(setInput('upscaler'),'Inputs','EnableDlssInputs','false'));
  assert.ok(f.issue(target));
  const amd = path.resolve(__dirname,'../vendor/runtime-tests/components/OptiScaler-0.2.0-patch1/OptiScaler');
  const ffx = 'amd_fidelityfx_framegeneration_dx12.dll';
  fs.copyFileSync(path.join(amd,ffx),f.local(ffx));
  fs.copyFileSync(path.join(amd,'libxess_fg.dll'),f.local('libxess_fg.dll'));
  target = await f.scan();
  assert.deepEqual(target.classicFgInputs.sort(),['fsrfg','xefg']);
  for (const input of target.classicFgInputs) { f.save(setInput(input)); assert.equal(f.issue(target),null,input); }
  fs.copyFileSync(path.join(amd,'../OptiScaler.dll'),f.local('dxgi.dll'));
  assert.ok(f.issue(target),'the older 10.0.0.1 build has no XeFG input');
  f.save(setInput('fsrfg30'));
  assert.ok(f.issue(target),'the newer AMD SDK cannot serve the older FSR 3.0 hook');
  writeProvider(f.local('ffx_frameinterpolation_x64.dll'),['ffxFrameInterpolationContextCreate','ffxFrameInterpolationDispatch','ffxFrameInterpolationContextDestroy']);
  assert.ok(f.issue(await f.scan()),'the FSR 3.0 backend must also be present');
  writeProvider(f.local('ffx_backend_dx12_x64.dll'),['ffxReplaceSwapchainForFrameinterpolationDX12','ffxSetFrameGenerationConfigToSwapchainDX12']);
  assert.equal(f.issue(await f.scan()),null);
});

test('classic ASI prepares missing NGX, rolls back a partial write and can be retried from the game entry point', async t => {
  const f = fixture(t);
  const stack = addPrivateStreamline(f.game);
  fs.unlinkSync(path.join(stack,'nvngx_dlssg.dll'));
  fs.copyFileSync(path.join(payload,'streamline/sl.dlss_g.dll'),f.local('sl.dlss_g.dll'));
  const target = await f.scan();
  assert.ok(f.issue(target)?.includes('nvngx_dlssg.dll'));
  assert.equal(classicMfgTarget(target,null,'auto',true).issue,null);
  const options = {exePath:f.exe, gpuName:'NVIDIA GeForce RTX 4070', mfgMode:'x3', payloadDir:payload,
    userDataDir:path.join(f.root,'data')};
  const apply = require('../src/core/apply');
  const copy = apply.copyTracked;
  const failure = t.mock.method(apply,'copyTracked',async (record,game,src,dest,...args) => {
    const out = await copy(record,game,src,dest,...args);
    if (path.basename(dest) === 'nvngx_dlssg.dll') throw new Error('test write interrupted');
    return out;
  });
  await assert.rejects(combined.applyCombinedConfiguration(f.game,options),/test write interrupted/);
  assert.equal(fs.existsSync(f.local('nvngx_dlssg.dll')),false);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),f.config);
  failure.mock.restore();
  await combined.applyCombinedConfiguration(f.game,options);
  assert.equal(f.issue(await f.scan()),null,'managed NGX can supply output without becoming a game input');
  assert.equal(ini.getIni(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),'FrameGen','Enabled'),'true');
  await require('../src/core/backend-manager').restore(f.game);
  assert.equal(fs.existsSync(f.local('nvngx_dlssg.dll')),false);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),f.config);
});

test('a relocated private Streamline stack cannot qualify its own host as a native DLSS-G game', async t => {
  const f = fixture(t);
  const stack = addPrivateStreamline(f.game);
  fs.mkdirSync(f.local('Alternate'));
  fs.renameSync(stack,f.local('Alternate/streamline'));
  const configured = ini.setIni(ini.setIni(f.config,'Libraries','OptiDllPath','Alternate'),'Plugins','Path','OptiScaler/plugins');
  f.save(configured);
  let target = await f.scan();
  assert.equal(target.hasGameStreamlineFg,false);
  assert.ok(f.issue(target));
  fs.copyFileSync(path.join(payload,'streamline/sl.dlss_g.dll'),f.local('sl.dlss_g.dll'));
  target = await f.scan();
  assert.equal(target.hasGameStreamlineFg,true);
  assert.equal(f.issue(target),null);
});
