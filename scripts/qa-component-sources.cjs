const { launchFixture } = require('../test/fixtures/launch-electron.cjs');
const { expect } = require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {RuntimePayload}=require('../src/core/runtime-payload');
const {DEFINITIONS}=require('../src/core/component-definitions');
const root = path.resolve(__dirname, '..');
const output=process.env.NEURALFRAME_QA_OUT;
if(output)fs.mkdirSync(output,{recursive:true});
const snapshot={root:'QA',warnings:[],definitions:DEFINITIONS,packages:[],
 runtimePacks:new RuntimePayload(path.join(root,'qa-output','sources-readonly')).list(),
 updates:{checkedAt:null,errors:[],candidates:[]}};
(async()=>{
 const { app, close } = await launchFixture();
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
   ['mfg-universal','dashdogy/MFG-Unlocker'],['xemfg-intel','Intel XeSS SDK 3.0.2'],['encore','SilyNoMeta/rtx-encore']]){
   assert.ok(options.includes(source),source+' filter');await filter.selectOption(source);
   const row=catalog.locator(`[data-version-id="runtime:${id}"]`);
   await expect(row).toBeVisible();await expect(row.locator('.component-source')).toContainText(source);
   await row.locator('.component-status').click();const drawer=p.locator('.component-drawer');
   await expect(drawer.locator('.component-source-detail').filter({hasText:source})).toBeVisible();
   if(id==='mfg-universal')await expect(drawer.locator('.component-detail-purpose')).toContainText(/AMD、Intel 和 NVIDIA.*DLSS-G.*需要兼容的 NVIDIA/);
   if(id==='xemfg-intel'){
    await expect(drawer.locator('.component-detail-purpose')).toContainText('Intel XeFG 帧生成与 XeLL 低延迟运行库');
    await expect(drawer.getByText(/独立 XeMFG 路线使用 Intel XeSS SDK 3\.0\.2 与 MFG Unlocker 1\.7\.1/)).toBeVisible();
    await drawer.locator('.component-source-detail').getByRole('button',{name:source,exact:true}).click();
    assert.equal(await p.evaluate(()=>window.qa.audit().projectLink.componentSource),'https://github.com/intel/xess/releases/tag/v3.0.2');
   }
   assert.ok(!(await drawer.innerText()).includes('lxl2000927/NeuralFrame'));
   assert.equal(await drawer.getByRole('button',{name:'配套包发布页',exact:true}).count(),0);
   if(output&&id==='renodx-nr')await p.screenshot({path:path.join(output,'upstream-details.png'),animations:'disabled'});
   await p.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  }
  await filter.selectOption('all');await catalog.getByRole('button',{name:'筛选',exact:true}).click();
  assert.ok(!(await catalog.innerText()).includes('lxl2000927/NeuralFrame'));
  await catalog.locator('[data-version-id="runtime:sm86"]').locator('.component-status').click();
  const pipoNote=p.locator('.component-drawer .component-project-evidence');
  await expect(pipoNote.getByText('独立分支 Pipo sm86-10',{exact:true})).toBeVisible();
  await expect(pipoNote.getByText('仅收录发布资料',{exact:true})).toBeVisible();
  await pipoNote.getByRole('button',{name:'Pipo sm86-10 作者发布说明',exact:true}).click();
  assert.equal(await p.evaluate(()=>window.qa.audit().projectLink.componentSource),
    'https://github.com/pipotoufikxyz-lgtm/dlssg_for_sm86-MFG-version/releases/tag/sm86-10');
  await p.keyboard.press('Escape');
  assert.equal(await catalog.locator('[data-version-id*="pipo"]').count(),0);
  if(output)await p.screenshot({path:path.join(output,'upstream-catalog.png')});
  await catalog.getByRole('group',{name:'组件分类'}).getByRole('button',{name:/^帧生成/}).click();
  await catalog.getByRole('textbox',{name:'搜索组件'}).fill('AMD XeFG');
  const versions=await catalog.locator('[data-version-id]').evaluateAll(rows=>rows.map(row=>row.dataset.versionId));
  assert.deepEqual(versions.sort(),['runtime:mfg-universal','runtime:xemfg-intel']);
  assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0);
  await p.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  await p.getByRole('combobox',{name:'语言',exact:true}).click();
  await p.getByRole('option',{name:'English',exact:true}).click();
  await p.getByRole('navigation').getByRole('button',{name:'Components',exact:true}).click();
  await catalog.locator('[data-version-id="runtime:xemfg-intel"]').locator('.component-status').click();
  const drawer=p.locator('.component-drawer');
  await expect(drawer.getByRole('heading',{name:'Intel XeSS Frame Generation and XeLL',exact:true})).toBeVisible();
  await expect(drawer.getByText(/Standalone XeMFG pairs Intel XeSS SDK 3\.0\.2 with MFG Unlocker 1\.7\.1/)).toBeVisible();
  await expect(drawer.locator('.component-project-evidence')).not.toContainText(/[\u4e00-\u9fff]/);
  if(output)await drawer.screenshot({path:path.join(output,'xemfg-intel-library-en.png'),animations:'disabled'});
  await p.keyboard.press('Escape');
  await p.evaluate(items=>{
    window.qa.setGraphicsEvidence('D:\\QA\\Game',{hasXeMfgDlssSrDx12:true});
    window.qa.setPendingDownloads(items);
  },snapshot.runtimePacks
   .filter(pack=>['mfg-universal','xemfg-intel'].includes(pack.id)).map(({name,size})=>({name,size})));
  await p.getByRole('navigation').getByRole('button',{name:'Games',exact:true}).click();
  await p.getByRole('radio',{name:/Standalone XeMFG/}).click();
  await p.getByRole('button',{name:'Preview frame generation settings',exact:true}).click();
  const modal=p.getByRole('dialog');await expect(modal.getByRole('heading',{name:'Prepare components'})).toBeVisible();
  await expect(modal.getByRole('listitem').filter({hasText:'MFG Unlocker 1.7.1'})).toBeVisible();
  await expect(modal.getByRole('listitem').filter({hasText:'Intel XeSS Frame Generation and XeLL'})).toBeVisible();
  await modal.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('Component upstream UI: source filters, version-specific AMD/XeFG search, Intel SDK details and English game preparation passed.');
 }finally{await close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
