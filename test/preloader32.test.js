'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { writePe } = require('./fixtures/pe');
const core = require('../src/core/apply');
const journal = require('../src/core/file-journal');
const { ComponentReview, diskInfo } = require('../src/core/component-review');
const { scanSource } = require('../src/core/scan');
const pe = require('../src/core/pe');

function fixture(t, bitness = 32, api = 'd3d9') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preloader32-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const game = path.join(root, 'Game'), payload = path.join(root, 'Payload');
  const put = (rel, text = 'fixture') => {const f=path.join(payload, rel);fs.mkdirSync(path.dirname(f), {recursive:true});fs.writeFileSync(f,text);return f;};
  const identified = (file, bits, brand) => {
    writePe(file, {bitness:bits, version:'6.8.0.0', text:brand+' Searching for add-ons'});
    const bytes=fs.readFileSync(file); Buffer.from(brand,'utf16le').copy(bytes,0x320); fs.writeFileSync(file,bytes);
  };
  const exePath = writePe(path.join(game, 'Game.exe'), {bitness, text:api === 'dxgi' ? 'D3D11CreateDevice' : 'Direct3DCreate9'});
  const shaderRoot = path.join(payload, 'shaders');
  for (const rel of ['Shaders/DLSS5_Feed.fx','Shaders/vort_Motion.fx','Shaders/ReShade.fxh','Shaders/ReShadeUI.fxh','Shaders/Includes/vort_Defs.fxh','Textures/vort_BlueNoise.png']) put('shaders/'+rel);
  for (const bits of [32,64]) {
    identified(path.join(payload, `reshade/ReShade${bits}.dll`),bits,'ReShade');
    identified(path.join(payload, `dgvoodoo/MS/${bits===32?'x86':'x64'}/D3D9.dll`),bits,'dgVoodoo');
  }
  for (const name of ['D3D8.dll', 'DDraw.dll', 'D3DImm.dll']) identified(path.join(payload, 'dgvoodoo/MS/x86', name),32,'dgVoodoo');
  put('dgvoodoo/dgVoodooCpl.exe');put('dgvoodoo/dgVoodoo.conf','[General]\nOutputAPI=bestavailable\n');
  const preloader32 = writePe(path.join(payload, 'enhanced/zh-cn/winmm.dll'), {bitness:32, version:'1.0.0.0'});
  const source = {hasNeuralRendering:true, payload:['nvngx_dlss.dll','nvngx_dlssnr.dll'].map(name=>({name,path:writePe(path.join(payload,'streamline',name),{bitness:64}),version:'310.8.0.0'})),feeder:{
    ok:true,addon32:put('dlss5-feed.addon32'),addon64:put('dlss5-feed.addon64'),host64:writePe(path.join(payload,'dlss5-feed-host64.exe')),
    hostAddon:put('renodx-dlss5.addon64'),feedShader:path.join(shaderRoot,'Shaders/DLSS5_Feed.fx'),shaderRoot,
    dgVoodooDir:path.join(payload,'dgvoodoo'),vulkanLayerDir:path.join(payload,'reshade'),preloader32
  }};
  const config = {gameDir:game,exePath,api,bitness,route:'feeder',source,installReShade:true};
  const work=async()=>{await journal.transaction(game,()=>core.applySwap(config));return {ok:true};};
  const review=new ComponentReview(path.join(root,'Profile'));
  return {root,game,payload,preloader32,config,work,review};
}

test('32-bit preloader and engine configs participate in preview, apply, lock and restore', async t=>{
  const f=fixture(t);
  const original='[Custom]\nKeep=original\n';
  for(const sub of ['e2driver','drivers','driver','renderers']) fs.mkdirSync(path.join(f.game,sub));
  fs.writeFileSync(path.join(f.game,'drivers/dgVoodoo.conf'),original);
  const request={kind:'install'};
  const plan=(await f.review.run(f.game,request,f.work)).preview;
  assert.equal(plan.rows.find(r=>r.rel==='winmm.dll').action,'add');
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
  assert.equal(fs.existsSync(path.join(f.game,'_DLSS5_Backup')),false);
  assert.equal(fs.readFileSync(path.join(f.game,'drivers/dgVoodoo.conf'),'utf8'),original);
  await f.review.run(f.game,request,f.work,plan.token);
  assert.equal(diskInfo(path.join(f.game,'winmm.dll')).sha256,diskInfo(f.preloader32).sha256);
  for(const sub of ['e2driver','drivers','driver','renderers']) assert.match(fs.readFileSync(path.join(f.game,sub,'dgVoodoo.conf'),'utf8'),/OutputAPI\s*=d3d11_fl11_0/);
  assert.match(fs.readFileSync(path.join(f.game,'drivers/dgVoodoo.conf'),'utf8'),/Keep=original/);
  const inventory=await f.review.inventory(f.game);
  assert.ok(inventory.rows.some(r=>r.rel==='winmm.dll'&&r.present));
  await f.review.setLock(f.game,true);
  fs.appendFileSync(f.preloader32,'updated preloader');
  const update=(await f.review.run(f.game,request,f.work)).preview;
  assert.ok(update.conflicts.some(c=>c.includes('winmm.dll')));
  await assert.rejects(f.review.run(f.game,request,f.work,update.token),{code:'errVersionLocked'});
  const restore=async()=>({ok:await core.restore(f.game)});
  const undo=(await f.review.run(f.game,{kind:'restore'},restore)).preview;
  await f.review.run(f.game,{kind:'restore'},restore,undo.token);
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
  assert.equal(fs.readFileSync(path.join(f.game,'drivers/dgVoodoo.conf'),'utf8'),original);
  assert.equal(fs.existsSync(path.join(f.game,'renderers/dgVoodoo.conf')),false);
});

