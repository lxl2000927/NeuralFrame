'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const {createRequire}=require('module'),{writePe}=require('./fixtures/pe');
const {RuntimePayload}=require('../src/core/runtime-payload');
test('lightweight IPC prepares cache before real native preview, then installs and restores offline',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-ipc-')),game=path.join(root,'Game'),profile=path.join(root,'Profile');fs.mkdirSync(game);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const exe=path.join(game,'Game.exe');writePe(exe,{bitness:64,text:'D3D12CreateDevice',size:131072});
 const original=path.join(game,'nvngx_dlss.dll');writePe(original,{bitness:64,version:[2,3,0,0]});const before=fs.readFileSync(original);
 const main=path.resolve(__dirname,'../main.js'),requireReal=createRequire(main),handlers=new Map();
 const cache=new RuntimePayload(profile,{bundledRoot:path.resolve(__dirname,'../dist/runtime-bootstrap'),legacyRoots:[require('./fixtures/payload').root],fetcher:()=>{throw Error('offline');}});
 const stubs={electron:{app:{isPackaged:true,setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>profile},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{showMessageBox:async()=>({response:0})}},'./src/core/install-guards':{assertGameClosed:async()=>{},gpuInfo:async()=>[],driverNeuralFault:()=>false}};
 const packagedProcess=Object.create(process,{resourcesPath:{value:path.join(root,'resources')}});
 const context=vm.createContext({require:n=>stubs[n]||requireReal(n),__dirname:path.dirname(main),process:packagedProcess,AbortController,Buffer,console,testCache:cache});vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});vm.runInContext('runtimeCache=testCache',context);
 const event={sender:{send(){},isDestroyed:()=>false}},operation=token=>handlers.get('install')(event,game,exe,'native','d3d12',token);
 // A partially populated cache is normal: an SR-only download has no addon.
 await cache.prepare(['sr-baseline']);
 assert.doesNotThrow(()=>vm.runInContext('addonLibrary(); replacementAddon(); companionAddons();',context));
 const consumerName=require('../src/core/renodx-release').CONSUMER.file;
 const fixtures=['first.addon64','second.addon64',consumerName].map((name,i)=>writePe(path.join(root,'custom',name),{text:'QA optional plugin '+i}));
 const disabled=writePe(path.join(root,'custom','disabled.addon64'));
 assert.equal(handlers.get('addon-save')(event,{path:disabled}),true);
 for(const file of fixtures){
   assert.equal(handlers.get('addon-save')(event,{path:file,name:path.basename(file)}),true);
   assert.equal(handlers.get('addon-toggle')(event,file,true).ok,true);
 }
 const configured=handlers.get('addons')(event).filter(row=>row.custom);
 assert.equal(configured.filter(row=>row.active).length,3);
 assert.equal(configured.find(row=>row.file===consumerName).replaces,true,'a custom consumer replaces the built-in consumer even before downloading it');
 const missing=await operation();assert.equal(missing.code,'errRuntimeComponents',JSON.stringify(missing));assert.ok(missing.dependencies.includes('runtime:nr-3108'));assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);assert.deepEqual(fs.readFileSync(original),before);
 const ready=await handlers.get('component-prepare')(event,missing.dependencies);assert.equal(ready.ok,true,JSON.stringify(ready));assert.deepEqual(fs.readFileSync(original),before);
 const preview=await operation();assert.ok(preview.preview,JSON.stringify(preview));assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);
 const planned=preview.preview.rows.map(row=>row.rel);
 for(const file of fixtures)assert.ok(planned.includes(path.basename(file)));
 assert.ok(!planned.includes(path.basename(disabled)));
 // A game update may replace the same executable after the user approves the route.
 const gameBytes=fs.readFileSync(exe);
 writePe(exe,{bitness:32,text:'D3D12CreateDevice',size:131072});
 const unavailable=await operation(preview.preview.token);
 assert.equal(unavailable.code,'errSelectedRouteUnavailable');
 assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);
 assert.deepEqual(fs.readFileSync(original),before);
 fs.writeFileSync(exe,gameBytes);
 const renewed=await operation();assert.ok(renewed.preview);
 const done=await operation(renewed.preview.token);assert.equal(done.ok,true,JSON.stringify(done));assert.ok(fs.existsSync(path.join(game,'nvngx_dlssnr.dll')));
 for(const file of fixtures)assert.deepEqual(fs.readFileSync(path.join(game,path.basename(file))),fs.readFileSync(file));
 assert.equal(fs.existsSync(path.join(game,path.basename(disabled))),false);
 const restore=await handlers.get('restore')(event,game);assert.ok(restore.preview,JSON.stringify(restore));assert.equal((await handlers.get('restore')(event,game,restore.preview.token)).ok,true);assert.deepEqual(fs.readFileSync(original),before);
 for(const file of fixtures){assert.equal(fs.existsSync(path.join(game,path.basename(file))),false);assert.equal(fs.existsSync(file),true);}
});
