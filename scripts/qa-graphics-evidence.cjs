const {_electron:electron}=require('@playwright/test');
const path=require('node:path'),assert=require('node:assert/strict');
const catalog=require('../src/core/neural-models');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
 const failures=[];
 for(const scenario of ['runtime expiry','independent FPS expiry','catalog labels','runtime header expiry']){
  const app=await electron.launch({executablePath:require('electron'),args:[path.resolve('test/fixtures/neuralframe-flow-main.cjs')],env});
  try{
   const p=await app.firstWindow();p.setDefaultTimeout(8000);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   await p.waitForFunction(()=>!!window.qa);
   await p.evaluate(value=>window.qa.setGraphicsCatalog(value),{
    profiles:catalog.HARDWARE_PROFILES,models:catalog.MODEL_DATABASE,stacks:catalog.RUNTIME_STACKS
   });
   await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
   const reading=p.locator('.multiplier-reading');await reading.waitFor();
   if(scenario==='runtime header expiry'){
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
    await reading.getByRole('button',{name:'检测倍率',exact:true}).click();
    await reading.getByText('已生效',{exact:true}).waitFor();
    if(scenario==='runtime expiry'){
     assert.match(await reading.textContent(),/3\.00×/);
     await p.clock.fastForward(30001);
     await reading.getByText('运行记录已过期',{exact:true}).waitFor();
     assert.doesNotMatch(await reading.textContent(),/3\.00×|已应用请求/);
    }else assert.doesNotMatch(await reading.textContent(),/3\.00×/,'Old FPS values must not be combined with a fresh configuration sample');
    const fresh=await p.evaluate(()=>Date.now());
    await p.evaluate(sample=>window.qa.setRuntimeSample(sample),{at:fresh,fpsAt:fresh,sourceFps:60,reportedOutputFps:120,appliedMultiplier:2});
    await reading.getByRole('button',{name:'检测倍率',exact:true}).click();
    await reading.getByText(/2\.00×/).waitFor();
   }
   console.log('PASS:',scenario);
  }catch(error){failures.push(scenario);console.error('FAIL:',scenario,error.message);}
  finally{await app.close();}
 }
 assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
