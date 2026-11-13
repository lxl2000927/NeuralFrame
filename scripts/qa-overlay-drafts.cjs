const {_electron:electron}=require('@playwright/test');
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
 const failures=[];
 for(const scenario of ['pristine refresh','invalid custom switch','invalid new custom switch']){
  const app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});
  try{
   const page=await app.firstWindow();page.setDefaultTimeout(12000);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   await page.evaluate(()=>window.qa.releaseOverlayList());
   const nav=page.getByRole('navigation');
   await nav.getByRole('button',{name:'叠加层',exact:true}).click();
   const panel=page.locator('.overlay-page'),themes=panel.getByRole('group',{name:'主题配色'});
   const blue=themes.getByRole('button',{name:'蔚蓝',exact:true});
   const green=themes.getByRole('button',{name:'翡翠绿',exact:true});
   await green.waitFor();
   const revisit=async()=>{
    await nav.getByRole('button',{name:'设置',exact:true}).click();
    await nav.getByRole('button',{name:'叠加层',exact:true}).click();
   };
   if(scenario==='pristine refresh'){
    for(const select of [async()=>green.click(),async()=>{await blue.click();await green.click();}]){
     await select();
     await page.evaluate(()=>window.qa.setOverlayPreferences({theme:'purple'}));
     await revisit();
     await page.waitForFunction(()=>document.querySelector('.overlay-theme-options button[aria-pressed="true"]')?.textContent==='紫晶');
     assert.equal(await panel.getByRole('button',{name:'应用外观',exact:true}).isEnabled(),false,'A clean selection must not become an artificial draft');
     assert.equal((await page.evaluate(()=>window.qa.audit())).overlaySaves?.length||0,0,'Refreshing external preferences never writes them back');
     await page.evaluate(()=>window.qa.setOverlayPreferences({theme:'green'}));await revisit();
     await page.waitForFunction(()=>document.querySelector('.overlay-theme-options button[aria-pressed="true"]')?.textContent==='翡翠绿');
    }
    await blue.click();
    await page.evaluate(()=>window.qa.setOverlayPreferences({theme:'purple'}));await revisit();
    assert.equal(await blue.getAttribute('aria-pressed'),'true','A real unsaved draft survives an external change');
    await page.evaluate(()=>window.qa.setOverlayPreferences({theme:'blue'}));await revisit();
    await page.waitForFunction(()=>document.querySelector('.overlay-theme-options button[aria-pressed="true"]')?.textContent==='蔚蓝');
    await page.evaluate(()=>window.qa.setOverlayPreferences({theme:'purple'}));await revisit();
    await page.waitForFunction(()=>document.querySelector('.overlay-theme-options button[aria-pressed="true"]')?.textContent==='紫晶');
    assert.equal(await panel.getByRole('button',{name:'应用外观',exact:true}).isEnabled(),false,'A draft matching externally saved settings must release its snapshot');
   }else{
    const saved=scenario==='invalid custom switch'?{name:'Saved custom',accent:'#ab7733'}:null;
    await page.evaluate(custom=>window.qa.setOverlayPreferences({theme:custom?'custom':'green',custom}),saved);await revisit();
    if(!saved)await themes.getByRole('button',{name:'自定义',exact:true}).click();
    const name=panel.getByRole('textbox',{name:'主题名称',exact:true});await name.fill(' ');
    await blue.click();
    await panel.getByRole('button',{name:'应用外观',exact:true}).click();
    await panel.getByText('当前外观已保存',{exact:true}).waitFor();
    const result=await page.evaluate(()=>window.qa.readOverlayPreferences());
    assert.equal(result.theme,'blue');assert.deepEqual(result.custom,saved,'Leaving an invalid draft preserves the saved custom theme');
   }
   console.log('PASS:',scenario);
  }catch(error){failures.push(scenario);console.error('FAIL:',scenario,error.message);}
  finally{await app.close();}
 }
 assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
