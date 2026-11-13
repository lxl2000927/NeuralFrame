'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {writePe} = require('./fixtures/pe');
const payload = require('./fixtures/payload');
const backends = require('../src/core/backend-manager'), encore = require('../src/core/encore');
const config = require('../src/core/encore-config');
const {ComponentReview} = require('../src/core/component-review');
const {scanGame} = require('../src/core/scan');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t, renderer='D3D12CreateDevice') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-encore-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const gameDir=path.join(root,'Game'),exePath=path.join(gameDir,'Game-Win64-Shipping.exe');
  writePe(exePath,{bitness:64,text:renderer,size:131072});
  const options={gameDir,exePath,route:'encore',api:'dxgi',apiLabel:'DirectX 12',bitness:64,
    payloadDir:payload.root,gpuName:'NVIDIA GeForce RTX 4070 Laptop GPU',encoreSettings:{...config.DEFAULTS,mfgMode:'x3'}};
  return {root,gameDir,exePath,options,reviews:new ComponentReview(path.join(root,'profile'))};
}
test('real pinned Encore preview is read-only; install, menu tuning, model update and restore stay transactional', async t => {
  const f=fixture(t), bytes=fs.readFileSync(f.exePath);
  const original=path.join(f.gameDir,'Engine','nvngx_dlss.dll');writePe(original,{version:[3,7,0,0]});const originalBytes=fs.readFileSync(original);
  const work=async()=>({ok:true,manifest:await backends.install(f.options)}),request={kind:'install',route:'encore'};
  const preview=await f.reviews.run(f.gameDir,request,work);
  assert.ok(preview.preview.rows.some(r=>r.rel==='version.dll'&&r.action==='add'));
  assert.ok(preview.preview.rows.some(r=>r.rel===encore.CONFIG&&r.category==='配置'));
  assert.equal(fs.existsSync(path.join(f.gameDir,'version.dll')),false);assert.equal(fs.existsSync(path.join(f.gameDir,'_DLSS5_Backup')),false);
  assert.equal((await f.reviews.run(f.gameDir,request,work,preview.preview.token)).ok,true);
  const scan=await scanGame(f.gameDir);assert.equal(scan.chosen.hasNativeFg,false,'own added DLL is not native FG');
  assert.equal(scan.chosen.hasNativeDlss,true);assert.equal(encore.inspect(f.gameDir,scan,backends.readManifest(f.gameDir)).installed,true);
  assert.deepEqual(fs.readFileSync(original),originalBytes);assert.deepEqual(fs.readFileSync(f.exePath),bytes);
  const json=path.join(f.gameDir,encore.CONFIG),tuned=fs.readFileSync(json,'utf8').replace('"configVersion": 4','"menu": {"language":"en"}, "configVersion": 4');
  fs.writeFileSync(json,tuned);
  await backends.install({...f.options,encoreSettings:{...f.options.encoreSettings,mfgMode:'x4'}});
  assert.equal(config.document(fs.readFileSync(json,'utf8')).menu.language,'en');
  const modelFile=encore.sourceFile(payload.root,'nr-3108','nvngx_dlssnr.dll');
  await backends.install({...f.options,encoreSettings:{...f.options.encoreSettings,neuralMode:'latest_compatible'},
    model:{filePath:modelFile.source,sha256:modelFile.sha256,version:'310.8.0.0',id:'310.8.SF-v2'}});
  assert.equal(hash(fs.readFileSync(path.join(f.gameDir,'nvngx_dlssnr.dll'))),modelFile.sha256);
  const manifest=backends.readManifest(f.gameDir);assert.equal(manifest.neuralRendering.modelId,'310.8.SF-v2');
  assert.throws(()=>encore.checkPreview(f.gameDir,[{scope:'game',rel:'sl.common.dll',action:'replace',after:{sha256:'bad'}}],'component-update'),/统一管理/);
  const restore=()=>backends.restore(f.gameDir).then(ok=>({ok}));
  const plan=await f.reviews.run(f.gameDir,{kind:'restore'},restore);
  assert.equal((await f.reviews.run(f.gameDir,{kind:'restore'},restore,plan.preview.token)).ok,true);
  for(const rel of Object.keys(manifest.encore.files))assert.equal(fs.existsSync(path.join(f.gameDir,rel)),false,rel);
  assert.deepEqual(fs.readFileSync(original),originalBytes);assert.deepEqual(fs.readFileSync(f.exePath),bytes);
  // Restore preserves the backend's private menu settings for a later install.
  await backends.install(f.options);
  assert.equal(config.document(fs.readFileSync(json,'utf8')).menu.language,'en');
});
test('Encore refuses foreign FG, modified owned files, unknown configs and source hash drift',async t=>{
  const f=fixture(t),dll=path.join(f.gameDir,'nvngx_dlssg.dll');writePe(dll,{version:[310,9,16,0]});const bytes=fs.readFileSync(dll);
  await assert.rejects(backends.install(f.options),/原生帧生成/);assert.deepEqual(fs.readFileSync(dll),bytes);fs.unlinkSync(dll);
  const json=path.join(f.gameDir,encore.CONFIG);fs.writeFileSync(json,'{}');
  await assert.rejects(backends.install(f.options),/来源未知/);assert.equal(fs.readFileSync(json,'utf8'),'{}');fs.unlinkSync(json);
  await backends.install(f.options);const proxy=path.join(f.gameDir,'version.dll');fs.appendFileSync(proxy,'edited');
  await assert.rejects(backends.install(f.options),/已被.*修改/);assert.ok(fs.readFileSync(proxy).includes(Buffer.from('edited')));
  const broken=path.join(f.root,'broken');fs.mkdirSync(path.join(broken,'enhanced','encore'),{recursive:true});
  fs.writeFileSync(path.join(broken,'enhanced','encore','rtx-encore.dll'),'wrong');
  assert.throws(()=>encore.sourceFile(broken,'encore','rtx-encore.dll'),/指纹不匹配/);
});
test('Encore chooses a free loader and rolls back all writes on a deployment failure',async t=>{
  const f=fixture(t),foreign=path.join(f.gameDir,'version.dll');writePe(foreign,{text:'Some other tool'});const bytes=fs.readFileSync(foreign);
  const apply=require('../src/core/apply'),copy=apply.copyTracked;let copied=0;
  const mock=t.mock.method(apply,'copyTracked',async(...args)=>{if(++copied===4)throw Error('injected disk failure');return copy(...args);});
  await assert.rejects(backends.install(f.options),/injected disk failure/);mock.mock.restore();
  assert.deepEqual(fs.readFileSync(foreign),bytes);assert.equal(fs.existsSync(path.join(f.gameDir,'dinput8.dll')),false);
  assert.equal(backends.readManifest(f.gameDir),null);
  await backends.install(f.options);assert.equal(backends.readManifest(f.gameDir).encore.proxy,'dinput8.dll');
  await backends.restore(f.gameDir);assert.deepEqual(fs.readFileSync(foreign),bytes);
});
test('Encore route rejects Wuthering Waves and unsupported GPUs before writing',async t=>{
  const f=fixture(t),dir=path.join(f.root,'Wuthering Waves Game');
  const exe=writePe(path.join(dir,'Client','Binaries','Win64','Client-Win64-Shipping.exe'),{bitness:64,text:'D3D12CreateDevice',size:131072});
  fs.writeFileSync(path.join(dir,'Wuthering Waves.exe'),'launcher');
  const scan=await scanGame(dir);assert.throws(()=>encore.assertTarget(dir,scan,scan.chosen,'RTX 4070'),/鸣潮/);
  await assert.rejects(backends.install({...f.options,gpuName:'Unknown'}),/NVIDIA RTX/);
  assert.equal(fs.existsSync(path.join(dir,'_DLSS5_Backup')),false);assert.ok(fs.existsSync(exe));
});
test('DX11 and Vulkan added FG use the adjacent proxy without a ReShade global layer',async t=>{
  for (const [api,apiLabel,renderer] of [['dxgi','DirectX 11','D3D11CreateDevice'],['vulkan','Vulkan','vkCreateInstance']]) {
    const f=fixture(t,renderer);await backends.install({...f.options,api,apiLabel});
    const m=backends.readManifest(f.gameDir);assert.equal(m.route,'encore');assert.equal(m.vulkanLayer,undefined);
    assert.equal(fs.existsSync(path.join(f.gameDir,'ReShade.ini')),false);await backends.restore(f.gameDir);
  }
});
test('switching to and from Encore preserves the original route profile and independent JSONC settings',async t=>{
  const f=fixture(t),apply=require('../src/core/apply');
  // Exercise the real backend/profile transaction; the other rendering engine
  // is represented by tracked settings rather than running an installer.
  const ini=path.join(f.gameDir,'ReShade.ini'),original='[CUSTOM]\nIntensity=0.25\n';fs.writeFileSync(ini,original);
  t.mock.method(apply,'applySwap',async options=>{
    const manifest=apply.beginManifest(options.gameDir,options.exePath,options.api);manifest.route=options.route;
    await apply.writeTracked(manifest,options.gameDir,ini,fs.readFileSync(ini,'utf8'),{kind:'config'});
    await apply.saveActiveManifest(options.gameDir,manifest);return manifest;
  });
  const native={...f.options,route:'native'};
  await backends.install(native);const tuned='[CUSTOM]\nIntensity=0.73\n';fs.writeFileSync(ini,tuned);
  await backends.install(f.options);assert.equal(fs.readFileSync(ini,'utf8'),original);
  assert.equal(backends.loadProfile(native)['ReShade.ini'],tuned);
  const json=path.join(f.gameDir,encore.CONFIG);
  fs.writeFileSync(json,fs.readFileSync(json,'utf8').replace('"configVersion": 4','"menu": {"language":"fr"}, "configVersion": 4'));
  await backends.install(native);assert.equal(fs.readFileSync(ini,'utf8'),tuned);assert.equal(fs.existsSync(json),false);
  await backends.install(f.options);assert.equal(config.document(fs.readFileSync(json,'utf8')).menu.language,'fr');
  await backends.restore(f.gameDir);assert.equal(fs.readFileSync(ini,'utf8'),original);
});
test('Encore inspection belongs to its deployed executable rather than another candidate in the same game',async t=>{
  const f=fixture(t);await backends.install(f.options);
  const other=writePe(path.join(f.gameDir,'Other','OtherGame.exe'),{bitness:64,text:'D3D11CreateDevice',size:131072});
  const manifest=backends.readManifest(f.gameDir),scan=await scanGame(f.gameDir,other);
  const status=encore.inspect(f.gameDir,scan,manifest);
  assert.equal(status.exePath,other);assert.equal(status.installed,false);assert.equal(status.error,undefined);
  assert.equal(status.settings.mfgMode,'off');
  const own=encore.inspect(f.gameDir,await scanGame(f.gameDir,f.exePath),manifest);
  assert.equal(own.exePath,f.exePath);assert.equal(own.installed,true);assert.equal(own.settings.mfgMode,'x3');
});
test('restore and backend switching preserve externally changed Encore files, including archived deployments',async t=>{
  const f=fixture(t);await backends.install(f.options);
  const proxy=path.join(f.gameDir,'version.dll'),original=fs.readFileSync(proxy),changed=Buffer.concat([original,Buffer.from('external update')]);
  fs.writeFileSync(proxy,changed);
  const manifestPath=path.join(f.gameDir,'_DLSS5_Backup','manifest.json'),manifestBytes=fs.readFileSync(manifestPath);
  const json=fs.readFileSync(path.join(f.gameDir,encore.CONFIG));
  await assert.rejects(backends.restore(f.gameDir),/停止还原.*version.dll/);
  await assert.rejects(backends.install({...f.options,route:'native'}),/停止还原.*version.dll/);
  assert.deepEqual(fs.readFileSync(proxy),changed);assert.deepEqual(fs.readFileSync(manifestPath),manifestBytes);
  assert.deepEqual(fs.readFileSync(path.join(f.gameDir,encore.CONFIG)),json);
  fs.renameSync(manifestPath,manifestPath+'.done-123');
  await assert.rejects(backends.restore(f.gameDir),/停止还原.*version.dll/);
  assert.deepEqual(fs.readFileSync(proxy),changed);
  // Missing files are already absent and must not block recovery of the rest.
  fs.unlinkSync(proxy);await backends.restore(f.gameDir);
  assert.equal(fs.existsSync(path.join(f.gameDir,encore.CONFIG)),false);
  assert.equal(fs.existsSync(path.join(f.gameDir,'sl.common.dll')),false);
});
test('Encore refuses a second copy under another proxy name or an ASI loader directory',async t=>{
  for(const rel of ['dsound.dll',path.join('plugins','renderer.asi'),path.join('scripts','renderer.asi')]) {
    const f=fixture(t),foreign=path.join(f.gameDir,rel),source=encore.sourceFile(payload.root,'encore','rtx-encore.dll');
    fs.mkdirSync(path.dirname(foreign),{recursive:true});fs.copyFileSync(source.source,foreign);
    await assert.rejects(backends.install(f.options),/其他工具的渲染或补帧加载器/);
    assert.equal(hash(fs.readFileSync(foreign)),source.sha256);
    assert.equal(fs.existsSync(path.join(f.gameDir,'version.dll')),false);
    assert.equal(backends.readManifest(f.gameDir),null);
  }
});
test('Encore preserves the installed version until explicitly selected, previews upgrades, and keeps menu JSONC',async t=>{
  const f=fixture(t),engines=require('../src/core/engine-packages'),describe=engines.describe;
  const native=path.join(f.gameDir,'Engine','nvngx_dlss.dll');writePe(native,{version:[3,7,0,0]});
  // Registry verification has separate tests with original release bytes. These
  // two tiny engines isolate selection, ownership and transaction semantics.
  const entries=['2.3.0','2.4.1'].map((version,index)=>{
    const filePath=writePe(path.join(f.root,`engine-${version}.dll`),{text:`RTX Encore ${version}`,size:131072});
    return {filePath,sha256:hash(fs.readFileSync(filePath)),size:fs.statSync(filePath).size,version,
      packageId:hash(version),verified:true,compatible:true,recommended:index===1,capabilities:config.capabilities(version)};
  });
  let resolutions=0;
  t.mock.method(engines,'describe',(component,pkg)=>component==='encore' && entries.find(e=>e.sha256===pkg.sha256) || describe(component,pkg));
  t.mock.method(engines,'resolve',async({packageId})=>{resolutions++;const selected=packageId?entries.find(e=>e.packageId===packageId):entries[1];assert.ok(selected);return {...selected};});
  await backends.install({...f.options,encorePackageId:entries[0].packageId});
  const proxy=path.join(f.gameDir,'version.dll'),json=path.join(f.gameDir,encore.CONFIG);
  fs.writeFileSync(json,fs.readFileSync(json,'utf8').replace('"configVersion": 4','// keep original menu\n  "configVersion": 4, "menu":{"language":"ja"}, "custom":{"private":9}'));
  await backends.install({...f.options,encoreSettings:{...config.read(fs.readFileSync(json,'utf8')),mfgMode:'x4'}});
  assert.equal(resolutions,1,'an ordinary configuration edit does not resolve a newer engine');
  assert.equal(hash(fs.readFileSync(proxy)),entries[0].sha256);
  let status=encore.inspect(f.gameDir,await scanGame(f.gameDir),backends.readManifest(f.gameDir));
  assert.equal(status.version,'2.3.0');assert.equal(status.engine.verified,true);assert.equal(status.engine.recommended,false);
  assert.equal(status.capabilities.nrPassPlacement,false);assert.equal(status.capabilities.dlssCustomScaleMin,50);
  const oldJson=fs.readFileSync(json,'utf8');
  await assert.rejects(backends.install({...f.options,encoreSettings:{...config.read(oldJson),nrPass1Placement:'present'}}),/2.4.0/);
  assert.equal(fs.readFileSync(json,'utf8'),oldJson);assert.equal(hash(fs.readFileSync(proxy)),entries[0].sha256);
  const upgrade={...f.options,encorePackageId:'',encoreSettings:{...config.read(oldJson),nrPass1Placement:'present',dlssRenderScale:'custom',dlssCustomScale:33}};
  const work=async()=>({ok:true,manifest:await backends.install(upgrade)}),request={kind:'install',route:'encore',encorePackageId:''};
  const preview=await f.reviews.run(f.gameDir,request,work);
  assert.ok(preview.preview.rows.some(row=>row.rel==='version.dll'&&row.action==='replace'));
  assert.equal(hash(fs.readFileSync(proxy)),entries[0].sha256);assert.equal(fs.readFileSync(json,'utf8'),oldJson);
  assert.equal((await f.reviews.run(f.gameDir,request,work,preview.preview.token)).ok,true);
  status=encore.inspect(f.gameDir,await scanGame(f.gameDir),backends.readManifest(f.gameDir));
  assert.equal(status.version,'2.4.1');assert.equal(status.engine.recommended,true);assert.equal(status.capabilities.nrPassPlacement,true);
  assert.equal(status.settings.nrPass1Placement,'present');assert.equal(status.settings.dlssCustomScale,33);
  const updated=fs.readFileSync(json,'utf8');assert.ok(updated.includes('// keep original menu'));
  assert.equal(config.document(updated).menu.language,'ja');assert.equal(config.document(updated).custom.private,9);
  await assert.rejects(backends.install({...f.options,encorePackageId:entries[0].packageId,encoreSettings:config.read(updated)}),/最低为 50/);
  assert.equal(hash(fs.readFileSync(proxy)),entries[1].sha256);assert.equal(fs.readFileSync(json,'utf8'),updated);
  await backends.restore(f.gameDir);assert.equal(fs.existsSync(proxy),false);assert.equal(fs.existsSync(json),false);assert.ok(fs.existsSync(native));
});
test('Encore does not silently replace a missing or unrecognized installed engine and reports drift',async t=>{
  const f=fixture(t);await backends.install(f.options);
  const proxy=path.join(f.gameDir,'version.dll');fs.unlinkSync(proxy);
  const status=encore.inspect(f.gameDir,await scanGame(f.gameDir),backends.readManifest(f.gameDir));
  assert.equal(status.engine.verified,false);assert.deepEqual(status.capabilities,{});
  await assert.rejects(backends.install(f.options),/明确选择推荐版本/);
  await backends.install({...f.options,encorePackageId:''});
  assert.equal(encore.inspect(f.gameDir,await scanGame(f.gameDir),backends.readManifest(f.gameDir)).engine.verified,true);
  fs.writeFileSync(proxy,'unrecognized replacement with a misleading release label');
  const manifest=backends.readManifest(f.gameDir);manifest.encore.version='2.4.1';
  manifest.encore.files['version.dll']=hash(fs.readFileSync(proxy));
  fs.writeFileSync(path.join(f.gameDir,'_DLSS5_Backup','manifest.json'),JSON.stringify(manifest));
  const unknown=encore.inspect(f.gameDir,await scanGame(f.gameDir),manifest);
  assert.equal(unknown.engine.verified,false);assert.equal(unknown.engine.compatible,false);assert.deepEqual(unknown.capabilities,{});
  await assert.rejects(backends.install(f.options),/明确选择推荐版本/);
});
