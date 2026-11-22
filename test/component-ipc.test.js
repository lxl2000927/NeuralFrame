'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const {createRequire}=require('module');
const {writePe}=require('./fixtures/pe');

test('component location opens the containing plugin folder, and rejects missing or outside files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-open-component-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const game = path.join(root,'Game'), plugin = path.join(game,'Engine','Plugins','Streamline');
  fs.mkdirSync(plugin,{recursive:true});
  fs.writeFileSync(path.join(plugin,'sl.interposer.dll'),'fixture');
  const main = path.resolve(__dirname,'../main.js'), realRequire = createRequire(main), handlers = new Map(), opened = [];
  const electron = {app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root},
    ipcMain:{handle:(id,fn)=>handlers.set(id,fn)}, shell:{openPath:async dir=>{opened.push(dir);return '';}}};
  const host = Object.create(process); host.on = () => host;
  const context = vm.createContext({game, require:id=>id==='electron'?electron:realRequire(id), __dirname:path.dirname(main), process:host, Buffer, console});
  vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
  vm.runInContext('lastGames = [{dir:game}]',context);
  const open = handlers.get('open-component-folder'), rel = path.relative(game,path.join(plugin,'sl.interposer.dll'));
  assert.equal((await open(null,game,rel,'game')).ok,true);
  for (const [dir,file,scope] of [[game,'missing.dll','game'],[game,'../outside.dll','game'],[root,rel,'game'],[game,rel,'shared']]) {
    assert.equal((await open(null,dir,file,scope)).ok,false);
  }
  assert.deepEqual(opened,[plugin]);
});

for (const phase of ['initialization','catalog read']) {
test(`cancelling a component download during library ${phase} prevents the transfer and permits retry`, async () => {
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main), handlers = new Map();
  const electron = {app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>os.tmpdir()},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)}};
  const host = Object.create(process); host.on = () => host;
  const context = vm.createContext({require:name=>name === 'electron' ? electron : realRequire(name),
    __dirname:path.dirname(main),process:host,Buffer,console});
  vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
  let finishWait, initializations = 0, downloads = 0, cancellations = 0;
  context.library = {initialized:true, init:async()=>{
    if (++initializations === 1 && phase === 'initialization') await new Promise(resolve=>{ finishWait = resolve; });
  }, list:async()=>{ await new Promise(resolve=>{ finishWait = resolve; }); return {ok:true}; }};
  context.updater = {status:()=>({}), download:async()=>{ downloads++; return {ok:true}; },cancel:()=>{ cancellations++; return {ok:true}; }};
  context.runtime = {list:()=>[]};
  vm.runInContext('unifiedComponents=library; componentUpdates=updater; runtimeCache=runtime',context);
  const event = {sender:{send(){},isDestroyed:()=>false}};
  const download = () => handlers.get('library-download')(event,'fixture');
  const read = phase === 'catalog read' ? handlers.get('library-components')() : null;
  const pending = download();
  const competing = await handlers.get('library-download')({sender:{}},'other');
  assert.equal(competing.code,'errJobBusy','a rejected competing request must preserve the first cancellation owner');
  handlers.get('library-cancel')({sender:{}});
  assert.equal(cancellations,0,'another window cannot cancel this request');
  handlers.get('library-cancel')(event);
  finishWait();
  if (read) await read;
  assert.equal((await pending).cancelled,true,'cancellation must survive the pre-download wait');
  assert.equal(downloads,0,'a cancelled request must not start downloading later');
  if (read) assert.equal(initializations,0,'a cancelled queued request need not start initialization');
  assert.equal((await download()).ok,true);
  assert.equal(downloads,1,'the next explicit request can start normally');
});
}

test('queued runtime preparation honours owner cancellation before touching the cache', async () => {
  const main = path.resolve(__dirname,'../main.js'), realRequire = createRequire(main), handlers = new Map();
  const electron = {app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>os.tmpdir()},
    ipcMain:{handle:(id,fn)=>handlers.set(id,fn)}};
  const host = Object.create(process); host.on = () => host;
  const context = vm.createContext({require:id=>id==='electron'?electron:realRequire(id),__dirname:path.dirname(main),process:host,AbortController,Buffer,console});
  vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
  let finishRead, starts = 0;
  context.library = {initialized:true,list:()=>new Promise(resolve=>{finishRead=()=>resolve({ok:true});})};
  context.runtime = {list:()=>[],pack:()=>({name:'fixture'}),prepare:async()=>{starts++;return {ok:true};}};
  vm.runInContext('unifiedComponents=library; runtimeCache=runtime; componentUpdates={status:()=>({})}',context);
  const event = {sender:{send(){},isDestroyed:()=>false}}, other = {sender:{}};
  const prepare = sender=>handlers.get('component-prepare')(sender,['runtime:fixture']);
  const read = handlers.get('library-components')();
  const pending = prepare(event);
  assert.equal((await prepare(other)).code,'errJobBusy');
  handlers.get('component-cancel-prepare')(other);
  handlers.get('component-cancel-prepare')(event);
  finishRead();
  await read;
  assert.equal((await pending).cancelled,true);
  assert.equal(starts,0);
  assert.equal((await prepare(event)).ok,true);
  assert.equal(starts,1);
});

