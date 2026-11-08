'use strict';
// Hidden Electron window, synthetic game data, isolated profile, network denied.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.resolve(root,'../validation/ui-zh');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const extra=`
 enhancedHardware:async()=>({hardwareProfile:'rtx40_laptop',hardware:{gpu:{name:'NVIDIA GeForce RTX 4070 Laptop GPU',driver:'621.01',vramTotalMB:8188,powerDefaultW:100,powerMaxW:140}}}),
 enhancedModels:async()=>({models:[],defaultModelId:'310.8.SF-v2'}),
 enhancedStatus:async()=>({hardwareProfile:'rtx40_laptop',neural:{mode:'latest_compatible'},mfg:{currentConfig:{installed:true,mode:'fixed',multiplier:3}},diagnostics:{},hardware:{gpu:{name:'NVIDIA GeForce RTX 4070 Laptop GPU'}}}),
 overlays:async()=>({ok:true,value:{overlays:[],installations:[],errors:[]}}),
 overlayPreferences:async()=>({ok:true,value:{enabled:true,theme:'green',hotkey:{key:119,mods:0}}}),
 overlayState:async()=>({running:true,addonPresent:true}),
`;
let fixture=fs.readFileSync(path.join(root,'test/fixtures/game-filters-preload.js'),'utf8');
fixture=fixture.replace("contextBridge.exposeInMainWorld('lab', {","contextBridge.exposeInMainWorld('lab', {"+extra).replace("lang: 'en'","lang: 'zh'");
const preload=path.join(out,'preload.cjs');fs.writeFileSync(preload,fixture);
const timeout=setTimeout(()=>{console.error('Chinese UI timeout');app.exit(1);},60000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{offscreen:true,preload,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
 const errors=[];win.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)errors.push(msg);});
 await win.loadFile(process.argv[2] || path.join(root,'src/renderer/index.html'));
 const run=code=>win.webContents.executeJavaScript(code);
 await run(`new Promise(resolve=>{const check=()=>state.games.length===9&&$('statusText').textContent===t('ready')?resolve():setTimeout(check,10);check();})`);
 assert.equal(await run(`document.documentElement.lang`),'zh');
 assert.equal(await run(`document.querySelector('[data-i18n-title="windowTheme"]').title`),'主题');
 for(const view of ['home','games','enhanced','overlays','settings']){
  await run(`show(${JSON.stringify(view)}); ${view==='enhanced'?'window.enhancedUi.renderEnhancedView()':'Promise.resolve()'}`);
  await new Promise(resolve=>setTimeout(resolve,650));
  const text=await run(`document.querySelector('.view.active').innerText`);
  fs.writeFileSync(path.join(out,view+'.txt'),text);
  assert.ok(!/\bundefined\b|\bNaN\b/.test(text),view+' invalid translated value');
  if(view==='enhanced'){
   assert.match(text,/神经渲染管理/);assert.match(text,/多帧生成管理/);
   assert.match(text,/实际生效倍率\s+请在“运行时检测”中查看/);
   assert.doesNotMatch(text,/Neural Rendering Manager|Multi Frame Generation Manager|Model & CUDA Fatbin Database/);
  }
  if(['enhanced','overlays','settings'].includes(view)){
   win.webContents.invalidate();
   await new Promise(resolve=>setTimeout(resolve,250));
   fs.writeFileSync(path.join(out,view+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 await run(`show('overlays');$('olHotkey').click()`);
 assert.match(await run(`$('olHotkeyDialog').innerText`),/面板快捷键/);
 assert.equal(await run(`$('olKeyCancel').textContent`),'取消');
 await run(`$('olHotkeyDialog').close();applyLang('en')`);
 assert.equal(await run(`document.querySelector('[data-i18n-title="windowTheme"]').title`),'Theme');
 await run(`applyLang('zh')`);
 assert.equal(await run(`document.querySelector('[data-i18n-title="windowTheme"]').title`),'主题');
 // Check the actual Overlay preview, including dropdown values and hover text.
 await run(`show('overlays');window.overlayLab.render()`);
 await run(`document.querySelector('[data-ol-action="preview"]').click()`);
 assert.equal(await run(`$('olPreview').querySelector('[data-live-id="113"]').textContent`),'默认');
 assert.match(await run(`$('olPreview').querySelector('[data-live-id="101"]').title`),/结构细节强度/);
 await run(`$('olPreview').querySelector('[data-live-id="113"]').click();$('olPreview').querySelector('[data-live-id="113"]').nextElementSibling.children[2].click()`);
 assert.equal(await run(`$('olPreview').querySelector('[data-live-id="113"]').textContent`),'预设 2');
 await run(`$('olPreview').querySelector('.ol-preview-backend').click()`);
 assert.equal(await run(`$('olPreview').querySelector('[data-live-id="307"]').textContent`),'自动');
 await run(`$('olPreview').querySelector('[data-live-id="307"]').click();$('olPreview').querySelector('[data-live-id="307"]').nextElementSibling.children[2].click()`);
 assert.equal(await run(`$('olPreview').querySelector('[data-live-id="307"]').textContent`),'反向深度');
 await run(`$('olPreviewDialog').close();window.fixtureCommands=[];window.overlayRuntime={resize:()=>{},setControl:v=>fixtureCommands.push(v),onStatus:fn=>window.fixtureStatus=fn};const mount=document.createElement('div');mount.id='fixtureLive';document.body.append(mount);window.mountOverlayLive(mount);fixtureStatus({epoch:1,nrEnabled:true,nrAvailable:false,nrReason:'RenoDX is not loaded',nrTools:[],tools:[],feedPresent:false,feedReason:'Feeder is not loaded',feedTools:[]})`);
 assert.equal(await run(`$('fixtureLive').querySelector('.ol-nr-status').textContent`),'尚未加载 RenoDX');
 assert.equal(await run(`$('fixtureLive').querySelector('.ol-feed-status').textContent`),'尚未加载 Feeder');
 assert.equal(await run(`fixtureCommands.length`),0);
 await run(`$('fixtureLive')._overlayDispose();$('fixtureLive').remove()`);
 assert.deepEqual(errors,[]);clearTimeout(timeout);
 console.log('PASS: Chinese home, games, enhanced panels, overlays, settings, hotkey dialog and language switching');
 app.exit(0);
}).catch(err=>{console.error(err);clearTimeout(timeout);app.exit(1);});
