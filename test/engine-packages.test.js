'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const engines=require('../src/core/engine-packages');
const {ComponentLibrary}=require('../src/core/component-library');
const {ComponentUpdates,candidates,mapFiles}=require('../src/core/component-updates');
const {componentCompatibility}=require('../src/core/component-compatibility');
const catalog=require('../src/core/runtime-catalog.json');
const payload=require('./fixtures/payload');
const {writePe}=require('./fixtures/pe');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-engine-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,library:new ComponentLibrary(path.join(root,'profile'))};}

test('engine identity requires fingerprints, preserving supported originals without trusting version labels',()=>{
  for(const component of ['encore','mfg-universal']){
    const current=engines.recommended(component);
    assert.equal(current.compatible,true);assert.equal(current.recommended,true);
    assert.equal(engines.describe(component,{version:current.version,trustedAdapter:true}).compatible,false);
    assert.equal(engines.describe(component,{sha256:current.archiveSha256}).recommended,true);
    assert.equal(engines.describe(component,{archiveSha256:current.archiveSha256,files:[{rel:component==='encore'?'rtx-encore.dll':'MFGUnlocker.dll',sha256:'a'.repeat(64)}]}).compatible,false);
    assert.equal(engines.describe(component,{component:'dlss-sr',sha256:current.sha256}).compatible,false);
    const support=componentCompatibility({component,sha256:current.archiveSha256});
    assert.equal(support.ready,false,'engine deployment never bypasses the route transaction');assert.equal(support.engine.compatible,true);
    assert.equal(componentCompatibility({component,version:current.version,trustedAdapter:true}).kind,'pending');
  }
  const oldEncore=engines.identify('encore','b668a747e5eba576b544e4c6a790ce9c2d52b80389fe4f6ec999b6020f612471');
  assert.equal(oldEncore.compatible,true);assert.equal(oldEncore.recommended,false);assert.equal(oldEncore.capabilities.dlssCustomScaleMin,50);
  assert.equal(engines.recommended('encore').capabilities.dlssCustomScaleMin,33);
  assert.equal(engines.identify('mfg-universal','e6b6e6b70a6ed3af839c9647a32fc22660ae6b2d655062c5c072246c91fc10c7').capabilities.neuralStrengths,true);
});

test('Encore official releases advertise support before download while an unknown update stays pending',t=>{
  const f=fixture(t),updater=new ComponentUpdates(f.library),engine=engines.recommended('encore');
  const release=(version,sha)=>({id:version,tag_name:'v'+version,assets:[{id:version,name:'RTX-Encore-v'+version+'.zip',digest:'sha256:'+sha,size:100,browser_download_url:'https://github.com/SilyNoMeta/rtx-encore/releases/download/v'+version+'/RTX-Encore-v'+version+'.zip'}]});
  const rows=candidates([release('2.4.1',engine.archiveSha256),release('9.0.0','a'.repeat(64))],'encore');
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.component==='encore'&&row.downloadable));
  const view=updater.withLocalModels({candidates:rows});
  assert.equal(view.candidates[0].engine.recommended,true);assert.equal(view.candidates[1].compatibility.kind,'pending');
  assert.equal(view.candidates[0].pairedPackId,'encore');assert.equal(view.candidates[1].pairedPackId,undefined);
  fs.mkdirSync(f.library.root,{recursive:true});fs.writeFileSync(updater.cache,JSON.stringify({sourcesVersion:2,nextCheckAt:Date.now()+300000,candidates:[],errors:[],etags:{}}));
  assert.equal(updater.readIndex().nextCheckAt,0,'the added upstream is discoverable immediately on explicit check');
});

test('missing recommended files request preparation without accepting a different payload',async t=>{
  const f=fixture(t);
  await assert.rejects(engines.resolve({component:'encore',payloadDir:f.root}),error=>error.code==='errRuntimeComponents'&&error.dependencies[0]==='runtime:encore');
  const file=path.join(f.root,'enhanced/encore/rtx-encore.dll');writePe(file,{bitness:64,text:'RTX Encore',version:[2,4,1,0]});
  await assert.rejects(engines.resolve({component:'encore',payloadDir:f.root}),{code:'errRuntimeComponents'});
});

