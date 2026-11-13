const {contextBridge}=require('electron');
const svg=(id,kind)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${kind==='cover'?60:160}" height="90"><rect width="100%" height="100%" fill="#657b73"/><text x="4" y="20">${id}-${kind}</text></svg>`);
const games=Array.from({length:160},(_,id)=>({key:'art-'+id,name:'Game '+String(id).padStart(3,'0'),dir:'D:\\ArtworkQA\\'+id,appid:String(1000+id),launcher:'Artwork fixture',poster:null,
  cached:{ok:true,api:'dxgi',apiLabel:'DirectX 12'}}));
games[0].poster={url:svg('cached','cover'),tall:true};games[0].tile=svg('cached','tile');
games[1].poster={url:svg('custom','cover'),custom:true,tall:true};
games[4].tile=svg(4,'tile');
games[6].poster={url:'data:image/png;base64,broken-six',tall:true};
games[8].poster={url:'data:image/png;base64,broken-eight',tall:true};
const audit={requests:[],active:0,peak:0,scans:0,libraryReads:0};
const pending=[];let automatic=false;
const recovered=new Set();
const releaseOne=()=>{pending.shift()?.();};
const profiles=Object.fromEntries(['rtx40_laptop','rtx40_desktop','rtx50_desktop'].map(id=>[id,{id,sm:89,targetResolution:'1920x1080',nrResolutionScale:.75,nrMaxWorksets:4,nrPasses:1,nrHookPoint:0}]));
contextBridge.exposeInMainWorld('artworkQA',{
  audit:()=>JSON.parse(JSON.stringify(audit)),
  releaseOne,
  releaseAll:()=>{automatic=true;while(pending.length)releaseOne();},
  recover:id=>{recovered.add(id);},
});
contextBridge.exposeInMainWorld('lab',{
  boot:async()=>({version:'0.1.1',theme:'dark',groupGamesByStore:false}),
  library:async()=>{audit.libraryReads++;return games;},
  scan:async()=>{audit.scans++;return{ok:true,api:'dxgi',apiLabel:'DirectX 12'};},
  recents:async()=>[0,2,4].map(id=>({dir:games[id].dir,at:Date.now()})),
  checkUpdate:async()=>({current:'0.1.1',newer:false}),
  onJob:()=>()=>{},onComponentProgress:()=>()=>{},onLibraryProgress:()=>()=>{},
  window:async()=>{},gameMenu:async()=>'poster',
  setPoster:async dir=>{const game=games.find(g=>g.dir===dir);const url=svg('custom-'+game.name,'cover');game.poster={url,custom:true,tall:true};return url;},
  artFetch:async(dir,name,appid,kind,options)=>{
    const id=Number(dir.split('\\').at(-1));
    audit.requests.push({dir,name,appid,kind,options});audit.active++;audit.peak=Math.max(audit.peak,audit.active);
    await new Promise(resolve=>automatic?setTimeout(resolve,20):pending.push(resolve));
    audit.active--;
    if(recovered.has(id))return{[kind]:svg(id+'-recovered',kind)};
    if([154,158].includes(id)||([3,4,159].includes(id)&&kind==='cover')||(id===3&&kind==='tile'))return{};
    if(id===6&&kind==='cover')return{cover:svg('6-repaired','cover')};
    if(id===8&&kind==='cover')return{cover:games[8].poster.url};
    return{[kind]:svg(id,kind)};
  },
  details:async dir=>({ok:true,exePath:dir+'\\game.exe',api:'DirectX 12',files:[],recommendedRoute:'native',
    exes:[{path:dir+'\\game.exe',rel:'game.exe',api:'dxgi',apiLabel:'DirectX 12',bitness:64,size:4096,hasNativeDlss:true}]}),
  restoreStatus:async()=>({canRestore:false}),
  enhancedStatus:async dir=>({ok:true,exePath:dir+'\\game.exe',hardwareProfile:'rtx40_laptop',hardwareProfileSource:'detected',hardwareProfiles:profiles,
    hardware:{gpu:{name:'RTX 4070 Laptop GPU',architecture:{sm:'89'}}},neural:{mode:'off',availableModels:[]},mfg:{currentConfig:{mode:'off'}},
    diagnostics:{gameName:'Artwork fixture',hardwareProfileLabel:'RTX 40',graphicsApi:'DirectX 12',neuralStatus:'尚未测试',mfgStatus:'实验性支持',combinedBadge:'尚未测试'}}),
});
