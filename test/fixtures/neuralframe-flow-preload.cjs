const {contextBridge}=require('electron');
const audit={prepared:0,applied:0,previewed:0,requests:[],detailReads:0,statusReads:0,runtimeReads:0};let downloaded=false,subscriber=()=>{};
contextBridge.exposeInMainWorld('qa',{audit:()=>JSON.parse(JSON.stringify(audit)),reset:()=>{downloaded=false;audit.prepared=0;audit.applied=0;audit.previewed=0;audit.requests=[]}});
contextBridge.exposeInMainWorld('lab',{
 boot:async()=>({version:'0.1.0',theme:'dark'}),library:async()=>[{key:'qa',name:'Workflow test',dir:'D:\\QA\\Game',launcher:'Test fixture',poster:null}],
 artFetch:async()=>({}),details:async()=>{audit.detailReads++;return{ok:true,exePath:'D:\\QA\\Game\\game.exe',api:'DirectX 12',files:[]}},
 enhancedStatus:async()=>{audit.statusReads++;return{ok:true,neural:{mode:'off'},mfg:{currentConfig:{mode:'off'}},hardwareProfile:'rtx40_laptop'}},
 componentRuntime:async()=>{audit.runtimeReads++;return{ok:true,checkedAt:Date.now(),processState:'running',nr:{state:'unloaded',label:'尚未加载',detail:'QA fixture',at:Date.now()},mfg:{state:'active',label:'已生效',detail:'QA fixture',at:Date.now()}}},
 enhancedApply:async(_dir,patch,token)=>{audit.requests.push({patch,token:token||null});if(!downloaded)return{ok:false,dependencies:['runtime:test'],downloads:[{name:'QA component',size:1024}]};if(!token){audit.previewed++;return{ok:true,preview:{token:'confirmed-plan',dir:'D:\\QA\\Game',kind:'enhanced',rows:[{rel:'QA.dll',action:'add',after:{version:'1.0'}}],conflicts:[]}}}if(token!=='confirmed-plan')throw Error('wrong preview token');audit.applied++;return{ok:true}},
 componentPrepare:async()=>{audit.prepared++;subscriber({name:'QA component',stage:'ready'});downloaded=true;return{ok:true}},componentCancelPrepare:async()=>{},onComponentProgress:fn=>{subscriber=fn;return()=>{subscriber=()=>{}}},
 window:async()=>{}
});
