const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
// Browser plugin not available in the local CLI; exercise the actual Electron UI.
const root=path.resolve(__dirname,'..');
const out=process.env.NEURALFRAME_QA_OUT || fs.mkdtempSync(path.join(os.tmpdir(),'neuralframe-ui-'));
const profile=path.join(out,'profile');fs.mkdirSync(profile,{recursive:true});
const existing=path.join(process.env.APPDATA,require('../package.json').distribution.userDataDirectory);
const state=JSON.parse(fs.readFileSync(path.join(existing,'library.json'),'utf8'));
state.closeToTray=false;state.autoScanDrives=false;
fs.writeFileSync(path.join(profile,'library.json'),JSON.stringify(state));
if(fs.existsSync(path.join(existing,'art')))fs.cpSync(path.join(existing,'art'),path.join(profile,'art'),{recursive:true});
// Copy release metadata only, so the UI can show known versions without fetching
// updates or touching the user's component files and installation records.
const updateIndex=path.join(existing,'component-library-v1','updates.json');
if(fs.existsSync(updateIndex)){
  fs.mkdirSync(path.join(profile,'component-library-v1'),{recursive:true});
  fs.copyFileSync(updateIndex,path.join(profile,'component-library-v1','updates.json'));
}
const env={...process.env,NEURALFRAME_USER_DATA:profile,DLSS5_LIGHTWEIGHT:'1'};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
  const packaged=process.env.NEURALFRAME_QA_EXE;
  const app=await electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[root],env,timeout:60000});
  try{
    let page;
    const deadline=Date.now()+60000;
    while(!(page=app.windows().find(p=>/ui-dist\/index\.html/.test(p.url())))){
      if(Date.now()>deadline)throw Error('The main NeuralFrame window did not load');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    page.setDefaultTimeout(60000);await page.waitForLoadState('domcontentloaded');
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const nav=page.getByRole('navigation');
    const started=performance.now();await nav.getByRole('button',{name:'游戏',exact:true}).click();
    const multiplier=page.getByRole('radiogroup',{name:'补帧倍率',exact:true});
    await multiplier.waitFor();const initialReadyMs=Math.round(performance.now()-started);
    const initial=await multiplier.getByRole('radio',{checked:true}).innerText();
    const choice=multiplier.getByRole('radio',{name:/^(?:x3|3×)/});await choice.click();
    await nav.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('region',{name:'硬件信息',exact:true}).locator('.hardware-information').waitFor();
    assert.equal(await page.getByRole('combobox',{name:'默认硬件档位',exact:true}).count(),0);
    assert.equal(await nav.getByRole('button',{name:'档位',exact:true}).count(),0);
    await nav.getByRole('button',{name:'游戏',exact:true}).click();
    assert.equal(await choice.getAttribute('aria-checked'),'true','Navigation preserves the draft');
    const undo=page.locator('.game-detail .apply-bar').getByRole('button',{name:'撤销',exact:true});
    if(await undo.isEnabled())await undo.click();
    assert.equal(await multiplier.getByRole('radio',{checked:true}).innerText(),initial);
    await page.screenshot({path:path.join(out,'games-desktop.png')});
    const testedGames=[];
    for(const pattern of [/Wuthering Waves|鸣潮/,/Star Rail|星穹铁道/]){
      const game=page.locator('.game-list').getByRole('button',{name:pattern}).first();
      if(!await game.count())continue;
      await game.click();await multiplier.waitFor();testedGames.push(await game.innerText());
      await page.getByRole('tab',{name:'运行诊断',exact:true}).click();
      await page.locator('.runtime-block').first().waitFor();
      await page.getByRole('tab',{name:'组件与版本',exact:true}).click();
      await page.getByRole('heading',{name:'已安装组件与文件',exact:true}).waitFor();
      await page.getByRole('tab',{name:'画质与补帧',exact:true}).click();
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui-dist/index')).setContentSize(960,700));
    await page.screenshot({path:path.join(out,'games-960.png')});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui-dist/index')).setContentSize(1280,900));
    for(const name of ['组件','叠加层','历史','设置']){
      await nav.getByRole('button',{name,exact:true}).click();
      await page.locator('.appbar h1').waitFor();
      if(name==='组件'){
        await page.locator('.library-page [data-component]').first().waitFor();
        const row=page.locator('.library-page [data-component="mfg-renodx"] [data-version-id]').first();
        await row.locator('.component-status').click();
        const drawer=page.locator('.component-drawer');
        await drawer.getByRole('heading',{name:'支持范围与测试记录',exact:true}).waitFor();
        assert.ok((await drawer.locator('.component-project-records').innerText()).includes('RTX 4070 SUPER'));
        assert.ok(!(await drawer.locator('.component-source-detail').allTextContents()).some(text=>text.includes('lxl2000927/NeuralFrame')));
        await drawer.getByRole('heading',{name:'配套依赖与适用路线',exact:true}).waitFor();
        await drawer.getByRole('heading',{name:'发布与入库记录',exact:true}).waitFor();
        await page.screenshot({path:path.join(out,'component-evidence-real-data.png'),animations:'disabled'});
        await drawer.getByRole('button',{name:'关闭详情',exact:true}).click();
        await drawer.waitFor({state:'detached'});
      }
      if(name==='叠加层')await page.frameLocator('.overlay-page iframe').getByRole('tab',{name:'DLSS 5',exact:true}).waitFor();
      if(name==='设置')await page.getByRole('region',{name:'硬件信息',exact:true}).locator('.hardware-information').waitFor();
      await page.screenshot({path:path.join(out,'page-'+name+'.png')});
    }
    for(const theme of ['浅色','深色']){
      await page.getByRole('combobox',{name:'主题',exact:true}).click();
      await page.getByRole('option',{name:theme,exact:true}).click();
      await page.screenshot({path:path.join(out,'settings-'+theme+'.png'),animations:'disabled'});
      for(const name of ['组件','叠加层']){
        await nav.getByRole('button',{name,exact:true}).click();
        if(name==='叠加层')await page.frameLocator('.overlay-page iframe').getByRole('tab',{name:'DLSS 5',exact:true}).waitFor();
        await page.screenshot({path:path.join(out,name+'-'+theme+'.png'),animations:'disabled'});
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui-dist/index')).setContentSize(960,700));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await page.screenshot({path:path.join(out,name+'-'+theme+'-960.png'),animations:'disabled'});
        await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('ui-dist/index')).setContentSize(1280,900));
      }
      await nav.getByRole('button',{name:'设置',exact:true}).click();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify({initialReadyMs,testedGames,errors,checks:['real game reads','draft preservation','undo','runtime and inventory','navigation','960px layout','light/dark']},null,2));
    console.log('Real-library UI checks passed:',out);
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
