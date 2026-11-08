'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {fileURLToPath}=require('node:url');

test('replacing a custom cover preserves the previous image and index if saving fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-cover-ipc-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const main = path.resolve(__dirname, '../main.js'), real = createRequire(main), handlers = new Map();
  const source = path.join(root, 'selected.png'), dir = path.join(root, 'Game');
  const electron = {
    app:{setAppUserModelId(){}, whenReady:()=>({then(){}}), on(){}, getPath:()=>root},
    dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[source]})},
    ipcMain:{handle:(name, fn)=>handlers.set(name, fn)}
  };
  vm.runInNewContext(fs.readFileSync(main,'utf8'), {
    require:name=>name==='electron'?electron:real(name), __dirname:path.dirname(main),
    process, Buffer, console, setTimeout, clearTimeout
  }, {filename:main});
  fs.writeFileSync(source, 'first cover');
  const setCover = () => handlers.get('set-poster')({}, dir);
  const first = fileURLToPath(await setCover());
  const index = path.join(root,'library.json');
  const before = fs.readFileSync(index,'utf8');
  fs.writeFileSync(source, 'replacement cover');
  fs.mkdirSync(index + '.tmp'); // Simulate a write failure before the new index is committed.
  await assert.rejects(setCover);
  assert.equal(fs.readFileSync(index,'utf8'), before);
  assert.equal(fs.readFileSync(first,'utf8'), 'first cover');
  assert.deepEqual(fs.readdirSync(path.dirname(first)), [path.basename(first)]);
  fs.rmdirSync(index + '.tmp');
  const second = fileURLToPath(await setCover());
  assert.equal(fs.readFileSync(second,'utf8'), 'replacement cover');
  assert.equal(fs.existsSync(first),false);
  assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(index,'utf8')).posters), [second]);
});

test('real art IPC migrates blank cache, uses fallback, recovers deleted files and preserves concurrent preferences', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enhanced-art-ipc-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map();
  let searches=0;
  const downloads=[];
  const stubs={
    electron:{app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root},ipcMain:{handle:(n,f)=>handlers.set(n,f)}},
    './src/steamart':{
      tileUrls:()=>['missing-banner','real-header'],
      look:async()=>{searches++;await new Promise(r=>setTimeout(r,10));return{coverUrl:'missing-portrait',heroUrl:'missing-hero',heroFallbackUrl:'real-header'};},
      download:async(url,dest)=>{downloads.push(url);if(url!=='real-header')throw Error('404');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'fixture');return dest;}
    }
  };
  const context=vm.createContext({require:n=>stubs[n]||realRequire(n),__dirname:path.dirname(main),process,Buffer,console,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
  const game=path.join(root,'Game'),key=vm.runInContext('keyFor',context)(game);
  fs.writeFileSync(path.join(root,'library.json'),JSON.stringify({folders:[],manual:[],posters:{},art:{[key]:{rules:4,cover:null,hero:null}}}));
  const pending=handlers.get('art-fetch')({},game,'鸣潮',null);
  await handlers.get('set-lang')({},'zh');
  const result=await pending;
  assert.ok(result.hero.startsWith('file:'));
  assert.deepEqual(downloads,['missing-portrait','missing-hero','real-header']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'library.json'),'utf8')).lang,'zh');
  await handlers.get('art-fetch')({},game,'鸣潮',null);
  assert.equal(searches,1,'valid wide artwork is cached');
  fs.unlinkSync(fileURLToPath(result.hero));
  const recovered=await handlers.get('art-fetch')({},game,'鸣潮',null);
  assert.equal(searches,2,'missing file is retried immediately');
  assert.ok(fs.existsSync(fileURLToPath(recovered.hero)));
  const custom=path.join(root,'custom.jpg');fs.writeFileSync(custom,'custom');
  const state=vm.runInContext('loadState()',context);state.posters[key]=custom;
  const poster=vm.runInContext('posterUrl',context)({dir:game},state);
  assert.equal(fileURLToPath(poster.url),custom);assert.equal(poster.custom,true);
  assert.ok(new URL(poster.url).searchParams.has('v'));
  const later = new Date(Date.now() + 2000);
  fs.writeFileSync(custom, 'replacement cover');fs.utimesSync(custom,later,later);
  const replaced=vm.runInContext('posterUrl',context)({dir:game},state);
  assert.notEqual(replaced.url,poster.url,'replacing the same cover path must invalidate the renderer image cache');
  assert.equal(fileURLToPath(replaced.url),custom);
  downloads.length = 0;
  const fetchTile = () => handlers.get('art-fetch')({},game,'鸣潮',null,'tile');
  const [firstTile, concurrentTile] = await Promise.all([fetchTile(), fetchTile()]);
  assert.deepEqual(downloads,['missing-banner','real-header']);
  assert.equal(firstTile.tile,concurrentTile.tile);
  assert.equal(fs.readFileSync(fileURLToPath(firstTile.tile),'utf8'),'fixture');
  assert.equal((await fetchTile()).tile,firstTile.tile);
  assert.equal(downloads.length,2,'cached home tile requires no network access');
});
