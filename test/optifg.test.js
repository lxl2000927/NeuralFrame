'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {writePe,writeProvider,writeNr} = require('./fixtures/pe');
const {root:payloadDir} = require('./fixtures/payload');
const ini = require('../src/core/feeder-config');
const {detectHost} = require('../src/core/optifg');
const graphics = require('../src/core/optional-graphics');
const backends = require('../src/core/backend-manager');
const {scanGame} = require('../src/core/scan');
const {ComponentReview} = require('../src/core/component-review');

const libraries = ['amd_fidelityfx_loader_dx12.dll','amd_fidelityfx_framegeneration_dx12.dll','amd_fidelityfx_upscaler_dx12.dll'];

function fixture(t,version,existingHost = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-fsr-optifg-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const gameDir = path.join(root,'game'), local = name => path.join(gameDir,name);
  const exePath = writePe(local('Game.exe'),{text:'D3D12CreateDevice'});
  const release = path.resolve(__dirname,'../vendor/runtime-tests/components/OptiScaler-' + version);
  const cfg = local('OptiScaler.ini'), host = local('dxgi.dll');
  const text = fs.readFileSync(path.join(release,'OptiScaler.ini'),'utf8');
  if (existingHost) {
    fs.mkdirSync(local('OptiScaler'));
    fs.copyFileSync(path.join(release,'OptiScaler.dll'),host);
    for (const name of libraries) fs.copyFileSync(path.join(release,'OptiScaler',name),local('OptiScaler/' + name));
    fs.writeFileSync(cfg,text);
  }
  const api = local('ffx_fsr2_api_x64.dll'), driver = local('ffx_fsr2_api_dx12_x64.dll');
  writeProvider(api,['ffxFsr2ContextCreate','ffxFsr2ContextDestroy','ffxFsr2ContextDispatch']);
  writeProvider(driver,['ffxFsr2GetInterfaceDX12']);
  const options = async () => {
    const {chosen:target} = await scanGame(gameDir,exePath);
    return {route:'optifg',gameDir,exePath,api:target.api,apiLabel:target.apiLabel,bitness:target.bitness,
      userDataDir:path.join(root,'profile'),payloadDir,target,gpuName:'AMD Radeon RX 6800'};
  };
  return {root,gameDir,exePath,host,release,local,cfg,api,driver,options,text};
}

test('OptiFG authenticates both fixed hosts, the configured process and actual AMD providers', async t => {
  for (const version of ['0.2.0-patch1','0.8.92-presr']) {
    const f = fixture(t,version);
    assert.ok(detectHost(f.exePath),version);
    fs.writeFileSync(f.cfg,ini.setIni(f.text,'ProcessFilter','TargetProcessName','another.exe'));
    assert.equal(detectHost(f.exePath),false);
    fs.writeFileSync(f.cfg,ini.setIni(f.text,'Libraries','FfxDx12FGPath','C:\\Other\\Custom.dll'));
    assert.equal(detectHost(f.exePath),false);
    fs.writeFileSync(f.cfg,f.text + '\n[DlssNr]\nEnabled=true\n');
    assert.equal(detectHost(f.exePath),false);
    fs.writeFileSync(f.cfg,Buffer.from('\uFEFF' + f.text,'utf16le'));
    assert.equal(detectHost(f.exePath),false,'the native INI reader expects narrow text');
    fs.writeFileSync(f.cfg,f.text);
    fs.copyFileSync(f.host,f.local('version.dll'));
    assert.equal(detectHost(f.exePath),false,'second host');
    fs.unlinkSync(f.local('version.dll'));
    const fg = f.local('OptiScaler/' + libraries[1]);
    const fd = fs.openSync(fg,'r+');
    try { fs.writeSync(fd,Buffer.from([0]),0,1,0); } finally { fs.closeSync(fd); }
    assert.equal(detectHost(f.exePath,false),false,'modified runtime');
  }
});

