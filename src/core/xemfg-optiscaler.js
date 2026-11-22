'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { fs, active: previewActive } = require('./preview-fs');
const { safePath } = require('./file-journal');
const pe = require('./pe');
const { getIni } = require('./feeder-config');
const { packs } = require('./runtime-catalog.json');

// The author's v1.7.1 setup uses the 20261111 nightly. Only the paired
// dashdogy build implements XeFG output on Vulkan. Neither host is replaced.
const hosts = new Map([
  [27644928, {sha256:'5a09bcd8733d6192a444d539727b6a06f65e5b5b8f0fe1b87c04f04c9791e8a6', vulkan:false}],
  [28182016, {sha256:'8ea15eecb3066fcb67485a57c951883b6fe4e8809df889a2a5e6d6b759974d0f', vulkan:false}], // nightly-20261118
  [27722752, {sha256:'3545cb32e4d09854a5f06f9df47a0d29adb6b7bede7b2a0ed0ab64ba837c1721', vulkan:true}],
]);
const hostNames = ['dxgi.dll','winmm.dll','version.dll','dbghelp.dll','d3d12.dll','wininet.dll','winhttp.dll'];
const otherProxyNames = ['dinput8.dll','d3d9.dll','d3d10.dll','d3d11.dll','dsound.dll','binkw64.dll','bink2w64.dll',
  'xinput1_1.dll','xinput1_2.dll','xinput1_3.dll','xinput1_4.dll','xinput9_1_0.dll','xinputuap.dll'];
const intel = packs.find(pack => pack.id === 'xemfg-intel').files.filter(file => file.path.endsWith('.dll'));
const engine = packs.find(pack => pack.id === 'mfg-universal');
const license = packs.find(pack => pack.id === 'mfg-license');
const plugin = 'OptiScaler/plugins/MFGUnlocker.asi';
const notice = 'OptiScaler/plugins/MFG-Unlocker-LICENSE.txt';
const fields = [['Plugins','LoadAsiPlugins','true'], ['FrameGen','FGInput','Upscaler'], ['FrameGen','FGOutput','XeFG']];
const hostFilterKeys = {processfilter:['targetprocessname','processexclusionlist'], fakenvapi:['forcexell']};
// Common Config.h pass-through entries in the supported OptiScaler hosts.
const defaultExcluded = new Set([
  'crashpad_handler','crashreport','crashreporter','crs-handler','crs-uploader','crs-video',
  'unitycrashhandler64','idtechlauncher','cefviewwing','ace-setup64','ace-service64','qtwebengineprocess',
  'platformprocess','bugsplathd64','bssndrpt64','pspcsdkappmgr','pspcsdkcore','pspcsdkstttts','pspcsdktelemetry',
  'pspcsdkui','pspcsdkupdatechecker','pspcsdkvoicechat','pspcsdkwebview','windhawk','vscodium','crash_reporter',
  'steamerrorreporter64','crashreportclient','edcefcrashpadprocess','edcefrenderprocess',
].map(name => name + '.exe'));
const hostKeys = {
  ...hostFilterKeys,
  plugins: ['path','loadasiplugins'], libraries: ['optidllpath','xefgpath','xellpath'],
  framegen: ['fginput','fgoutput','enabled'], inputs: ['enabledlssinputs','enablexessinputs','enableffxinputs','useffxinputs'],
};
const proofs = new Map();
const fail = message => Object.assign(new Error(message), {code:'errGraphicsRoute'});

function fingerprint(file, stat, cached) {
  const stamp = [stat.dev, stat.ino, stat.size, stat.ctimeMs, stat.mtimeMs].join(':');
  const proof = cached && proofs.get(file);
  if (proof && proof.stamp === stamp) return proof.sha;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (cached) {
    if (proofs.size >= 128) proofs.delete(proofs.keys().next().value);
    proofs.set(file, {stamp, sha});
  }
  return sha;
}

function matches(file, item, cached) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  return stat.isFile() && stat.size === item.size && fingerprint(file, stat, cached) === item.sha256;
}

