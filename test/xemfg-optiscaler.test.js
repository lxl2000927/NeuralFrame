'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { root:payloadDir } = require('./fixtures/payload');
const { writePe } = require('./fixtures/pe');
const { detectHost } = require('../src/core/xemfg-optiscaler');
const { scanGame } = require('../src/core/scan');
const { ComponentReview } = require('../src/core/component-review');
const backends = require('../src/core/backend-manager');
const graphics = require('../src/core/optional-graphics');
const { getIni } = require('../src/core/feeder-config');

const route = 'xemfg-optiscaler';
const original = '[Libraries]\r\nOptiDllPath=auto\r\n[Plugins]\r\nLoadAsiPlugins=false\r\n[FrameGen]\r\nFGInput=auto\r\nFGOutput=auto\r\n[User]\r\nKeep=me\r\n';
const pairedHost = path.join(payloadDir,'enhanced/components/XeMFG-OptiScaler-v1.7.1.dll');
const engine = path.join(payloadDir,'enhanced/mfg/MFGUnlocker.dll');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-optifg-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const gameDir = path.join(root,'game'), exePath = writePe(path.join(gameDir,'game.exe'),{text:'D3D12CreateDevice'});
  const local = name => path.join(gameDir,name);
  fs.mkdirSync(local('OptiScaler'));
  fs.writeFileSync(local('OptiScaler.ini'),original);
  fs.copyFileSync(path.join(payloadDir,'streamline/nvngx_dlss.dll'),local('nvngx_dlss.dll'));
  const plugin = local('OptiScaler/plugins/MFGUnlocker.asi');
  const notice = local('OptiScaler/plugins/MFG-Unlocker-LICENSE.txt');
  const userDataDir = path.join(root,'profile');
  function addHost(proxy = 'winmm.dll') {
    fs.copyFileSync(pairedHost,local(proxy));
    for (const name of ['libxell.dll','libxess_fg.dll'])
      fs.copyFileSync(path.join(payloadDir,'enhanced/xemfg-intel',name),local('OptiScaler/' + name));
  }
  async function options() {
    const {chosen:target} = await scanGame(gameDir,exePath);
    return {gameDir,exePath,target,api:target.api,apiLabel:target.apiLabel,bitness:64,route,payloadDir,userDataDir,gpuName:'AMD Radeon RX 6800'};
  }
  return {gameDir,exePath,local,plugin,notice,userDataDir,addHost,options};
}

test('OptiScaler XeMFG recognizes only verified, loadable hosts and their actual Intel runtime', async t => {
  const f = fixture(t);
  assert.equal(detectHost(f.exePath),null);
  writePe(f.local('dxgi.dll'),{version:'10.0.0.0'});
  assert.equal(detectHost(f.exePath),null);
  f.addHost('OptiScaler.dll'); // An unrenamed download has no loader.
  assert.equal(detectHost(f.exePath),null);
  fs.renameSync(f.local('OptiScaler.dll'),f.local('wininet.dll'));
  assert.equal(detectHost(f.exePath),null, 'alternate proxy is not imported by this EXE');
  fs.renameSync(f.local('wininet.dll'),f.local('winmm.dll'));
  assert.equal((await f.options()).target.xeMfgOptiHost,'dx12-vulkan');
  fs.writeFileSync(f.local('OptiScaler.ini'),original.replace('OptiDllPath=auto','OptiDllPath=foreign'));
  assert.equal(detectHost(f.exePath),null);
  fs.writeFileSync(f.local('OptiScaler.ini'),original.replace('OptiDllPath=auto','XeFGPath=wrong.dll'));
  assert.equal(detectHost(f.exePath),null);
  fs.writeFileSync(f.local('OptiScaler.ini'),original+'[FrameGen]\r\nFGOutput=nofg\r\n');
  assert.equal(detectHost(f.exePath),null);
  for (const cfg of [original.replace('[FrameGen]','[FrameGen] ; host settings'),original.replace('OptiDllPath=auto','OptiDllPath='),
    original.replace('OptiDllPath=auto','OptiDllPath=auto#other')]) {
    fs.writeFileSync(f.local('OptiScaler.ini'),cfg);
    assert.equal(detectHost(f.exePath),null);
  }
  fs.writeFileSync(f.local('OptiScaler.ini'),'\uFEFF' + original,'utf16le');
  assert.equal(detectHost(f.exePath),null);
  fs.writeFileSync(f.local('OptiScaler.ini'),original);
  const fd = fs.openSync(f.local('OptiScaler/libxell.dll'),'r+');
  try { fs.writeSync(fd,Buffer.from('changed'),0,7,0); } finally { fs.closeSync(fd); }
  assert.equal(detectHost(f.exePath),null);
});

