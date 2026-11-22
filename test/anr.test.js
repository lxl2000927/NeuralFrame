'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {writePe, writeProvider} = require('./fixtures/pe');
const payload = require('./fixtures/payload');
const apply = require('../src/core/apply');
const backends = require('../src/core/backend-manager');
const {ComponentReview} = require('../src/core/component-review');
const {unpack} = require('../src/core/component-updates');
const graphics = require('../src/core/optional-graphics');
const anr = require('../src/core/anr');
const ini = require('../src/core/feeder-config');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const coreName = 'nvngx_dlssg.dll';
const archiveHashes = {full:'ed70eef1dc92ba71685daad59f1d9ef1d9897b46df009f04b1dc51c4933cd300',
  addon:'6dfce1ce2240f6ce8d820a7eb66b4d7d349655e9238c30df820297d70b9963f3'};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-anr-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const gameDir = path.join(root,'Game'), exePath = writePe(path.join(gameDir,'Game.exe'), {text:'D3D12CreateDevice'});
  writePe(path.join(gameDir,'sl.dlss_g.dll'));
  const options = {gameDir,exePath,api:'dxgi',apiLabel:'DirectX 12',bitness:64,target:{hasNativeDlssFg:true},
    route:'anr', payloadDir:payload.root, userDataDir:path.join(root,'profile'), gpuName:'AMD Radeon RX 7800 XT'};
  const provider = path.join(gameDir, anr.privatePath);
  const restore = () => backends.restore(gameDir);
  const state = () => graphics.inspect(gameDir,backends.readManifest(gameDir));
  return {root, gameDir, provider, options, state, restore, reviews:new ComponentReview(options.userDataDir)};
}
async function previousPack(f, kind) {
  const archive = path.join(payload.root,'enhanced/components', `anr-fg-V.B18-${kind}.zip`);
  assert.equal(sha(fs.readFileSync(archive)), archiveHashes[kind], 'prepare the original B18 test archives with prepare-test-payload');
  const dir = path.join(f.root, kind);
  await unpack(archive,dir);
  return dir;
}
function loader(file, wrongIdentity = false) {
  const installed = process.platform === 'win32' && path.join(process.env.SystemRoot,'System32','vulkan-1.dll');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if (!wrongIdentity && installed && fs.existsSync(installed)) return fs.copyFileSync(installed,file);
  writeProvider(file, ['vkGetInstanceProcAddr','vkGetDeviceProcAddr']);
  const data = fs.readFileSync(file);
  data.writeUInt32LE(0x1170,0x20c);
  data.write(wrongIdentity ? 'another-provider.dll\0' : 'vulkan-1.dll\0',0x370);
  fs.writeFileSync(file,data);
}

