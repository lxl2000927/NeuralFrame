'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-desktop-audit-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const game=path.join(root,'game');fs.mkdirSync(game);
 const main=path.resolve(__dirname,'../main.js'),realRequire=createRequire(main),handlers=new Map();
 const dialog={};
 const electron={app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root,getVersion:()=> '0.1.1'},
  ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog,BrowserWindow:{fromWebContents:()=>({})}};
 const host=Object.create(process);host.on=()=>host;
 const context=vm.createContext({require:name=>name==='electron'?electron:
  name==='./src/core/scan.js'?{scanGame:async()=>({chosen:{path:path.join(game,'Game.exe')}})}:
  name==='./src/core/install-guards'?{gpuInfo:async()=>[],driverNames:()=>[]}:
  realRequire(name),__dirname:path.dirname(main),process:host,Buffer,console});
 vm.runInContext(fs.readFileSync(main,'utf8'),context,{filename:main});
 return{root,game,dialog,context,handlers};
}
test('the desktop companion-addon entry preserves unrelated disabled plug-ins',t=>{
 const f=fixture(t),file=path.join(f.game,'ReShade.ini');
 fs.writeFileSync(file,'[ADDON]\r\nDisabledAddons=extra,extra-tools,other.addon64\r\n');
 vm.runInContext('enableAddon',f.context)(f.game,'extra.addon64');
 assert.equal(fs.readFileSync(file,'utf8'),'[ADDON]\r\nDisabledAddons=extra-tools,other.addon64\r\n');
});
test('cards and details report only loadable 64-bit host runtimes and invalidate stale scan rules',async t=>{
 const f=fixture(t), {writePe}=require('./fixtures/pe');
 const exe={path:path.join(f.game,'Game.exe'),rel:'Game.exe',bitness:32,api:'d3d9',apiLabel:'DirectX 9'};
 const host=writePe(path.join(f.game,'host64','nvngx_dlss.dll'),{bitness:32,version:[3,1,2,0]});
 f.context.scanFixture={chosen:exe,exeCandidates:[exe],dlssFiles:[],streamlineFiles:[],reshade:{installed:false}};
 vm.runInContext("gameInspection={run:async task=>task==='scan'?scanFixture:{scan:scanFixture}}",f.context);
 const card=()=>f.handlers.get('scan')({},f.game);
 const details=()=>f.handlers.get('details')({},f.game);
 assert.equal((await card()).hasDlss,false);
 assert.equal((await details()).currentDlss,null);
 writePe(host,{bitness:64,version:[3,1,2,0]});
 const valid=await card();
 assert.equal(valid.dlss,'3.1.2.0');
 assert.ok(valid.rules>10);
 assert.equal((await details()).currentDlss.version,'3.1.2.0');
});
test('desktop diagnostics exports only the confirmed files and reports that actual count',async t=>{
 const f=fixture(t),output=path.join(f.root,'report.txt');
 fs.writeFileSync(path.join(f.game,'ReShade.log'),'APPROVED_CONTENT');
 f.dialog.showMessageBox=async(_window,options)=>{
  assert.match(options.detail,/ReShade\.log/);
  assert.doesNotMatch(options.detail,/OptiScaler\.log/);
  fs.writeFileSync(path.join(f.game,'OptiScaler.log'),'NOT_APPROVED_CONTENT');
  return{response:1};
 };
 f.dialog.showSaveDialog=async()=>({canceled:false,filePath:output});
 const result=await f.handlers.get('save-diagnostics')({sender:{}},f.game,'session activity');
 assert.equal(result.ok,true);assert.equal(result.count,1);
 const report=fs.readFileSync(output,'utf8');
 assert.match(report,/APPROVED_CONTENT/);assert.doesNotMatch(report,/NOT_APPROVED_CONTENT/);
});
