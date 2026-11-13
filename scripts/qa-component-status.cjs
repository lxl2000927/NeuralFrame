const {_electron:electron,expect}=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {componentCompatibility}=require('../src/core/component-compatibility');
const {DEFINITIONS}=require('../src/core/component-definitions');
const root=path.resolve(__dirname,'..'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const output=process.env.NEURALFRAME_QA_OUT;
if(output)fs.mkdirSync(output,{recursive:true});
const compatibility=(component,extra={})=>componentCompatibility({component,...extra});
const local=(id,component,extra={})=>({id,component,version:id,source:'fixture/QA',present:true,
  compatibility:compatibility(component,{files:[{rel:'example.dll',sha256:'a'.repeat(64)}]}),...extra});
const remote=(id,component,extra={})=>({id,component,tag:id,repo:'fixture/QA',name:id+'.zip',size:2048,downloadable:true,
  compatibility:compatibility(component),...extra});
const snapshot={root:'QA',warnings:[],definitions:DEFINITIONS,
  packages:[local('unverified','mfg-renodx'),local('selectable','dlss-sr'),local('damaged','renodx-nr',{present:false}),
    local('internal','overlay'),local('wrong-sm','dlss-nr',{modelRequirements:{architectures:['120'],source:'fingerprint'}}),
    local('unknown-sm','dlss-nr')],
  runtimePacks:[{id:'route',component:'feeder',version:'QA paired',repository:'fixture/QA',downloaded:false,size:2048,
    compatibility:compatibility('feeder',{trustedAdapter:true})}],
  updates:{checkedAt:new Date().toISOString(),errors:[],candidates:[remote('verify','encore'),remote('route-version','feeder')]} };
const cases=[
  ['release:verify','verify','文件身份待确认','下载并校验'],
  ['local:unverified','unsupported','NeuralFrame 尚未接入',null],
  ['release:route-version','route-version','未提供单独替换','下载入库'],
  ['runtime:route','route','随安装路线应用','下载入库'],
  ['local:wrong-sm','incompatible','显卡架构不匹配',null],
  ['local:unknown-sm','model-check','模型架构待确认',null],
  ['local:damaged','repair','文件异常 · 需修复',null],
  ['local:internal','internal','软件内置 · 无需单独安装',null],
  ['local:selectable','selectable','程序已支持 · 游戏页预览',null],
];
const expectedFacts={
 verify:[/先校验身份/,/文件|指纹|确认/,/下载并校验.*程序是否支持/],
 unsupported:[/不能通过 NeuralFrame 应用/,/不代表原项目未验证或组件不兼容/,/选择程序已支持的版本/],
 'route-version':[/未提供.*单独替换/,/成组部署/,/查看配套版本.*不会更新路线/],
 route:[/游戏页安装路线统一应用/,/宿主.*运行库.*加载器/,/选择安装路线并预览/],
 incompatible:[/不能在本机应用/,/CUDA.*不包含当前显卡/,/选择包含本机 CUDA 架构的模型/],
 'model-check':[/架构尚未确认/,/不能据此判定兼容或不兼容/,/实际 DLL 检查显卡架构.*保留原配置/],
 repair:[/需要先修复文件/,/文件缺失或大小异常/,/重新导入.*原始文件/],
 internal:[/无需.*单独安装/,/随.*维护|软件内置/,/更新 NeuralFrame/],
 selectable:[/游戏页预览.*检查游戏支持/,/校验|选择|支持/,/游戏页选择.*预览/],
};
(async()=>{
 const app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'test/fixtures/neuralframe-flow-main.cjs')],env});
 try {
  const p=await app.firstWindow();p.setDefaultTimeout(15000);
  const errors=[];p.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await p.evaluate(value=>window.qa.setComponentStatusFixture(value),snapshot);
  await p.getByRole('navigation').getByRole('button',{name:'组件',exact:true}).click();
  const catalog=p.locator('.component-catalog');
  await catalog.getByRole('textbox',{name:'搜索组件'}).fill('QA');
  await expect(catalog.locator('[data-version-id]')).toHaveCount(cases.length);
  await catalog.getByRole('button',{name:/^筛选/}).click();
  const filter=catalog.getByRole('combobox',{name:'应用条件筛选'});
  for(const [id,state,label,action] of cases){
   await filter.selectOption(state);
   const row=catalog.locator('[data-version-id]');await expect(row).toHaveCount(1);
   await expect(row).toHaveAttribute('data-version-id',id);
   await expect(row.locator('.component-status')).toHaveText(label);
   await expect(row.locator('.component-condition')).not.toHaveText('');
   if(action)await expect(row.getByRole('button',{name:action,exact:true})).toBeEnabled();
   await row.locator('.component-status').click();
   const drawer=p.locator('.component-drawer');await expect(drawer).toBeVisible();
   await expect(drawer.locator('.component-support-badge')).toHaveText(label);
   if(['verify','route-version','model-check','internal'].includes(state)){
    const colors=await drawer.locator('.component-support-badge').evaluate(el=>({actual:getComputedStyle(el).color,expected:getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()}));
    // Resolve the theme token through CSS rather than comparing hex and rgb strings.
    const expected=await p.evaluate(value=>{const probe=document.createElement('span');probe.style.color=value;document.body.append(probe);const result=getComputedStyle(probe).color;probe.remove();return result;},colors.expected);
    assert.equal(colors.actual,expected,'Unconfirmed or managed-only conditions must not look like confirmed support');
   }
   await expect(drawer.getByText('能否应用',{exact:true})).toBeVisible();
   await expect(drawer.getByText('原因',{exact:true})).toBeVisible();
   await expect(drawer.getByText('下一步',{exact:true})).toBeVisible();
   const facts=await drawer.locator('.component-verdict-facts dd').allTextContents();
   assert.equal(facts.length,3);
   expectedFacts[state].forEach((pattern,index)=>assert.match(facts[index],pattern,`${state}: availability, reason and next step retain their distinct meanings`));
   if(state==='unsupported')assert.match(await drawer.innerText(),/不代表原项目未验证或组件不兼容/);
   if(state==='incompatible')assert.match(await drawer.innerText(),/本机 CUDA：sm_89 · 模型 CUDA：sm_120/);
   if(output&&state==='route-version')await p.screenshot({path:path.join(output,'component-status-drawer.png'),animations:'disabled'});
   await p.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
  }
  await filter.selectOption('all');
  await catalog.getByRole('button',{name:/^筛选/}).click();
  await expect(catalog.locator('[data-version-id]')).toHaveCount(cases.length);
  if(output)await p.screenshot({path:path.join(output,'component-status-dark.png')});
  await p.setViewportSize({width:960,height:800});
  const overflow=await catalog.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
  assert.ok(overflow.content<=overflow.width+1,JSON.stringify(overflow));
  await p.evaluate(()=>document.documentElement.dataset.theme='light');
  if(output)await p.screenshot({path:path.join(output,'component-status-light-compact.png')});
  const audit=await p.evaluate(()=>window.qa.audit());
  assert.equal(audit.requests.length,0,'Browsing component conditions must not apply a game configuration');
  assert.equal(audit.libraryDownload,undefined,'Reviewing status must not trigger downloads');
  assert.deepEqual(errors,[]);
  console.log('Component status UI: 9 states, filters, reasons, next steps, action labels and compact layout passed.');
 } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
