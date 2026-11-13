const {contextBridge,ipcRenderer}=require('electron');
async function validateOverlay(value){
 const result=await ipcRenderer.invoke('qa-validate-overlay',value);
 if(!result.ok)throw Error(result.error);
 return result.value;
}
const audit={prepared:0,applied:0,previewed:0,requests:[],profileQueries:[],detailReads:0,statusReads:0,runtimeReads:0,detailPriorities:[],statusPriorities:[]};let downloaded=false,subscriber=()=>{};
const profiles=Object.fromEntries(['rtx40_laptop','rtx40_desktop','rtx50_desktop'].map(id=>[id,{
  id, sm:89, targetResolution:'1920x1080', nrResolutionScale:id==='rtx40_laptop'?0.75:1, nrMaxWorksets:id==='rtx40_laptop'?4:8, nrPasses:1, nrHookPoint:0
}]));
const release = {id:'smartergamers-qa',provider:'smartergamers-nr',component:'dlss-nr',repo:'SmarterGamers/SmarterGamers-DLSS5-Swapper',
  tag:'v2.3.0',catalogModelId:'310.8.SF-v2',name:'nvngx_dlssnr.dll',size:165840496,downloadable:true};
const selectable={kind:'selectable',ready:true,label:'可选择',reason:''};
const pending={kind:'pending',ready:false,label:'已入库 · 等待适配',reason:''};
const routeManaged={kind:'route',ready:false,label:'由安装路线成组管理',reason:''};
let checkedAt = null;
const libraryUpdates = () => ({checkedAt,errors:[],candidates:checkedAt
  ? [{...release,compatibility:selectable,cachedPackageId:audit.sfDownloaded ? 'qa-model' : undefined},
     {id:'rankftw-sf-qa',component:'dlss-nr',provider:'rhi-nr',repo:'RankFTW/rhi-repo',tag:'dlssnr-310.8.SF-v2',name:'nvngx_dlssnr_310.8.SF-v2.zip',size:116693212,downloadable:true,compatibility:selectable},
     ...['310.9.16','310.8.0-RTX40','310.8.SF','310.8.Lecram','310.8.0'].map(tag=>({id:'nr-'+tag,component:'dlss-nr',provider:'rhi-nr',repo:'RankFTW/rhi-repo',tag:'dlssnr-'+tag,name:'nvngx_dlssnr_'+tag+'.zip',size:2048,downloadable:true,compatibility:selectable})),
     {id:'sr-test',component:'dlss-sr',repo:'example/sr-only',tag:'v3.7.20',size:2048,downloadable:true,compatibility:selectable},
     {id:'sr-matched',component:'dlss-sr',repo:'example/sr-only',tag:'v3.7.10',size:2048,downloadable:true,cachedPackageId:'qa-sr',compatibility:selectable},
     {id:'mfg-test',component:'mfg-renodx',repo:'mavismmg/MFGAdaUnlock-RenoDx',tag:'1.9.0',size:2048,downloadable:true,compatibility:pending,cachedPackageId:audit.pendingDownloaded?'qa-mfg':undefined},
     {id:'feeder-test',component:'feeder',repo:'jlrouzies-fr/DLSS5-Feeder',tag:'1.20',size:2048,downloadable:true,compatibility:routeManaged}] : []});
