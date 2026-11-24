const { launchFixture } = require('../test/fixtures/launch-electron.cjs');
const { expect } = require('@playwright/test');
const path=require('node:path'),assert=require('node:assert/strict');
const catalog=require('../src/core/neural-models');
(async()=>{
 const failures=[];
 for(const scenario of ['runtime expiry','independent FPS expiry','catalog labels','runtime header expiry','runtime executable','profile keyboard','F7 executable identity','Radeon ANR','Radeon legacy','unknown GPU','mixed GPU model']){
  const { app, close } = await launchFixture();
  try{
   const p=await app.firstWindow();p.setDefaultTimeout(8000);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   await p.waitForFunction(()=>!!window.qa);
   const fixtureGpus={
    'Radeon ANR':{name:'AMD Radeon RX 7800 XT',architecture:{sm:null},nvidiaPresent:false},
    'Radeon legacy':{name:'AMD Radeon RX 580',architecture:{sm:null},nvidiaPresent:false},
    'unknown GPU':{name:'Display adapter',architecture:{sm:null},nvidiaPresent:null},
    'mixed GPU model':{name:'NVIDIA GeForce RTX 4070',architecture:{sm:'89'},nvidiaPresent:true}
   };
   const gpu=fixtureGpus[scenario];
   await p.evaluate(value=>window.qa.setGraphicsCatalog(value),{
    profiles:catalog.HARDWARE_PROFILES,stacks:catalog.RUNTIME_STACKS,gpu,
    models:gpu ? catalog.MODEL_DATABASE.map(model=>({...model,availableOnDisk:model.id==='310.8.SF-v2',
      ...(scenario==='mixed GPU model' && model.id==='310.8.SF-v2' ? {architectures:['89']} : {})})) : catalog.MODEL_DATABASE,
    ...(scenario==='Radeon ANR' ? {neuralMode:'latest_compatible',mfgMode:'x3'} : {})
   });
   if(scenario==='F7 executable identity'){
    await p.evaluate(()=>window.qa.setReceiptExe('ALT/GAME.EXE'));
    await p.getByRole('navigation').getByRole('button',{name:'叠加层',exact:true}).click();
    const monitor=p.getByRole('region',{name:'F7 性能监控'});
    const selectGame=async name=>{
     await monitor.getByRole('combobox',{name:'目标游戏'}).click();
     await p.getByRole('option',{name,exact:true}).click();
    };
    await selectGame('Unconfigured game');
    const exe=monitor.getByRole('combobox',{name:'可执行文件'});
    await expect(exe).toHaveAttribute('data-value','D:\\QA\\New\\Alt\\game.exe');
    await expect(monitor.getByRole('button',{name:'预览安装并应用设置'})).toBeEnabled();
    await exe.click();await p.getByRole('option',{name:'game.exe',exact:true}).click();
    await expect(monitor.getByText('请为当前已部署的游戏程序和渲染 API 配置性能监控。')).toBeVisible();
    await selectGame('Wuthering Waves');
    await expect(monitor.getByText('仅预览',{exact:true})).toBeVisible();
    const modes=monitor.getByRole('group',{name:'监控显示模式'});
    const corners=monitor.getByRole('group',{name:'浮窗位置'});
    await modes.getByRole('radio',{name:'详细'}).check();
    await corners.getByRole('radio',{name:'左下'}).check();
    await expect(corners.locator('.monitor-anchor').filter({hasText:'左下'})).toContainText('1% Low');
    await modes.getByRole('radio',{name:'隐藏'}).check();
    await expect(corners.getByText('浮窗已隐藏')).toBeVisible();
    await expect(corners.locator('.monitor-anchor small')).toHaveCount(0);
    await expect(monitor.getByRole('button',{name:/预览安装|预览监控设置/})).toHaveCount(0);
    assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0);
    await selectGame('Unconfigured game');
    await exe.click();await p.getByRole('option',{name:/Alt.*game\.exe/i}).click();
    await expect(monitor.getByRole('button',{name:'预览安装并应用设置'})).toBeEnabled();
    await expect(modes.getByRole('radio',{name:'精简'})).toBeChecked();
    await expect(corners.getByRole('radio',{name:'右上'})).toBeChecked();
    console.log('PASS:',scenario);continue;
   }
   await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
   const reading=p.locator('.multiplier-reading');await reading.waitFor();
   if(scenario==='Radeon legacy'){
    await p.getByRole('radiogroup',{name:'补帧引擎'}).getByRole('radio',{name:/ANR FG B20/}).click();
    await expect(p.getByText('这款 Radeon 不在 ANR FG 的支持列表内。')).toBeVisible();
    await expect(p.getByRole('button',{name:'预览帧生成设置'})).toBeDisabled();
    await expect(p.locator('.apply-bar').getByRole('button',{name:'预览并应用',exact:true})).toBeDisabled();
    console.log('PASS:',scenario);continue;
   }
   const modelPicker=p.getByRole('region',{name:'神经渲染配置',exact:true}).getByRole('combobox',{name:'神经渲染模型',exact:true});
   if(scenario==='mixed GPU model'){
    await p.getByRole('radio',{name:/RTX 50 系列/}).click();
    await expect(p.getByRole('radio',{name:/RTX 50 系列/})).toBeChecked();
    await modelPicker.click();
    const local=p.getByRole('option',{name:/SmarterGamers.*sm_89.*已入库/});
    await expect(local).not.toContainText('不支持');
    await local.click();await expect(modelPicker).toHaveAttribute('data-value','310.8.SF-v2');
    console.log('PASS:',scenario);continue;
   }
   if(gpu){
    const radeon=gpu.nvidiaPresent===false;
    const modes=p.getByRole('radiogroup',{name:'神经渲染',exact:true}).getByRole('radio');
    const multipliers=p.getByRole('radiogroup',{name:'补帧倍率',exact:true}).getByRole('radio');
    await expect(modes).toHaveCount(radeon ? 1 : 3);await expect(multipliers).toHaveCount(radeon ? 1 : 4);
    await expect(p.getByText('此处显示 RTX 档位的参考参数。实机兼容性取决于检测到的显卡和游戏路线。')).toBeVisible();
    if(radeon){
     const applyNeural=p.getByRole('button',{name:'仅应用神经渲染设置',exact:true});
     await expect(applyNeural).toBeDisabled();await expect(p.getByRole('button',{name:'仅应用补帧设置'})).toBeDisabled();
     await modes.first().click();await expect(applyNeural).toBeEnabled();
     await expect(p.locator('.apply-bar').getByRole('button',{name:'预览并应用',exact:true})).toBeEnabled();
     await p.evaluate(()=>window.lab.componentPrepare());await applyNeural.click();
     await p.getByRole('heading',{name:'应用前变更预览'}).waitFor();
     const patch=await p.evaluate(()=>window.qa.audit().requests.at(-1).patch);
     assert.equal(patch.neuralMode,'off');assert.equal(patch.mfgMode,undefined);
     await p.getByRole('button',{name:'取消',exact:true}).click();
    }
    if(radeon)await expect(modelPicker).toBeDisabled();
    else{
     await modelPicker.click();await expect(p.getByRole('option',{name:/SmarterGamers.*已入库/})).toBeVisible();
     await p.keyboard.press('Escape');
    }
    await expect(p.getByRole('button',{name:'管理模型',exact:true})).toBeEnabled();
    const setup=p.getByRole('region',{name:'安装与运行环境',exact:true});
    await setup.getByRole('combobox',{name:'安装方式',exact:true}).click();
    await p.getByRole('option',{name:'Feeder + ReShade',exact:true}).click();
    await expect(setup.getByText(/Feeder 向渲染插件提供/)).toBeVisible();
    const install=p.getByRole('button',{name:'预览并应用安装方式',exact:true});
    if(radeon)await expect(install).toBeDisabled();else await expect(install).toBeEnabled();
    if(!radeon){console.log('PASS:',scenario);continue;}
    assert.equal(await p.evaluate(()=>window.qa.audit().installRequests?.length || 0),0);
    await p.getByRole('radiogroup',{name:'补帧引擎'}).getByRole('radio',{name:/ANR FG B20/}).click();
    await expect(p.getByRole('combobox',{name:'同时启用 DLSS 神经渲染'})).toBeDisabled();
    await expect(p.getByText(/DLSS 神经渲染需要识别到兼容的 NVIDIA CUDA/)).toBeVisible();
    await p.getByRole('button',{name:'预览帧生成设置'}).click();
    await p.getByRole('heading',{name:'应用前变更预览'}).waitFor();
    assert.equal(await p.evaluate(()=>window.qa.audit().requests.at(-1).patch.route),'anr');
    await p.getByRole('button',{name:'取消',exact:true}).click();
    await p.getByRole('navigation').getByRole('button',{name:'叠加层',exact:true}).click();
    const monitor=p.getByRole('region',{name:'F7 性能监控'});
    await monitor.getByRole('combobox',{name:'目标游戏'}).click();
    await p.getByRole('option',{name:'Unconfigured game',exact:true}).click();
    await expect(monitor.getByRole('button',{name:'预览安装并应用设置'})).toBeEnabled();
    console.log('PASS:',scenario);continue;
   }
   if(scenario==='runtime executable'){
    const alternate='D:\\QA\\New\\Alt\\game.exe';
    await p.setViewportSize({width:960,height:800});
    await p.evaluate(exe=>{window.qa.setRuntimeExe(exe);window.qa.setRuntimeSample({sourceFps:60,reportedOutputFps:180,appliedMultiplier:3});},alternate);
    await p.locator('.game-list').getByRole('button',{name:/Unconfigured game/}).click();
    await expect(reading).toContainText(alternate);
    assert.doesNotMatch(await reading.innerText(),/3\.00×|已应用请求/);
    if(process.env.NEURALFRAME_QA_OUT){
     await reading.scrollIntoViewIfNeeded();
     await p.screenshot({path:path.join(process.env.NEURALFRAME_QA_OUT,'runtime-target-960.png')});
    }
    await p.getByRole('tab',{name:'运行诊断',exact:true}).click();
    await expect(p.getByRole('tabpanel')).toContainText(alternate);
    await p.evaluate(()=>window.qa.setRuntimeExe('d:/qa/new/GAME.EXE'));
    await p.getByRole('tab',{name:'画质与补帧',exact:true}).click();
    await expect(reading).toContainText('3.00×');
    const otherWuwa='D:\\QA\\Wuthering Waves\\Alt\\game.exe';
    await p.evaluate(exe=>window.qa.setRuntimeExe(exe),otherWuwa);
    await p.locator('.game-list').getByRole('button',{name:/Wuthering Waves/}).click();
    const standalone=p.getByRole('region',{name:'独立加载参数与运行状态'});
    await expect(standalone).toContainText(otherWuwa);
    assert.doesNotMatch(await standalone.innerText(),/正在执行神经渲染/);
   }else if(scenario==='profile keyboard'){
    const cards=p.getByRole('radiogroup',{name:'硬件档位',exact:true}).getByRole('radio');
    await cards.first().focus();await p.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeChecked();await expect(cards.nth(1)).toBeFocused();
    await p.keyboard.press('End');await expect(cards.last()).toBeChecked();
    await p.keyboard.press('ArrowRight');await expect(cards.first()).toBeChecked();
    assert.equal(await cards.evaluateAll(list=>list.filter(card=>card.tabIndex===0).length),1);
   }else if(scenario==='runtime header expiry'){
    await p.clock.install({time:new Date()});
    await p.getByRole('tab',{name:'运行诊断',exact:true}).click();
    const summary=p.locator('.runtime-summary');
    await summary.getByText('游戏运行中',{exact:true}).waitFor();
    await p.getByRole('tab',{name:'画质与补帧',exact:true}).click();
    await p.clock.fastForward(30001);
    await summary.getByText('运行记录已过期',{exact:true}).waitFor();
    assert.equal(await summary.getAttribute('data-running'),null,'Expired observations must not keep the green running indicator');
    // Playwright's renderer clock does not replace Date inside the preload.
    await p.evaluate(()=>window.qa.setRuntimeCheckedAt(Date.now()));
    await p.getByRole('tab',{name:'运行诊断',exact:true}).click();
    await summary.getByText('游戏运行中',{exact:true}).waitFor();
   }else if(scenario==='catalog labels'){
    const panel=p.getByRole('region',{name:'神经渲染配置',exact:true});
    assert.match(await panel.locator('.module-note').textContent(),/75%/);
    const tracked=panel.locator('.module-facts > div').filter({has:p.getByText('2026-10 模型追踪',{exact:true})});
    assert.match(await tracked.textContent(),/310\.9\.16\.0.*RankFTW/);
    assert.match(await panel.locator('.module-facts').textContent(),/待应用运行库组合/);
    const mfg=p.getByRole('region',{name:'多帧生成配置',exact:true});
    await mfg.getByText('已部署的补帧插件',{exact:true}).waitFor();
    await mfg.getByRole('radiogroup',{name:'补帧引擎'}).waitFor();
    const stack=panel.getByRole('combobox',{name:'运行时栈版本 (Streamline / DLSS / Feeder)',exact:true});
    await stack.click();
    const baseline=p.getByRole('option').filter({hasText:'基准组合'});
    assert.match(await baseline.textContent(),/FG 310\.9\.1\.0/);
    assert.doesNotMatch(await baseline.textContent(),/Dynamic MFG 310\.9\.16/);
    await p.keyboard.press('Escape');
    await panel.getByRole('combobox',{name:'神经渲染模型',exact:true}).click();
    const legacy=p.getByRole('option').filter({hasText:'Early Ada Lovelace Port'});
    await legacy.waitFor();assert.match(await legacy.textContent(),/sm_89\/sm_120/);
    assert.doesNotMatch(await legacy.textContent(),/sm_75|sm_86/);
    await p.keyboard.press('Escape');
    await p.getByRole('radio',{name:/RTX 50 系列/}).click();
    await p.waitForFunction(()=>window.qa.audit().profileQueries.includes('rtx50_desktop'));
    assert.match(await p.getByRole('radio',{name:/^x3/}).textContent(),/实验性/);
   }else{
    await p.clock.install({time:new Date()});
    const now=await p.evaluate(()=>Date.now());
    await p.evaluate(sample=>window.qa.setRuntimeSample(sample),{at:now,fpsAt:now-(scenario==='independent FPS expiry'?31000:0),sourceFps:60,reportedOutputFps:180,appliedMultiplier:3});
    assert.equal(await reading.getByRole('button',{name:'刷新检测',exact:true}).count(),1);
    await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await reading.getByText('已生效',{exact:true}).waitFor();
    if(scenario==='runtime expiry'){
     assert.match(await reading.textContent(),/3\.00×/);
     await p.clock.fastForward(30001);
     await reading.getByText('运行记录已过期',{exact:true}).waitFor();
     assert.doesNotMatch(await reading.textContent(),/3\.00×|已应用请求/);
    }else assert.doesNotMatch(await reading.textContent(),/3\.00×/,'Old FPS values must not be combined with a fresh configuration sample');
    const fresh=await p.evaluate(()=>Date.now());
    await p.evaluate(sample=>window.qa.setRuntimeSample(sample),{at:fresh,fpsAt:fresh,sourceFps:60,reportedOutputFps:120,appliedMultiplier:2});
    await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await reading.getByText(/2\.00×/).waitFor();
   }
   console.log('PASS:',scenario);
  }catch(error){failures.push(scenario);console.error('FAIL:',scenario,error.message);}
  finally{await close();}
 }
 assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