test('a managed full B18 receipt upgrades via the game entry point and keeps the player configuration and original files', async t => {
  const f = fixture(t), before = await previousPack(f,'full');
  const manifest = apply.beginManifest(f.gameDir,f.options.exePath,'dxgi');
  manifest.route = 'anr'; manifest.game.bitness = 64; manifest.game.apiLabel = 'DirectX 12';
  const record = manifest.graphicsRoute = {proxy:'dxgi.dll', files:{},shared:{}, settings:[]};
  const input = path.join(before,'game');
  const originalLicense = 'original game license';
  const license = path.join(f.gameDir,'LICENSES/OptiScaler-GPL-3.0.txt');
  fs.mkdirSync(path.dirname(license)); fs.writeFileSync(license, originalLicense);
  for (const folder of [input, path.join(before,'LICENSES')]) {
    for (const name of fs.readdirSync(folder,{recursive:true})) {
      const source = path.join(folder,name);
      if (!fs.statSync(source).isFile()) continue;
      const rel = folder === input ? name : path.join('LICENSES',name);
      const dest = path.join(f.gameDir,rel), bytes = fs.readFileSync(source);
      await apply.copyTracked(manifest, f.gameDir, source, dest, {kind:rel.endsWith('.ini')?'config':'addon'});
      if (rel.endsWith('.ini')) record.settings.push(rel);
      else record.files[rel] = sha(bytes);
    }
  }
  await apply.saveActiveManifest(f.gameDir, manifest);
  assert.equal(f.state().providerVersion,'B18');
  const oldProvider = path.join(f.provider,coreName), providerBytes = fs.readFileSync(oldProvider);
  fs.appendFileSync(oldProvider,'other');
  assert.equal(f.state().providerVersion,undefined); assert.equal(f.state().filesPresent,false);
  fs.writeFileSync(oldProvider,providerBytes);
  const cfg = path.join(f.provider,'nr_fg.ini');
  const custom = ini.setIni(fs.readFileSync(cfg,'utf8'),'','max_generated','2') + '\nplayer_key = personal\n';
  fs.writeFileSync(cfg,custom);
  const combined = require('../src/core/combined-manager');
  const hardware = {gpu:{name:f.options.gpuName,nvidiaPresent:false}};
  const config = {...f.options,hardware,graphics:{}}, request = {kind:'enhanced',config:{route:'anr',exePath:f.options.exePath}};
  const work = () => combined.applyCombinedConfiguration(f.gameDir, config);
  const {preview} = await f.reviews.run(f.gameDir,request,work);
  assert.ok(preview.rows.some(row => /blackwell-scrgb16/.test(row.rel) && row.action === 'add'));
  assert.equal(f.state().providerVersion,'B18');
  assert.ok((await f.reviews.run(f.gameDir,request,work,preview.token)).ok);
  assert.equal(f.state().providerVersion,'B20'); assert.equal(f.state().multiplier,3);
  assert.equal(fs.readFileSync(cfg,'utf8'),custom);
  assert.ok((await work()).ok);
  const runtime = path.join(f.provider,anr.loaderName);
  loader(runtime);
  fs.writeFileSync(path.join(f.provider,'player-notes.txt'),'keep');
  const {preview:removal} = await f.reviews.run(f.gameDir,{kind:'restore'},async()=>({ok:await f.restore()}));
  assert.ok(removal.rows.some(row => row.rel.endsWith(anr.loaderName) && row.action === 'remove'));
  assert.ok(fs.existsSync(runtime));
  assert.ok(await f.restore());
  assert.equal(fs.existsSync(runtime),false);
  assert.equal(fs.readFileSync(path.join(f.provider,'player-notes.txt'),'utf8'),'keep');
  assert.equal(fs.readFileSync(license,'utf8'),originalLicense);
  assert.equal(backends.loadProfile(f.options)[path.relative(f.gameDir,cfg)],custom);
});

test('an external B18 add-on is restored byte for byte while later edits and the independent host stay in place', async t => {
  const f = fixture(t), before = await previousPack(f,'addon');
  const host = path.join(f.gameDir,'dxgi.dll'), config = path.join(f.gameDir,'OptiScaler.ini');
  const hostBytes = fs.readFileSync(path.join(payload.root,'enhanced/components/XeMFG-OptiScaler-v1.7.1.dll'));
  fs.writeFileSync(host, hostBytes);
  const original = '[Libraries]\nOptiDllPath=custom-host\n[FrameGen]\nFGInput=auto\n[Player]\nColor=blue\n';
  fs.writeFileSync(config,original);
  const customDir = path.join(f.gameDir,'custom-host/custom',anr.provider,'dlssg');
  fs.cpSync(path.join(before,anr.provider,'dlssg'),customDir,{recursive:true});
  const file = path.join(customDir,'nr_fg.ini'), binary = path.join(customDir,coreName), oldBytes = fs.readFileSync(binary);
  const oldConfig = ini.setIni(fs.readFileSync(file,'utf8'),'','max_generated','3') + '\nplayer = old\n';
  fs.writeFileSync(file,oldConfig);
  const preexisting = path.join(customDir,anr.loaderName); loader(preexisting);
  const options = {...f.options, route:'anr-addon',graphics:{multiplier:3}};
  await backends.install(options);
  assert.equal(f.state().providerVersion,'B20');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('player = old','player = new'));
  fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('Color=blue','Color=red'));
  await backends.install({...options,graphics:{multiplier:2}});
  assert.equal(f.state().multiplier,2);
  assert.ok(await f.restore());
  assert.deepEqual(fs.readFileSync(host),hostBytes);
  assert.deepEqual(fs.readFileSync(binary),oldBytes);
  assert.equal(fs.readFileSync(config,'utf8'),original.replace('blue','red'));
  assert.equal(fs.readFileSync(file,'utf8'),oldConfig.replace('player = old','player = new'));
  assert.ok(fs.existsSync(preexisting));
});

