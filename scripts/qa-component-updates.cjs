const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const output=process.env.NEURALFRAME_QA_OUT;if(output)fs.mkdirSync(output,{recursive:true});
const compatibility={kind:'pending',ready:false,assessment:'unsupported'};
const release=(id,extra={})=>({id,component:'mfg-renodx',repo:'mavismmg/MFGAdaUnlock-RenoDx',tag:id,name:'plugin.addon64',size:2048,
 downloadable:true,sha256:'a'.repeat(64),compatibility,...extra});
const snapshot={root:'QA',warnings:[],definitions:{'mfg-renodx':{name:'MFG 解锁插件 · RenoDX'}},runtimePacks:[],
 packages:[{id:'cached',component:'mfg-renodx',version:'cached',source:'mavismmg/MFGAdaUnlock-RenoDx',present:true,compatibility}],
 updates:{checkedAt:new Date().toISOString(),errors:[],candidates:[
  release('invalid',{downloadable:false,size:0,cachedPackageId:'cached'}),
  release('mfg-test',{stale:true,cachedPackageId:'cached',publishedAt:'2026-11-10T12:00:00Z'}),
  release('missing-checksum',{sha256:null,downloadable:false,compatibility:{...compatibility,assessment:'verify'}}),
 ]}};
(async()=>{
 const app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});
 try{
  const p=await app.firstWindow();p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await p.evaluate(value=>window.qa.setComponentStatusFixture(value),snapshot);
  await p.getByRole('navigation').getByRole('button',{name:'组件',exact:true}).click();
  const catalog=p.locator('.component-catalog');
  await catalog.getByRole('textbox',{name:'搜索组件'}).fill('mavismmg');
  const cached=catalog.locator('[data-version-id="release:invalid"]');
  await expect(cached.getByRole('button',{name:'校验缓存',exact:true})).toBeEnabled();
  await p.evaluate(()=>window.qa.holdNextUpdateCheck());
  await catalog.getByRole('button',{name:'检查更新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'检查中…',exact:true})).toBeDisabled();
  await expect(catalog.getByRole('button',{name:'导入',exact:true})).toBeDisabled();
  await expect(cached.getByRole('button',{name:'校验缓存',exact:true})).toBeDisabled();
  await cached.locator('.component-status').click();const drawer=p.locator('.component-drawer');
  await expect(drawer.locator('.component-download-note')).toContainText('正在检查组件版本');
  await expect(drawer.getByRole('button',{name:'校验缓存',exact:true})).toBeDisabled();
  await p.evaluate(()=>window.qa.releaseUpdateCheck());
  await expect(drawer.getByRole('button',{name:'校验缓存',exact:true})).toBeEnabled();
  await expect(drawer.locator('.component-download-note')).toContainText('仍可校验本地缓存');
  await expect(drawer.getByText(/发布时间：/)).toContainText('2026');
  await expect(drawer.getByRole('heading',{name:'配套依赖与适用路线',exact:true})).toBeVisible();
  await expect(drawer.getByRole('heading',{name:'发布与入库记录',exact:true})).toBeVisible();
  await expect(drawer.locator('.component-detail-section summary')).toHaveCount(0);
  await drawer.getByRole('button',{name:'校验缓存',exact:true}).click();
  await p.waitForFunction(()=>window.qa.audit().libraryDownload==='mfg-test');
  await p.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  const missing=catalog.locator('[data-version-id="release:missing-checksum"]');
  await expect(missing.getByRole('button',{name:'下载并校验',exact:true})).toBeDisabled();
  await missing.locator('.component-status').click();
  await expect(drawer.locator('.component-download-note')).toContainText('未提供 SHA-256');
  if(output)await p.screenshot({path:path.join(output,'component-download-blocked.png'),animations:'disabled'});
  await p.setViewportSize({width:960,height:800});
  await p.evaluate(()=>document.documentElement.dataset.theme='light');
  const overflow=await drawer.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
  assert.ok(overflow.content<=overflow.width+1,JSON.stringify(overflow));
  if(output)await p.screenshot({path:path.join(output,'component-details-compact.png'),animations:'disabled'});
  await expect(drawer.getByText(/需要对应的原生帧生成链路/)).toBeVisible();
  assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0);assert.deepEqual(errors,[]);
  console.log('Update UI passed: check/download exclusion, cached offline verification, blocked-download reasons, release date and always-visible dependency/release sections.');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