test('new recommended payloads and explicit library versions resolve only verified bytes and notices',async t=>{
  const f=fixture(t);
  for(const component of ['mfg-universal','encore']){
    const pack=catalog.packs.find(p=>p.id===component),name=component==='encore'?'rtx-encore.dll':'MFGUnlocker.dll';
    const file=pack.files.find(file=>path.basename(file.path)===name),source=path.join(payload.root,file.path);
    const original=await engines.resolve({component,payloadDir:payload.root});
    assert.equal(original.sha256,engines.recommended(component).sha256);assert.ok(original.noticePath);
    const files={[name]:source};
    if(component==='encore')files['THIRD-PARTY-NOTICES.md']=original.noticePath;
    const pkg=await f.library.importPackage({component,version:'user-supplied-label',files});
    const selected=await engines.resolve({component,packageId:pkg.id,userDataDir:f.library.userData,payloadDir:payload.root});
    assert.equal(selected.version,engines.recommended(component).version);assert.equal(selected.packageId,pkg.id);
    assert.ok(selected.noticePath);assert.equal(fs.existsSync(path.join(f.root,'game')),false);
    await assert.rejects(engines.resolve({component:component==='encore'?'mfg-universal':'encore',packageId:pkg.id,userDataDir:f.library.userData}),/尚未适配/);
    const local=path.join(f.library.directory(pkg),name);const fd=fs.openSync(local,'r+');fs.writeSync(fd,Buffer.from([0]),0,1,0);fs.closeSync(fd);
    await assert.rejects(engines.resolve({component,packageId:pkg.id,userDataDir:f.library.userData}),/变化|缺失/);
  }
});

test('an engine notice is preserved without changing existing DLL package identity',async t=>{
  const f=fixture(t),dll=path.join(f.root,'rtx-encore.dll'),notice=path.join(f.root,'THIRD-PARTY-NOTICES.md');
  writePe(dll,{bitness:64,text:'RTX Encore'});fs.writeFileSync(notice,'test notice');
  const first=await f.library.importPackage({component:'encore',files:{'rtx-encore.dll':dll}});
  const second=await f.library.importPackage({component:'encore',files:{'rtx-encore.dll':dll,'THIRD-PARTY-NOTICES.md':notice}});
  assert.equal(first.id,second.id);assert.equal(second.files.length,2);assert.equal(f.library.catalog().packages.length,1);
  assert.equal(componentCompatibility(second).kind,'pending');
  await assert.rejects(engines.resolve({component:'encore',packageId:second.id,userDataDir:f.library.userData}),/尚未适配/);
  const mapped=await mapFiles(f.root,'encore');assert.equal(fs.readFileSync(mapped['THIRD-PARTY-NOTICES.md'],'utf8'),'test notice');
});

test('OptiScaler retains its original 1.7.0 engine while the independent route recommends 1.7.1',async t=>{
  const f=fixture(t),pack=catalog.packs.find(p=>p.id==='mfg-optiscaler-170');
  assert.equal(pack.version,'1.7.0');assert.notEqual(pack.files[0].path,catalog.packs.find(p=>p.id==='mfg-universal').files[0].path);
  const pkg=await f.library.importPackage({component:'mfg-universal',files:{'MFGUnlocker.dll':path.join(payload.root,pack.files[0].path)}});
  const selected=await engines.resolve({component:'mfg-universal',packageId:pkg.id,userDataDir:f.library.userData,payloadDir:payload.root});
  assert.equal(selected.version,'1.7.0');assert.equal(selected.recommended,false);assert.equal(selected.compatible,true);
  assert.equal(engines.recommended('mfg-universal').version,'1.7.1');
});