test('only a verified private Vulkan loader is retired during legacy reinstall', async t => {
  const f = fixture(t);
  const privateLoader = path.join(f.provider,anr.loaderName), sidecar = path.join(f.gameDir,'vulkan-1.dll');
  loader(privateLoader); loader(sidecar);
  const bytes = fs.readFileSync(privateLoader);
  const keep = path.join(f.provider,'unknown.bin');
  fs.writeFileSync(keep,'custom'); await assert.rejects(backends.install(f.options), /已有 OptiScaler/);
  assert.deepEqual(fs.readFileSync(privateLoader),bytes);
  fs.unlinkSync(keep);
  const host = path.join(f.gameDir,'dxgi.dll');
  fs.copyFileSync(path.join(payload.root,'enhanced/anr/dxgi.dll'),host);
  await assert.rejects(backends.install(f.options), /已有 OptiScaler/);
  assert.deepEqual(fs.readFileSync(privateLoader),bytes);
  fs.unlinkSync(host);
  loader(privateLoader,true);
  await assert.rejects(backends.install(f.options), /已有 OptiScaler/);
  fs.writeFileSync(privateLoader,bytes);
  const request={kind:'enhanced',config:{route:'anr',exePath:f.options.exePath}};
  const work=async()=>({ok:true,manifest:await backends.install(f.options)});
  const {preview}=await f.reviews.run(f.gameDir,request,work);
  assert.ok(preview.rows.some(row => row.rel.endsWith(anr.loaderName) && row.action === 'remove'));
  assert.ok(fs.existsSync(privateLoader));
  assert.ok((await f.reviews.run(f.gameDir,request,work,preview.token)).ok);
  assert.equal(fs.existsSync(privateLoader),false);
  loader(privateLoader,true);
  assert.ok(await f.restore());
  assert.ok(fs.existsSync(privateLoader));
  assert.ok(fs.existsSync(sidecar));
});

test('an add-on needs a compatible loader for the selected executable; full install preserves an independent proxy without a config', async t => {
  const f = fixture(t), opti = path.join(f.gameDir,'OptiScaler.ini'), proxy = path.join(f.gameDir,'dxgi.dll');
  const config = '[FrameGen]\nFGInput=auto\n[ProcessFilter]\nTargetProcessName=Other.exe\n';
  fs.writeFileSync(opti, config);
  assert.equal(anr.hasAddonHost(f.options.exePath), false);
  await assert.rejects(backends.install({...f.options, route:'anr-addon'}), /自定义帧生成/);
  let prepared = false;
  await assert.rejects(require('../src/core/combined-manager').applyCombinedConfiguration(f.gameDir,
    {...f.options,route:'anr-addon',hardware:{gpu:{name:f.options.gpuName,nvidiaPresent:false}},
      requirePayload:async () => { prepared = true; }}), /自定义帧生成/);
  assert.equal(prepared,false);
  assert.ok(!fs.existsSync(path.join(f.gameDir,'custom')));
  const bytes = fs.readFileSync(path.join(payload.root,'enhanced/anr/dxgi.dll'));
  fs.writeFileSync(proxy,bytes);
  assert.equal(anr.hasAddonHost(f.options.exePath), false, 'the host is filtered to a different executable');
  fs.writeFileSync(opti, config.replace('Other.exe','Game.exe'));
  assert.equal(anr.hasAddonHost(f.options.exePath), true);
  assert.equal(anr.hasAddonHost(f.options.exePath,'vulkan'),false, 'Vulkan requires an imported loader');
  fs.unlinkSync(opti);
  await assert.rejects(backends.install(f.options), /已有 OptiScaler/);
  assert.deepEqual(fs.readFileSync(proxy), bytes);
  assert.equal(backends.readManifest(f.gameDir), null);
});

