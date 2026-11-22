const { launchFixture } = require('../test/fixtures/launch-electron.cjs');
const { expect } = require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const output=process.env.NEURALFRAME_QA_OUT;if(output)fs.mkdirSync(output,{recursive:true});
const compatibility={kind:'pending',ready:false,assessment:'unsupported'};
const release=(id,extra={})=>({id,component:'mfg-renodx',repo:'mavismmg/MFGAdaUnlock-RenoDx',tag:id,name:'plugin.addon64',size:2048,
 downloadable:true,sha256:'a'.repeat(64),compatibility,...extra});
const snapshot={root:'QA',warnings:[],definitions:{'mfg-renodx':{name:'MFG 解锁插件 · RenoDX'}},runtimePacks:[],
 packages:[{id:'cached',component:'mfg-renodx',version:'cached',source:'mavismmg/MFGAdaUnlock-RenoDx',present:true,compatibility}],
 cache:{totalBytes:4096,removableBytes:2048,partialBytes:0,packages:[{id:'cached',component:'mfg-renodx',version:'cached',source:'test',size:2048,removable:true,selected:false,bundled:false,protectedReason:'',at:'2026-01-01T00:00:00Z',lastUsedAt:null}]},
 updates:{checkedAt:new Date().toISOString(),errors:[],candidates:[
  release('invalid',{downloadable:false,size:0,cachedPackageId:'cached'}),
  release('mfg-test',{stale:true,cachedPackageId:'cached',publishedAt:'2026-11-10T12:00:00Z'}),
  release('mfg-second',{sha256:'b'.repeat(64)}),
  release('mfg-third',{sha256:'c'.repeat(64)}),
  release('missing-checksum',{sha256:null,downloadable:false,compatibility:{...compatibility,assessment:'verify'}}),
 ]}};
