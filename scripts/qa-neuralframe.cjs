const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-output'),profile=path.join(out,'profile');fs.mkdirSync(profile,{recursive:true});
const existing=path.join(process.env.APPDATA,'dlss5-swapper-enhanced');
const state=JSON.parse(fs.readFileSync(path.join(existing,'library.json'),'utf8'));
state.closeToTray=false;state.autoScanDrives=false;
fs.writeFileSync(path.join(profile,'library.json'),JSON.stringify(state));
if(fs.existsSync(path.join(existing,'art')))fs.cpSync(path.join(existing,'art'),path.join(profile,'art'),{recursive:true});
const env={...process.env,NEURALFRAME_USER_DATA:profile,DLSS5_LIGHTWEIGHT:'1'};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{const started=Date.now();const packaged=process.env.NEURALFRAME_QA_EXE;const app=await electron.launch({executablePath:packaged||path.join(root,'node_modules/electron/dist/electron.exe'),args:packaged?[]:[root],env,timeout:60000});try{
 let page=await app.firstWindow();console.log('Windows',app.windows().map(p=>p.url()));
 for(const p of app.windows())if(p.url().includes('ui-dist'))page=p;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.waitForLoadState('domcontentloaded');
 await page.screenshot({path:path.join(out,'startup.png')});
 console.log('Startup',page.url(),await page.locator('body').innerText());
 await page.getByRole('button',{name:'补帧倍率'}).count();
 await page.locator('.game-row').first().waitFor({timeout:60000});
 await page.getByLabel('补帧倍率',{exact:true}).waitFor({timeout:60000});
 const initial=Date.now()-started;
 await page.screenshot({path:path.join(out,'games-desktop.png')});
 const games=await page.locator('.game-row').count();assert.ok(games>0);
 const dir=await page.locator('.game-identity .path').textContent();
 const initialMode=await page.getByLabel('补帧倍率',{exact:true}).getAttribute('data-value');
 await page.getByRole('combobox',{name:'补帧倍率',exact:true}).click();await page.getByRole('option',{name:initialMode==='x3'?'4×':'3×',exact:true}).click();
 await page.getByRole('button',{name:'预览并应用',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'预览并应用',exact:true}).isEnabled(),true);
 if(games>1){await page.locator('.game-row').nth(1).click();await page.getByLabel('补帧倍率',{exact:true}).waitFor();await page.locator('.game-row').first().click();await page.getByLabel('补帧倍率',{exact:true}).waitFor();assert.equal(await page.getByLabel('补帧倍率',{exact:true}).getAttribute('data-value'),initialMode==='x3'?'x4':'x3');}
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await page.getByRole('button',{name:'预览并应用',exact:true}).isDisabled(),true);
 for(const keyword of ['鸣潮','星穹铁道']){const button=page.locator('.game-row').filter({hasText:keyword}).first();assert.equal(await button.count(),1,'required game missing: '+keyword);await button.click();await page.getByLabel('补帧倍率',{exact:true}).waitFor({timeout:60000});assert.ok(await page.locator('.game-identity h1').textContent());await page.screenshot({path:path.join(out,keyword+'.png')})}
 await page.getByRole('tab',{name:'运行诊断',exact:true}).click();await page.locator('.runtime-block').first().waitFor({timeout:60000});
 await page.getByRole('tab',{name:'组件与版本',exact:true}).click();await page.getByRole('heading',{name:'已安装组件与文件',exact:true}).waitFor({timeout:60000});
 await page.getByRole('tab',{name:'画质与补帧',exact:true}).click();
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay-panel'));win.setSize(960,700)});
 await page.screenshot({path:path.join(out,'games-960.png')});
 const overflow=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth>innerWidth,rows:[...document.querySelectorAll('.setting-row')].some(r=>r.scrollWidth>r.clientWidth+2)}));
 // Fractional Windows display scaling can round the native client width by 1 CSS pixel.
 assert.ok(Math.abs(overflow.width-960)<=1,'minimum width must be 960 CSS px, within native DPI rounding');assert.equal(overflow.body,false);assert.equal(overflow.rows,false);
 await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay-panel'));win.setSize(1440,900)});
 for(const [name,heading] of [['组件','组件库'],['叠加层','游戏内叠加层'],['历史','操作历史'],['设置','设置']]){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name:heading,exact:true}).last().waitFor();await page.screenshot({path:path.join(out,'page-'+name+'.png')})}
 await page.getByRole('combobox',{name:'主题',exact:true}).click();await page.getByRole('option',{name:'浅色',exact:true}).click();await page.screenshot({path:path.join(out,'settings-light.png')});
 await page.getByRole('combobox',{name:'主题',exact:true}).click();await page.getByRole('option',{name:'深色',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();await page.getByLabel('补帧倍率',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'games-final.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify({games,initialReadyMs:initial,initialDir:dir,checks:['real library','per-game drafts','undo','Wuthering Waves and Star Rail details','runtime read','component inventory','960px overflow','navigation','light/dark'],errors},null,2));console.log('UI checks passed',games,'games;',initial,'ms until first settings ready');
 }finally{await app.close()}})().catch(e=>{console.error(e);process.exitCode=1});