test('third-party winmm is left intact and is never claimed by the installer', async t=>{
  const f=fixture(t), target=path.join(f.game,'winmm.dll');
  writePe(target,{bitness:32,text:'external audio or mod proxy'});
  const original=fs.readFileSync(target);
  const preview=(await f.review.run(f.game,{kind:'install'},f.work)).preview;
  assert.ok(!preview.rows.some(r=>r.rel==='winmm.dll'&&r.action!=='keep'));
  await f.review.run(f.game,{kind:'install'},f.work,preview.token);
  const mf=JSON.parse(fs.readFileSync(path.join(f.game,'_DLSS5_Backup/manifest.json')));
  assert.ok(!mf.added.some(r=>r.toLowerCase()==='winmm.dll'));
  assert.ok(!mf.replaced.some(r=>r.rel.toLowerCase()==='winmm.dll'));
  await core.restore(f.game);
  assert.deepEqual(fs.readFileSync(target),original);
});

test('preloader applies only to 32-bit legacy wrapper routes', async t=>{
  for(const [bits,api] of [[64,'d3d9'],[32,'dxgi']]) {
    const f=fixture(t,bits,api);
    const plan=(await f.review.run(f.game,{kind:'install'},f.work)).preview;
    assert.ok(!plan.rows.some(r=>r.rel==='winmm.dll'));
  }
});

test('2.3.1 OpenGL fallback is previewed, recognized, repeatable and restored without replacing user configuration', async t => {
  const f = fixture(t, 32, 'opengl');
  const target = path.join(f.game, 'NeuralFrame-Legacy.ini');
  const original = '[Compatibility]\nCpuLimit=0\nLegacyMemory=0\nGoldSrc=0\n[Custom]\nKeep=42\n';
  fs.writeFileSync(target, original);
  const plan = (await f.review.run(f.game, {kind:'install'}, f.work)).preview;
  for (const rel of ['winmm.dll', 'ReShade32.dll', 'NeuralFrame-Legacy.ini']) assert.ok(plan.rows.some(row => row.rel === rel));
  assert.equal(fs.readFileSync(target,'utf8'), original);
  await f.review.run(f.game, {kind:'install'}, f.work, plan.token);
  assert.match(fs.readFileSync(target,'utf8'), /Keep=42/);
  const compatibility = require('../src/core/compatibility');
  const manifest = () => JSON.parse(fs.readFileSync(path.join(f.game, '_DLSS5_Backup/manifest.json')));
  compatibility.assertLoaderCompatible(f.config, manifest());
  // GoldSrc can delete the named proxy; the controlled backup is still detected.
  fs.unlinkSync(path.join(f.game, 'opengl32.dll'));
  assert.equal(require('../src/core/scan').inspectReShade(f.game).kind, 'preloader');
  await f.work();
  await core.restore(f.game);
  assert.equal(fs.existsSync(path.join(f.game, 'ReShade32.dll')), false);
  assert.equal(fs.existsSync(path.join(f.game, 'winmm.dll')), false);
  assert.equal(fs.readFileSync(target,'utf8'), original);
});

test('2.3.1 DirectDraw keeps compatible wrappers and restores the 32-bit pipeline', async t => {
  const f = fixture(t, 32, 'ddraw');
  await f.work();
  const compatibility = require('../src/core/compatibility');
  assert.doesNotThrow(() => compatibility.assertLoaderCompatible(f.config, null));
  assert.equal(core.selectSafeReShadeHook(f.game,'ddraw').hook,'dxgi.dll');
  assert.match(fs.readFileSync(path.join(f.game,'dgVoodoo.conf'),'utf8'), /VRAM=1024/);
  assert.match(fs.readFileSync(path.join(f.game,'dgVoodoo.conf'),'utf8'), /FullscreenAttributes=fake/);
  await core.restore(f.game);
  for (const name of ['DDraw.dll','D3DImm.dll','winmm.dll','NeuralFrame-Legacy.ini']) assert.equal(fs.existsSync(path.join(f.game,name)),false);
});