(async()=>{
 const { app, close } = await launchFixture();
 try{
  const p=await app.firstWindow();p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await p.evaluate(value=>window.qa.setComponentStatusFixture(value),snapshot);
  await p.getByRole('navigation').getByRole('button',{name:'组件',exact:true}).click();
  await p.getByText('下载源设置',{exact:true}).click();
  const mirror=p.getByRole('textbox',{name:'自定义下载镜像前缀'}),save=p.getByRole('button',{name:'保存下载设置'});
  await mirror.fill('http://invalid.example');await save.click();
  await expect(mirror).toHaveAttribute('aria-invalid','true');
  assert.equal(await p.evaluate(()=>localStorage.getItem('neuralframe.githubMirror')),null);
  await mirror.fill('https://mirror.example/');await p.getByRole('radio',{name:/GitHub 优先/}).check();await save.click();
  await expect(save).toBeDisabled();
  if(process.env.NEURALFRAME_QA_OUT)await p.screenshot({path:path.join(process.env.NEURALFRAME_QA_OUT,'download-sources.png')});
  const catalog=p.locator('.component-catalog');
  await catalog.getByRole('textbox',{name:'搜索组件'}).fill('mavismmg');
  const cached=catalog.locator('[data-version-id="release:invalid"]');
  await expect(cached.getByRole('button',{name:'校验缓存',exact:true})).toBeEnabled();
  await p.evaluate(()=>window.qa.holdNextUpdateCheck());
  await catalog.getByRole('button',{name:'检查更新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'取消检查',exact:true})).toBeEnabled();
  await expect(catalog.getByRole('button',{name:'导入',exact:true})).toBeDisabled();
  await expect(cached.getByRole('button',{name:'校验缓存',exact:true})).toBeDisabled();
  await catalog.getByRole('button',{name:'取消检查',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'检查更新',exact:true})).toBeEnabled();
  await p.evaluate(()=>window.qa.holdNextUpdateCheck());
  await catalog.getByRole('button',{name:'检查更新',exact:true}).click();
  await expect(catalog.getByRole('button',{name:'取消检查',exact:true})).toBeEnabled();
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
  assert.equal((await p.evaluate(()=>window.qa.audit())).downloadOptions.priority,'official');
  await p.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  const firstDownload=cached;
  const secondDownload=catalog.locator('[data-version-id="release:mfg-second"]');
  await p.evaluate(()=>{window.qa.holdLibraryDownload('mfg-test');window.qa.holdLibraryDownload('mfg-second');});
  await firstDownload.getByRole('button',{name:'校验缓存',exact:true}).click();
  await secondDownload.getByRole('button',{name:'加入下载队列',exact:true}).click();
  await expect(secondDownload.getByRole('button',{name:'已加入下载队列',exact:true})).toBeDisabled();
  await p.getByRole('button',{name:/下载队列/}).first().click();
  const queue=p.getByRole('region',{name:'下载队列'});await expect(queue).toContainText('等待 1 项');
  await queue.getByRole('button',{name:'移出队列 mfg-second'}).click();await expect(queue.locator('.queue-entry')).toHaveCount(0);await expect(queue.locator('.queue-current')).toBeVisible();
  await queue.getByRole('button',{name:'关闭下载队列',exact:true}).click();
  await p.evaluate(()=>window.qa.releaseLibraryDownload('mfg-test'));
  await expect(firstDownload.locator('.download-active')).toHaveCount(0);
  await expect(secondDownload.locator('.download-active')).toHaveCount(0);
  assert.equal((await p.evaluate(()=>window.qa.audit())).secondDownloaded,undefined,'A removed queued item must never start');
  const thirdDownload=catalog.locator('[data-version-id="release:mfg-third"]');
  await p.evaluate(()=>{window.qa.holdLibraryDownload('mfg-test');window.qa.holdLibraryDownload('mfg-third');});
  await firstDownload.getByRole('button',{name:'校验缓存',exact:true}).click();
  await secondDownload.getByRole('button',{name:'加入下载队列',exact:true}).click();
  await thirdDownload.getByRole('button',{name:'加入下载队列',exact:true}).click();
  const launcher=p.getByRole('button',{name:'下载队列',exact:true});
  await p.evaluate(()=>window.qa.emitLibraryProgress({stage:'download',name:'MFG Unlocker · RenoDX',loaded:1024,total:0}));
  await expect(launcher).toContainText('下载中');await expect(launcher.locator('progress')).not.toHaveAttribute('value',/.+/);
  await p.evaluate(()=>window.qa.emitLibraryProgress({stage:'download',name:'MFG Unlocker · RenoDX',loaded:2048,total:4096,count:2,overallLoaded:8192,overallTotal:32768,connections:2,source:'GitHub'}));
  await expect(launcher).toContainText('25%');await expect(launcher).toContainText('+2');
  await launcher.click();
  await expect(queue.getByRole('progressbar',{name:'当前下载进度'})).toHaveAttribute('value','25');
  await expect(queue).toContainText('MFG Unlocker · RenoDX');
  expect(await queue.getByRole('progressbar',{name:'队列总进度'}).evaluate(el=>el.value)).toBeCloseTo(25/3);
  if(process.env.NEURALFRAME_QA_OUT)await p.screenshot({path:path.join(process.env.NEURALFRAME_QA_OUT,'download-queue.png')});
  await queue.getByRole('button',{name:'移出队列 mfg-second'}).click();
  await queue.getByRole('button',{name:'关闭下载队列',exact:true}).click();
  await secondDownload.getByRole('button',{name:'加入下载队列',exact:true}).click();
  await p.evaluate(()=>window.qa.releaseLibraryDownload('mfg-test'));
  await expect(thirdDownload.locator('.download-active')).toHaveCount(1);
  assert.equal(await p.evaluate(()=>window.qa.audit().libraryDownload),'mfg-third');
  await p.evaluate(()=>window.qa.releaseLibraryDownload('mfg-third'));
  await expect(secondDownload.locator('.download-active')).toHaveCount(1);
  await p.evaluate(()=>window.qa.releaseLibraryDownload('mfg-second'));
  await p.waitForFunction(()=>window.qa.audit().secondDownloaded);
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
  await drawer.getByRole('button',{name:'关闭详情'}).click();
  await catalog.getByRole('button',{name:'缓存管理',exact:true}).click();
  const cacheDialog=p.getByRole('dialog',{name:'组件缓存管理'});
  await expect(cacheDialog).toBeVisible();
  await expect(cacheDialog).toContainText('手动导入、内置组件、游戏选择和恢复备份会保留');
  await cacheDialog.getByRole('combobox',{name:'缓存组件筛选'}).click();await p.getByRole('option',{name:'MFG 解锁插件 · RenoDX'}).click();
  await cacheDialog.getByRole('combobox',{name:'闲置时间'}).click();await p.getByRole('option',{name:'90 天未使用'}).click();
  await cacheDialog.getByRole('button',{name:'清理可释放缓存'}).click();
  await expect(cacheDialog).toHaveCount(0);
  assert.equal((await p.evaluate(()=>window.qa.audit())).cacheCleaned,true);
  assert.deepEqual((await p.evaluate(()=>window.qa.audit())).cacheCleanOptions,{component:'mfg-renodx',olderThanDays:90});
  assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0);assert.deepEqual(errors,[]);
  console.log('Update UI passed: check/download exclusion, cached offline verification, blocked-download reasons, release date and always-visible dependency/release sections.');
 }finally{await close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