test('OptiFG previews only INI fields, preserves the in-game switch and restores the user-owned host', async t => {
  const f = fixture(t,'0.2.0-patch1');
  let original = ini.setIni(f.text,'DlssNr','Enabled','true');
  original = ini.setIni(original,'Upscalers','Dx12Upscaler','dlss');
  original = ini.setIni(original,'Inputs','EnableFsr2Inputs','false');
  original = ini.setIni(original,'Inputs','UseFsr2VulkanInputs','true');
  original = ini.setIni(original,'Player','Private','before');
  const write = text => fs.writeFileSync(f.cfg,'\uFEFF'+text);
  const read = () => fs.readFileSync(f.cfg,'utf8').slice(1);
  write(original);
  const opts = await f.options();
  assert.equal(opts.target.optiFgHost,true);
  assert.ok(opts.target.optiFgInputs.includes('fsr2'));
  assert.equal(opts.target.hasNativeDlssFg,false);
  const reviews = new ComponentReview(opts.userDataDir);
  const request = {kind:'enhanced',config:{route:'optifg',exePath:f.exePath}};
  const run = token => reviews.run(f.gameDir,request,async () => ({ok:true,manifest:await backends.install(opts)}),token);
  const diskHashes = () => [f.host,f.api,f.driver,...libraries.map(name => f.local('OptiScaler/' + name))]
    .map(file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const originals = diskHashes();
  const {preview} = await run();
  assert.deepEqual(preview.rows.filter(row => row.scope === 'game' && row.action !== 'keep').map(row => row.rel), ['OptiScaler.ini']);
  assert.equal(read(),original);
  assert.ok((await run(preview.token)).ok);
  const now = read();
  for (const [section,key,value] of [
    ['FrameGen','FGInput','upscaler'],['FrameGen','FGOutput','fsrfg'],['FrameGen','Enabled','true'],
    ['Upscalers','Dx12Upscaler','ffx'],['DlssNr','Enabled','false'],['Inputs','EnableFsr2Inputs','true'],
    ['Inputs','UseFsr2VulkanInputs','false'],['Player','Private','before'],
  ]) assert.equal(ini.getIni(now,section,key),value);
  const receipt = backends.readManifest(f.gameDir);
  assert.deepEqual(receipt.graphicsRoute.files,{});
  assert.equal(graphics.inspect(f.gameDir,receipt).providerVersion,'0.2.0-patch1');
  let menu = ini.setIni(now,'FrameGen','Enabled','false');
  menu = ini.setIni(menu,'Player','Private','游戏内修改');
  write(menu);
  await backends.install(opts);
  assert.equal(read(),menu);
  const active = backends.readManifest(f.gameDir);
  assert.equal(graphics.inspect(f.gameDir,active).enabled,false);
  write(ini.setIni(menu,'FrameGen','Enabled','1'));
  assert.equal(graphics.inspect(f.gameDir,active).enabled,false,'the host reads numeric flags as its default');
  write(ini.setIni(menu,'Inputs','UseFsr2Inputs','false'));
  assert.match(graphics.inspect(f.gameDir,active).error,/超分输入/);
  write(menu);
  await backends.restore(f.gameDir);
  assert.equal(read(),ini.setIni(ini.setIni(original,'Player','Private','游戏内修改'),'FrameGen','Enabled','false'));
  assert.ok(detectHost(f.exePath));
  assert.deepEqual(diskHashes(),originals);
  assert.equal(fs.existsSync(f.local('nvngx_dlssnr.dll')),false);
});

test('OptiFG refuses protected games, missing inputs, unknown settings and competing engines without changing host files', async t => {
  const f = fixture(t,'0.8.92-presr');
  let opts = await f.options();
  assert.ok(detectHost(f.exePath,false));
  const unchanged = async (rejected,pattern) => {
    const before = fs.readFileSync(f.cfg);
    await assert.rejects(rejected,pattern);
    assert.deepEqual(fs.readFileSync(f.cfg),before);
    assert.equal(backends.readManifest(f.gameDir),null);
  };
  await unchanged(backends.install({...opts,graphics:{multiplier:5}}),/OptiFG/);
  fs.writeFileSync(f.cfg,ini.setIni(f.text,'fakenvapi','ForceXeLL','true'));
  assert.equal(detectHost(f.exePath),false);
  await unchanged(backends.install(opts),/宿主|XeLL/);
  fs.writeFileSync(f.cfg,f.text);
  fs.mkdirSync(f.local('EasyAntiCheat'));
  await unchanged(backends.install({...opts,antiCheatAcknowledged:true}),/反作弊|保护/);
  fs.rmdirSync(f.local('EasyAntiCheat'));
  fs.writeFileSync(f.cfg,ini.setIni(f.text,'FrameGen','FGOutput','custom-provider'));
  await unchanged(backends.install(opts),/输出/);
  fs.writeFileSync(f.cfg,ini.setIni(f.text,'Upscalers','Dx12Upscaler','custom'));
  await unchanged(backends.install(opts),/超分/);
  fs.writeFileSync(f.cfg,f.text);
  fs.writeFileSync(f.local('RTXMFG-Universal.json'),'{}');
  await unchanged(backends.install(opts),/独立/);
  fs.unlinkSync(f.local('RTXMFG-Universal.json'));
  fs.unlinkSync(f.driver);
  opts = await f.options();
  assert.deepEqual(opts.target.optiFgInputs,[]);
  await unchanged(backends.install(opts),/输入/);
});

test('combined configuration installs only OptiFG on simulated Radeon with a scanned FSR 2-only game', async t => {
  const f = fixture(t,'0.8.92-presr');
  const combined = require('../src/core/combined-manager'), guards = require('../src/core/install-guards');
  t.mock.method(guards,'queryNvidiaSmi',async () => {throw Error('unavailable');});
  t.mock.method(guards,'displayAdapters',async () => ({name:'AMD Radeon RX 6800',nvidiaPresent:false}));
  t.mock.method(guards,'assertGameClosed',async () => {});
  const hardware = await combined.detectHardwareEnvironment(true);
  const config = {route:'optifg',exePath:f.exePath,payloadDir,userDataDir:path.join(f.root,'profile')};
  const original = fs.readFileSync(f.cfg);
  assert.ok((await combined.applyCombinedConfiguration(f.gameDir,{...config,mfgMode:'x4',neuralMode:'latest_compatible'})).ok);
  const status = await combined.inspectCombinedStatus(f.gameDir,{...config,detectedHardware:hardware});
  assert.equal(status.graphicsRoute.providerVersion,'0.8.92-presr');
  assert.equal(status.graphicsRoute.enabled,true);
  assert.equal(status.neural.mode,'off');
  assert.equal(status.diagnostics.combinedStatus,'experimental');
  assert.equal(status.mfg.currentConfig.multiplier,null);
  assert.ok(!fs.existsSync(f.local('nvngx_dlssnr.dll')));
  assert.ok(!fs.existsSync(f.local('version.dll')));
  assert.ok(await backends.restore(f.gameDir));
  assert.deepEqual(fs.readFileSync(f.cfg),original);
  assert.ok(detectHost(f.exePath));
});

test('switching a managed OptiScaler host to OptiFG retains the installation and disables NVIDIA settings', async t => {
  const f = fixture(t,'0.2.0-patch1',false);
  const model = writeNr(f.local('nvngx_dlssnr.dll'));
  const originalModel = fs.readFileSync(model);
  await backends.install({...await f.options(),route:'optiscaler',optiVersion:'0.2.0-patch1',optiRoot:f.release,
    source:require('../src/core/scan').scanSource(payloadDir)});
  assert.equal(ini.getIni(ini.readText(f.cfg),'DlssNr','Enabled'),'true');
  const stamp = fs.statSync(f.host).mtimeMs;
  const keep = f.local('OptiScaler/player-notes.txt');
  fs.writeFileSync(keep,'keep');
  const opts = await f.options();
  assert.deepEqual(opts.target.optiFgInputs,['fsr2']);
  await backends.install(opts);
  assert.equal(fs.statSync(f.host).mtimeMs,stamp);
  assert.equal(ini.getIni(ini.readText(f.cfg),'DlssNr','Enabled'),'false');
  assert.equal(ini.getIni(ini.readText(f.cfg),'Upscalers','Dx12Upscaler'),'ffx');
  assert.equal(graphics.inspect(f.gameDir,backends.readManifest(f.gameDir)).enabled,true);
  assert.deepEqual(fs.readFileSync(model),originalModel);
  await backends.restore(f.gameDir);
  assert.equal(fs.existsSync(f.host),false);
  assert.deepEqual(fs.readFileSync(model),originalModel);
  assert.equal(fs.readFileSync(keep,'utf8'),'keep');
});
