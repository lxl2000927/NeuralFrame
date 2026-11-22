const { launchFixture } = require('../test/fixtures/launch-electron.cjs');
const { expect } = require('@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const failures=[];
 for(const scenario of ['pending executable','pending route','resolved target','no native DLSS','installed OptiScaler','missing installed executable']){
  const { app, close } = await launchFixture();
  try{
   const p=await app.firstWindow();p.setDefaultTimeout(10000);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   if(scenario==='no native DLSS') await p.evaluate(()=>window.qa.setGraphicsEvidence('D:\\QA\\Game',{hasNativeDlss:false,hasNativeDlssFg:false,hasNativeFg:false}));
   if(scenario==='installed OptiScaler') await p.evaluate(async()=>{
    await window.lab.componentPrepare();
    await window.lab.install('D:\\QA\\Game','D:\\QA\\Game\\game.exe','optiscaler','auto','route-plan');
   });
   if(scenario==='missing installed executable') await p.evaluate(async()=>{
    window.qa.setReceiptExe('Retired/Game.exe');
    await window.lab.install('D:\\QA\\Game','D:\\QA\\Game\\Retired\\Game.exe','encore','auto','route-plan');
   });
   await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
   const setup=p.getByRole('region',{name:'安装与运行环境',exact:true});
   await setup.waitFor();
   if(scenario==='no native DLSS'){
    const neural=p.getByRole('region',{name:'神经渲染配置',exact:true}),mfg=p.getByRole('region',{name:'多帧生成配置',exact:true});
    for(const width of [1560,960]){
     await p.setViewportSize({width,height:900});
     await expect(neural.getByRole('heading',{name:'Neural Rendering Manager'})).toBeVisible();
     await expect(mfg.getByRole('heading',{name:'Multi Frame Generation Manager'})).toBeVisible();
     await expect(neural.getByText('当前模型 (Current Model)',{exact:true})).toBeVisible();
     await expect(mfg.getByText('当前显卡 (Current GPU)',{exact:true})).toBeVisible();
     await expect(p.locator('.graphics-module details')).toHaveCount(0);
     const left=await neural.boundingBox(),right=await mfg.boundingBox();
     assert.ok(width===1560 ? Math.abs(left.y-right.y)<2 : right.y>=left.y+left.height-1);
    }
    console.log('PASS:',scenario);continue;
   }
   if(scenario==='missing installed executable'){
    await expect(setup.getByRole('combobox',{name:'渲染后端',exact:true})).toHaveAttribute('data-value','reshade');
    await expect(setup.getByText('已安装的后端',{exact:true}).locator('+ dd')).toHaveText('无');
    console.log('PASS:',scenario);continue;
   }
   if(scenario==='resolved target' || scenario==='installed OptiScaler') {
    const consumer=setup.getByText('神经渲染插件',{exact:true}).locator('+ dd');
    await expect(consumer).toHaveText(scenario==='installed OptiScaler'?'已安装':'未安装');
   }
   if(scenario==='pending executable'){
    await p.locator('.game-list').getByRole('button',{name:/Unconfigured game/}).click();
    await setup.getByRole('combobox',{name:'可执行文件',exact:true}).click();
    await p.getByRole('option',{name:/^Alt\\game.exe/}).click();
    assert.equal(await setup.getByRole('combobox',{name:'安装方式',exact:true}).getAttribute('data-value'),'feeder');
    assert.equal(await setup.getByText('未检测到原生超分',{exact:true}).count(),1,'Target detection must not show the main executable DLSS runtime');
    assert.equal(await p.getByRole('radiogroup',{name:'补帧倍率'}).getByRole('radio').count(),0,'An inactive unsupported target has no multiplier controls');
    assert.equal(await p.locator('.multiplier-reading').count(),0,'Runtime evidence belongs to the inspected executable');
    const api=setup.getByRole('combobox',{name:'渲染 API',exact:true});
    await api.click();await p.getByRole('option',{name:'DirectX 12',exact:true}).click();
    await p.waitForFunction(()=>document.querySelector('[aria-label="渲染 API"][data-value="d3d12"]'));
    assert.equal(await setup.getByRole('combobox',{name:'安装方式',exact:true}).getAttribute('data-value'),'feeder','DX12 executable without SR keeps its own Feeder recommendation');
    const backend=setup.getByRole('combobox',{name:'渲染后端',exact:true});
    await backend.click();await p.getByRole('option',{name:'RTX Encore',exact:true}).click();
    await backend.click();await p.getByRole('option',{name:'ReShade（默认）',exact:true}).click();
    assert.equal(await setup.getByRole('combobox',{name:'安装方式',exact:true}).getAttribute('data-value'),'feeder','Returning to ReShade uses the selected executable recommendation');
    await expect(p.getByRole('radiogroup',{name:'补帧倍率'}).getByRole('radio')).toHaveCount(0);
    await expect(p.getByText('当前程序未检测到可供 NVIDIA 补帧使用的 DLSS-G 输入。',{exact:true}).first()).toBeVisible();
   }else if(scenario==='pending route'){
    await setup.getByRole('combobox',{name:'安装方式',exact:true}).click();
    await p.getByRole('option',{name:'Feeder + ReShade',exact:true}).click();
   }
   if(scenario==='installed OptiScaler'){
    await p.getByRole('radiogroup',{name:'补帧倍率'}).getByRole('radio',{name:/^x3/}).click();
    await p.getByRole('button',{name:'仅应用补帧设置',exact:true}).click();
    await p.getByRole('heading',{name:'应用前变更预览'}).waitFor();
    const patch=await p.evaluate(()=>window.qa.audit().requests.at(-1).patch);
    assert.equal(patch.mfgMode,'x3');assert.equal(patch.hdrCompatibility,undefined);assert.equal(patch.runtimeStack,undefined);
   }else if(scenario==='resolved target'){
    await p.getByRole('button',{name:'仅应用补帧设置',exact:true}).click();
    await p.waitForFunction(()=>window.qa.audit().requests.length>0);
    const patch=await p.evaluate(()=>window.qa.audit().requests.at(-1).patch);
    assert.equal(patch.exePath,'D:\\QA\\Game\\game.exe','A graphics operation must pin the executable displayed to the user');
   }else{
    for(const name of ['仅应用神经渲染设置','仅应用补帧设置','重新应用当前配置']){
     if(scenario==='pending executable' && name==='仅应用神经渲染设置'){
      await expect(p.getByRole('button',{name,exact:true})).toBeDisabled();continue;
     }
     if(scenario==='pending executable' && name==='仅应用补帧设置'){
      await expect(p.getByRole('button',{name,exact:true})).toHaveCount(0);continue;
     }
     if(name==='重新应用当前配置')await p.locator('.apply-bar').getByRole('button',{name:'更多操作',exact:true}).click();
     await p.getByRole('button',{name,exact:true}).click();
     await p.waitForFunction(()=>window.qa.audit().requests.length>0 || document.body.textContent.includes('请先预览并应用安装方式，再应用该路线的参数。'));
     assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0,name+' must not modify the old target while installation selection is pending');
    }
    assert.equal((await p.evaluate(()=>window.qa.audit())).installRequests?.length||0,0);
    assert.equal(await p.locator('.apply-bar').getByRole('button',{name:'预览并应用安装方式',exact:true}).isEnabled(),true,'The reviewed installation action remains available');
    if(scenario==='pending route'){
     await setup.getByRole('combobox',{name:'渲染后端',exact:true}).click();
     await p.getByRole('option',{name:'OptiScaler',exact:true}).click();
     assert.equal(await p.getByRole('combobox',{name:'运行时栈版本 (Streamline / DLSS / Feeder)',exact:true}).isDisabled(),true);
     assert.equal(await p.getByRole('combobox',{name:/QualityGuard/}).count(),0);
     assert.equal(await p.getByText('神经渲染调校',{exact:true}).count(),0,'OptiScaler owns its runtime and tuning');
     await setup.getByRole('combobox',{name:'渲染后端',exact:true}).click();
     await p.getByRole('option',{name:'ReShade（默认）',exact:true}).click();
     await setup.getByRole('combobox',{name:'安装方式',exact:true}).click();
     await p.getByRole('option',{name:'RenoDX DLSS Tool',exact:true}).click();
     assert.equal(await p.getByText('神经渲染调校',{exact:true}).count(),0,'Multipass does not own single-pass tuning');
    }
   }
   console.log('PASS:',scenario);
  }catch(error){failures.push(scenario);console.error('FAIL:',scenario,error.message);}
  finally{await close();}
 }
 assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
