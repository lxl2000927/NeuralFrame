const {_electron:electron}=require('@playwright/test'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{const app=await electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});try{
 const p=await app.firstWindow();await p.getByLabel('补帧倍率',{exact:true}).selectOption('x3');
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'取消',exact:true}).click();
 let a=await p.evaluate(()=>window.qa.audit());assert.equal(a.prepared,0);assert.equal(a.applied,0);
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'下载组件',exact:true}).click();await p.getByRole('heading',{name:'应用前变更预览'}).waitFor();await p.getByRole('button',{name:'取消',exact:true}).click();
 a=await p.evaluate(()=>window.qa.audit());assert.equal(a.prepared,1);assert.equal(a.applied,0);
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'确认应用',exact:true}).click();await p.getByRole('status').filter({hasText:'操作完成'}).waitFor();
 a=await p.evaluate(()=>window.qa.audit());assert.equal(a.applied,1);assert.equal(a.prepared,1);assert.equal(a.requests.at(-1).token,'confirmed-plan');assert.equal(a.requests.at(-1).patch.mfgMode,'x3');assert.equal(a.requests.at(-1).patch.neuralMode,undefined);
 console.log('UI workflow passed: cancel preparation, cancel preview, confirmed token, preserve NR, reuse cache.');
 }finally{await app.close()}})().catch(e=>{console.error(e);process.exitCode=1});
