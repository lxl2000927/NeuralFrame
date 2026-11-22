'use strict';

const path = require('node:path');
const {fs, active:previewActive} = require('./preview-fs');
const {safePath} = require('./file-journal');
const pe = require('./pe');
const ini = require('./feeder-config');
const {matches, defaultPath, configText, hostFilterKeys, acceptsFrameGenInput} = require('./xemfg-optiscaler');

// Both fixed releases ship these three AMD binaries. The host forwards the
// selected upscaler's inputs to FSR FG; no separate MFG plugin is involved.
const hosts = [
  {version:'0.2.0-patch1',size:25863680,sha256:'114a1d18e79d90a011406b9467b4b6dc4d4948487c4b30289311def311174bce'},
  {version:'0.8.92-presr',size:26477568,sha256:'696308c0af61800124dcf59fb0cc131372024d275e2cdf8500e5b28dd9e494a7'},
];
const libraries = [
  {key:'FfxDx12Path',name:'amd_fidelityfx_loader_dx12.dll',size:26376,sha256:'e2d85aa05a9bd9ed8b38935fdf5199372cca6f74c12015143bb6f945ee1608aa'},
  {key:'FfxDx12SRPath',name:'amd_fidelityfx_upscaler_dx12.dll',size:28761864,sha256:'d0dcccc74a43c44ba435b7a369b456e0970d8a4464e4bd683119b374f2c9fb46'},
  {key:'FfxDx12FGPath',name:'amd_fidelityfx_framegeneration_dx12.dll',size:40085776,sha256:'02297beedd285e822d3a64f314cf00faf378dcec0edc47ff0c4dd71b3a8c2f18'},
];
const xeSr = {key:'XeSSPath',name:'libxess.dll',size:77795704,sha256:'251659dd84a3e84de67c886a4186e01f3eca49b00641906fe38bb6b807e5d5b7'};
const proxies = ['dxgi.dll','winmm.dll','version.dll','d3d12.dll','dbghelp.dll','wininet.dll','winhttp.dll'];
const inputs = {
  dlss:['EnableDlssInputs'], xess:['EnableXeSSInputs'], ffx:['EnableFfxInputs','UseFfxInputs'],
  fsr2:['EnableFsr2Inputs','UseFsr2Inputs'], fsr3:['EnableFsr3Inputs','UseFsr3Inputs'],
};
const keys = {
  ...hostFilterKeys,
  libraries:['optidllpath','xesspath',...libraries.map(x => x.key.toLowerCase())],
  framegen:['fginput','fgoutput','enabled'], dlssnr:['enabled'], upscalers:['dx12upscaler'],
  inputs:[...Object.values(inputs).flat().map(x => x.toLowerCase()),'usefsr2dx11inputs','usefsr2vulkaninputs'],
  plugins:['loadasiplugins','loadreshade','path'],
};
const fail = message => Object.assign(new Error(message), {code:'errGraphicsRoute'});
const field = (text, section, key) => (ini.getIni(text, section, key) ?? 'auto').trim().toLowerCase();
function flag(text, section, key, fallback = false) {
  const value = field(text, section, key);
  // Config::readBool recognizes only the words true and false. Numeric
  // settings fall back to the host default just as auto does.
  if (['auto','0','1'].includes(value)) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw fail('OptiScaler.ini 中的 ' + section + '.' + key + ' 不是有效的开关。');
}

function identify(exePath, cached) {
  const bin = path.dirname(exePath), local = name => safePath(bin,name);
  const config = local('OptiScaler.ini');
  if (!fs.existsSync(config) || pe.getBitness(exePath,{exeOnly:true}) !== 64) return null;
  // These two builds use CSimpleIniA. Its byte-oriented reader accepts a
  // UTF-8 BOM, but UTF-16 NULs stop it before the first setting.
  const text = configText(config,keys);
  if (!text || !acceptsFrameGenInput(text,exePath) || !defaultPath(text,'Libraries','OptiDllPath',bin,'OptiScaler')) return null;
  let host;
  const imports = pe.getImports(exePath);
  cached = cached && !previewActive();
  for (const name of proxies) {
    const file = local(name);
    if (!fs.existsSync(file)) continue;
    const found = hosts.find(item => matches(file,item,cached));
    if (!found) continue;
    if (host || (!['dxgi.dll','d3d12.dll'].includes(name) && !imports.includes(name))) return null;
    host = found;
  }
  if (!host) return null;
  const required = field(text,'Upscalers','Dx12Upscaler') === 'xess' ? [...libraries,xeSr] : libraries;
  for (const item of required) {
    const location = path.join('OptiScaler',item.name);
    if (!defaultPath(text,'Libraries',item.key,bin,location) || !matches(local(location),item,cached)) return null;
  }
  return {version:host.version,text};
}

function detectHost(exePath, cached = true) {
  try { return Boolean(identify(exePath,cached)); } catch { return false; }
}

