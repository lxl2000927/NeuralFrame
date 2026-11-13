'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {ComponentUpdates}=require('../src/core/component-updates');
const {componentCompatibility,modelRequirements}=require('../src/core/component-compatibility');
const {RuntimePayload}=require('../src/core/runtime-payload');
const catalog=require('../src/core/runtime-catalog.json');

test('release availability follows application policy before any download', () => {
  const updater=new ComponentUpdates({root:os.tmpdir(),catalog:()=>({packages:[]})});
  const result=updater.withLocalModels({candidates:['mfg-renodx','dlss-fg','dlss-sr','dlss-nr','feeder','optiscaler'].map(component=>({component,name:'unknown.zip'}))});
  assert.deepEqual(result.candidates.map(c=>c.compatibility.kind),['pending','pending','selectable','selectable','route','route']);
  assert.equal(componentCompatibility({component:'overlay',trustedAdapter:true}).kind,'internal');
});

test('assessment explains unknown archives, known unsupported DLLs and route-only versions while keeping installation gates',()=>{
  const engines=require('../src/core/engine-packages');
  const unknown={component:'encore',name:'RTX-Encore-v9.0.0.zip',sha256:'a'.repeat(64)};
  assert.equal(componentCompatibility(unknown).assessment,'verify');
  const knownFile={...unknown,files:[{rel:'rtx-encore.dll',sha256:'a'.repeat(64),size:123}]};
  assert.equal(componentCompatibility(knownFile).assessment,'unsupported');
  assert.equal(componentCompatibility(knownFile).ready,false);
  assert.equal(componentCompatibility({...unknown,sha256:engines.recommended('encore').archiveSha256}).assessment,'route');
  for(const component of ['feeder','optiscaler','streamline','reshade']) {
    assert.equal(componentCompatibility({component}).assessment,'route-version');
    const paired=componentCompatibility({component,trustedAdapter:true});
    assert.equal(paired.assessment,'route');assert.equal(paired.ready,false);
  }
  assert.equal(componentCompatibility({component:'mfg-renodx',name:'archive.zip'}).assessment,'verify');
  assert.equal(componentCompatibility({component:'mfg-renodx',name:'renodx-mfgunlock.addon64',sha256:'a'.repeat(64)}).assessment,'unsupported');
  assert.equal(componentCompatibility({component:'dlss-fg',files:[{rel:'nvngx_dlssg.dll',sha256:'a'.repeat(64)}]}).assessment,'unsupported');
  assert.equal(componentCompatibility({component:'dlss-fg',trustedAdapter:true}).ready,true);
  assert.equal(componentCompatibility({component:'overlay'}).assessment,'internal');
});

test('adapter trust follows matching bytes, never a matching tag, and requires the complete package', () => {
  const sha='a'.repeat(64);
  const packages=[{id:'trusted',component:'mfg-renodx',trustedAdapter:true,version:'1.5.5',files:[{rel:'renodx-mfgunlock.addon64',sha256:sha}]}];
  const updater=new ComponentUpdates({root:os.tmpdir(),catalog:()=>({packages})});
  const candidate={component:'mfg-renodx',tag:'1.5.5',name:'renodx-mfgunlock.addon64',sha256:sha};
  let results=updater.withLocalModels({candidates:[candidate,{...candidate,sha256:'b'.repeat(64)}]}).candidates;
  assert.equal(results[0].compatibility.kind,'selectable');
  assert.equal(results[0].cachedPackageId,'trusted');
  assert.equal(results[1].compatibility.kind,'pending');
  assert.equal(results[1].cachedPackageId,undefined);
  packages[0].files.push({rel:'other.dll',sha256:sha});
  results=updater.withLocalModels({candidates:[candidate]}).candidates;
  assert.equal(results[0].cachedPackageId,undefined);
});

test('paired cache links require matching component, names and every fingerprint', () => {
  const runtime=new RuntimePayload(path.join(os.tmpdir(),'nf-readonly-catalog'));
  const pack=catalog.packs.find(p=>p.id==='nr-3108');
  const file=pack.files.find(f=>/nvngx_dlssnr.dll$/.test(f.path));
  const base={component:pack.component,version:pack.version,files:[{rel:'nvngx_dlssnr.dll',sha256:file.sha256}]};
  const packs=runtime.list([{...base,id:'matched'}, {...base,id:'different',files:[{rel:'nvngx_dlssnr.dll',sha256:'f'.repeat(64)}]},
    {...base,id:'wrong-component',component:'dlss-sr'}, {...base,id:'incomplete',files:[...base.files,{rel:'extra.dll',sha256:file.sha256}]}]);
  assert.deepEqual(packs.find(p=>p.id===pack.id).packageIds,['matched']);
  assert.equal(packs.find(p=>p.id==='feeder').compatibility.kind,'route');
});

