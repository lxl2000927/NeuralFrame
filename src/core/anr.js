'use strict';
const path = require('node:path');
const {fs, active:previewActive} = require('./preview-fs');
const journal = require('./file-journal');
const pe = require('./pe');
const history = require('./anr-previous.json');
const catalog = require('./runtime-catalog.json');
const {matches, configText, hostFilterKeys, acceptsFrameGenInput, acceptsProcess, defaultPath} = require('./xemfg-optiscaler');
const {getIni} = require('./feeder-config');

const provider = 'Apex Neural Rendering FG';
const privatePath = path.join('OptiScaler', 'custom', provider, 'dlssg');
const loaderName = 'anr-vkloader.dll';
const fullB18 = 'be9a9c4f21c89cbae993f1c2f5df0685e3f530bf9f2e565e22958dd062c9c12c';
const fullHosts = [
  catalog.packs.find(p => p.id === 'anr').files.find(f => f.archivePath === 'game/dxgi.dll'),
  {size:30009856, sha256:'b35eec64bd1c0027a5245a90b39c5d7118bf55b5c0c533a7e7a98669df6ca919'},
];
const hooks = {'dxgi.dll':'CreateDXGIFactory1', 'd3d12.dll':'D3D12CreateDevice', 'winmm.dll':'timeGetTime',
  'version.dll':'GetFileVersionInfoW', 'dbghelp.dll':'SymInitialize', 'wininet.dll':'InternetOpenW',
  'winhttp.dll':'WinHttpOpen', 'dinput8.dll':'DirectInput8Create'};
const hostKeys = {
  FGNvngxReplacement:{...hostFilterKeys, libraries:['optidllpath'], framegen:['fginput','fgnvngxreplacement','disablehudless']},
  LoadAsiPlugins:{...hostFilterKeys, libraries:['optidllpath','nvngxfeaturepath'], framegen:['fginput','fgoutput','enabled','fgnvngxreplacement'], plugins:['path','loadasiplugins'],
    inputs:['enabledlssinputs','enablexessinputs','enableffxinputs','useffxinputs','enablefsr2inputs','usefsr2inputs','usefsr2dx11inputs','usefsr2vulkaninputs','enablefsr3inputs','usefsr3inputs'],
    dlssg:['interpolationcount','overrideinterpolationcount','forcedmfg','overrideforcedmfg']},
  LoadReShade:{processfilter:hostFilterKeys.processfilter, plugins:['loadreshade']},
};

