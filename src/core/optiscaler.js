'use strict';

const fs = require('./preview-fs').fs;
const replaceFile = require('./replace-file');
const path = require('path');
const extractZip = require('extract-zip');
const pe = require('./pe');
const ini = require('./feeder-config');
const { cached, fetchBytes, fetchVerified } = require('./runtime-components');
const { safePath } = require('./file-journal');
// More than one pinned build, because upgrading one broke a game and there was
// no way back: No Man's Sky runs on 0.1.1.5 and crashes on 0.2.0-patch1, and
// the only cure anybody had was to keep an old copy of the whole app (#238).
//
// This is not the "put your own DLL in the components folder" that #191 asked
// for and that the folder deliberately refuses. Every entry here is pinned by
// URL and by digest exactly as the single one was; there is simply more than
// one, and a game may name it. Nothing unverified becomes installable.
//
// Two lineages, not one line of versions. Dagherbou's build reaches the model
// through a small forwarder DLL and carries its own colour work - the highlight
// proxy, multi-point exposure calibration, the game's live exposure. wilsjo2's
// pre-SR fork runs the model before the upscaler with independent controls per
// pass, squeezes the periphery to spend less on it, and rebuilds lighting and
// colour when the model runs below 100%; it opens the runtime directly, so it
// has no forwarder at all - and a leftover one from the other build stops its
// pass without saying so, which is why installing it clears one away. The build
// pinned here is the DLSS5-Feeder author's fork of it, which fixes what the
// model is handed below 100% and the motion-vector scale in games that upscale,
// the two things that made every resolution under 100% flicker.
const FORWARDED = Object.freeze({
  forwarder: 'nvngx.dll_dlssnr.dll',
  notes: 'READ ME - DLSS Neural Rendering.txt',
  licenses: Object.freeze(['DirectX_LICENSE.txt', 'FidelityFX_v2_LICENSE.md', 'RenoDX_ATTRIBUTION.txt', 'XeSS_LICENSE.txt'])
});
const DIRECT = Object.freeze({
  forwarder: null,
  notes: 'INSTALL-DLSSNR.md',
  // Its GPL text rides in the archive rather than being fetched beside it.
  gpl: 'LICENSE',
  licenses: Object.freeze(['DirectX_LICENSE.txt', 'FidelityFX_v1_LICENSE.md', 'FidelityFX_v2_LICENSE.md',
    'PeripheralWarp_LICENSE.txt', 'RenoDX_ATTRIBUTION.txt', 'XeSS_LICENSE.txt'])
});
const RELEASES = Object.freeze([
  Object.freeze({
    version: '0.2.0-patch1',
    nativeVulkanNr: true,
    host: {size:25863680, sha256:'114a1d18e79d90a011406b9467b4b6dc4d4948487c4b30289311def311174bce'},
    forwarder: {size:114688, sha256:'17cf51d25d142d0be15fcac945cc928c37849a1cb61011cb9c742d72df86647c'},
    url: 'https://github.com/Dagherbou/OptiScaler_DLSSNR/releases/download/v0.2.0-patch1/OptiScaler-DLSSNR-v0.2.0-onimusha-fix.zip',
    sha256: '5db547216fa8a7dbd8ab0a193da1e3bce0ea4bd71f91189afa4ed2ede8bb9561',
    licenseUrl: 'https://raw.githubusercontent.com/Dagherbou/OptiScaler_DLSSNR/393e070/LICENSE',
    licenseHash: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
    layout: FORWARDED
  }),
  // The pre-SR multipass fork, pinned at the Feeder author's fixed build.
  Object.freeze({
    version: '0.8.92-presr',
    nativeVulkanNr: true,
    host: {size:26477568, sha256:'696308c0af61800124dcf59fb0cc131372024d275e2cdf8500e5b28dd9e494a7'},
    label: '0.8.92 - pre-SR multipass',
    url: 'https://github.com/jlrouzies-fr/OptiScaler-DLSSNR-PreSR-Multipass/releases/download/v0.8.92/OptiScaler-NR-v0.8.92.zip',
    sha256: '9605352af2378eeb5ef96aedf69c648b36152eea40a388cb5413ca6a408bf728',
    layout: DIRECT
  }),
  // What 2.2.1 shipped. Same archive layout, so it satisfies the same
  // validation; kept for the titles the newer build regressed on.
  Object.freeze({
    version: '0.1.1.5-dlssnr',
    host: {size:25712640, sha256:'365fd117fdcceedc9a75311243c0a3ef06d54252420547947d5782595aa35294'},
    forwarder: {size:108032, sha256:'528591737f2c049d1c88b42aa0a48398e3795d92ee786be3325879c89aa4d3ae'},
    url: 'https://github.com/Dagherbou/OptiScaler_DLSSNR/releases/download/v0.1.1.5-dlssnr/OptiScaler-DLSSNR-v0.1.1.5-dlssnr.zip',
    sha256: '735b10b4077bc187ba4d07d607e864349aca386344c6126aba61ced746d27ece',
    licenseUrl: 'https://raw.githubusercontent.com/Dagherbou/OptiScaler_DLSSNR/393e070/LICENSE',
    licenseHash: '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
    layout: FORWARDED
  })
]);
const RELEASE = RELEASES[0];
// An unknown name resolves to the current build rather than failing: a state
// file naming a version this app no longer carries must not stop an install.
const releaseFor = (version) => RELEASES.find((r) => r.version === version) || RELEASE;
const LIBRARIES = [
  'libxess.dll', 'libxess_dx11.dll', 'libxess_fg.dll', 'libxell.dll',
  'amd_fidelityfx_vk.dll', 'amd_fidelityfx_upscaler_dx12.dll',
  'amd_fidelityfx_loader_dx12.dll', 'amd_fidelityfx_framegeneration_dx12.dll',
  'D3D12_OptiScaler/D3D12Core.dll'
];
// The GPL text is written under one name whichever build supplied it.
const GPL_AS = 'OptiScaler/licenses/LICENSE.GPL-3.0.txt';
function fail(code, message = code) { return Object.assign(new Error(message), { code }); }
const inputKeys = {
  dlss:['EnableDlssInputs'], xess:['EnableXeSSInputs'], ffx:['EnableFfxInputs','UseFfxInputs'],
  fsr2:['EnableFsr2Inputs','UseFsr2Inputs'], fsr3:['EnableFsr3Inputs','UseFsr3Inputs']
};
const nrConfigKeys = {dlssnr:['enabled'], processfilter:['targetprocessname','processexclusionlist'],
  inputs:[...Object.values(inputKeys).flat().map(key => key.toLowerCase()),'usefsr2dx11inputs','usefsr2vulkaninputs'],
  upscalers:['dx11upscaler','vulkanupscaler']};
