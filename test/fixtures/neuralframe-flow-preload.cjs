const {contextBridge}=require('electron');
const audit={prepared:0,applied:0,previewed:0,requests:[],profileQueries:[],detailReads:0,statusReads:0,runtimeReads:0,detailPriorities:[],statusPriorities:[]};let downloaded=false,subscriber=()=>{};
const profiles=Object.fromEntries(['rtx40_laptop','rtx40_desktop'].map(id=>[id,{
  id, sm:89, targetResolution:'1920x1080', nrResolutionScale:0.75, nrMaxWorksets:4, nrPasses:1, nrHookPoint:0
}]));
const release = {id:'smartergamers-qa',provider:'smartergamers-nr',component:'dlss-nr',repo:'SmarterGamers/SmarterGamers-DLSS5-Swapper',
  tag:'v2.3.0',catalogModelId:'310.8.SF-v2',name:'nvngx_dlssnr.dll',size:165840496,downloadable:true};
let checkedAt = null;
const libraryUpdates = () => ({checkedAt,errors:[],candidates:checkedAt
  ? [{...release,cachedPackageId:audit.sfDownloaded ? 'qa-model' : undefined},
     {id:'rankftw-sf-qa',component:'dlss-nr',provider:'rhi-nr',repo:'RankFTW/rhi-repo',tag:'dlssnr-310.8.SF-v2',name:'nvngx_dlssnr_310.8.SF-v2.zip',size:116693212,downloadable:true},
     {id:'sr-test',component:'dlss-sr',repo:'example/sr-only',tag:'v3.7.20',size:2048,downloadable:true}] : []});
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
let notifyLibraryProgress=()=>{}, cancelLibraryTransfer;
let overlayPrefs={theme:'green',enabled:true,custom:null,hotkey:{key:119,mods:0}};
let releaseOverlayList;
const firstOverlayList=new Promise(resolve=>{releaseOverlayList=resolve});
const wuwaDir='D:\\QA\\Wuthering Waves';
let proxyState = 'active';
const proxyTarget = id => ({dlss5DefaultsVersion:3,dlss5HookStage:2,dlss5ResolutionScale:id==='rtx40_laptop'?75:100,
  dlss5ResolutionScaleAuto:false,dlss5PassCount:1,dlss5UpsampleFilter:3,dlss5CharacterMask:false,dlss5UiCorrection:1,dlss5OverallIntensity:1});
