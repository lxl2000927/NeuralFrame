'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
test('malformed path entries do not hide valid games or discard unrelated saved preferences',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-library-invalid-paths-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const game=path.join(root,'Game'),hidden=path.join(root,'Hidden');fs.mkdirSync(game);fs.mkdirSync(hidden);
 const state={folders:[game,null,42,''],manual:[game,hidden,null,{},' '],hidden:[null,hidden,false],
  excludedRoots:[null,'',hidden],excludedFolders:[hidden,3],lang:'en',theme:'dark',
  apiOverrides:{retained:'dx12'},optiscalerVersion:{retained:'custom-selection'}};
 const file=path.join(root,'library.json');fs.writeFileSync(file,JSON.stringify(state));
 const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map();
 const electron={app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
 const host=Object.create(process);host.on=()=>host;
 const context=vm.createContext({require:n=>n==='electron'?electron:realRequire(n),__dirname:path.dirname(main),process:host,Buffer,console});
 vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
 context.inspection={run:async(_type,_dir,options)=>{assert.deepEqual(Array.from(options.folders),[game]);assert.deepEqual(Array.from(options.excludedRoots),[hidden]);return{games:[],roots:[game]};}};
 vm.runInContext('gameInspection=inspection',context);
 const games=await handlers.get('library')();
 assert.deepEqual(Array.from(games,g=>g.dir),[game]);
 const loaded=JSON.parse(JSON.stringify(vm.runInContext('loadState()',context)));
 assert.deepEqual(loaded.excludedFolders,[hidden]);
 assert.deepEqual(loaded.manual,[game,hidden]);
 assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(state),'Browsing must not rewrite the source file');
 handlers.get('set-theme')({},'light');
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(saved.lang,'en');assert.deepEqual(saved.apiOverrides,state.apiOverrides);assert.deepEqual(saved.optiscalerVersion,state.optiscalerVersion);
 assert.deepEqual(saved.hidden,[hidden]);assert.equal(saved.theme,'light');
});
