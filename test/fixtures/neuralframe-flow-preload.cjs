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
let inventoryRows=[];
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
let recentRows=[],libraryGamesOverride=null;
let notifyLibraryProgress=()=>{}, cancelLibraryTransfer;
let overlayPrefs={theme:'green',enabled:true,custom:null,hotkey:{key:119,mods:0}};
let overlayBridgeState={listening:true,connected:false,addon:true,game:false};
let releaseOverlayList;
const firstOverlayList=new Promise(resolve=>{releaseOverlayList=resolve});
const wuwaDir='D:\\QA\\Wuthering Waves';
let proxyState = 'active';
let runtimeSample={}, runtimeCheckedAt, runtimeExe, receiptExe, graphicsCatalog=null;
let engineCatalog=false, failLibraryOnce=false, componentStatusFixture=null;
let pendingDownloads=[{name:'QA component',size:1024}];
let updateCheckGate=null, releaseUpdateCheck;
const downloadGates=new Map();
const cancelledDownloads=new Set();
const engineMfg={version:'1.7.1',verified:true,compatible:true,recommended:true,capabilities:{diagnosticLogging:true}};
const engineEncore={version:'2.5.0',verified:true,compatible:true,recommended:true,capabilities:{nrPassPlacement:true,dlssCustomScaleMin:33,spatialUpscaling:true}};
const engineMfgOld={...engineMfg,version:'1.7.0',recommended:false,capabilities:{diagnosticLogging:false}};
const engineEncoreOld={...engineEncore,version:'2.3.0',recommended:false,capabilities:{nrPassPlacement:false,dlssCustomScaleMin:50}};
const componentSelections = {};
const encoreConfigs = {};
const graphicsConfigs = {};
const graphicsEvidence = {};
let presetToImport;
let releaseDiscovery,releaseBatch,releaseLibrary;
const libraryGate=process.env.NEURALFRAME_QA_PAUSE_LIBRARY ? new Promise(resolve=>{releaseLibrary=resolve;}) : null;
const discoveryGate=process.env.NEURALFRAME_QA_PAUSE_SCANS ? new Promise(resolve=>{releaseDiscovery=resolve;}) : null;
const batchGate=(process.env.NEURALFRAME_QA_PAUSE_SCANS||process.env.NEURALFRAME_QA_PAUSE_BATCH) ? new Promise(resolve=>{releaseBatch=resolve;}) : null;
// ---- read-only batch scan task fixture ----
let batchTask=null;const batchListeners=new Set(),batchManual=process.env.NEURALFRAME_QA_BATCH_MANUAL==='1';
const batchNames=['Workflow test','Unconfigured game','Legacy game','Broken game','Scan fault'];
const batchName=index=>batchNames[index]||('Game '+(index+1));
const batchCopy=value=>value==null?null:JSON.parse(JSON.stringify(value));
function batchRow(index){
 const status=index===0?'supported':index===4?'error':index===3?'unsupported':'verify';
 const routes=[2,3,4].includes(index)?[]:[index===1?'feeder':'native'];
 return{name:batchName(index),exe:'game.exe',candidateCount:index===1?2:1,status,api:'DirectX 12',bitness:64,
  nativeDlss:index!==2,nativeFg:false,nativeDlssFg:false,antiCheat:index===1,routes,recommendedRoute:routes[0]||'',
  driverHint:index===2?'afmf-fullscreen':null,message:index===4?'扫描失败，请在游戏详情中重新检测。':''};
}
function batchReport(status){return{schema:'neuralframe-compatibility-report',version:1,generatedAt:new Date().toISOString(),readOnly:true,
 complete:status==='done',total:batchTask.total,...(status==='done'?{}:{scanStatus:status}),rows:batchCopy(batchTask.rows)};}
