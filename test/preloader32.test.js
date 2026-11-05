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
  const exePath = writePe(path.join(game, 'Game.exe'), {bitness, text:api === 'dxgi' ? 'D3D11CreateDevice' : 'Direct3DCreate9'});
  const shaderRoot = path.join(payload, 'shaders');
  for (const rel of ['Shaders/DLSS5_Feed.fx','Shaders/vort_Motion.fx','Shaders/ReShade.fxh','Shaders/ReShadeUI.fxh','Shaders/Includes/vort_Defs.fxh','Textures/vort_BlueNoise.png']) put('shaders/'+rel);
  for (const bits of [32,64]) {
    writePe(path.join(payload, `reshade/ReShade${bits}.dll`), {bitness:bits, version:'6.8.0.0', text:'ReShade Searching for add-ons'});
    writePe(path.join(payload, `dgvoodoo/MS/${bits===32?'x86':'x64'}/D3D9.dll`), {bitness:bits, text:'dgVoodoo'});
  }
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

test('preloader comes from the selected component source and wrong bitness blocks without game writes', async t=>{
  const f=fixture(t);
  assert.equal(scanSource(f.payload).feeder.preloader32,f.preloader32);
  writePe(f.preloader32,{bitness:64});
  await assert.rejects(f.review.run(f.game,{kind:'install'},f.work),{code:'errReShadeArchitecture'});
  assert.equal(fs.existsSync(path.join(f.game,'_DLSS5_Backup')),false);
  assert.equal(fs.existsSync(path.join(f.game,'winmm.dll')),false);
});

test('built upstream preloader is a 32-bit DLL', {skip:!fs.existsSync(path.resolve(__dirname,'../payload/enhanced/zh-cn/winmm.dll'))}, ()=>{
  assert.equal(pe.getBitness(path.resolve(__dirname,'../payload/enhanced/zh-cn/winmm.dll')),32);
});