test('historical architecture hints never become fingerprint identity or adapter trust', () => {
  const result=modelRequirements({component:'dlss-nr',provider:'rhi-nr',tag:'dlssnr-310.8.Lecram'});
  assert.deepEqual(result,{architectures:['120'],source:'catalog'});
  assert.equal(modelRequirements({component:'dlss-nr',provider:'rhi-nr',tag:'dlssnr-310.8.Lecram',dllSha256:'a'.repeat(64)}),undefined);
  assert.equal(modelRequirements({component:'dlss-nr',provider:'smartergamers-nr',tag:'dlssnr-310.8.Lecram'}),undefined);
  assert.deepEqual(modelRequirements({component:'dlss-nr',provider:'rhi-nr',tag:'dlssnr-310.8.0'}).architectures,['120']);
});

test('uninstalled model can link to a paired pack by DLL fingerprint without mistaking RankFTW SF-v2 for it', () => {
  const {MODEL_DATABASE}=require('../src/core/neural-models');
  const updater=new ComponentUpdates({root:os.tmpdir(),catalog:()=>({packages:[]})});
  const candidates=['310.8.SF-v2','310.8.SF-v2-rankftw'].map(id=>({component:'dlss-nr',name:'nvngx_dlssnr.dll',sha256:MODEL_DATABASE.find(m=>m.id===id).sha256}));
  const result=updater.withLocalModels({candidates}).candidates;
  assert.equal(result[0].pairedPackId,'nr-3108');
  assert.equal(result[1].pairedPackId,undefined);
});

test('runtime metadata separates recommended independent MFG from its OptiScaler baseline and links original release bytes',()=>{
  const runtime=new RuntimePayload(path.join(os.tmpdir(),'nf-readonly-engines'));
  const packs=runtime.list(),current=packs.find(p=>p.id==='mfg-universal'),baseline=packs.find(p=>p.id==='mfg-optiscaler-170'),encore=packs.find(p=>p.id==='encore');
  assert.equal(current.engine.recommended,true);assert.equal(current.engine.version,'1.7.1');
  assert.equal(baseline.engine.compatible,true);assert.equal(baseline.engine.recommended,false);assert.equal(baseline.engine.version,'1.7.0');
  assert.equal(encore.engine.recommended,true);assert.equal(encore.engine.version,'2.4.1');
  for(const pack of [current,baseline,encore]){assert.equal(pack.compatibility.kind,'route');assert.equal(pack.compatibility.ready,false);}
  const updater=new ComponentUpdates({root:os.tmpdir(),catalog:()=>({packages:[]})});
  const candidates=[current,baseline,encore].map((pack,i)=>({id:String(i),component:pack.component,name:path.basename(new URL(pack.url).pathname),sha256:pack.sha256}));
  const rows=updater.withLocalModels({candidates}).candidates;
  assert.deepEqual(rows.map(row=>row.pairedPackId),['mfg-universal','mfg-optiscaler-170','encore']);
  assert.deepEqual(rows.map(row=>row.engine.recommended),[true,false,true]);
});

test('upstream display metadata preserves transport validation, pinned files and the existing runtime cache identity',()=>{
  const root=path.join(os.tmpdir(),'nf-provenance-readonly');
  const runtime=new RuntimePayload(root);
  const withoutProvenance={...catalog,packs:catalog.packs.map(({upstreams,...pack})=>pack)};
  assert.equal(runtime.payloadDir,new RuntimePayload(root,{manifest:withoutProvenance}).payloadDir);
  for(const row of runtime.list()) {
    const pack=catalog.packs.find(p=>p.id===row.id);
    assert.deepEqual(row.upstreams,pack.upstreams);
    assert.equal(row.url,pack.url);assert.equal(row.sha256,pack.sha256);assert.deepEqual(row.files,pack.files);
  }
  const model=runtime.list().find(p=>p.id==='nr-3108');
  assert.equal(model.repository,'lxl2000927/NeuralFrame');
  assert.equal(model.upstreams[0].name,'SmarterGamers/SmarterGamers-DLSS5-Swapper');
});
