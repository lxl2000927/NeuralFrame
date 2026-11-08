const {contextBridge}=require('electron');
const audit={prepared:0,applied:0,previewed:0,requests:[],profileQueries:[],detailReads:0,statusReads:0,runtimeReads:0,detailPriorities:[],statusPriorities:[]};let downloaded=false,subscriber=()=>{};
const profiles=Object.fromEntries(['rtx40_laptop','rtx40_desktop'].map(id=>[id,{
  id, sm:89, targetResolution:'1920x1080', nrResolutionScale:0.75, nrMaxWorksets:4, nrPasses:1, nrHookPoint:0
}]));
contextBridge.exposeInMainWorld('qa',{audit:()=>JSON.parse(JSON.stringify(audit)),reset:()=>{downloaded=false;audit.prepared=0;audit.applied=0;audit.previewed=0;audit.requests=[]}});
contextBridge.exposeInMainWorld('lab',{
 libraryComponents:async()=>{
   audit.libraryReads=(audit.libraryReads||0)+1;
   if(audit.libraryReads===1)return{ok:false,code:'errJobBusy'};
   return{ok:true,definitions:{},packages:[],runtimePacks:[],root:'QA',warnings:[]};
 },
 checkUpdate:async()=>({current:'0.1.0',latest:null,newer:false}),
 recents:async()=>[],onJob:()=>()=>{},scan:async()=>({ok:true,api:'DirectX 12'}),
 boot:async()=>({version:'0.1.0',theme:'dark'}),library:async()=>[{key:'qa',name:'Workflow test',dir:'D:\\QA\\Game',launcher:'Test fixture',poster:null}],
 artFetch:async()=>({}),details:async(_dir,priority)=>{audit.detailReads++;audit.detailPriorities.push(priority||null);return{ok:true,exePath:'D:\\QA\\Game\\game.exe',api:'DirectX 12',files:[]}},
 enhancedHardware:async()=>({ok:true,hardwareProfile:'rtx40_desktop',hardwareProfileSource:'default',hardwareProfiles:profiles}),
 enhancedStatus:async(_dir,override,priority)=>{
   audit.statusReads++;audit.profileQueries.push(override||null);audit.statusPriorities.push(priority||null);
   return {ok:true,neural:{mode:'off',availableModels:[]},mfg:{currentConfig:{mode:'off'}},
     hardwareProfile:override||'rtx40_laptop',hardwareProfileSource:override?'selected':'manifest',hardwareProfiles:profiles};
 },
 componentRuntime:async()=>{audit.runtimeReads++;return{ok:true,checkedAt:Date.now(),processState:'running',nr:{state:'unloaded',label:'尚未加载',detail:'QA fixture',at:Date.now()},mfg:{state:'active',label:'已生效',detail:'QA fixture',at:Date.now()}}},
 componentInventory:async()=>({ok:true,rows:[],lock:null}),
 restoreStatus:async()=>({canRestore:false}),
 enhancedApply:async(_dir,patch,token)=>{audit.requests.push({patch,token:token||null});if(!downloaded)return{ok:false,dependencies:['runtime:test'],downloads:[{name:'QA component',size:1024}]};if(!token){audit.previewed++;return{ok:true,preview:{token:'confirmed-plan',dir:'D:\\QA\\Game',kind:'enhanced',rows:[{rel:'QA.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}}}if(token!=='confirmed-plan')throw Error('wrong preview token');audit.applied++;return{ok:true}},
 componentPrepare:async()=>{audit.prepared++;subscriber({name:'QA component',stage:'ready'});downloaded=true;return{ok:true}},componentCancelPrepare:async()=>{},onComponentProgress:fn=>{subscriber=fn;return()=>{subscriber=()=>{}}},
 window:async()=>{}
});
