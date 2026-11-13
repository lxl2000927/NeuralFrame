'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{writePe}=require('./fixtures/pe');
const {RuntimePayload}=require('../src/core/runtime-payload');
test('Encore debug IPC prepares exact dependencies, previews, applies changes and restores without touching native SR',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-encore-ipc-')),game=path.join(root,'Game'),profile=path.join(root,'Profile');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const exe=writePe(path.join(game,'Game.exe'),{bitness:64,text:'D3D12CreateDevice',size:131072});
  const native=writePe(path.join(game,'Engine','nvngx_dlss.dll'),{version:[3,7,0,0]}),bytes=fs.readFileSync(native);
  // Only process/GPU probes are stubbed. IPC, component preparation, JSONC,
  // previews, transactions, real pinned DLLs and restore are production code.
  const child=require('node:child_process'),exec=child.execFile;
  t.mock.method(child,'execFile',(file,args,options,cb)=>file==='nvidia-smi.exe'
    ? cb(null,'NVIDIA GeForce RTX 4070 Laptop GPU, 621.14, 8192, 1000, 7192, 100, 140') : exec(file,args,options,cb));
  const guards=require('../src/core/install-guards');t.mock.method(guards,'assertGameClosed',async()=>{});
  const main=path.resolve(__dirname,'../main.js'),requireReal=createRequire(main),handlers=new Map();
  const cache=new RuntimePayload(profile,{bundledRoot:path.resolve(__dirname,'../dist/runtime-bootstrap'),legacyRoots:[require('./fixtures/payload').root],fetcher:()=>{throw Error('offline');}});
  const electron={app:{isPackaged:false,setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>profile},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showMessageBox:async()=>({response:0})}};
  const env={...process.env};delete env.DLSS5_LIGHTWEIGHT;
  const proc=Object.create(process,{env:{value:env}});
  const context=vm.createContext({require:n=>n==='electron'?electron:requireReal(n),__dirname:path.dirname(main),process:proc,AbortController,Buffer,console,testCache:cache});
  vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});vm.runInContext('runtimeCache=testCache',context);
  const event={sender:{send(){},isDestroyed:()=>false}},patch={route:'encore',exePath:exe,apiOverride:'d3d12',mfgMode:'x3',neuralMode:'off'};
  const operation=token=>handlers.get('enhanced-apply')(event,game,patch,token);
  const missing=await operation();assert.equal(missing.code,'errRuntimeComponents',JSON.stringify(missing));
  assert.deepEqual(Array.from(missing.dependencies).sort(),['runtime:encore','runtime:fg-modern','runtime:sl-modern']);
  assert.equal(fs.existsSync(path.join(game,'version.dll')),false);
  assert.equal((await handlers.get('component-prepare')(event,missing.dependencies)).ok,true);
  let preview=await operation();assert.ok(preview.preview,JSON.stringify(preview));assert.equal(fs.existsSync(path.join(game,'version.dll')),false);
  // A stale selected executable must never fall back to a different game exe.
  const stale=await handlers.get('enhanced-apply')(event,game,{...patch,exePath:path.join(game,'missing.exe')});
  assert.equal(stale.code,'errSelectedExeMissing');
  const done=await operation(preview.preview.token);assert.equal(done.ok,true,JSON.stringify(done));
  assert.equal(done.status.encore.installed,true);assert.equal(done.status.encore.settings.mfgMode,'x3');
  assert.deepEqual(fs.readFileSync(native),bytes);
  patch.mfgMode='x4';preview=await operation();assert.ok(preview.preview,JSON.stringify(preview));
  assert.equal((await operation(preview.preview.token)).ok,true);
  const modelPatch={...patch,neuralMode:'latest_compatible',neuralModelId:'310.8.SF-v2'};
  const missingModel=await handlers.get('enhanced-apply')(event,game,modelPatch);
  assert.equal(missingModel.code,'errRuntimeComponents',JSON.stringify(missingModel));
  assert.deepEqual(Array.from(missingModel.dependencies),['runtime:nr-3108']);
  assert.equal((await handlers.get('component-prepare')(event,missingModel.dependencies)).ok,true);
  const nrPreview=await handlers.get('enhanced-apply')(event,game,modelPatch);assert.ok(nrPreview.preview,JSON.stringify(nrPreview));
  assert.equal((await handlers.get('enhanced-apply')(event,game,modelPatch,nrPreview.preview.token)).ok,true);
  const other=writePe(path.join(game,'Alternate','Other.exe'),{text:'D3D11CreateDevice',size:131072});
  const switchPatch={route:'encore',exePath:other,apiOverride:'d3d11',neuralMode:'off',mfgMode:'x2'};
  const switchPreview=await handlers.get('enhanced-apply')(event,game,switchPatch);
  assert.ok(switchPreview.preview,JSON.stringify(switchPreview));
  assert.equal(fs.existsSync(path.join(path.dirname(other),'version.dll')),false,'switch preview has no side effects');
  const switched=await handlers.get('enhanced-apply')(event,game,switchPatch,switchPreview.preview.token);
  assert.equal(switched.ok,true,JSON.stringify(switched));assert.equal(switched.status.exePath,other);
  assert.equal(switched.status.encore.settings.mfgMode,'x2');assert.equal(switched.status.encore.settings.neuralMode,'off');
  assert.equal(fs.existsSync(path.join(game,'version.dll')),false,'the old executable no longer owns a live Encore loader');
  const saved=require('../src/core/backend-manager').loadProfile({gameDir:game,exePath:exe,api:'dxgi',route:'encore'});
  const priorSettings=require('../src/core/encore-config').read(saved['rtx-encore.jsonc']);
  assert.equal(priorSettings.mfgMode,'x4');assert.equal(priorSettings.neuralMode,'latest_compatible');
  const restore=await handlers.get('restore')(event,game);assert.ok(restore.preview,JSON.stringify(restore));
  assert.equal((await handlers.get('restore')(event,game,restore.preview.token)).ok,true);
  assert.equal(fs.existsSync(path.join(game,'version.dll')),false);assert.deepEqual(fs.readFileSync(native),bytes);
  assert.equal(fs.existsSync(path.join(path.dirname(other),'version.dll')),false);
});