function configText(file, keys = hostKeys) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) return null;
  const bytes = fs.readFileSync(file);
  // Both paired OptiScaler lineages read this file with CSimpleIniA.
  // Accept the same UTF-8 BOM that it strips; UTF-16 leaves embedded NULs.
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  if (text.includes('\0') || !/^\s*\[[^\]]+\]/m.test(text)) return null;
  // The field editor acts on the first section/key. A later duplicate can
  // leave the real host using a different value after an apparent success.
  const seen = new Set();
  let section;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\](.*)$/.exec(line);
    if (header) {
      // SimpleIni accepts these section headers. The shared field editor
      // cannot round-trip them, and could append a second active section.
      if (header[1] !== header[1].trim() || header[2].trim()) return null;
      section = header[1].toLowerCase();
      if (Object.hasOwn(keys,section) && seen.has(section)) return null;
      seen.add(section);
    } else if (Object.hasOwn(keys,section)) {
      const key = line.split('=',1)[0].trim().toLowerCase();
      if (keys[section].includes(key) && line.includes('=')) {
        const name = section + '/' + key;
        if (seen.has(name)) return null;
        seen.add(name);
      }
    }
  }
  return text;
}

function defaultPath(text, section, key, dir, expected) {
  const value = getIni(text, section, key);
  // An explicitly empty MainDllPath resolves to the EXE directory. Only a
  // missing value or "auto" makes the host choose the OptiScaler subfolder.
  if (value === '' && section === 'Libraries' && key === 'OptiDllPath') return false;
  if (!value || value.toLowerCase() === 'auto') return true;
  return path.relative(path.join(dir,expected), path.resolve(dir,value.replace(/[\\/]/g,path.sep))) === '';
}

function acceptsProcess(text, exePath) {
  const process = path.basename(exePath).toLowerCase();
  const target = (getIni(text,'ProcessFilter','TargetProcessName') ?? 'auto').toLowerCase();
  const list = (getIni(text,'ProcessFilter','ProcessExclusionList') ?? 'auto').toLowerCase();
  const excluded = list === 'auto' ? defaultExcluded.has(process) : list.split('|').includes(process);
  return (target === 'auto' || target === process) && !excluded;
}

function acceptsFrameGenInput(text, exePath) {
  // ForceXeLL overrides both FGInput and FGOutput after reading [FrameGen].
  return acceptsProcess(text,exePath) && getIni(text,'fakenvapi','ForceXeLL')?.toLowerCase() !== 'true';
}

function detectHost(exePath, cached = true) {
  const bin = path.dirname(exePath);
  try {
    const config = safePath(bin,'OptiScaler.ini');
    if (!fs.existsSync(config) || pe.getBitness(exePath,{exeOnly:true}) !== 64) return null;
    const text = configText(config);
    if (!text || !acceptsFrameGenInput(text,exePath) || !defaultPath(text,'Plugins','Path',bin,'OptiScaler/plugins') ||
        !defaultPath(text,'Libraries','OptiDllPath',bin,'OptiScaler')) return null;
    let found;
    const imports = new Set(pe.getImports(exePath));
    for (const name of hostNames) {
      // DXGI/D3D12 are normal renderer entries; the stock installer also
      // explicitly supports winmm for Vulkan. An arbitrary alternate proxy
      // beside the game does not establish that it will be loaded.
      if (!['dxgi.dll','d3d12.dll','winmm.dll'].includes(name) && !imports.has(name)) continue;
      const file = safePath(bin,name);
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      const host = stat.isFile() && hosts.get(stat.size);
      if (!host || fingerprint(file, stat, cached && !previewActive()) !== host.sha256) continue;
      if (found) return null;
      // Upstream's installer recommends winmm for Vulkan. Other proxy names
      // require a matching EXE import to identify a Vulkan loading path.
      found = host.vulkan && (name === 'winmm.dll' || imports.has(name)) ? 'dx12-vulkan' : 'dx12';
    }
    if (!found) return null;
    for (const item of intel) {
      const name = path.basename(item.path), rel = 'OptiScaler/' + name;
      const key = name === 'libxell.dll' ? 'XeLLPath' : 'XeFGPath';
      if (!defaultPath(text,'Libraries',key,bin,rel) || !matches(safePath(bin,rel),item,cached && !previewActive())) return null;
    }
    return found;
  } catch { return null; }
}

function assertNoOtherLoader(bin) {
  for (const name of [...hostNames, ...otherProxyNames, 'MFGUnlocker.asi', 'RTXMFG.asi']) {
    const file = safePath(bin,name);
    if (fs.existsSync(file) && ['MFGUnlocker.dll','MFG Unlocker','RTXMFG.dll'].some(id => pe.versionMentions(file,id)))
      throw fail('检测到已有 MFG 独立加载器，请先通过原管理工具恢复：' + name);
  }
  const plugins = safePath(bin,'OptiScaler/plugins');
  if (fs.existsSync(plugins)) {
    for (const name of fs.readdirSync(plugins)) {
      if (!name.toLowerCase().endsWith('.asi') || name.toLowerCase() === 'mfgunlocker.asi') continue;
      const file = safePath(plugins,name);
      if (pe.versionMentions(file,'MFG Unlocker') || pe.versionMentions(file,'RTXMFG.dll'))
        throw fail('检测到重复的 MFG 插件：' + name);
    }
  }
}