// The paired builds document Enabled=auto as false.
const disabled = value => /^(?:false|auto|0)$/i.test(value);
function validModel(file) {
  return pe.getBitness(file,{dllOnly:true}) === 64 && pe.matchesNvidiaFeature(file,'nr') &&
    require('./neural-models').inspectNeuralModelBinary(file).valid;
}
function hostConfig(exePath, api, receipt) {
  try {
    const {matches,configText,acceptsProcess} = require('./xemfg-optiscaler');
    const dir = path.dirname(exePath), cached = !require('./preview-fs').active();
    const hook = String(receipt.hook || '').toLowerCase();
    if (!['dxgi.dll','winmm.dll'].includes(hook) || (api && hook !== hookFor(api))) return false;
    const host = safePath(dir,hook);
    // An old receipt without a build can still identify the exact installed
    // release. An explicitly different build must not inherit its status.
    const legacy = receipt.version == null || receipt.version === '';
    const release = RELEASES.find(r => (legacy || r.version === receipt.version) && matches(host,r.host,cached));
    if (!release) return false;
    const forwarder = safePath(dir,FORWARDED.forwarder);
    if (release.forwarder ? !matches(forwarder,release.forwarder,cached) : fs.existsSync(forwarder)) return false;
    const config = configText(safePath(dir,'OptiScaler.ini'),nrConfigKeys);
    if (!config || !/^\s*\[(?:DlssNr|Upscalers|FrameGen|ProcessFilter|Plugins)\]\s*$/im.test(config) || !acceptsProcess(config,exePath)) return false;
    return {config, release};
  } catch { return false; }
}
function installed(exePath, api, receipt) {
  const host = hostConfig(exePath,api,receipt);
  if (!host) return false;
  const enabled = ini.getIni(host.config,'DlssNr','Enabled');
  if (enabled === null || disabled(enabled)) return true;
  try { return enabled.toLowerCase() === 'true' && validModel(safePath(path.dirname(exePath),'nvngx_dlssnr.dll')); }
  catch { return false; }
}
function dx11Inputs(scan) {
  const managed = new Set((scan.install?.added || []).map(rel => path.normalize(rel).toLowerCase()));
  const types = [];
  for (const file of [...scan.dlssFiles,...scan.upscalerFiles]) {
    if (file.bitness !== 64 || file.featureMismatch || managed.has(path.normalize(file.rel).toLowerCase())) continue;
    const name = file.name.toLowerCase();
    if (name === 'nvngx_dlss.dll' && !/^1\./.test(file.version || '') &&
        pe.hasExports(file.path,['NVSDK_NGX_D3D11_CreateFeature','NVSDK_NGX_D3D11_EvaluateFeature','NVSDK_NGX_D3D11_ReleaseFeature'])) types.push('dlss');
    if (name === 'libxess_dx11.dll' && pe.hasExports(file.path,['xessD3D11CreateContext','xessD3D11Init','xessD3D11Execute'])) types.push('xess');
  }
  return types;
}
function supportsNrOutput(field, value, release) {
  const output = value?.toLowerCase() || 'auto';
  if (field === 'Dx11Upscaler') return ['dlss_12','xess_12','fsr21_12','fsr22_12','ffx_12'].includes(output);
  if (['ffx_12','fsr21_12','fsr22_12'].includes(output)) return true;
  if (output === 'dlss_12') return release.version === '0.8.92-presr';
  // The post-upscale Vulkan pass and the pre-SR native Vulkan pass arrive
  // after 0.1.1.5. That release evaluates NR in its D3D12 bridge.
  return !!release.nativeVulkanNr && ['auto','dlss','fsr21','fsr22','ffx','xess'].includes(output);
}
function assertNeuralTarget(scan, manifest) {
  const target = scan.chosen;
  const host = target && scan.install?.exe && path.relative(path.resolve(scan.gameDir,scan.install.exe),target.path) === '' &&
    hostConfig(target.path,target.api,manifest.optiscaler);
  if (!host) throw fail('errOptiPayload','当前游戏程序的 OptiScaler 宿主、配套文件或配置已变化，请重新应用安装方式。');
  const {config,release} = host;
  const api = target.api === 'vulkan' ? 'vulkan' : target.api === 'dxgi' ? target.apiLabel : null;
  let types = [];
  if (target.bitness === 64 && !target.emulator) {
    if (api === 'DirectX 12') types = target.optiFgInputs || [];
    if (api === 'DirectX 11') types = dx11Inputs(scan);
    if (api === 'vulkan') types = [...(target.classicVkUpscalerInputs || []), ...(target.hasXeMfgDlssSrVk ? ['dlss'] : [])];
  }
  const bridge = api === 'DirectX 11' ? 'Dx11Upscaler' : api === 'vulkan' ? 'VulkanUpscaler' : null;
  if (bridge && !supportsNrOutput(bridge,ini.getIni(config,'Upscalers',bridge),release))
    throw fail('errOptiPayload','当前 OptiScaler 的超分输出不能在所选渲染接口上运行神经渲染。');
  const enabled = kind => inputKeys[kind]?.every(key => ini.getIni(config,'Inputs',key)?.toLowerCase() !== 'false') &&
    (kind !== 'fsr2' || ['UseFsr2Dx11Inputs','UseFsr2VulkanInputs'].every(key => ini.getIni(config,'Inputs',key)?.toLowerCase() !== 'true'));
  if (!types.some(enabled)) throw fail('errOptiNeedsDlss','当前游戏程序和渲染接口缺少已启用的 OptiScaler 超分输入。');
}
function validatePayload(root, release = RELEASE) {
  const layout = release.layout;
  const {matches} = require('./xemfg-optiscaler'), cached = !require('./preview-fs').active();
  if (!matches(safePath(root,'OptiScaler.dll'),release.host,cached) ||
      (release.forwarder && !matches(safePath(root,layout.forwarder),release.forwarder,cached))) throw fail('errOptiPayload');
  for (const name of LIBRARIES) {
    if (pe.getBitness(safePath(root, 'OptiScaler/' + name),{dllOnly:true}) !== 64) throw fail('errOptiPayload');
  }
  for (const rel of ['OptiScaler.ini', layout.notes, layout.gpl, ...layout.licenses.map(f => 'Licenses/' + f)].filter(Boolean)) {
    const file = safePath(root, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw fail('errOptiPayload');
  }
}
async function ensureOptiScaler(cacheRoot, version, signal) {
  const release = releaseFor(version);
  const base = path.join(path.resolve(cacheRoot), 'components', `OptiScaler-${release.version}`);
  const archive = base + '.zip';
  if (require('./preview-fs').active()) {
    try { if (cached(archive, release.sha256) && require('./cache-proof').valid(base, release.sha256)) { validatePayload(base, release); return base; } } catch {}
    require('./preview-fs').external('需要先准备 OptiScaler 缓存（不会修改游戏）', 'optiscaler:' + release.version);
  }
  if (!cached(archive, release.sha256)) await fetchVerified(release.url, release.sha256, archive, {signal});
  // Re-extract verified bytes on every install. The installer below copies an
  // explicit file list, not unknown files that may have appeared in the cache.
  signal?.throwIfAborted();
  await extractZip(archive, { dir: base });
  // One build publishes its licence beside the archive; the other carries it
  // inside. Either way what reaches the game is verified bytes.
  if (release.licenseUrl) {
    const license = path.join(base, 'OptiScaler-GPL-3.0.txt');
    if (!cached(license, release.licenseHash)) {
      try {
        await fetchVerified(release.licenseUrl, release.licenseHash, license, {signal, attempts:1});
      } catch (error) {
        if (error.code !== 'componentNetwork') throw error;
        const api = 'https://api.github.com/repos/Dagherbou/OptiScaler_DLSSNR/contents/LICENSE?ref=393e070';
        await fetchVerified(api, release.licenseHash, license, {signal,
          fetchBytes:(url, abort) => fetchBytes(url, abort, {Accept:'application/vnd.github.raw+json'})});
      }
    }
  }
  validatePayload(base, release);
  require('./cache-proof').save(base, release.sha256);
  return base;
}
function hookFor(api) { return api === 'vulkan' ? 'winmm.dll' : 'dxgi.dll'; }
function configure(text, target) {
  let out = text;
  for (const [section, key, value] of [
    ['DlssNr', 'Enabled', target.neuralOff ? 'false' : 'true'], ['Log', 'LogToFile', 'true'], ['Log', 'LogLevel', '2'],
    ['Spoofing', 'Dxgi', 'false'], ['Plugins', 'LoadAsiPlugins', target.keepAsi ? 'true' : 'false'],
    ['ProcessFilter', 'TargetProcessName', path.basename(target.exePath)]
  ]) out = ini.setIni(out, section, key, value);
  // Keep a supported custom backend. A game may change API via launch arguments.
  for (const field of ['Dx12Upscaler', 'Dx11Upscaler', 'VulkanUpscaler']) {
    const current = ini.getIni(out, 'Upscalers', field);
    const bridge = field !== 'Dx12Upscaler';
    if (!current || current === 'auto' || (bridge && !supportsNrOutput(field,current,releaseFor(target.optiVersion)))) {
      out = ini.setIni(out, 'Upscalers', field, bridge ? 'ffx_12' : 'dlss');
    }
  }
  return out;
}
function copyPlan(root, api, release = RELEASE) {
  const layout = release.layout;
  return [
    ['OptiScaler.dll', hookFor(api)],
    ...(layout.forwarder ? [[layout.forwarder, layout.forwarder]] : []),
    ...LIBRARIES.map(f => ['OptiScaler/' + f, 'OptiScaler/' + f]),
    ...layout.licenses.map(f => ['Licenses/' + f, 'OptiScaler/licenses/' + f]),
    [layout.gpl || 'OptiScaler-GPL-3.0.txt', GPL_AS],
    [layout.notes, 'OptiScaler/README-DLSSNR.txt']
  ].map(([from, to]) => ({ from: safePath(root, from), to }));
}
function checkConflicts(gameDir, exePath, manifest, api) {
  // Inspect the baseline too: switching restores it before installing. Never
  // silently clobber another proxy, OptiScaler install or ASI loader.
  const { originalPath } = require('./apply');
  const exeDir = path.dirname(exePath);
  const added = new Set((manifest?.added || []).map(f => f.toLowerCase()));
  const replacements = new Map((manifest?.replaced || []).map(f => [f.rel.toLowerCase(), f]));
  const names = new Set([...fs.readdirSync(exeDir), 'dxgi.dll', 'winmm.dll', 'OptiScaler.ini']);
  const hook = hookFor(api);
  for (const name of names) {
    if (!/^(?:dxgi|winmm|version|dbghelp|dbgcore|d3d12|d3d11|d3d9|opengl32|wininet|winhttp|nvngx|nvapi64|OptiScaler)\.(?:dll|ini|asi)$/i.test(name) && !/\.asi$/i.test(name)) continue;
    const rel = path.relative(gameDir, path.join(exeDir, name));
    if (added.has(rel.toLowerCase())) continue;
    const file = replacements.has(rel.toLowerCase()) ? originalPath(gameDir, manifest, rel) : safePath(gameDir, rel);
    if (!fs.existsSync(file)) continue;
    // A pre-existing ReShade under the selected proxy name can be replaced
    // with a tracked backup. Other proxies require explicit user cleanup.
    if (name.toLowerCase() === hook && pe.versionMentions(file, 'ReShade')) continue;
    // dbghelp/dbgcore are on the list because Ultimate ASI Loader ships under
    // those names - but they are also genuine Windows components that games
    // ship for their own crash reporting. Cyberpunk 2077 carries both, and
    // every OptiScaler install there was refused as "another loader/mod".
    // Microsoft own the real ones; the loaders do not claim to.
    if (/^dbg(?:help|core)\.dll$/i.test(name) && pe.versionMentions(file, 'Microsoft')) continue;
    throw fail('errOptiConflict', `Conflicting pre-existing file: ${path.join(exeDir, name)}. Restore/remove the other mod with its own installer first.`);
  }
  const pluginDir = path.join(exeDir, 'OptiScaler', 'plugins');
  if (fs.existsSync(pluginDir) && fs.readdirSync(pluginDir).some(f => /\.(dll|asi)$/i.test(f) && !added.has(path.relative(gameDir, path.join(pluginDir, f)).toLowerCase()))) throw fail('errOptiConflict', 'Existing OptiScaler plugins need to be removed with their original installer first.');
  for (const name of LIBRARIES) {
    const rel = path.relative(gameDir, path.join(exeDir, 'OptiScaler', name));
    if (!added.has(rel.toLowerCase()) && fs.existsSync(safePath(gameDir, rel))) throw fail('errOptiConflict', `Pre-existing OptiScaler component: ${rel}`);
  }
}
// The forwarder belongs to one lineage only. Left beside a build that opens the
// runtime directly, the neural pass quietly does nothing - upstream lists it
// with FinishedPicture and a wrong TargetProcessName as the three settings that
// stop the pass without a word in any log. It is retired the way any replaced
// file is, so Restore originals still puts the game back exactly as it was.
async function retireForwarder(manifest, gameDir, exeDir, log) {
  const { trackBeforeWrite, saveActiveManifest } = require('./apply');
  const file = path.join(exeDir, FORWARDED.forwarder);
  if (!fs.existsSync(file)) return;
  const rel = await trackBeforeWrite(manifest, gameDir, file, { kind: 'optiscaler' });
  await saveActiveManifest(gameDir, manifest);
  await replaceFile.makeWritable(file).catch(() => {});
  await fs.promises.unlink(file);
  log({ code: 'forwarderRetired', params: { rel } });
}
async function install(config, log) {
  const { beginManifest, copyTracked, writeTracked, saveActiveManifest } = require('./apply');
  const { gameDir, exePath, api, optiRoot, source } = config;
  // Which build this game asked for. #238 gave every game its own choice, and
  // the manifest recorded the default no matter what was installed.
  const release = releaseFor(config.optiVersion);
  validatePayload(optiRoot, release);
  const manifest = beginManifest(gameDir, exePath, api);
  const exeDir = path.dirname(exePath), model = safePath(exeDir,'nvngx_dlssnr.dll');
  const file = safePath(exeDir,'OptiScaler.ini'), prior = config.profile?.[path.relative(gameDir, file)] ?? ini.readText(file);
  const currentEnabled = ini.getIni(prior,'DlssNr','Enabled');
  const neuralOff = currentEnabled == null
    ? Boolean(prior) || (manifest.route === 'optiscaler' && manifest.neuralRendering?.mode === 'off')
    : disabled(currentEnabled);
  const existing = fs.existsSync(model);
  let sourceModel;
  if (!neuralOff) {
    if (existing && !validModel(model)) throw fail('errInvalidNeuralModel','游戏目录中的 nvngx_dlssnr.dll 不是有效的 x64 神经渲染模型。');
    if (!existing) {
      const nr = source?.payload?.find(f => f.name.toLowerCase() === 'nvngx_dlssnr.dll');
      if (!nr) throw fail('errNoNeuralRuntime');
      sourceModel = require('./component-deploy').resolveSource(gameDir,nr.path,model);
      if (!validModel(sourceModel)) throw fail('errInvalidNeuralModel','选中的 nvngx_dlssnr.dll 不是有效的 x64 神经渲染模型。');
    }
  }
  manifest.route = 'optiscaler';
  manifest.game.bitness = 64;
  manifest.game.apiLabel = config.apiLabel;
  manifest.optiscaler = { version: release.version, hook: hookFor(api) };
  if (!release.layout.forwarder) await retireForwarder(manifest, gameDir, exeDir, log);
  for (const item of copyPlan(optiRoot, api, release)) {
    const rel = await copyTracked(manifest, gameDir, item.from, path.join(exeDir, item.to), { kind: 'optiscaler' });
    log({ code: 'added', params: { rel } });
  }
  // Players can have a different valid model for their hardware.
  if (!neuralOff && existing) {
    log({ code: 'neuralModelKept', params: { rel: path.relative(gameDir, model) } });
  } else if (sourceModel) {
    await copyTracked(manifest, gameDir, sourceModel, model, { kind: 'runtime' });
  }
  const keepAsi = manifest.mfg?.backend === 'mfg-unlocker-asi' && fs.existsSync(path.join(exeDir,'OptiScaler','plugins','MFGUnlocker.asi'));
  await writeTracked(manifest, gameDir, file, configure(prior || ini.readText(path.join(optiRoot, 'OptiScaler.ini')), {...config,keepAsi,neuralOff}), { kind: 'config' });
  await saveActiveManifest(gameDir, manifest);
  return manifest;
}
module.exports = { RELEASE, RELEASES, releaseFor, LIBRARIES, ensureOptiScaler, validatePayload, configure, copyPlan, hookFor, checkConflicts, installed, assertNeuralTarget, install };