function batchEmit(payload){for(const listener of batchListeners){try{listener(batchCopy(payload))}catch{}}}
function batchFinalize(status){
 batchTask.status=status;batchTask.currentGame=null;batchTask.finishedAt=new Date().toISOString();batchTask.report=batchReport(status);
 batchEmit({taskId:batchTask.id,status,task:batchCopy(batchTask)});
}
function batchReadNext(){
 const index=batchTask.rows.length;
 batchTask.currentGame=batchName(index);
 batchEmit({taskId:batchTask.id,status:'running',total:batchTask.total,index,currentGame:batchTask.currentGame});
}
function batchPushRow(){
 if(!batchTask||batchTask.status!=='running')return false;
 const index=batchTask.rows.length;
 if(index>=batchTask.total){batchFinalize('done');return false;}
 const row=batchRow(index);batchTask.rows.push(row);batchTask.currentGame=null;
 audit.batchProgress=(audit.batchProgress||[]).concat({index:index+1,row:batchCopy(row)});
 batchEmit({taskId:batchTask.id,status:'running',total:batchTask.total,index:index+1,currentGame:null,row:batchCopy(row)});
 if(batchTask.rows.length>=batchTask.total)batchFinalize('done');
 else batchReadNext();
 return true;
}
async function batchRun(){
 await batchGate;
 if(batchManual)return;
 for(;;){await new Promise(resolve=>setTimeout(resolve,40));if(!batchTask||batchTask.status!=='running')return;if(!batchPushRow())return;}
}
const apiOverrides = new Map();
const monitorModes = new Map();
const encoreTargets = {};
const encoreScenario = {hidePrimary:false,nativeFg:false};
const proxyTarget = id => ({dlss5DefaultsVersion:3,dlss5HookStage:2,dlss5ResolutionScale:id==='rtx40_laptop'?75:100,
  dlss5ResolutionScaleAuto:false,dlss5PassCount:1,dlss5UpsampleFilter:3,dlss5CharacterMask:false,dlss5UiCorrection:1,dlss5OverallIntensity:1});
