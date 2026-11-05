'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ctx={window:{},console};vm.createContext(ctx);
for(const file of ['src/renderer/i18n.js','src/shared/feature-i18n.js','src/renderer/i18n-zh-complete.js','src/renderer/zh-cn-sections.js']) vm.runInContext(read(file),ctx);
test('Chinese root catalog covers every English key and preserves argument counts',()=>{
 for(const [key,en] of Object.entries(ctx.window.i18n.S.en)) {
  const zh=ctx.window.i18n.S.zh[key];assert.notEqual(zh,undefined,key);assert.equal(typeof zh,typeof en,key);
  if(typeof en==='function') assert.equal(zh.length,en.length,key);
 }
});
for(const name of ['community','chat'])test(`${name} Chinese catalog has all fields and function signatures`,()=>{
 const source=read(`src/renderer/${name}.js`),start=source.indexOf('  const L = '),end=source.indexOf('\n  };',start)+5;
 const english=vm.runInNewContext(source.slice(start,end)+'; L.en');
 const check=(en,zh,prefix)=>{for(const [key,value]of Object.entries(en)){
  assert.notEqual(zh[key],undefined,`${prefix}.${key}`);assert.equal(typeof zh[key],typeof value,`${prefix}.${key}`);
  if(typeof value==='function')assert.equal(zh[key].length,value.length,`${prefix}.${key}`);
  else if(value&&typeof value==='object')check(value,zh[key],`${prefix}.${key}`);
 }};check(english,ctx.window.zhCNSections[name],name);
});
test('native translation placeholders preserve type, width, precision and order',()=>{
 const entries=JSON.parse(read('overlay/zh-cn-extra.json'));
 const specs=s=>[...s.matchAll(/%(?:%|[-+ #0]*(?:\*|\d+)?(?:\.(?:\*|\d*))?(?:hh|ll|I32|I64|[hlLjzt])?[diuoxXfFeEgGaAcspn])/g)].map(m=>m[0]).filter(s=>s!=='%%');
 for(const[en,zh]of Object.entries(entries)){assert.deepEqual(specs(en),specs(zh),en);assert.ok(!specs(zh).some(s=>s.endsWith('n')),en);}
});
test('Overlay dialog localization keeps button actions, file types and user paths intact',()=>{
 const zh=require('../src/shared/overlay-zh');
 const input={title:'Add a custom ReShade overlay',message:'Remove Custom name.addon64?',detail:'D:\\Custom Folder\\My File.exe\n\nYour original imported file is kept.',buttons:['Cancel','Remove'],defaultId:0,cancelId:0,filters:[{name:'ReShade native add-ons',extensions:['addon64','addon32']}]};
 const result=zh.dialog(input);
 assert.equal(result.title,'添加自定义 ReShade 叠加层');assert.equal(result.message,'移除 Custom name.addon64？');
 assert.deepEqual(result.buttons,['取消','移除']);assert.equal(result.defaultId,0);assert.equal(result.cancelId,0);
 assert.match(result.detail,/^D:\\Custom Folder\\My File.exe\n\n/);assert.deepEqual(result.filters[0].extensions,input.filters[0].extensions);
 assert.equal(input.buttons[0],'Cancel');assert.equal(zh.text('Custom file name'),'Custom file name');
});