const artFixture = (width,height) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#657b73"/></svg>`);
contextBridge.exposeInMainWorld('qa',{setProxyState: state=>{proxyState=state},audit:()=>JSON.parse(JSON.stringify(audit)),releaseOverlayList:()=>releaseOverlayList(),emitJob:event=>{for(const fn of jobListeners)fn(event)},reset:()=>{downloaded=false;audit.prepared=0;audit.applied=0;audit.previewed=0;audit.requests=[]}});
contextBridge.exposeInMainWorld('lab',{
 overlayPreferences:async()=>({ok:true,value:overlayPrefs}),
 saveOverlayPreferences:async patch=>({ok:true,value:overlayPrefs={...overlayPrefs,...patch}}),
 overlays:async()=>{
   audit.overlayReads=(audit.overlayReads||0)+1;
   await firstOverlayList;
   return {ok:true,value:{overlays:[{id:'builtin',name:'F8',builtin:true,ready:true,architecture:64}],installations:[],errors:[]}};
 },
 overlayBridge:async()=>({ok:true,value:{listening:true,connected:false,addon:true,game:false}}),
 libraryComponents:async dir=>{
   if(dir)return{ok:true,inventory:{ok:true,rows:[],lock:null},definitions:{},packages:[],runtimePacks:[]};
   audit.libraryReads=(audit.libraryReads||0)+1;
   if(audit.libraryReads===1)return{ok:false,code:'errJobBusy'};
   const packages = audit.sfDownloaded ? [{id:'qa-model',component:'dlss-nr',version:'310.8.0.0',source:release.repo,
     present:true,compatibility:{ready:true,label:'可选择',reason:''}}] : [];
   packages.push({id:'qa-sr',component:'dlss-sr',version:'3.7.10',source:'example/sr-only',
     present:true,compatibility:{ready:true,label:'可选择',reason:''}});
   return{ok:true,definitions:{'dlss-nr':{name:'DLSS 神经渲染模型',files:['nvngx_dlssnr.dll']},'dlss-sr':{name:'DLSS 超分辨率',files:['nvngx_dlss.dll']}},packages,runtimePacks:[],root:'QA',warnings:[],updates:libraryUpdates()};
 },
 libraryCheck:async()=>{checkedAt=new Date().toISOString();return{ok:true,...libraryUpdates()}},
 libraryDownload:async id=>{
   audit.libraryDownload=id;
   if(id==='sr-test'){
     notifyLibraryProgress({stage:'download',loaded:1024,total:2048,name:'QA SR'});
     await new Promise(resolve=>{cancelLibraryTransfer=resolve});
     return {ok:false,cancelled:true};
   }
   if(id===release.id) audit.sfDownloaded=true;
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
 recents:async()=>[],onJob:fn=>{jobListeners.add(fn);return()=>jobListeners.delete(fn)},scan:async()=>({ok:true,api:'DirectX 12'}),
 boot:async()=>({version:'0.1.0',theme:'dark'}),library:async()=>[{key:'qa',name:'Workflow test',dir:'D:\\QA\\Game',launcher:'Test fixture',
   poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)},
   {key:'qa-wuwa',name:'Wuthering Waves',dir:wuwaDir,launcher:'Test fixture',poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)}],
 artFetch:async()=>({}),details:async(dir,priority)=>{
   audit.detailReads++;audit.detailPriorities.push(priority||null);
   const exePath=dir+'\\game.exe';
   return{ok:true,exePath,api:'DirectX 12',launcherProtected:dir===wuwaDir,
     files:[{name:'nvngx_dlss.dll',rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
       {name:'nvngx_dlssg.dll',rel:'Engine\\Plugins\\StreamlineCore\\Binaries\\ThirdParty\\Win64\\nvngx_dlssg.dll',version:'310.6.0.0'}],
     currentDlss:{rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
     newDlss:'310.9.1.0',recommendedRoute:'native',installedRoute:audit.installedRoute,
     exes:[{path:exePath,rel:'game.exe',api:'dxgi',apiLabel:'DirectX 12',bitness:64,size:4096,hasNativeDlss:true}]};
 },
 install:async(dir,exe,route,api,token)=>{
   (audit.installRequests||=[]).push({dir,exe,route,api,token});
   if(!token)return{ok:true,preview:{token:'route-plan',dir,kind:'install',rows:[{rel:'route.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}};
   if(token!=='route-plan')throw Error('wrong installation token');
   audit.installedRoute=route;return{ok:true};
 },
 enhancedHardware:async force=>{
   if(force) audit.forcedHardware=(audit.forcedHardware||0)+1;
   return {ok:true,hardwareProfile:'rtx40_desktop',hardwareProfileSource:'default',hardwareProfiles:profiles};
 },
 enhancedStatus:async(dir,override,priority)=>{
   audit.statusReads++;audit.profileQueries.push(override||null);audit.statusPriorities.push(priority||null);
   const nativeRuntimeStack=dir===wuwaDir ? {indexAvailable:true,sr:{rel:'nvngx_dlss.dll',version:'310.5.0.0'},fg:{rel:'nvngx_dlssg.dll',version:'310.6.0.0'},streamline:{rel:'sl.interposer.dll',version:'2.8.0.0'}} : undefined;
   return {ok:true,launcherProtected:dir===wuwaDir,nativeRuntimeStack,
     standaloneProfile:dir===wuwaDir?{target:proxyTarget(override||'rtx40_laptop'),saved:{...proxyTarget('rtx40_laptop'),dlss5:true},adapterVersion:1}:null,
     hardware:{gpu:{name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}}},neural:{mode:'off',availableModels:catalogModels()},mfg:{currentConfig:{mode:'off'}},
     diagnostics:{gameName:'Workflow test',hardwareProfileLabel:'RTX 40 笔记本',graphicsApi:'DirectX 12',neuralStatus:'尚未测试',mfgStatus:'实验性支持',combinedBadge:'尚未测试',
       coExecution:{dlssCompat:{summary:'游戏保留启动器校验的 DLSS 文件。神经渲染与补帧使用主程序旁的 version.dll。'}}},
     hardwareProfile:override||'rtx40_laptop',hardwareProfileSource:override?'selected':'manifest',hardwareProfiles:profiles};
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
   return{ok:true,checkedAt:Date.now(),processState:'running',nr:{state:'unloaded',label:'尚未加载',detail:'QA fixture',at:Date.now()},mfg:{state:'active',label:'已生效',detail:'QA fixture',at:Date.now()}};
 },
 componentInventory:async()=>({ok:true,rows:[],lock:null}),
 restoreStatus:async()=>({canRestore:false}),
 enhancedApply:async(_dir,patch,token)=>{audit.requests.push({patch,token:token||null});if(!downloaded)return{ok:false,dependencies:['runtime:test'],downloads:[{name:'QA component',size:1024}]};if(!token){audit.previewed++;return{ok:true,preview:{token:'confirmed-plan',dir:'D:\\QA\\Game',kind:'enhanced',rows:[{rel:'QA.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}}}if(token!=='confirmed-plan')throw Error('wrong preview token');audit.applied++;return{ok:true}},
 componentPrepare:async()=>{audit.prepared++;subscriber({name:'QA component',stage:'ready'});downloaded=true;return{ok:true}},componentCancelPrepare:async()=>{},onComponentProgress:fn=>{subscriber=fn;return()=>{subscriber=()=>{}}},
 window:async()=>{}
});