test('ANR add-on diagnostics follow the actual external host, selected provider and provider directory', async t => {
  const f = fixture(t), config = path.join(f.gameDir,'OptiScaler.ini'), proxy = path.join(f.gameDir,'dxgi.dll');
  const original = '[Libraries]\nOptiDllPath=custom#host\\x64\n[FrameGen]\nFGInput=auto\n';
  fs.copyFileSync(path.join(payload.root,'enhanced/components/XeMFG-OptiScaler-v1.7.1.dll'),proxy);
  fs.writeFileSync(config,original);
  await backends.install({...f.options,route:'anr-addon'});
  assert.ok(fs.existsSync(path.join(f.gameDir,'custom#host','x64','custom',anr.provider,'dlssg',coreName)));
  assert.equal(f.state().filesPresent,true);
  const installed = fs.readFileSync(config,'utf8');
  for (const [section,key,value] of [['Libraries','OptiDllPath','elsewhere'],['FrameGen','FGNvngxReplacement','Nukems'],
    ['fakenvapi','ForceXeLL','true']]) {
    fs.writeFileSync(config,ini.setIni(installed,section,key,value));
    assert.ok(f.state().error);
  }
  fs.writeFileSync(config,installed);
  fs.unlinkSync(proxy);
  assert.equal(f.state().filesPresent,false);
  assert.ok(f.state().error);
  await f.restore();
  assert.equal(fs.readFileSync(config,'utf8'),original);
});

test('the MFG ASI host must load on the selected executable and use the installed plugin folder', t => {
  const f = fixture(t), exe = f.options.exePath;
  const host = path.join(f.gameDir,'dxgi.dll'), config = path.join(f.gameDir,'OptiScaler.ini');
  const original = '[Plugins]\nLoadAsiPlugins=false\n[FrameGen]\nFGInput=auto\n';
  fs.writeFileSync(config,original);
  assert.equal(anr.hasMfgAsiHost(exe),false);
  for (const [source,custom] of [
    [path.join(payload.root,'enhanced/anr/dxgi.dll'),true],
    [path.join(payload.root,'enhanced/components/XeMFG-OptiScaler-v1.7.1.dll'),true],
    ...['0.2.0-patch1','0.8.92-presr'].map(version =>
      [path.resolve(__dirname,'../vendor/runtime-tests/components','OptiScaler-' + version,'OptiScaler.dll'),false]),
  ]) {
    fs.copyFileSync(source,host);
    assert.equal(anr.hasMfgAsiHost(exe),true,source);
    assert.equal(anr.hasAddonHost(exe),custom,source + ' custom provider support');
  }
  const probe = t.mock.method(require('../src/core/pe'),'findMarkers');
  assert.equal(anr.hasReShadeHost(exe),true);
  assert.equal(anr.hasMfgAsiHost(exe),true);
  assert.equal(anr.hasAddonHost(exe),false);
  assert.equal(probe.mock.callCount(),0,'unchanged external host capabilities are shared by the three checks');
  fs.appendFileSync(host,'changed');
  assert.equal(anr.hasMfgAsiHost(exe),true);
  assert.equal(probe.mock.callCount(),1,'a changed file is examined again');
  assert.equal(anr.hasMfgAsiHost(exe,'vulkan'),false);
  for (const [section,key,value] of [['Plugins','Path','HelperPlugins'], ['Libraries','OptiDllPath','custom-host'],
    ['ProcessFilter','TargetProcessName','another.exe'], ['fakenvapi','ForceXeLL','true']]) {
    fs.writeFileSync(config,ini.setIni(original,section,key,value));
    assert.equal(anr.hasMfgAsiHost(exe),false);
  }
  fs.writeFileSync(config,ini.setIni(original,'Plugins','Path',path.join(f.gameDir,'OptiScaler','plugins')));
  assert.equal(anr.hasMfgAsiHost(exe),true);
  fs.writeFileSync(config,'\uFEFF' + original,'utf16le');
  assert.equal(anr.hasMfgAsiHost(exe),false);
  fs.writeFileSync(config,original);
  const helper = writePe(path.join(f.gameDir,'QtWebEngineProcess.exe'),{text:'D3D12CreateDevice'});
  assert.equal(anr.hasMfgAsiHost(helper),false);
  fs.writeFileSync(config,ini.setIni(original,'ProcessFilter','ProcessExclusionList','other.exe'));
  assert.equal(anr.hasMfgAsiHost(helper),true);
  fs.renameSync(host,path.join(f.gameDir,'version.dll'));
  assert.equal(anr.hasMfgAsiHost(exe),false,'an unimported alternate proxy cannot host this game');
});