test('Radeon configuration with the actual OptiScaler and Intel files previews, redeploys and restores the player-owned host INI',async t => {
  const f = fixture(t);
  f.addHost();
  const opts = await f.options();
  const review = new ComponentReview(f.userDataDir);
  const request = {kind:'install',config:{route,exePath:f.exePath}};
  const work = async () => ({ok:true,manifest:await backends.install(opts)});
  const preview = await review.run(f.gameDir,request,work);
  assert.ok(preview.preview.rows.some(row => row.action === 'add' && row.scope === 'game'));
  assert.equal(fs.existsSync(f.plugin),false);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),original);
  await review.run(f.gameDir,request,work,preview.preview.token);
  assert.deepEqual(fs.readFileSync(f.plugin),fs.readFileSync(engine));
  assert.ok(fs.existsSync(f.notice));
  assert.equal(fs.existsSync(f.local('version.dll')),false);
  assert.equal(fs.existsSync(f.local('nvngx_dlssg.dll')),false);
  const state = graphics.inspect(f.gameDir,backends.readManifest(f.gameDir));
  assert.equal(state.providerVersion,'1.7.1');
  assert.equal(state.filesPresent,true);
  const current = fs.readFileSync(f.local('OptiScaler.ini'),'utf8');
  assert.equal(getIni(current,'FrameGen','FGInput'),'Upscaler');
  assert.equal(getIni(current,'FrameGen','FGOutput'),'XeFG');
  assert.equal(getIni(current,'FrameGen','Enabled'),'true');
  fs.writeFileSync(f.local('OptiScaler.ini'),current.replace('Keep=me','Keep=player'));
  await backends.install(opts);
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),original.replace('Keep=me','Keep=player'));
  assert.equal(fs.existsSync(f.plugin),false);
  assert.equal(detectHost(f.exePath),'dx12-vulkan');
});

test('standalone conflicts, protected targets and missing inputs stop the ASI route before changing the host',async t => {
  const f = fixture(t);
  f.addHost();
  let opts = await f.options();
  fs.copyFileSync(engine,f.local('version.dll'));
  await assert.rejects(backends.install(opts),/独立加载器/);
  fs.unlinkSync(f.local('version.dll'));
  fs.mkdirSync(f.local('EasyAntiCheat'));
  await assert.rejects(backends.install({...opts,antiCheatAcknowledged:true}),/反作弊|保护/);
  fs.rmdirSync(f.local('EasyAntiCheat'));
  fs.unlinkSync(f.local('nvngx_dlss.dll'));
  opts = await f.options();
  await assert.rejects(backends.install(opts),/超分|不匹配/);
  assert.equal(fs.existsSync(f.plugin),false);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),original);
});

test('matching external ASI is reused and remains when restoring the managed settings',async t => {
  const f = fixture(t);
  f.addHost();
  const withInputs = original + '[Inputs]\r\nEnableDlssInputs=false\r\nEnableXeSSInputs=false\r\n';
  fs.writeFileSync(f.local('OptiScaler.ini'),withInputs);
  fs.mkdirSync(path.dirname(f.plugin));
  fs.copyFileSync(engine,f.plugin);
  await backends.install(await f.options());
  const installed = fs.readFileSync(f.local('OptiScaler.ini'),'utf8');
  assert.equal(getIni(installed,'Inputs','EnableDlssInputs'),'true');
  assert.equal(getIni(installed,'Inputs','EnableXeSSInputs'),'false');
  await backends.restore(f.gameDir);
  assert.deepEqual(fs.readFileSync(f.plugin),fs.readFileSync(engine));
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),withInputs);
});

test('XeMFG respects the host process filter and an existing forced XeLL input', async t => {
  const f = fixture(t);
  f.addHost();
  const ini = f.local('OptiScaler.ini');
  for (const extra of ['[ProcessFilter]\nTargetProcessName=other-game.exe\n',
    '[ProcessFilter]\nProcessExclusionList=helper.exe|GAME.EXE\n', '[fakenvapi]\nForceXeLL=true\n']) {
    fs.writeFileSync(ini,original + extra);
    assert.equal(detectHost(f.exePath),null);
    const opts = await f.options();
    assert.equal(opts.target.xeMfgOptiHost,null);
    await assert.rejects(backends.install(opts), {code:'errGraphicsRoute'});
    assert.equal(fs.existsSync(f.plugin),false);
    assert.equal(fs.readFileSync(ini,'utf8'),original + extra);
  }
});

test('XeMFG keeps the disabled in-game setting on reapply and reports it independently of the files', async t => {
  const f = fixture(t);
  f.addHost();
  const opts = await f.options(), ini = f.local('OptiScaler.ini');
  await backends.install(opts);
  const {setIni} = require('../src/core/feeder-config');
  const edited = setIni(fs.readFileSync(ini,'utf8'),'FrameGen','Enabled','false');
  fs.writeFileSync(ini,edited);
  const state = graphics.inspect(f.gameDir,backends.readManifest(f.gameDir));
  assert.equal(state.filesPresent,true);
  assert.equal(state.enabled,false);
  await backends.install(opts);
  assert.equal(fs.readFileSync(ini,'utf8'),edited);
  await backends.restore(f.gameDir);
  assert.equal(getIni(fs.readFileSync(ini,'utf8'),'FrameGen','Enabled'),'false');
});

test('Vulkan installation requires the paired host with a loader available to the Vulkan game',async t => {
  const f = fixture(t);
  f.addHost('dxgi.dll');
  let opts = await f.options();
  const vulkan = {api:'vulkan',apiLabel:'Vulkan'};
  assert.equal(opts.target.xeMfgOptiHost,'dx12');
  await assert.rejects(backends.install({...opts,...vulkan}),/兼容|不匹配/);
  fs.renameSync(f.local('dxgi.dll'),f.local('winmm.dll'));
  opts = await f.options();
  assert.equal(opts.target.xeMfgOptiHost,'dx12-vulkan');
  await backends.install({...opts,...vulkan});
  assert.equal(graphics.inspect(f.gameDir,backends.readManifest(f.gameDir)).filesPresent,true);
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(f.local('OptiScaler.ini'),'utf8'),original);
});