const capabilities = new Map();
const customProviderMarker = "isn't a replacement or a custom provider";
function externalCapabilities(file, cached) {
  const stat = fs.statSync(file);
  const stamp = [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const proof = cached && capabilities.get(file);
  if (proof && proof.stamp === stamp) return proof.markers;
  const markers = pe.findMarkers(file,[...Object.keys(hostKeys),customProviderMarker,'OverrideInterpolationCount','XeFG input hooks:']);
  if (!markers.has(customProviderMarker)) markers.delete('FGNvngxReplacement');
  if (pe.getFileVersion(file)?.split('.')[0] !== '10' || !markers.has('OverrideInterpolationCount')) markers.delete('LoadAsiPlugins');
  if (cached) {
    if (capabilities.size >= 128) capabilities.delete(capabilities.keys().next().value);
    capabilities.set(file,{stamp,markers});
  }
  return markers;
}
function isHost(file, hook, capability = 'FGNvngxReplacement') {
  if (!fs.existsSync(file) || pe.getBitness(file,{dllOnly:true}) !== 64 || !pe.hasExports(file, [hook])) return false;
  const cached = !previewActive();
  return fullHosts.some(item => matches(file, item, cached)) ||
    ((pe.versionMentions(file, 'OptiScaler') || pe.hasExports(file, [hook], 'OptiScaler.dll')) &&
     externalCapabilities(file,cached).has(capability));
}
function supportsHost(exePath, api, capability) {
  try {
    if (!['dxgi','vulkan'].includes(api)) return false;
    const bin = path.dirname(exePath);
    const text = configText(journal.safePath(bin, 'OptiScaler.ini'), hostKeys[capability]);
    const accepts = capability === 'LoadReShade' ? acceptsProcess : acceptsFrameGenInput;
    if (!text || pe.getBitness(exePath, {exeOnly:true}) !== 64 || !accepts(text,exePath)) return false;
    if (capability === 'LoadAsiPlugins') {
      // The downloader writes to this one location. With the default PluginPath,
      // the host instead uses <OptiDllPath>/plugins when a custom root is set.
      journal.safePath(bin,'OptiScaler/plugins/MFGUnlocker.asi');
      if (!defaultPath(text,'Plugins','Path',bin,'OptiScaler/plugins')) return false;
      const pluginPath = getIni(text,'Plugins','Path');
      if ((!pluginPath || pluginPath.toLowerCase() === 'auto') && !defaultPath(text,'Libraries','OptiDllPath',bin,'OptiScaler')) return false;
    }
    const needsXeInput = capability === 'LoadAsiPlugins' && getIni(text,'FrameGen','FGInput')?.toLowerCase() === 'xefg';
    const imports = pe.getImports(exePath);
    return Object.entries(hooks).some(([name, hook]) =>
      ((api !== 'vulkan' && ['dxgi.dll','d3d12.dll'].includes(name)) || imports.includes(name)) &&
      isHost(journal.safePath(bin, name), hook, capability) &&
      (!needsXeInput || externalCapabilities(path.join(bin,name),!previewActive()).has('XeFG input hooks:')));
  } catch { return false; }
}
function hasAddonHost(exePath, api = 'dxgi') { return supportsHost(exePath,api,'FGNvngxReplacement'); }
function hasMfgAsiHost(exePath, api = 'dxgi') { return supportsHost(exePath,api,'LoadAsiPlugins'); }
function hasReShadeHost(exePath) { return supportsHost(exePath,'dxgi','LoadReShade'); }

function identify(sha) {
  for (const pack of catalog.packs.filter(p => p.id === 'anr' || p.id === 'anr-addon')) {
    if (pack.files.some(item => item.path.endsWith('/nvngx_dlssg.dll') && item.sha256 === sha)) {
      const files = Object.fromEntries(pack.files.filter(f => f.path.includes('/dlssg/'))
        .map(f => [f.path.split('/dlssg/')[1], f.sha256]));
      return {version:pack.version, files};
    }
  }
  if (sha === fullB18) return {version:'B18', files:{...history.B18, 'nvngx_dlssg.dll':sha}};
  for (const [version, changes] of Object.entries(history)) {
    // B15/B16 were recorded as differences from the B18 add-on.
    if (changes['nvngx_dlssg.dll'] === sha) return {version, files:{...history.B18, ...changes}};
  }
  return null;
}
function isLoader(file) {
  const stat = fs.lstatSync(file);
  return stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024 &&
    pe.getBitness(file, {dllOnly:true}) === 64 &&
    pe.hasExports(file, ['vkGetInstanceProcAddr', 'vkGetDeviceProcAddr'], 'vulkan-1.dll');
}
async function removeLoader(gameDir, file) {
  await journal.capture(gameDir, file);
  await fs.promises.unlink(file);
}

// Old builds could leave an unowned private loader after restore. Only reuse
// its exact, otherwise empty directory chain when there is no independent host.
async function clearLegacyTree(gameDir, bin, proxyNames) {
  const safe = name => journal.safePath(gameDir, path.relative(gameDir, path.join(bin, name)));
  const root = safe('OptiScaler');
  if (['OptiScaler.ini', 'OptiScaler.dll', 'OptiScaler.asi'].some(n => fs.existsSync(safe(n))) ||
      [...new Set([...proxyNames, ...Object.keys(hooks)])].some(n => fs.existsSync(safe(n)) &&
        (pe.versionMentions(safe(n), 'OptiScaler') || (hooks[n] && isHost(safe(n), hooks[n]))))) return false;
  if (!fs.existsSync(root)) return true;
  if (fs.existsSync(safe('OptiScaler.log'))) return false;
  let current = root;
  const directories = [];
  for (const name of ['custom', provider, 'dlssg', loaderName]) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    directories.push(current);
    const entries = fs.readdirSync(current);
    if (!entries.length) return true;
    if (entries.length !== 1 || (process.platform === 'win32' ? entries[0].toLowerCase() !== name.toLowerCase() : entries[0] !== name))
      return false;
    current = journal.safePath(gameDir, path.relative(gameDir, path.join(current, entries[0])));
  }
  if (!isLoader(current)) return false;
  await removeLoader(gameDir, current);
  for (const dir of directories.reverse()) await journal.removeEmptyDirectory(gameDir, dir);
  return true;
}

async function removeGeneratedLoader(gameDir, manifest) {
  if (!['anr', 'anr-addon'].includes(manifest.route)) return;
  const record = manifest.graphicsRoute;
  const bin = path.dirname(journal.safePath(gameDir, manifest.game.exe));
  const dir = manifest.route === 'anr' ? path.join(bin, privatePath)
    : record?.providerDir && path.join(journal.safePath(gameDir, record.providerDir), 'dlssg');
  if (!dir) return;
  const rel = path.relative(gameDir, dir);
  const core = path.join(rel, 'nvngx_dlssg.dll');
  if (!manifest.added.includes(core) || !identify(record?.files?.[core]) ||
      !(record?.generatedLoader ?? manifest.addedDirs?.includes(rel))) return;
  const loader = path.join(journal.safePath(gameDir, rel), loaderName);
  if (fs.existsSync(loader) && isLoader(loader)) await removeLoader(gameDir, journal.safePath(gameDir, path.relative(gameDir, loader)));
}
module.exports = {provider, loaderName, privatePath, identify, hasAddonHost, hasMfgAsiHost, hasReShadeHost, clearLegacyTree, removeGeneratedLoader};
