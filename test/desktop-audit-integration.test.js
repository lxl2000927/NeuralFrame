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