const catalogModels = () => [
  {id:'310.8.SF-v2', name:'310.8.SF-v2 · SmarterGamers', upstreamRepo:release.repo, version:'310.8.0.0', sha256:'a'.repeat(64), architectures:['89'], downloadable:true, availableOnDisk:!!audit.sfDownloaded},
  {id:'310.8.SF-v2-rankftw', name:'310.8.SF-v2 · RankFTW', upstreamRepo:'RankFTW/rhi-repo', version:'310.8.2.0', sha256:'e'.repeat(64), architectures:['89'], downloadId:'rankftw-nr-310.8.SF-v2', downloadable:true, availableOnDisk:!!audit.rankSfDownloaded},
  {id:'310.8.0-RTX40', name:'Early Ada', sha256:'f'.repeat(64), architectures:['89'], availableOnDisk:false},
  {id:'310.9.16', name:'DLSS 5 NR 310.9.16.0 · RankFTW', version:'310.9.16.0', sha256:'d'.repeat(64), architectures:['89'], downloadId:'rankftw-nr-310.9.16', downloadable:true, availableOnDisk:!!audit.rankDownloaded},
  {id:'310.8.SF', name:'ShortFuse v1', sha256:'b'.repeat(64), architectures:['89'], availableOnDisk:false},
  {id:'310.8.Lecram', name:'Lecram', sha256:'c'.repeat(64), architectures:['120'], availableOnDisk:!!audit.lecramImported},
  {id:'stock', name:'Stock', sha256:null, architectures:['120'], availableOnDisk:false}
];
const jobListeners=new Set();
let externalRevision=0;
let uiLanguage='zh';
let notifyLibraryProgress=()=>{}, cancelLibraryTransfer;
let overlayPrefs={theme:'green',enabled:true,custom:null,hotkey:{key:119,mods:0}};
let overlayBridgeState={listening:true,connected:false,addon:true,game:false};
let releaseOverlayList;
const firstOverlayList=new Promise(resolve=>{releaseOverlayList=resolve});
const wuwaDir='D:\\QA\\Wuthering Waves';
let proxyState = 'active';
let runtimeSample={}, runtimeCheckedAt, graphicsCatalog=null;
let engineCatalog=false, failLibraryOnce=false, componentStatusFixture=null;
let updateCheckGate=null, releaseUpdateCheck;
const engineMfg={version:'1.7.1',verified:true,compatible:true,recommended:true,capabilities:{diagnosticLogging:true}};
const engineEncore={version:'2.4.1',verified:true,compatible:true,recommended:true,capabilities:{nrPassPlacement:true,dlssCustomScaleMin:33}};
const engineMfgOld={...engineMfg,version:'1.7.0',recommended:false,capabilities:{diagnosticLogging:false}};
const engineEncoreOld={...engineEncore,version:'2.3.0',recommended:false,capabilities:{nrPassPlacement:false,dlssCustomScaleMin:50}};
const componentSelections = {};
const encoreConfigs = {};
const encoreTargets = {};
const encoreScenario = {hidePrimary:false,nativeFg:false};
const proxyTarget = id => ({dlss5DefaultsVersion:3,dlss5HookStage:2,dlss5ResolutionScale:id==='rtx40_laptop'?75:100,
  dlss5ResolutionScaleAuto:false,dlss5PassCount:1,dlss5UpsampleFilter:3,dlss5CharacterMask:false,dlss5UiCorrection:1,dlss5OverallIntensity:1});
const artFixture = (width,height) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#657b73"/></svg>`);
contextBridge.exposeInMainWorld('qa',{
 setComponentStatusFixture:value=>{componentStatusFixture=value;},
 holdNextUpdateCheck:()=>{updateCheckGate=new Promise(resolve=>{releaseUpdateCheck=resolve});},
 releaseUpdateCheck:()=>{releaseUpdateCheck?.();},
 setEngineCatalog:value=>{engineCatalog=value;},
 failNextLibraryRead:()=>{failLibraryOnce=true;},
 setRuntimeSample:value=>{runtimeSample=value;},
 setRuntimeCheckedAt:value=>{runtimeCheckedAt=value;},
 setGraphicsCatalog:value=>{graphicsCatalog=value;},
 setOverlayPreferences:async patch=>{overlayPrefs=await validateOverlay({...overlayPrefs,...patch});},
 readOverlayPreferences:()=>overlayPrefs,
 setOverlayBridge:patch=>Object.assign(overlayBridgeState,patch),
 setEncoreScenario:value=>Object.assign(encoreScenario,value),
 setEncoreSettings:patch=>Object.assign(encoreConfigs['D:\\QA\\New'] || {},patch),
 setComponentSelection:(dir,selection)=>{componentSelections[dir]=selection},
 bumpExternalFiles:()=>++externalRevision,
 setProxyState: state=>{proxyState=state},audit:()=>JSON.parse(JSON.stringify(audit)),releaseOverlayList:()=>releaseOverlayList(),emitJob:event=>{for(const fn of jobListeners)fn(event)},reset:()=>{downloaded=false;audit.prepared=0;audit.applied=0;audit.previewed=0;audit.requests=[]}});