async function upscalerFields(gameDir, exePath, api, target, text) {
  const disabled = key => getIni(text,'Inputs',key)?.toLowerCase() === 'false';
  const dlss = ['EnableDlssInputs'], xess = ['EnableXeSSInputs'], fidelity = ['EnableFfxInputs','UseFfxInputs'];
  // All supported inputs default on. Only an explicitly disabled input may
  // require a change; leave every unrelated hook in the player's chosen state.
  if (![...dlss,...xess,...fidelity].some(disabled)) return [];
  const nativeDlss = api === 'vulkan' ? target.hasXeMfgDlssSrVk : target.hasXeMfgDlssSrDx12;
  const choices = nativeDlss ? [dlss] : [];
  if (choices.some(keys => !keys.some(disabled))) return [];
  if (api === 'vulkan' ? target.hasXeMfgVkUpscaler : target.hasXeMfgDx12Upscaler) {
    const scan = await require('./scan').scanGame(gameDir,exePath);
    const routes = require('../shared/install-routes');
    const present = api === 'vulkan' ? routes.nativeXeMfgVkUpscalerPresent : routes.nativeXeMfgDx12UpscalerPresent;
    for (const [pattern,keys] of [[/^libxess\.dll$/i,xess],[/^amd_fidelityfx_/i,fidelity]]) {
      if (present({...scan,upscalerFiles:scan.upscalerFiles.filter(file => pattern.test(file.name))})) choices.push(keys);
    }
  }
  if (choices.some(keys => !keys.some(disabled))) return [];
  return (choices[0] || []).filter(disabled).map(key => ['Inputs',key,'true']);
}

async function deploy({gameDir,exePath,api,apiLabel,bitness,target,graphics = {},old,local,copy,edit,checkedSource}) {
  const host = detectHost(exePath, false);
  const antiCheatWarning = require('./compatibility').hasAntiCheat(gameDir,exePath) || !!target?.antiCheatWarning;
  const issue = require('../shared/install-routes').xemfgOptiReason({...target,api,apiLabel,bitness,xeMfgOptiHost:host,antiCheatWarning});
  if (issue) throw fail(issue);
  if (Object.keys(graphics).length) throw fail('XeMFG 插件倍率由 OptiScaler 的游戏内菜单设置。');
  assertNoOtherLoader(path.dirname(exePath));
  const config = local('OptiScaler.ini');
  const inputs = await upscalerFields(gameDir,exePath,api,target,configText(config));
  for (const [pack, name] of [[engine,plugin], [license,notice]]) {
    const item = pack.files[0], dest = local(name);
    const source = checkedSource(pack,item);
    if (!old?.files?.[path.relative(gameDir,dest)] && matches(dest,item,false)) continue;
    await copy(source,dest,item.sha256);
  }
  // The host defaults FG to off. Enable it on initial setup; a later change
  // in the game's menu remains the player's choice on reapply.
  const enabled = old ? [] : [['FrameGen','Enabled','true']];
  await edit(config, '', [...fields,...enabled,...inputs], true);
  return {providerDir:path.relative(gameDir, local('OptiScaler/plugins')), providerVersion:engine.version};
}

function inspect(gameDir,manifest) {
  const exePath = safePath(gameDir,manifest.game.exe), bin = path.dirname(exePath);
  const host = detectHost(exePath);
  const state = {route:'xemfg-optiscaler',exePath,filesPresent:false,providerVersion:undefined,enabled:null};
  try {
    const present = matches(safePath(bin,plugin),engine.files[0],true);
    if (present) state.providerVersion = engine.version;
    const text = configText(safePath(bin,'OptiScaler.ini'));
    state.filesPresent = !!host && (manifest.game.api !== 'vulkan' || host === 'dx12-vulkan') && present &&
      matches(safePath(bin,notice),license.files[0],true);
    if (text) {
      state.enabled = getIni(text,'FrameGen','Enabled')?.toLowerCase() === 'true';
      if (!fields.every(([section,key,value]) => getIni(text,section,key)?.toLowerCase() === value.toLowerCase()))
        state.error = 'OptiScaler 的插件加载、帧生成输入或输出已变化。';
    }
  } catch { /* An externally removed or edited host needs a fresh preparation. */ }
  return state;
}

module.exports = {detectHost, deploy, inspect, matches, defaultPath, configText, hostFilterKeys, acceptsProcess, acceptsFrameGenInput};