for (const failure of [false, true]) test(`obsolete Feeder wrappers and effects survive ${failure ? 'a later failed installation' : 'a full restore'}`, async t => {
  const f = fixture(t), wrapper = path.join(f.game,'D3D8.dll');
  fs.copyFileSync(path.join(f.payload,'dgvoodoo/MS/x86/D3D8.dll'),wrapper);
  const shader = path.join(f.game,'reshade-shaders/Shaders/lumenite_SSSR.fx');
  fs.mkdirSync(path.dirname(shader),{recursive:true});
  fs.writeFileSync(shader,'user tuned reflection shader');
  const originals = [wrapper,shader].map(file=>[file,fs.readFileSync(file)]);
  const lumenite = path.join(f.payload,'Lumenite');
  fs.mkdirSync(path.join(lumenite,'Shaders'),{recursive:true});
  fs.mkdirSync(path.join(lumenite,'Textures'));
  fs.writeFileSync(path.join(lumenite,'Shaders/lumenite_Kernel.fx'),'fixture kernel');
  f.config.source.feeder.lumeniteRoot = lumenite;
  if (failure) {
    const copy = fs.promises.copyFile;
    t.mock.method(fs.promises,'copyFile',async (src,dest,...options)=>{
      if (dest === path.join(f.game,'host64/nvngx_dlssnr.dll')) throw Object.assign(Error('later deployment failed'),{code:'EBUSY'});
      return copy(src,dest,...options);
    });
    await assert.rejects(f.work(),{code:'EBUSY'});
  } else {
    const preview = (await f.review.run(f.game,{kind:'install'},f.work)).preview;
    for (const [file,bytes] of originals) assert.deepEqual(fs.readFileSync(file),bytes,'preview never removes originals');
    await f.review.run(f.game,{kind:'install'},f.work,preview.token);
    for (const [file] of originals) assert.equal(fs.existsSync(file),false,'the obsolete component is disabled during use');
    await core.restore(f.game);
  }
  for (const [file,bytes] of originals) assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(fs.existsSync(journal.pendingPath(f.game)),false);
});

function registryFixture() {
  const values = new Map(), mutations = [];
  const runner = async (_file, args) => {
    const [action, key] = args;
    const valueAt = args.indexOf('/v');
    const valueName = valueAt >= 0 ? args[valueAt+1] : '';
    const id = (key+'|'+valueName).toLowerCase();
    if (action === 'query') return {code: [...values.keys()].some(k=>valueAt >= 0 || args.includes('/ve') ? k === id : k.startsWith(key.toLowerCase()+'\\') || k.startsWith(key.toLowerCase()+'|')) ? 0 : 1, stdout:''};
    mutations.push(args);
    if (action === 'add') values.set(id,args[args.indexOf('/d')+1]);
    if (action === 'delete') for (const k of values.keys()) if (k.startsWith(key.toLowerCase()+'\\') || k.startsWith(key.toLowerCase()+'|')) values.delete(k);
    return {code:0,stdout:''};
  };
  return {values, mutations, runner};
}
function installScript(game) {
  fs.writeFileSync(path.join(game,'installscript.vdf'), '"InstallScript" { "Registry" { "HKEY_LOCAL_MACHINE\\\\Software\\\\TestGameVendor\\\\Game" { "string" { "Path" "%INSTALLDIR%" } } } }');
}

test('legacy registry stays private, preview is read-only, reapply preserves values, restore removes only its namespace', async t => {
  const f=fixture(t), reg=registryFixture(); installScript(f.game);
  f.config.registryRunner=reg.runner;
  const original = path.join(f.game,'user-settings.ini'); fs.writeFileSync(original,'untouched');
  const preview=(await f.review.run(f.game,{kind:'install'},f.work)).preview;
  assert.equal(reg.mutations.length,0);
  assert.ok(preview.externalSteps.some(step=>step.args[0]==='add'));
  await f.review.run(f.game,{kind:'install'},f.work,preview.token);
  assert.ok(reg.mutations.every(a=>a[1].startsWith('HKCU\\Software\\NeuralFrame\\Legacy\\')));
  const key=[...reg.values.keys()][0]; reg.values.set(key,'user modified value');
  await f.work(); assert.equal(reg.values.get(key),'user modified value');
  const other='hkcu\\software\\neuralframe\\legacy\\another-game|keep'; reg.values.set(other,'keep');
  await core.restore(f.game,null,null,{registryRunner:reg.runner});
  assert.equal(reg.values.has(key),false); assert.equal(reg.values.get(other),'keep');
  assert.equal(fs.readFileSync(original,'utf8'),'untouched');
});