const artFixture = (width,height) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#657b73"/></svg>`);
contextBridge.exposeInMainWorld('qa',{
 setPresetImport:value=>{presetToImport=value;},
 setRecents:value=>{recentRows=value;},setLibraryGames:value=>{libraryGamesOverride=value;},
 finishDiscovery:()=>releaseDiscovery?.(), finishBatch:()=>releaseBatch?.(),finishLibrary:()=>releaseLibrary?.(),emitBatchRow:()=>batchPushRow(),batchTask:()=>batchCopy(batchTask),
 setComponentStatusFixture:value=>{componentStatusFixture=value;},
 setPendingDownloads:value=>{pendingDownloads=value;},
 holdNextUpdateCheck:()=>{updateCheckGate=new Promise(resolve=>{releaseUpdateCheck=resolve});},
 releaseUpdateCheck:()=>{releaseUpdateCheck?.();},
 holdLibraryDownload:id=>{let resolve;const pending=new Promise(r=>resolve=r);downloadGates.set(id,{pending,resolve});},
 emitLibraryProgress:event=>notifyLibraryProgress(event),
 releaseLibraryDownload:id=>{const gate=downloadGates.get(id);gate?.resolve?.();downloadGates.delete(id);},
 setEngineCatalog:value=>{engineCatalog=value;},
 failNextLibraryRead:()=>{failLibraryOnce=true;},
 setRuntimeSample:value=>{runtimeSample=value;},
 setRuntimeExe:value=>{runtimeExe=value;},
 setReceiptExe:value=>{receiptExe=value;},
 setRuntimeCheckedAt:value=>{runtimeCheckedAt=value;},
 setGraphicsCatalog:value=>{graphicsCatalog=value;},
 setGraphicsEvidence:(dir,value)=>{graphicsEvidence[dir]=value;},
 setGraphicsOnDisk:(dir,patch)=>Object.assign(graphicsConfigs[dir] || {},patch),
 setOverlayPreferences:async patch=>{overlayPrefs=await validateOverlay({...overlayPrefs,...patch});},
 readOverlayPreferences:()=>overlayPrefs,
 setOverlayBridge:patch=>Object.assign(overlayBridgeState,patch),
 setEncoreScenario:value=>Object.assign(encoreScenario,value),
 setEncoreSettings:patch=>Object.assign(encoreConfigs['D:\\QA\\New'] || {},patch),
 setComponentSelection:(dir,selection)=>{componentSelections[dir]=selection},
 setInventoryRows:rows=>{inventoryRows=rows;},
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
 saveMonitorAddon:async bits=>({ok:[32,64].includes(bits)}),
 overlayBridge:async()=>({ok:true,value:overlayBridgeState}),
 openComponentFolder:async (dir,rel,scope)=>{audit.openedComponentFolder={dir,rel,scope};return {ok:true};},
 libraryComponents:async dir=>{
   if(dir){audit.gameLibraryReads=(audit.gameLibraryReads||0)+1;return{ok:true,inventory:{ok:true,rows:inventoryRows,lock:null},profile:{selected:componentSelections[dir]||{}},
     definitions:{'dlss-sr':{name:'DLSS 超分辨率'}},packages:[{id:'qa-sr',component:'dlss-sr',version:'3.7.10',present:true,compatibility:selectable,
       files:[{rel:'nvngx_dlss.dll',version:'3.7.10.0',bitness:64,sha256:'a'.repeat(64)}]}],runtimePacks:[]};}
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
         {id:'encore',component:'encore',version:engineEncore.version,downloaded:true,engine:engineEncore,compatibility:routeManaged}] : [])],
     root:'QA',warnings:[],updates:libraryUpdates()};
 },
 libraryCheck:async()=>{audit.updateChecks=(audit.updateChecks||0)+1;if(updateCheckGate){await updateCheckGate;updateCheckGate=null;}checkedAt=new Date().toISOString();return{ok:true,...(componentStatusFixture?.updates || libraryUpdates())}},
 libraryApply:async(dir,token,selection)=>{
   (audit.componentRequests||=[]).push({dir,token,selection});
   if(!token)return{ok:true,preview:{token:'component-plan',dir,kind:'component-update',rows:[],conflicts:[]}};
   if(token!=='component-plan')throw Error('wrong component token');
   componentSelections[dir]={...selection};return{ok:true};
 },
 libraryDownload:async(id,options)=>{
   audit.libraryDownload=id;audit.downloadOptions=options;(audit.downloadSequence||=[]).push(id);
   const gate=downloadGates.get(id);
   if(gate?.pending) await gate.pending;
   if(cancelledDownloads.delete(id))return {ok:false,cancelled:true};
   if(id==='sr-test'){
     audit.srDownloadAttempts=(audit.srDownloadAttempts||0)+1;
     if(audit.srDownloadAttempts>1) notifyLibraryProgress({stage:'download',loaded:1024,total:2048,name:'QA SR'});
     await new Promise(resolve=>{cancelLibraryTransfer=resolve});
     return {ok:false,cancelled:true};
   }
   if(id===release.id) audit.sfDownloaded=true;
   else if(id==='mfg-test') audit.pendingDownloaded=true;
   else if(id==='mfg-second') audit.secondDownloaded=true;
   else if(id==='mfg-third') audit.thirdDownloaded=true;
   else if(id==='rankftw-nr-310.8.SF-v2') audit.rankSfDownloaded=true;
   else if(id==='rankftw-nr-310.9.16') {
     audit.rankAttempts=(audit.rankAttempts||0)+1;
     if(audit.rankAttempts===1) return {ok:false,message:'Fixture download interrupted'};
     audit.rankDownloaded=true;
   } else throw Error('Unexpected download ID: '+id);
   return{ok:true};
 },
 onLibraryProgress:fn=>{notifyLibraryProgress=fn;return()=>{notifyLibraryProgress=()=>{}}},
 libraryCancel:async options=>{audit.cancelledDownload=audit.libraryDownload;audit.cancelOptions=options;const gate=downloadGates.get(audit.libraryDownload);if(gate)cancelledDownloads.add(audit.libraryDownload);cancelLibraryTransfer?.();cancelLibraryTransfer=undefined;gate?.resolve?.();downloadGates.delete(audit.libraryDownload);releaseUpdateCheck?.()},
 libraryImport:async component=>{audit.importComponent=component;return {ok:false,cancelled:true}},
 libraryCleanCache:async options=>{audit.cacheCleaned=true;audit.cacheCleanOptions=options;return{ok:true,removedPackages:0,removedBytes:0}},
 presetExport:async preset=>{audit.presetExported=preset;return{ok:true,file:'D:\\QA\\preset.json'};},
 presetImport:async()=>presetToImport?{ok:true,preset:presetToImport}:{ok:false,cancelled:true},
 gamesBatchScan:async dirs=>{
   audit.batchScanned=dirs;audit.batchCalls=(audit.batchCalls||0)+1;
   if(batchTask&&batchTask.status==='running')batchFinalize('stopped');
   batchTask={id:'qa-batch-'+audit.batchCalls,status:'running',total:dirs.length,startedAt:new Date().toISOString(),finishedAt:null,currentGame:null,rows:[],report:null};
   audit.batchTaskId=batchTask.id;const started=batchCopy(batchTask);
   if(dirs.length){batchReadNext();setTimeout(()=>{void batchRun();},0);}
   else batchFinalize('done');
   return{ok:true,task:started};
 },
 gamesBatchScanState:async()=>({ok:true,task:batchCopy(batchTask)}),
 gamesBatchScanStop:async taskId=>{
   audit.batchStopCalls=(audit.batchStopCalls||0)+1;
   if(!batchTask||batchTask.id!==taskId||batchTask.status!=='running')return{ok:false,message:'扫描任务已结束或已更换'};
   batchTask.stopRequested=true;batchFinalize('stopped');return{ok:true,stopping:true};
 },
 onBatchScanProgress:fn=>{batchListeners.add(fn);return()=>batchListeners.delete(fn);},
 gamesExportScan:async(report,format)=>{audit.scanExported={report,format};return{ok:true,file:'D:\\QA\\report.'+format};},
 onUpdateProgress:()=>()=>{},downloadUpdate:async()=>({ok:false,message:'not available'}),applyUpdate:async()=>({ok:false}),rollbackUpdate:async()=>({ok:false}),
 enhancedImportModel:async (_file,meta)=>{
   audit.imports=(audit.imports||[]).concat(meta?.expectedModelId||'any');
   if (meta?.expectedModelId !== '310.8.Lecram') return {ok:false,cancelled:true};
   audit.lecramImported=true;
   return {ok:true,model:{id:meta.expectedModelId,compatibility:{status:'incompatible'}}};
 },
 checkUpdate:async()=>({current:'0.1.0',latest:null,newer:false}),
 recents:async()=>{audit.recentsReads=(audit.recentsReads||0)+1;return recentRows},onJob:fn=>{jobListeners.add(fn);return()=>jobListeners.delete(fn)},scan:async()=>{audit.scans=(audit.scans||0)+1;await discoveryGate;return{ok:true,api:'DirectX 12'}},
 boot:async()=>({version:'0.1.0',theme:'dark',lang:uiLanguage}),library:async()=>{audit.gameLists=(audit.gameLists||0)+1;if(libraryGate){await libraryGate;}if(libraryGamesOverride)return libraryGamesOverride;return[{key:'qa',name:'Workflow test',dir:'D:\\QA\\Game',launcher:'Test fixture',
   poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)},
   {key:'qa-wuwa',name:'Wuthering Waves',dir:wuwaDir,launcher:'Test fixture',poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)},
   {key:'qa-new',name:'Unconfigured game',dir:'D:\\QA\\New',launcher:'Test fixture',poster:{url:artFixture(60,90),tall:true},tile:artFixture(160,90)}]},
 openProject:async key=>{audit.projectLink=key;return true;},
 artFetch:async()=>({}),details:async(dir,priority)=>{
   audit.detailReads++;audit.detailPriorities.push(priority||null);
   const primary=dir+'\\game.exe',exePath=encoreTargets[dir]||primary;
   const exes=[{path:primary,rel:'game.exe',api:'dxgi',apiLabel:'DirectX 12',bitness:64,size:4096,hasNativeDlss:true,hasNativeDlssFg:dir!=='D:\\QA\\New'||encoreScenario.nativeFg,hasNativeFg:dir!=='D:\\QA\\New'||encoreScenario.nativeFg}];
   if(dir==='D:\\QA\\New') {
     exes.push({path:dir+'\\Alt\\game.exe',rel:'Alt\\game.exe',api:'dxgi',apiLabel:'DirectX 11',bitness:64,size:4096,hasNativeDlss:false,hasNativeFg:false});
     exes.push({path:dir+'\\Legacy.exe',rel:'Legacy.exe',api:'d3d9',apiLabel:'DirectX 9',bitness:32,size:4096,hasNativeDlss:false,hasNativeFg:false});
     if(encoreScenario.hidePrimary)exes.shift();
   }
   for(const exe of exes) {
     if(exe.path===primary)Object.assign(exe,graphicsEvidence[dir]);
     exe.apiOverride=apiOverrides.get(exe.path) || 'auto';
     exe.recommendedRoute=exe.hasNativeDlss ? 'native' : 'feeder';
     if (exe.rel==='Alt\\game.exe' && exe.apiOverride==='d3d12') exe.classicMfgIssue='当前程序未检测到可供 NVIDIA 补帧使用的 DLSS-G 输入。';
     if(monitorModes.has(exe.path)) exe.performanceMonitor={installed:true,...monitorModes.get(exe.path)};
   }
   return{ok:true,exePath,api:'DirectX 12',addon:'renodx-mfgunlock.addon64',launcherProtected:dir===wuwaDir,
     files:[{name:'nvngx_dlss.dll',rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
       {name:'nvngx_dlssg.dll',rel:'Engine\\Plugins\\StreamlineCore\\Binaries\\ThirdParty\\Win64\\nvngx_dlssg.dll',version:'310.6.0.0'}],
     currentDlss:{rel:'Engine\\Plugins\\DLSS\\Binaries\\ThirdParty\\Win64\\nvngx_dlss.dll',version:dir===wuwaDir?'310.5.0.0':'3.1.30.0'},
     newDlss:'310.9.1.0',recommendedRoute:'native',installedRoute:graphicsConfigs[dir]?.route || (encoreConfigs[dir]?'encore':audit.installedRoute),
     installedExe:receiptExe || encoreTargets[dir]?.slice(dir.length+1),exes};
 },
 setApiOverride:async(_dir,exe,value)=>{apiOverrides.set(exe,value);return {ok:true};},
 optiscalerBuilds:async()=>({current:'fixture',builds:[{version:'fixture',label:'QA OptiScaler'}]}),
 install:async(dir,exe,route,api,token)=>{
   (audit.installRequests||=[]).push({dir,exe,route,api,token});
   if(!token)return{ok:true,preview:{token:'route-plan',dir,kind:'install',rows:[{rel:'route.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}};
   if(token!=='route-plan')throw Error('wrong installation token');
   audit.installedRoute=route;return{ok:true};
 },
 enhancedHardware:async force=>{
   if(force) audit.forcedHardware=(audit.forcedHardware||0)+1;
   return {ok:true,hardwareProfile:'rtx40_laptop',hardwareProfileSource:'detected',hardwareProfiles:profiles,
     hardware:{gpu:graphicsCatalog?.gpu || {name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}},display:{resolution:'2560x1600',refreshRateHz:audit.forcedHardware?165:60}}};
 },
 enhancedStatus:async(dir,override,priority)=>{
   audit.statusReads++;audit.profileQueries.push(override||null);audit.statusPriorities.push(priority||null);
   const nativeRuntimeStack=dir===wuwaDir ? {indexAvailable:true,sr:{rel:'nvngx_dlss.dll',version:'310.5.0.0'},fg:{rel:'nvngx_dlssg.dll',version:'310.6.0.0'},streamline:{rel:'sl.interposer.dll',version:'2.8.0.0'}} : undefined;
   return {ok:true,exePath:encoreTargets[dir]||dir+'\\game.exe',launcherProtected:dir===wuwaDir,nativeRuntimeStack,graphicsRoute:graphicsConfigs[dir],
     encore:encoreConfigs[dir]?{exePath:encoreTargets[dir],installed:true,filesPresent:true,hasNativeDlss:true,version:engineCatalog?engineEncore.version:engineEncoreOld.version,engine:engineCatalog?engineEncore:engineEncoreOld,settings:encoreConfigs[dir]}:undefined,
     standaloneProfile:dir===wuwaDir?{target:proxyTarget(override||'rtx40_laptop'),saved:{...proxyTarget('rtx40_laptop'),dlss5:true},adapterVersion:1}:null,
     hardware:{os:graphicsCatalog?.os,gpu:graphicsCatalog?.gpu || {name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}}},neural:{mode:'off',availableModels:catalogModels(),dependencies:{hasConsumer:audit.installedRoute==='optiscaler'}},mfg:{currentConfig:{mode:'off'},
       ...(graphicsConfigs[dir] ? {version:'other-provider'} : {}),
       ...(engineCatalog && dir===wuwaDir ? {engine:engineMfgOld,advanced:{model:1,structure:0.7,tone:0.8,character:1,characterMask:false}} : {})},
     diagnostics:{gameName:'Workflow test',hardwareProfileLabel:'RTX 40 笔记本',graphicsApi:'DirectX 12',neuralStatus:'尚未测试',mfgStatus:'实验性支持',combinedBadge:'尚未测试',
       coExecution:{dlssCompat:{summary:'游戏保留启动器校验的 DLSS 文件。神经渲染与补帧使用主程序旁的 version.dll。'}}},
     hardwareProfile:override||'rtx40_laptop',hardwareProfileSource:override?'selected':dir==='D:\\QA\\New'?'detected':'manifest',hardwareProfiles:profiles,
     ...(graphicsCatalog?{hardwareProfileInfo:graphicsCatalog.profiles[override||'rtx40_laptop'],hardwareProfiles:graphicsCatalog.profiles,
       neural:{mode:graphicsCatalog.neuralMode || 'off',availableModels:graphicsCatalog.models,runtimeStacks:graphicsCatalog.stacks},
       mfg:{currentConfig:{mode:graphicsCatalog.mfgMode || 'off'},gpuSupport:{nativeX2:true,nativeX3X4:false,unlockRequiredForX3X4:true}}}:{})};
 },
 componentRuntime:async dir=>{
   audit.runtimeReads++;
   if(dir===wuwaDir){
     if(proxyState==='error')throw Error('Fixture runtime query failed');
     if(proxyState==='stopped')return{ok:true,checkedAt:Date.now(),processState:'stopped',nr:{state:'stopped',label:'游戏未运行',detail:''},mfg:{state:'stopped',label:'游戏未运行',detail:''}};
     const settings={...proxyTarget('rtx40_laptop'),dlss5ResolutionScale:proxyState==='changed'?100:75};
     return{ok:true,checkedAt:Date.now(),processState:'running',process:{exe:runtimeExe || dir+'\\game.exe'},nr:{state:proxyState==='pending'?'pending':'active',label:proxyState==='pending'?'参数等待应用':'正在执行神经渲染',detail:'当前执行计数持续增长',at:Date.now()},
       mfg:{state:'active',label:'帧生成生效 · 提供程序 3 帧',detail:'已应用动态补帧；提供程序呈现 3 帧。',at:Date.now(),requestedMode:'dynamic',appliedMode:'dynamic',dynamicSupported:true},
       standalone:{at:Date.now(),enabled:true,pending:proxyState==='pending',settings,evaluations:500,failures:0,actual:proxyState==='pending'?null:{stage:2,scale:settings.dlss5ResolutionScale,passes:1,width:2560,height:1600,extentWidth:1920,extentHeight:1200,gpuMs:12.5},
         stack:{fg:'310.9.16.0',streamline:'2.14.16.0',ota:true}}};
   }
   return{ok:true,checkedAt:runtimeCheckedAt??Date.now(),processState:'running',process:{exe:runtimeExe || dir+'\\game.exe'},nr:{state:'unloaded',label:'尚未加载',detail:'QA fixture',at:Date.now()},mfg:{state:'active',label:'已生效',detail:'QA fixture',at:Date.now(),...runtimeSample}};
 },
 componentInventory:async()=>({ok:true,rows:[],lock:null}),
 restoreStatus:async dir=>({canRestore:!!graphicsConfigs[dir]}),
 restoreGame:async(dir,token)=>{
   if(!token)return{ok:true,preview:{token:'restore-plan',dir,kind:'restore',rows:[],conflicts:[]}};
   if(token!=='restore-plan')throw Error('wrong restore token');
   delete graphicsConfigs[dir];audit.restored=dir;return{ok:true};
 },
 enhancedApply:async(_dir,patch,token)=>{audit.requests.push({patch,token:token||null});if(!downloaded && patch.route!=='optifg')return{ok:false,dependencies:['runtime:test'],downloads:pendingDownloads};if(!token){audit.previewed++;const row=patch.route==='optifg'?{rel:'OptiScaler.ini',action:'replace'}:{rel:'QA.dll',action:'add',after:{version:'1.0'}};return{ok:true,preview:{token:'confirmed-plan',dir:_dir,kind:'enhanced',rows:[row],conflicts:[]}}}if(token!=='confirmed-plan')throw Error('wrong preview token');audit.applied++;
   if(patch.performanceMonitor!==undefined)monitorModes.set(patch.exePath,typeof patch.performanceMonitor==='number'
     ? {mode:patch.performanceMonitor,corner:1} : {mode:1,corner:1,...monitorModes.get(patch.exePath),...patch.performanceMonitor});
   if(patch.route==='xemfg') {
     const previous=graphicsConfigs[_dir]?.route==='xemfg' ? graphicsConfigs[_dir] : {};
     graphicsConfigs[_dir]={route:'xemfg',exePath:patch.exePath,filesPresent:true,providerVersion:'1.7.1',...previous,
       ...(patch.graphics?.multiplier ? {multiplier:patch.graphics.multiplier,enabled:true,dynamic:false} : {})};
   }
   if(patch.route==='xemfg-optiscaler')graphicsConfigs[_dir]={route:patch.route,exePath:patch.exePath,providerVersion:'1.7.1',filesPresent:true};
   if(patch.route==='optifg')graphicsConfigs[_dir]={route:patch.route,exePath:patch.exePath,providerVersion:'0.2.0-patch1',filesPresent:true,
     enabled:graphicsConfigs[_dir]?.route==='optifg' ? graphicsConfigs[_dir].enabled : true,engine:'FSR FG',neural:false};
   if(['anr','anr-addon','sm86','sm86-delta'].includes(patch.route))
     graphicsConfigs[_dir]={route:patch.route,exePath:patch.exePath,filesPresent:true,...patch.graphics};
   if(patch.route==='encore'){encoreConfigs[_dir]={...patch.encore,neuralMode:patch.neuralMode,neuralModelId:patch.neuralModelId,mfgMode:patch.mfgMode};encoreTargets[_dir]=patch.exePath;}return{ok:true}},
 componentPrepare:async()=>{audit.prepared++;subscriber({name:'QA component',stage:'ready'});downloaded=true;return{ok:true}},componentCancelPrepare:async options=>{audit.prepareCancelOptions=options;},onComponentProgress:fn=>{subscriber=fn;return()=>{subscriber=()=>{}}},
 addGame:async()=>{audit.addGameCalls=(audit.addGameCalls||0)+1;return{ok:true,dir:'D:\\QA\\Game'}},addGameByPath:async dir=>{audit.droppedDirectory=dir;return dir},addFolder:async()=>true,
 pathForFile:file=>file?.path||'',window:async()=>{}
});