test('component browsers share reads during update checks and wait for committed game writes', async () => {
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const electron = {app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>os.tmpdir()},
    ipcMain:{handle:(name, handler)=>handlers.set(name, handler)}};
  const context = vm.createContext({require: name=>name === 'electron' ? electron : realRequire(name), __dirname:path.dirname(main), process, Buffer, console});
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, {filename:main});
  let finishCheck, finishRead, finishWrite, reads = 0, invalidations = 0;
  context.library = { list: async () => {
    reads++;
    if (reads === 1) await new Promise(resolve => { finishRead = resolve; });
    return {ok:true};
  }};
  context.updater = { status: () => ({}), check: () => new Promise(resolve => { finishCheck = resolve; }) };
  context.runtime = { list: () => [] };
  context.inspector = { invalidate() { invalidations++; } };
  vm.runInContext('unifiedComponents=library; componentUpdates=updater; runtimeCache=runtime; gameInspection=inspector', context);
  const list = () => handlers.get('library-components')();
  const checked = handlers.get('library-check')();
  const first = list(), same = list();
  assert.equal(reads, 1);
  finishRead();
  assert.ok((await first).ok && (await same).ok);
  assert.equal(invalidations, 0);
  finishCheck({ok:true});
  await checked;
  const write = vm.runInContext('exclusiveMutation', context)(() => new Promise(resolve => { finishWrite = resolve; }));
  const waiting = list();
  assert.equal(reads, 1);
  context.library.initialized = true;
  assert.equal((await list()).ok, true, 'a seeded global list stays readable during the write');
  finishWrite({ok:true});
  assert.equal((await waiting).ok, true);
  await write;
  assert.equal(reads, 3);
  assert.equal(invalidations, 1);
});
test('the F7 file picker exports the selected bundled architecture only after checksum verification',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'export-f7-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map();
 let choice;
 const electron={app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root},
   BrowserWindow:{fromWebContents:()=>null},ipcMain:{handle:(n,f)=>handlers.set(n,f)},
   dialog:{showSaveDialog:async()=>choice}};
 const context=vm.createContext({require:name=>name==='electron'?electron:realRequire(name),__dirname:path.dirname(main),process,Buffer,console});
 vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
 const save=bits=>handlers.get('save-monitor-addon')({sender:{}},bits);
 const files=[32,64].map(bits=>{
   const name='dlss5-zh-cn.addon'+bits, bytes=Buffer.from('fixture '+bits);
   fs.writeFileSync(path.join(root,name),bytes);
   return {path:name,size:bytes.length,sha256:require('crypto').createHash('sha256').update(bytes).digest('hex')};
 });
 context.runtime={bundledRoot:root,pack:()=>({files})};
 vm.runInContext('runtimeCache=runtime',context);
 choice={canceled:true};assert.equal((await save(64)).cancelled,true);
 choice={filePath:path.join(root,'export')};
 for(const bits of [32,64]){
   assert.equal((await save(bits)).ok,true);
   assert.equal(fs.readFileSync(choice.filePath,'utf8'),'fixture '+bits);
 }
 fs.writeFileSync(path.join(root,files[0].path),'tampered');
 assert.equal((await save(32)).ok,false);
 assert.equal(fs.readFileSync(choice.filePath,'utf8'),'fixture 64');
});
test('real main IPC previews before install, records only committed work, enforces tokens and persisted lock',async t=>{
 require('./fixtures/payload').use(t);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'component-ipc-')),game=path.join(root,'Game');fs.mkdirSync(game);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const exe=path.join(game,'Game.exe');writePe(exe,{bitness:64,text:'D3D12CreateDevice',size:131072});
 writePe(path.join(game,'nvngx_dlss.dll'),{bitness:64,version:[2,3,0,0]});
 const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map(),jobs=[];
 const stubs={electron:{app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>path.join(root,'Profile')},ipcMain:{handle:(n,f)=>handlers.set(n,f)},dialog:{showMessageBox:async()=>({response:0})}},
 './src/core/install-guards':{assertGameClosed:async()=>{},gpuInfo:async()=>[],driverNeuralFault:()=>false}};
 const context=vm.createContext({require:name=>stubs[name]||realRequire(name),__dirname:path.dirname(main),process:require('./fixtures/offline-process')(),Buffer,console});
 vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
 const event={sender:{send:(_n,e)=>jobs.push(e)}};
 const operation=token=>handlers.get('install')(event,game,exe,'native','d3d12',token);
 const before=fs.readFileSync(path.join(game,'nvngx_dlss.dll'));
 const first=await operation();assert.equal(first.ok,true,JSON.stringify(first));assert.ok(first.preview);
 assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);
 assert.deepEqual(fs.readFileSync(path.join(game,'nvngx_dlss.dll')),before);
 assert.equal(jobs.length,0,'preview emits no installed events');
 assert.equal(handlers.get('history')().rows.length,0);
 const done=await operation(first.preview.token);assert.equal(done.ok,true,JSON.stringify(done));
 assert.equal(handlers.get('history')().rows.length,1);
 assert.equal((await operation(first.preview.token)).code,'errPreviewExpired');
 const inventory=await handlers.get('component-inventory')(event,game);assert.equal(inventory.ok,true);assert.ok(inventory.rows.length);
 assert.equal((await handlers.get('component-lock')(event,game,true)).ok,true);
 assert.ok((await handlers.get('component-inventory')(event,game)).lock);
 const restoration=await handlers.get('restore')(event,game);assert.ok(restoration.preview);
 assert.equal((await handlers.get('restore')(event,game,restoration.preview.token)).ok,true);
 assert.deepEqual(fs.readFileSync(path.join(game,'nvngx_dlss.dll')),before);
 assert.equal((await handlers.get('component-inventory')(event,game)).lock,null);
});
