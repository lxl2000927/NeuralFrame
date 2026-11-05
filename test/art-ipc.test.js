'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {fileURLToPath,pathToFileURL}=require('node:url');

test('real art IPC migrates blank cache, uses fallback, recovers deleted files and preserves concurrent preferences', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'enhanced-art-ipc-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map();
  let searches=0;
  const downloads=[];
  const stubs={
    electron:{app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root},ipcMain:{handle:(n,f)=>handlers.set(n,f)}},
    './src/steamart':{
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
  assert.equal(poster.url,pathToFileURL(custom).href);assert.equal(poster.custom,true);
});