test('a later file-stage failure rolls back the bridge and never seeds registry values', async t => {
  const f=fixture(t), reg=registryFixture(); installScript(f.game); f.config.registryRunner=reg.runner;
  const badHost=f.config.source.feeder.host64;
  fs.unlinkSync(badHost);
  await assert.rejects(f.work());
  assert.equal(reg.mutations.length,0);
  for(const name of ['winmm.dll','NeuralFrame-Legacy.ini','dgVoodoo.conf']) assert.equal(fs.existsSync(path.join(f.game,name)),false);
});

test('registry commit failure retains an owned, recoverable manifest', async t => {
  const f=fixture(t), reg=registryFixture(); installScript(f.game);
  f.config.registryRunner=async(file,args)=>args[0]==='add' ? {code:1,stdout:''} : reg.runner(file,args);
  await assert.rejects(f.work(),{code:'errBackendRecovery'});
  const manifest=JSON.parse(fs.readFileSync(path.join(f.game,'_DLSS5_Backup/manifest.json')));
  assert.equal(manifest.legacyRegistry.owned,true);
  await journal.recover(f.game);
  await core.restore(f.game,null,null,{registryRunner:reg.runner});
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
});

test('failed registry cleanup is retryable without replaying file restoration or allowing another install', async t => {
  const f=fixture(t), reg=registryFixture(); installScript(f.game); f.config.registryRunner=reg.runner;
  const settings=path.join(f.game,'NeuralFrame-Legacy.ini'); fs.writeFileSync(settings,'[Custom]\nKeep=old\n');
  await f.work();
  const failing=async(file,args)=>args[0]==='delete' ? {code:1,stdout:''} : reg.runner(file,args);
  await assert.rejects(core.restore(f.game,null,null,{registryRunner:failing}),{code:'errLegacyRegistry'});
  const manifest=JSON.parse(fs.readFileSync(path.join(f.game,'_DLSS5_Backup/manifest.json')));
  assert.equal(manifest.restorePhase,'detach-external');
  fs.writeFileSync(settings,'new game configuration');
  await assert.rejects(f.work(),{code:'errBackendRecovery'});
  await core.restore(f.game,null,null,{registryRunner:reg.runner});
  assert.equal(fs.readFileSync(settings,'utf8'),'new game configuration');
  assert.equal(reg.values.size,0);
});

test('switching away from the 32-bit route cleans its registry and keeps per-route user settings', async t => {
  const f=fixture(t), reg=registryFixture(); installScript(f.game); f.config.registryRunner=reg.runner;
  const manager=require('../src/core/backend-manager');
  await manager.install(f.config);
  const settings=path.join(f.game,'NeuralFrame-Legacy.ini');
  fs.writeFileSync(settings,'[Compatibility]\nCpuLimit=0\nLegacyMemory=0\n[User]\nKeep=17\n');
  fs.writeFileSync(path.join(f.game,'dgVoodoo.conf'),'[DirectX]\nVRAM=1536\n[User]\nKeep=18\n');
  const exe64=writePe(path.join(f.game,'Game64.exe'),{bitness:64,text:'D3D11CreateDevice'});
  await manager.install({...f.config,exePath:exe64,bitness:64,api:'dxgi'});
  assert.equal(reg.values.size,0);
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
  await manager.install(f.config);
  assert.match(fs.readFileSync(settings,'utf8'),/Keep=17/);
  assert.match(fs.readFileSync(path.join(f.game,'dgVoodoo.conf'),'utf8'),/VRAM=1536/);
  assert.match(fs.readFileSync(path.join(f.game,'dgVoodoo.conf'),'utf8'),/Keep=18/);
  assert.ok(reg.values.size>0);
  await core.restore(f.game,null,null,{registryRunner:reg.runner});
});

test('preloader comes from the selected component source and wrong bitness blocks without game writes', async t=>{
  const f=fixture(t);
  assert.equal(scanSource(f.payload).feeder.preloader32,f.preloader32);
  writePe(f.preloader32,{bitness:64});
  await assert.rejects(f.review.run(f.game,{kind:'install'},f.work),{code:'errReShadeArchitecture'});
  assert.equal(fs.existsSync(path.join(f.game,'_DLSS5_Backup')),false);
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
});

const builtPreloader = path.join(require('./fixtures/payload').root, 'enhanced/zh-cn/winmm.dll');
test('built upstream preloader is a 32-bit DLL', {skip:!fs.existsSync(builtPreloader)}, ()=>{
  assert.equal(pe.getBitness(builtPreloader),32);
});