function assertNoConflict(bin, text) {
  const local = name => safePath(bin,name);
  if (['RTXMFG-Universal.json','rtx-encore.jsonc','dlssg_sm86.ini'].some(name => fs.existsSync(local(name))))
    throw fail('已有独立帧生成配置，请先还原原有帧生成路线。');
  if (flag(text,'Plugins','LoadAsiPlugins')) {
    if (!defaultPath(text,'Plugins','Path',bin,'OptiScaler/plugins') || fs.existsSync(local('OptiScaler/plugins/MFGUnlocker.asi')))
      throw fail('现有 ASI 帧生成插件或自定义加载目录与 OptiFG 冲突。');
  }
  const addons = ['renodx-dlss5.addon64','renodx-dlss.addon64','dlss5-feed.addon64','renodx-mfgunlock.addon64']
    .filter(name => fs.existsSync(local(name)));
  if (!addons.length) return;
  if (flag(text,'Plugins','LoadReshade') || require('./scan').inspectReShade(bin,proxies).installed) {
    const reshade = ini.readText(local('ReShade.ini'));
    if (addons.some(name => ini.enableAddons(reshade,[name]) === reshade))
      throw fail('现有 ReShade 正在加载 NVIDIA 消费者或帧生成插件，请先关闭该插件。');
  }
}

function inputSettings(text, available) {
  const choices = available.filter(kind => Object.hasOwn(inputs,kind)).map(kind => {
    const changes = inputs[kind].filter(key => !flag(text,'Inputs',key,true)).map(key => ['Inputs',key,'true']);
    if (kind === 'fsr2') {
      for (const key of ['UseFsr2Dx11Inputs','UseFsr2VulkanInputs']) {
        if (flag(text,'Inputs',key)) changes.push(['Inputs',key,'false']);
      }
    }
    return changes;
  });
  if (!choices.length) throw fail('OptiFG 尚未识别到当前程序可读取的超分输入。');
  return choices.sort((a,b) => a.length - b.length)[0];
}

async function deploy({gameDir,exePath,api,apiLabel,bitness,target,graphics = {},old,local,edit}) {
  const host = identify(exePath,false);
  const issue = require('../shared/install-routes').optiFgReason({...target,api,apiLabel,bitness,optiFgHost:!!host,
    launcherProtected:target?.launcherProtected || !!require('./wuthering-waves').gameRoot(gameDir,exePath),
    antiCheatWarning:target?.antiCheatWarning || require('./compatibility').hasAntiCheat(gameDir,exePath)});
  if (issue) throw fail(issue);
  if (Object.keys(graphics).length) throw fail('OptiFG 使用 FSR 帧生成输出，游戏内可调整其参数。');
  const {text} = host;
  assertNoConflict(path.dirname(exePath),text);
  const fgInput = field(text,'FrameGen','FGInput'), fgOutput = field(text,'FrameGen','FGOutput');
  if (!['upscaler','auto','nofg'].includes(fgInput) || !['fsrfg','auto','nofg'].includes(fgOutput))
    throw fail('已有其他帧生成输入或输出，请先在 OptiScaler 菜单中关闭原路线。');
  const sr = field(text,'Upscalers','Dx12Upscaler');
  if (!['auto','dlss','ffx','fsr21','fsr22','xess'].includes(sr)) throw fail('未识别当前 DirectX 12 超分后端，请先核对 OptiScaler 配置。');
  const available = target.optiFgInputs || [];
  const changed = inputSettings(text,available);
  if (flag(text,'DlssNr','Enabled')) changed.push(['DlssNr','Enabled','false']);
  if (sr === 'auto' || sr === 'dlss') changed.push(['Upscalers','Dx12Upscaler','ffx']);
  if (fgInput !== 'upscaler') changed.push(['FrameGen','FGInput','upscaler']);
  if (fgOutput !== 'fsrfg') changed.push(['FrameGen','FGOutput','fsrfg']);
  const enabled = flag(text,'FrameGen','Enabled');
  if (!old && !enabled) changed.push(['FrameGen','Enabled','true']);
  await edit(local('OptiScaler.ini'),'',changed,true);
  return {providerVersion:host.version,inputs:available};
}

function inspect(gameDir,manifest) {
  const exePath = safePath(gameDir,manifest.game.exe);
  const state = {route:'optifg',exePath,filesPresent:false,engine:'FSR FG',enabled:null,neural:false};
  try {
    const host = identify(exePath,true);
    if (!host) return state;
    state.providerVersion = host.version;
    state.filesPresent = true;
    const {text} = host;
    state.enabled = flag(text,'FrameGen','Enabled');
    if (field(text,'FrameGen','FGInput') !== 'upscaler' || field(text,'FrameGen','FGOutput') !== 'fsrfg' ||
        flag(text,'DlssNr','Enabled') || !['ffx','fsr21','fsr22','xess'].includes(field(text,'Upscalers','Dx12Upscaler')))
      throw fail('OptiFG 的输入、输出或神经渲染设置已变化，请核对游戏内配置。');
    if (inputSettings(text,manifest.graphicsRoute?.inputs || []).length)
      throw fail('OptiScaler 已关闭此游戏所需的超分输入。');
  } catch (error) { state.error = error.message; }
  return state;
}

module.exports = {detectHost, deploy, inspect};
