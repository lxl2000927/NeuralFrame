const {_electron:electron}=require('@playwright/test');
const path=require('node:path'),assert=require('node:assert/strict');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
(async()=>{
 const failures=[];
 for(const scenario of ['pending executable','pending route','resolved target']){
  const app=await electron.launch({executablePath:require('electron'),args:[path.resolve('test/fixtures/neuralframe-flow-main.cjs')],env});
  try{
   const p=await app.firstWindow();p.setDefaultTimeout(10000);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
   await p.getByRole('navigation').getByRole('button',{name:'游戏',exact:true}).click();
   const setup=p.getByRole('region',{name:'安装与运行环境',exact:true});
   await setup.waitFor();
   if(scenario==='pending executable'){
    await p.locator('.game-list').getByRole('button',{name:/Unconfigured game/}).click();
    await setup.getByRole('combobox',{name:'可执行文件',exact:true}).click();
    await p.getByRole('option',{name:/^Alt\\game.exe/}).click();
   }else if(scenario==='pending route'){
    await setup.getByRole('combobox',{name:'安装方式',exact:true}).click();
    await p.getByRole('option',{name:'Feeder + ReShade',exact:true}).click();
   }
   if(scenario==='resolved target'){
    await p.getByRole('button',{name:'仅应用补帧设置',exact:true}).click();
    await p.waitForFunction(()=>window.qa.audit().requests.length>0);
    const patch=await p.evaluate(()=>window.qa.audit().requests.at(-1).patch);
    assert.equal(patch.exePath,'D:\\QA\\Game\\game.exe','A graphics operation must pin the executable displayed to the user');
   }else{
    for(const name of ['仅应用神经渲染设置','仅应用补帧设置','重新应用当前配置']){
     if(name==='重新应用当前配置')await p.locator('.apply-bar').getByRole('button',{name:'更多操作',exact:true}).click();
     await p.getByRole('button',{name,exact:true}).click();
     await p.waitForFunction(()=>window.qa.audit().requests.length>0 || document.body.textContent.includes('请先预览并应用安装方式，再应用该路线的参数。'));
     assert.equal((await p.evaluate(()=>window.qa.audit())).requests.length,0,name+' must not modify the old target while installation selection is pending');
    }
    assert.equal((await p.evaluate(()=>window.qa.audit())).installRequests?.length||0,0);
    assert.equal(await p.locator('.apply-bar').getByRole('button',{name:'预览并应用安装方式',exact:true}).isEnabled(),true,'The reviewed installation action remains available');
   }
   console.log('PASS:',scenario);
  }catch(error){failures.push(scenario);console.error('FAIL:',scenario,error.message);}
  finally{await app.close();}
 }
 assert.deepEqual(failures,[]);
})().catch(error=>{console.error(error);process.exitCode=1;});