contextBridge.exposeInMainWorld('lab',{
 addons:async()=>{audit.addonReads=(audit.addonReads||0)+1;return[{path:'D:\\QA\\fixture.addon64',file:'fixture.addon64',label:'Local add-on '+externalRevision,version:'1.0',active:false}]},
 history:async()=>{audit.historyReads=(audit.historyReads||0)+1;return{rows:[],warning:false}},
 settings:async()=>({folders:[],stateFile:'D:\\QA\\library.json',posterDir:'D:\\QA\\covers',closeToTray:false,autoScanDrives:false,safeGraphics:false,groupGamesByStore:false}),
 setTheme:async value=>value,
 setLang:async value=>{uiLanguage=value==='en'?'en':'zh';audit.language=uiLanguage;return uiLanguage},
 overlayPreferences:async()=>({ok:true,value:overlayPrefs}),
 saveOverlayPreferences:async patch=>{
   (audit.overlaySaves||=[]).push(patch);
   try{return{ok:true,value:overlayPrefs=await validateOverlay({...overlayPrefs,...patch})};}
   catch(error){return{ok:false,error:error.message};}
 },
 overlays:async()=>{
   audit.overlayReads=(audit.overlayReads||0)+1;
   await firstOverlayList;
   return {ok:true,value:{overlays:[{id:'builtin',name:'F8',builtin:true,ready:true,architecture:64}],installations:[],errors:[]}};
 },
 overlayBridge:async()=>({ok:true,value:overlayBridgeState}),
 libraryComponents:async dir=>{
   if(dir){audit.gameLibraryReads=(audit.gameLibraryReads||0)+1;return{ok:true,inventory:{ok:true,rows:[],lock:null},profile:{selected:componentSelections[dir]||{}},
     definitions:{'dlss-sr':{name:'DLSS 超分辨率'}},packages:[{id:'qa-sr',component:'dlss-sr',version:'3.7.10',present:true,compatibility:selectable}],runtimePacks:[]};}
   audit.libraryReads=(audit.libraryReads||0)+1;
   if(failLibraryOnce){failLibraryOnce=false;return{ok:false,code:'errJobBusy'};}
   if(componentStatusFixture)return{ok:true,...componentStatusFixture};
   const packages = audit.sfDownloaded ? [{id:'qa-model',component:'dlss-nr',version:'310.8.0.0',source:release.repo,
     present:true,compatibility:{ready:true,label:'可选择',reason:''}}] : [];
   packages.push({id:'qa-sr',component:'dlss-sr',version:'3.7.10',source:'example/sr-only',
     present:true,compatibility:{ready:true,label:'可选择',reason:''}});
   packages.push({id:'qa-overlay',component:'overlay',version:'zh 1.10',source:'NeuralFrame',present:true,compatibility:{kind:'internal',ready:false,label:'随软件维护',reason:''}});
   if(audit.pendingDownloaded)packages.push({id:'qa-mfg',component:'mfg-renodx',version:'1.9.0',source:'mavismmg/MFGAdaUnlock-RenoDx',present:true,compatibility:pending});
   if(engineCatalog)packages.push(...[
     {id:'qa-engine-mfg-170',component:'mfg-universal',engine:engineMfgOld},
     {id:'qa-engine-encore-230',component:'encore',engine:engineEncoreOld},
   ].map(item=>({...item,version:item.engine.version,source:'upstream/original',present:true,compatibility:routeManaged})));
   return{ok:true,definitions:{'dlss-nr':{name:'DLSS 神经渲染模型',files:['nvngx_dlssnr.dll']},'dlss-sr':{name:'DLSS 超分辨率',files:['nvngx_dlss.dll']},
     'renodx-nr':{name:'RenoDX 神经渲染插件'},'renodx-multipass':{name:'RenoDX 多通道插件'},'mfg-renodx':{name:'MFG 解锁插件 · RenoDX'},feeder:{name:'Feeder 配套组件'},overlay:{name:'F8 紧凑叠加层',internal:true}},packages,
     runtimePacks:[{id:'sr-baseline',component:'dlss-sr',name:'DLSS 超分辨率',version:'3.7.10',size:2048,downloaded:true,packageIds:['qa-sr'],compatibility:selectable},
       ...['renodx-nr','renodx-multipass'].map(id=>({id,component:id,version:'1.0',downloaded:false,compatibility:selectable})),
       ...(engineCatalog ? [{id:'mfg-universal',component:'mfg-universal',version:'1.7.1',downloaded:true,engine:engineMfg,compatibility:routeManaged},
         {id:'encore',component:'encore',version:'2.4.1',downloaded:true,engine:engineEncore,compatibility:routeManaged}] : [])],
     root:'QA',warnings:[],updates:libraryUpdates()};
 },
 libraryCheck:async()=>{audit.updateChecks=(audit.updateChecks||0)+1;if(updateCheckGate){await updateCheckGate;updateCheckGate=null;}checkedAt=new Date().toISOString();return{ok:true,...(componentStatusFixture?.updates || libraryUpdates())}},
 libraryApply:async(dir,token,selection)=>{
   (audit.componentRequests||=[]).push({dir,token,selection});
   if(!token)return{ok:true,preview:{token:'component-plan',dir,kind:'component-update',rows:[],conflicts:[]}};
   if(token!=='component-plan')throw Error('wrong component token');
   componentSelections[dir]={...selection};return{ok:true};
 },
 libraryDownload:async id=>{
   audit.libraryDownload=id;
   if(id==='sr-test'){
     audit.srDownloadAttempts=(audit.srDownloadAttempts||0)+1;
     if(audit.srDownloadAttempts>1) notifyLibraryProgress({stage:'download',loaded:1024,total:2048,name:'QA SR'});
     await new Promise(resolve=>{cancelLibraryTransfer=resolve});
     return {ok:false,cancelled:true};
   }
   if(id===release.id) audit.sfDownloaded=true;
   else if(id==='mfg-test') audit.pendingDownloaded=true;
   else if(id==='rankftw-nr-310.8.SF-v2') audit.rankSfDownloaded=true;
   else if(id==='rankftw-nr-310.9.16') {
     audit.rankAttempts=(audit.rankAttempts||0)+1;
     if(audit.rankAttempts===1) return {ok:false,message:'Fixture download interrupted'};
     audit.rankDownloaded=true;
   } else throw Error('Unexpected download ID: '+id);
   return{ok:true};
 },
 onLibraryProgress:fn=>{notifyLibraryProgress=fn;return()=>{notifyLibraryProgress=()=>{}}},
 libraryCancel:async()=>{audit.cancelledDownload=audit.libraryDownload;cancelLibraryTransfer?.();cancelLibraryTransfer=undefined},
 libraryImport:async component=>{audit.importComponent=component;return {ok:false,cancelled:true}},
 enhancedImportModel:async (_file,meta)=>{
   audit.imports=(audit.imports||[]).concat(meta?.expectedModelId||'any');
   if (meta?.expectedModelId !== '310.8.Lecram') return {ok:false,cancelled:true};
   audit.lecramImported=true;
   return {ok:true,model:{id:meta.expectedModelId,compatibility:{status:'incompatible'}}};
 },
 checkUpdate:async()=>({current:'0.1.0',latest:null,newer:false}),
 recents:async()=>{audit.recentsReads=(audit.recentsReads||0)+1;return[]},onJob:fn=>{jobListeners.add(fn);return()=>jobListeners.delete(fn)},scan:async()=>{audit.scans=(audit.scans||0)+1;return{ok:true,api:'DirectX 12'}},
 boot:async()=>({version:'0.1.0',theme:'dark',lang:uiLanguage}),library:async()=>{audit.gameLists=(audit.gameLists||0)+1;return[{key:'qa',name:'Workflow test',dir:'D:\\QA\\Game',launcher:'Test fixture',
   poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)},
   {key:'qa-wuwa',name:'Wuthering Waves',dir:wuwaDir,launcher:'Test fixture',poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)},
   {key:'qa-new',name:'Unconfigured game',dir:'D:\\QA\\New',launcher:'Test fixture',poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)}]},
 artFetch:async()=>({}),details:async(dir,priority)=>{
   audit.detailReads++;audit.detailPriorities.push(priority||null);
   const primary=dir+'\\game.exe',exePath=encoreTargets[dir]||primary;
   const exes=[{path:primary,rel:'game.exe',api:'dxgi',apiLabel:'DirectX 12',bitness:64,size:4096,hasNativeDlss:true,hasNativeFg:dir!=='D:\\QA\\New'||encoreScenario.nativeFg}];
   if(dir==='D:\\QA\\New') {
     exes.push({path:dir+'\\Alt\\game.exe',rel:'Alt\\game.exe',api:'dxgi',apiLabel:'DirectX 11',bitness:64,size:4096,hasNativeDlss:false,hasNativeFg:false});
     exes.push({path:dir+'\\Legacy.exe',rel:'Legacy.exe',api:'d3d9',apiLabel:'DirectX 9',bitness:32,size:4096,hasNativeDlss:false,hasNativeFg:false});
     if(encoreScenario.hidePrimary)exes.shift();
   }
   return{ok:true,exePath,api:'DirectX 12',launcherProtected:dir===wuwaDir,
     files:[{name:'nvngx_dlss.dll',rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
       {name:'nvngx_dlssg.dll',rel:'Engine\\Plugins\\StreamlineCore\\Binaries\\ThirdParty\\Win64\\nvngx_dlssg.dll',version:'310.6.0.0'}],
     currentDlss:{rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
     newDlss:'310.9.1.0',recommendedRoute:'native',installedRoute:encoreConfigs[dir]?'encore':audit.installedRoute,
     installedExe:encoreTargets[dir]?.slice(dir.length+1),exes};
 },
 install:async(dir,exe,route,api,token)=>{
   (audit.installRequests||=[]).push({dir,exe,route,api,token});
   if(!token)return{ok:true,preview:{token:'route-plan',dir,kind:'install',rows:[{rel:'route.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}};
   if(token!=='route-plan')throw Error('wrong installation token');
   audit.installedRoute=route;return{ok:true};
 },
 enhancedHardware:async force=>{
   if(force) audit.forcedHardware=(audit.forcedHardware||0)+1;
   return {ok:true,hardwareProfile:'rtx40_laptop',hardwareProfileSource:'detected',hardwareProfiles:profiles,
     hardware:{gpu:{name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}},display:{resolution:'2560x1600',refreshRateHz:audit.forcedHardware?165:60}}};
 },
 enhancedStatus:async(dir,override,priority)=>{
   audit.statusReads++;audit.profileQueries.push(override||null);audit.statusPriorities.push(priority||null);
   const nativeRuntimeStack=dir===wuwaDir ? {indexAvailable:true,sr:{rel:'nvngx_dlss.dll',version:'310.5.0.0'},fg:{rel:'nvngx_dlssg.dll',version:'310.6.0.0'},streamline:{rel:'sl.interposer.dll',version:'2.8.0.0'}} : undefined;
   return {ok:true,exePath:encoreTargets[dir]||dir+'\\game.exe',launcherProtected:dir===wuwaDir,nativeRuntimeStack,
     encore:encoreConfigs[dir]?{exePath:encoreTargets[dir],installed:true,filesPresent:true,hasNativeDlss:true,version:engineCatalog?'2.4.1':'2.3.0',engine:engineCatalog?engineEncore:engineEncoreOld,settings:encoreConfigs[dir]}:undefined,
     standaloneProfile:dir===wuwaDir?{target:proxyTarget(override||'rtx40_laptop'),saved:{...proxyTarget('rtx40_laptop'),dlss5:true},adapterVersion:1}:null,
     hardware:{gpu:{name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}}},neural:{mode:'off',availableModels:catalogModels()},mfg:{currentConfig:{mode:'off'},
       ...(engineCatalog && dir===wuwaDir ? {engine:engineMfgOld,advanced:{model:1,structure:0.7,tone:0.8,character:1,characterMask:false}} : {})},
     diagnostics:{gameName:'Workflow test',hardwareProfileLabel:'RTX 40 笔记本',graphicsApi:'DirectX 12',neuralStatus:'尚未测试',mfgStatus:'实验性支持',combinedBadge:'尚未测试',
       coExecution:{dlssCompat:{summary:'游戏保留启动器校验的 DLSS 文件。神经渲染与补帧使用主程序旁的 version.dll。'}}},
     hardwareProfile:override||'rtx40_laptop',hardwareProfileSource:override?'selected':dir==='D:\\QA\\New'?'detected':'manifest',hardwareProfiles:profiles,
     ...(graphicsCatalog?{hardwareProfileInfo:graphicsCatalog.profiles[override||'rtx40_laptop'],hardwareProfiles:graphicsCatalog.profiles,
       neural:{mode:'off',availableModels:graphicsCatalog.models,runtimeStacks:graphicsCatalog.stacks},
       mfg:{currentConfig:{mode:'off'},gpuSupport:{nativeX2:true,nativeX3X4:false,unlockRequiredForX3X4:true}}}:{})};
 },
 componentRuntime:async dir=>{
   audit.runtimeReads++;
   if(dir===wuwaDir){
     if(proxyState==='error')throw Error('Fixture runtime query failed');
     if(proxyState==='stopped')return{ok:true,checkedAt:Date.now(),processState:'stopped',nr:{state:'stopped',label:'游戏未运行',detail:''},mfg:{state:'stopped',label:'游戏未运行',detail:''}};
     const settings={...proxyTarget('rtx40_laptop'),dlss5ResolutionScale:proxyState==='changed'?100:75};
     return{ok:true,checkedAt:Date.now(),processState:'running',nr:{state:proxyState==='pending'?'pending':'active',label:proxyState==='pending'?'参数等待应用':'正在执行神经渲染',detail:'当前执行计数持续增长',at:Date.now()},
       mfg:{state:'active',label:'帧生成生效 · 提供程序 3 帧',detail:'已应用动态补帧；提供程序呈现 3 帧。',at:Date.now(),requestedMode:'dynamic',appliedMode:'dynamic',dynamicSupported:true},
       standalone:{at:Date.now(),enabled:true,pending:proxyState==='pending',settings,evaluations:500,failures:0,actual:proxyState==='pending'?null:{stage:2,scale:settings.dlss5ResolutionScale,passes:1,width:2560,height:1600,extentWidth:1920,extentHeight:1200,gpuMs:12.5},
         stack:{fg:'310.9.16.0',streamline:'2.14.16.0',ota:true}}};
   }
   return{ok:true,checkedAt:runtimeCheckedAt??Date.now(),processState:'running',nr:{state:'unloaded',label:'尚未加载',detail:'QA fixture',at:Date.now()},mfg:{state:'active',label:'已生效',detail:'QA fixture',at:Date.now(),...runtimeSample}};
 },
 componentInventory:async()=>({ok:true,rows:[],lock:null}),
 restoreStatus:async()=>({canRestore:false}),
 enhancedApply:async(_dir,patch,token)=>{audit.requests.push({patch,token:token||null});if(!downloaded)return{ok:false,dependencies:['runtime:test'],downloads:[{name:'QA component',size:1024}]};if(!token){audit.previewed++;return{ok:true,preview:{token:'confirmed-plan',dir:_dir,kind:'enhanced',rows:[{rel:'QA.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}}}if(token!=='confirmed-plan')throw Error('wrong preview token');audit.applied++;if(patch.route==='encore'){encoreConfigs[_dir]={...patch.encore,neuralMode:patch.neuralMode,neuralModelId:patch.neuralModelId,mfgMode:patch.mfgMode};encoreTargets[_dir]=patch.exePath;}return{ok:true}},
 componentPrepare:async()=>{audit.prepared++;subscriber({name:'QA component',stage:'ready'});downloaded=true;return{ok:true}},componentCancelPrepare:async()=>{},onComponentProgress:fn=>{subscriber=fn;return()=>{subscriber=()=>{}}},
 window:async()=>{}
});
