const {_electron:electron}=require('@playwright/test'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{const app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});try{
 const p=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
 // Profile and generic panels label the same multiplier "x3" and "3×".
 // Match the visible multiplier independently of its translated description.
 const multiplier=p.getByRole('radiogroup',{name:'补帧倍率',exact:true}).getByRole('radio',{name:/^(?:x3|3×)/});
 await multiplier.click();
 await p.getByRole('navigation').getByRole('button',{name:'首页',exact:true}).click();await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
 assert.equal(await multiplier.getAttribute('aria-checked'),'true');
 let cached=await p.evaluate(()=>window.qa.audit());assert.equal(cached.detailReads,1);assert.equal(cached.statusReads,1);
 assert.deepEqual(cached.detailPriorities,['selection']);assert.deepEqual(cached.statusPriorities,['selection']);
 const nav=p.getByRole('navigation');
 await nav.getByRole('button',{name:'档位',exact:true}).click();
 const profiles=p.locator('.profile-page');
 await profiles.getByText(/来自游戏部署记录/).waitFor();
 const profileModes=profiles.getByRole('radiogroup',{name:'补帧倍率',exact:true});
 await profileModes.getByRole('radio',{name:/^x2/}).click();
 await profileModes.getByRole('radio',{name:/^x3/}).click();
 assert.deepEqual(await p.evaluate(()=>window.qa.audit().profileQueries),[null,null],
   'editing another setting must preserve the manifest profile and avoid another status request');
 assert.deepEqual(await p.evaluate(()=>window.qa.audit().statusPriorities),['selection',null],
   'the profile page uses an explicit inspection even when the game selection later changes');
 await nav.getByRole('button',{name:'游戏',exact:true}).click();
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'取消',exact:true}).click();
 let a=await p.evaluate(()=>window.qa.audit());assert.equal(a.prepared,0);assert.equal(a.applied,0);
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'下载组件',exact:true}).click();await p.getByRole('heading',{name:'应用前变更预览'}).waitFor();await p.getByRole('button',{name:'取消',exact:true}).click();
 a=await p.evaluate(()=>window.qa.audit());assert.equal(a.prepared,1);assert.equal(a.applied,0);
 await p.getByRole('button',{name:'预览并应用',exact:true}).click();await p.getByRole('button',{name:'确认应用',exact:true}).click();await p.getByRole('status').filter({hasText:'操作完成'}).waitFor();
 a=await p.evaluate(()=>window.qa.audit());assert.equal(a.applied,1);assert.equal(a.prepared,1);assert.equal(a.requests.at(-1).token,'confirmed-plan');assert.equal(a.requests.at(-1).patch.mfgMode,'x3');assert.equal(a.requests.at(-1).patch.neuralMode,undefined);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
 await p.getByRole('tab',{name:'运行诊断',exact:true}).click();await p.waitForFunction(()=>window.qa.audit().runtimeReads>=1);
 await p.getByLabel('自动刷新',{exact:true}).check();await p.waitForFunction(()=>window.qa.audit().runtimeReads>=2);
 await p.getByRole('navigation').getByRole('button',{name:'首页',exact:true}).click();const paused=(await p.evaluate(()=>window.qa.audit())).runtimeReads;
 await new Promise(resolve=>setTimeout(resolve,5600));assert.equal((await p.evaluate(()=>window.qa.audit())).runtimeReads,paused);
 await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();await p.waitForFunction(n=>window.qa.audit().runtimeReads>n,paused);
 await p.getByRole('tab',{name:'画质与补帧',exact:true}).click();
 await p.getByRole('radiogroup',{name:'硬件档位',exact:true}).getByRole('radio',{name:/RTX 40 桌面显卡/}).click();
 await nav.getByRole('button',{name:'档位',exact:true}).click();
 await profiles.getByText(/手动选择/).waitFor();
 assert.equal(await p.evaluate(()=>window.qa.audit().profileQueries.at(-1)),'rtx40_desktop');
 await nav.getByRole('button',{name:'组件',exact:true}).click();
 const library=p.locator('.library-page');
 await library.getByText('另一项操作正在进行，请稍后重试。',{exact:false}).first().waitFor();
 await library.getByRole('button',{name:'重试',exact:true}).click();
 await library.getByRole('heading',{name:/已入库版本/}).waitFor();
 assert.equal(await library.locator('.error').count(),0);
 console.log('UI workflow passed: navigation, drafts, reviewed operations, background diagnostics and component list retry.');
 }finally{await app.close()}})().catch(e=>{console.error(e);process.exitCode=1});
