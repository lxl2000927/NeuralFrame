const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {RuntimePayload}=require('../src/core/runtime-payload');
const {DEFINITIONS}=require('../src/core/component-definitions');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const output=process.env.NEURALFRAME_QA_OUT;
if(output)fs.mkdirSync(output,{recursive:true});
const snapshot={root:'QA',warnings:[],definitions:DEFINITIONS,packages:[],
 runtimePacks:new RuntimePayload(path.join(root,'qa-output','sources-readonly')).list(),
 updates:{checkedAt:null,errors:[],candidates:[]}};
(async()=>{
 const app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});
 try{
  const p=await app.firstWindow();p.setDefaultTimeout(15000);const errors=[];
  p.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await p.evaluate(value=>window.qa.setComponentStatusFixture(value),snapshot);
  await p.getByRole('navigation').getByRole('button',{name:'组件',exact:true}).click();
  const catalog=p.locator('.component-catalog');
  await catalog.getByRole('button',{name:'筛选',exact:true}).click();
  const filter=catalog.getByRole('combobox',{name:'来源筛选'});
  const options=await filter.locator('option').allTextContents();
  assert.ok(!options.includes('lxl2000927/NeuralFrame'));
  for(const [id,source] of [
   ['nr-3108','SmarterGamers/SmarterGamers-DLSS5-Swapper'],['sr-baseline','NVIDIA/DLSS'],
   ['sl-baseline','NVIDIA-RTX/Streamline'],['renodx-nr','clshortfuse/renodx'],
   ['renodx-multipass','RankFTW/rhi-repo'],['feeder','jlrouzies-fr/DLSS5-Feeder'],
   ['reshade','crosire/reshade'],['mfg-renodx','mavismmg/MFGAdaUnlock-RenoDx'],
   ['mfg-universal','dashdogy/MFG-Unlocker'],['encore','SilyNoMeta/rtx-encore']]){
   assert.ok(options.includes(source),source+' filter');await filter.selectOption(source);
   const row=catalog.locator(`[data-version-id="runtime:${id}"]`);
   await expect(row).toBeVisible();await expect(row.locator('.component-source')).toContainText(source);
   await row.locator('.component-status').click();const drawer=p.locator('.component-drawer');
   await expect(drawer.locator('.component-source-detail').filter({hasText:source})).toBeVisible();
   assert.ok(!(await drawer.innerText()).includes('lxl2000927/NeuralFrame'));
   assert.equal(await drawer.getByRole('button',{name:'配套包发布页',exact:true}).count(),0);
   if(output&&id==='renodx-nr')await p.screenshot({path:path.join(output,'upstream-details.png'),animations:'disabled'});
   await p.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  }
  await filter.selectOption('all');await catalog.getByRole('button',{name:'筛选',exact:true}).click();
  assert.ok(!(await catalog.innerText()).includes('lxl2000927/NeuralFrame'));
  if(output)await p.screenshot({path:path.join(output,'upstream-catalog.png')});
  assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0);assert.deepEqual(errors,[]);
  console.log('Component upstream UI: real catalog, source filters and details passed; archive host is not displayed as upstream.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
