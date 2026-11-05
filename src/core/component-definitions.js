'use strict';
// Component identities are independent of app versions and file version resources.
// Native panel adapters remain pinned until their ABI has been checked.
const DEFINITIONS = Object.freeze({
  'dlss-sr': {name:'DLSS 超分辨率', files:['nvngx_dlss.dll'], online:'rhi-sr'},
  'dlss-fg': {name:'DLSS 帧生成运行库', files:['nvngx_dlssg.dll'], online:'rhi-fg'},
  'dlss-nr': {name:'DLSS 神经渲染模型', files:['nvngx_dlssnr.dll'], online:'rhi-nr'},
  'renodx-nr': {name:'RenoDX 神经渲染插件', files:['renodx-dlss5.addon64'], online:'renodx'},
  'renodx-multipass': {name:'RenoDX 多通道插件', files:['renodx-dlss.addon64'], online:'multipass'},
  'mfg-renodx': {name:'MFG 解锁插件 · RenoDX', files:['renodx-mfgunlock.addon64'], online:'mfg'},
  'mfg-universal': {name:'MFG 解锁插件 · Universal', files:['MFGUnlocker.dll'], online:'universal'},
  feeder: {name:'Feeder 配套组件', files:['dlss5-feed.addon32','dlss5-feed.addon64','dlss5-feed-host64.exe','DLSS5_Feed.fx'], online:'feeder'},
  reshade: {name:'ReShade 加载器', files:['ReShade32.dll','ReShade64.dll','ReShade32.json','ReShade64.json']},
  preloader: {name:'32 位老游戏预加载器', files:['winmm.dll'], internal:true},
  localization: {name:'中文面板适配层', files:['dlss5-zh-cn.addon32','dlss5-zh-cn.addon64'], pinned:true, internal:true},
  overlay: {name:'F8 紧凑叠加层', files:['dlss5-lab-overlay.addon64'], pinned:true, internal:true},
  optiscaler: {name:'OptiScaler', files:[], online:'optiscaler', managedRoute:true}
});
const PROVIDERS = Object.freeze({
  mfg:{repo:'mavismmg/MFGAdaUnlock-RenoDx',asset:/^renodx-mfgunlock\.addon64$/i},
  universal:{repo:'dashdogy/MFG-Unlocker',asset:/^(?:MFGUnlocker|RTXMFG)-.+\.zip$/i},
  renodx:{repo:'RankFTW/rhi-repo',asset:/^renodx-dlss5_[\w.-]+\.zip$/i},
  multipass:{repo:'RankFTW/rhi-repo',asset:/^renodx-dlss_SF_[\w.-]+\.zip$/i},
  'rhi-nr':{repo:'RankFTW/rhi-repo',asset:/^nvngx_dlssnr_[\w.-]+\.zip$/i},
  'rhi-sr':{repo:'RankFTW/rhi-repo',asset:/^nvngx_dlss_[\w.-]+\.zip$/i},
  'rhi-fg':{repo:'RankFTW/rhi-repo',asset:/^nvngx_dlssg_[\w.-]+\.zip$/i},
  feeder:{repo:'jlrouzies-fr/DLSS5-Feeder',asset:/^DLSS5-Feeder-[\w.-]+\.zip$/i},
  optiscaler:{repo:'Dagherbou/OptiScaler_DLSSNR',asset:/^OptiScaler.*\.zip$/i}
});
function builtins(payload, overlayDir) {
  const path=require('path'),fs=require('fs'),result=[];
  const add=(component,version,files)=>{if(Object.values(files).every(f=>fs.existsSync(f)))result.push({component,version,files,source:'随包组件快照',trustedAdapter:true});};
  for(const [folder,label] of [['streamline','310.9.1'],['enhanced/streamline-2.14.16','310.9.16']])for(const [id,name] of [['dlss-sr','nvngx_dlss.dll'],['dlss-fg','nvngx_dlssg.dll']])add(id,label,{[name]:path.join(payload,folder,name)});
  add('dlss-nr','310.8.SF-v2',{'nvngx_dlssnr.dll':path.join(payload,'streamline/nvngx_dlssnr.dll')});
  add('renodx-nr','8.5.0-rc10',{'renodx-dlss5.addon64':path.join(payload,'renodx-dlss5.addon64')});
  add('renodx-multipass','SF 26.1003.2350',{'renodx-dlss.addon64':path.join(payload,'feeder/host64/renodx-dlss.addon64')});
  for(const [id,version,name] of [['mfg-renodx','1.5.5','renodx-mfgunlock.addon64'],['mfg-universal','1.7.0','MFGUnlocker.dll']])add(id,version,{[name]:path.join(payload,'enhanced/mfg',name)});
  for(const [folder,version] of [['feeder','1.17.0'],['enhanced/feeder-1.19.0','1.19.0']]) {
    const root=path.join(payload,folder);add('feeder',version,{
      'dlss5-feed.addon32':path.join(root,'dlss5-feed.addon32'),'dlss5-feed.addon64':path.join(root,'dlss5-feed.addon64'),
      'dlss5-feed-host64.exe':path.join(root,version==='1.19.0'?'host64/dlss5-feed-host64.exe':'dlss5-feed-host64.exe'),
      'DLSS5_Feed.fx':path.join(root,'reshade-shaders/Shaders/DLSS5_Feed.fx')});
  }
  add('reshade','6.8.0',Object.fromEntries(DEFINITIONS.reshade.files.map(n=>[n,path.join(payload,'reshade-vulkan',n)])));
  add('preloader','bb72b7c',{'winmm.dll':path.join(payload,'enhanced/zh-cn/winmm.dll')});
  add('localization','zh1.10',Object.fromEntries(DEFINITIONS.localization.files.map(n=>[n,path.join(payload,'enhanced/zh-cn',n)])));
  if(overlayDir)add('overlay','zh1.10',{'dlss5-lab-overlay.addon64':path.join(overlayDir,'dlss5-lab-overlay.addon64')});
  return result;
}
module.exports={DEFINITIONS,PROVIDERS,builtins};
