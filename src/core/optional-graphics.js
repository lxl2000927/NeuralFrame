'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { fs } = require('./preview-fs');
const journal = require('./file-journal');
const apply = require('./apply');
const ini = require('./feeder-config');
const pe = require('./pe');
const catalog = require('./runtime-catalog.json');
const routes = require('../shared/install-routes');
const fail = (message) => Object.assign(new Error(message), { code: 'errGraphicsRoute' });
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const anrProvider = require('./anr');
const provider = anrProvider.provider;
// Known localization builds may be upgraded in place even when the game
// acquired them before the standalone monitor had its own install record.
const previousLocalization = {
  32:['5b15891ad240093e1e798540854824ac52f248a96703690132246ca172bf3faa','d6fec692366bd9c2e79731c2bd913264f30f3b5c28ad8d50355768769a5e2d8c','8df3d030160d9cc60b785320a8abe55b614a546743b0fd8bd498e9cc1543da3a'],
  64:['41f5e109dfcb24d56e656da8dee31dc4f013a552173aed9602c68adef9d0d4d5','67c0f5728901a08e4ecb1584b1c0f0a04f8e970af6a4688fc7758e9393da5226','d7af14c6e37c58a7b6e193ceb97106deb918c84a7c554a75026f5660fd72e960'],
};
const isRoute = (route) => routes.componentRoutes.includes(route);
const proxyNames = ['dxgi.dll', 'winmm.dll', 'version.dll', 'dinput8.dll', 'dbghelp.dll', 'd3d12.dll'];

function checkOwned(gameDir, manifest) {
  const backend = isRoute(manifest?.route) || manifest?.route === 'hud';
  if (backend && !manifest.graphicsRoute?.files) throw fail('缺少安装文件归属记录，请保留备份。');
  const files = {...(backend && manifest.graphicsRoute.files), ...manifest?.performanceMonitor?.files};
  for (const [rel, sha] of Object.entries(files)) {
    const file = journal.safePath(gameDir, rel);
    if (fs.existsSync(file) && digest(file) !== sha) throw fail('部署后文件已变化，请先处理：' + rel);
  }
}

function readConfig(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw fail('配置文件无效：' + file);
  const data = fs.readFileSync(file);
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf16le' : 'utf8';
  const text = data.toString(encoding);
  if (text.includes('\0') || (encoding === 'utf16le' && data.length % 2)) throw fail('配置文件编码无效：' + file);
  return { text, encoding };
}

function textFile(file) {
  return fs.existsSync(file) ? readConfig(file).text : '';
}
function addonBase(gameDir, bin, text) {
  const value = ini.getIni(text, 'Libraries', 'OptiDllPath');
  const base =
    value === null || /^auto$/i.test(value)
      ? fs.existsSync(path.join(bin, 'OptiScaler'))
        ? path.join(bin, 'OptiScaler')
        : bin
      : path.resolve(bin, value.replace(/[\\/]/g,path.sep));
  return journal.safePath(gameDir, path.relative(gameDir, path.join(base, 'custom', provider)));
}

function validateTarget(options) {
  const { gameDir, exePath, api, apiLabel, bitness, route, gpuName, target } = options;
  const protectedRoot = require('./wuthering-waves').gameRoot(gameDir, exePath);
  const current = { ...target, path: exePath, api, apiLabel, bitness, launcherProtected: !!target?.launcherProtected || !!protectedRoot };
  if (route === 'anr-addon') {
    current.hasAnrAddonHost = anrProvider.hasAddonHost(exePath,api);
    if (!current.hasAnrAddonHost) throw fail('ANR 附加包需要当前游戏可加载、支持自定义帧生成提供程序的 OptiScaler。');
  }
  if (Object.hasOwn(routes.graphicsRouteReasons, route)) {
    current.antiCheatWarning = !!target?.antiCheatWarning || require('./compatibility').hasAntiCheat(gameDir, exePath);
    const reason = routes.graphicsRouteReasons[route](current);
    if (reason) throw fail(reason);
  }
  if (route === 'hud' ? !routes.supportsPerformanceMonitor(current) : !routes.componentRoutesFor(current).includes(route))
    throw fail('所选路线与当前程序、图形 API 或帧生成输入不匹配。');
  if (route.startsWith('sm86') && !/\bRTX\s*(?:20|30|40|50)\d\d/i.test(gpuName || ''))
    throw fail('Dlssg_for_sm86 需要 NVIDIA GeForce RTX 20–50 系列显卡。');
  if (route.startsWith('anr')) {
    const reason = routes.anrGpuReason(gpuName);
    if (reason) throw fail(reason);
  }
  const neural = options.graphics?.neural;
  if (neural !== undefined && (route !== 'anr' || typeof neural !== 'boolean'))
    throw fail('神经渲染选项只适用于 ANR 完整包。');
  if (neural) {
    const gpu = require('./neural-models').detectGpuArchitecture(gpuName);
    const reason = routes.anrNeuralReason(target, gpu.sm);
    if (reason) throw fail(reason);
  }
}

function ownedConflict(file) {
  throw fail('目标已由游戏或其他插件使用：' + file);
}

function monitorSettings(config, defaultMode = 0) {
  const mode = ini.getIni(config, 'DLSS5Swapper.HUD', 'Mode');
  const corner = ini.getIni(config, 'DLSS5Swapper.HUD', 'Corner');
  return {mode:/^[0-2]$/.test(mode) ? Number(mode) : defaultMode, corner: /^[0-3]$/.test(corner) ? Number(corner) : 1};
}

function monitorAddonPath(gameDir, exePath, name, config) {
  const directory = ini.getIni(config, 'ADDON', 'AddonPath') || '.';
  return journal.safePath(gameDir, path.relative(gameDir, path.resolve(path.dirname(exePath), directory, name)));
}

function matchesRelease(file, item) {
  if (!item || !fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  return stat.isFile() && stat.size === item.size && digest(file) === item.sha256;
}

// A proxy only covers the renderer that loads it. ReShadeNN.dll and .asi
// builds need a separate loader. A copy next to the game proves neither.
function monitorHost(exe, requestedProxy) {
  const bin = path.dirname(exe.path);
  const local = name => path.join(bin, name);
  const {api, apiLabel, bitness} = exe;
  const dgFiles = api === 'd3d8' ? ['D3D8.dll'] : api === 'ddraw' ? ['DDraw.dll','D3DImm.dll']
    : api === 'd3d9' && pe.versionMentions(local('D3D9.dll'),'dgVoodoo') ? ['D3D9.dll'] : [];
  const missingWrappers = dgFiles.filter(name => !pe.versionMentions(local(name),'dgVoodoo') || pe.getBitness(local(name)) !== bitness);
  const translated = dgFiles.length > 0;
  const output = translated && ini.getIni(textFile(local('dgVoodoo.conf')), 'General', 'OutputAPI');
  const dx11 = translated ? /^d3d11/i.test(output || '') : api === 'dxgi' && apiLabel === 'DirectX 11';
  const dx12 = translated ? /^d3d12/i.test(output || '') : api === 'dxgi' && apiLabel === 'DirectX 12';
  const hooks = api === 'opengl' ? ['opengl32.dll'] : api === 'd3d9' && !translated ? ['d3d9.dll']
    : dx11 && requestedProxy === 'd3d11' ? ['d3d11.dll','dxgi.dll']
    : ['dxgi.dll', ...(dx11 ? ['d3d11.dll'] : dx12 ? ['d3d12.dll'] : [])];
  if (pe.getImports(exe.path).includes('dinput8.dll')) hooks.push('dinput8.dll');
  const names = [...hooks];
  const proxyFiles = [...new Set([...hooks, 'winmm.dll', 'version.dll', 'dinput8.dll', 'dbghelp.dll', 'dbgcore.dll', 'winhttp.dll'])].map(local);
  const optiLoader = api === 'dxgi' && bitness === 64 && fs.existsSync(local('OptiScaler.ini')) && anrProvider.hasReShadeHost(exe.path);
  const chainEnabled = optiLoader && ini.getIni(textFile(local('OptiScaler.ini')), 'Plugins', 'LoadReshade')?.toLowerCase() === 'true';
  const legacyLoader = api === 'opengl' && bitness === 32 && matchesRelease(local('winmm.dll'),
    catalog.packs.find(p => p.id === 'localization').files.find(f => f.path.endsWith('/winmm.dll')));
  if (chainEnabled || legacyLoader) names.push('ReShade' + bitness + '.dll');
  if (proxyFiles.some(file => pe.getBitness(file) === bitness && pe.versionMentions(file,'ASI Loader')))
    names.push(...fs.readdirSync(bin).filter(name => /\.asi$/i.test(name)));
  const {inspectReShade} = require('./scan');
  let host = inspectReShade(bin,[]);
  for (const name of names) {
    const candidate = inspectReShade(bin,[name]);
    if (!candidate.installed) continue;
    if (!host.installed) host = candidate;
    if (candidate.addonSupport && pe.getBitness(local(name),{dllOnly:true}) === bitness) {
      host = candidate;
      break;
    }
  }
  return {host, optiLoader, missingWrappers, hooks};
}

function addonProxy(exe,reshadeProxy) {
  const bin = path.dirname(exe.path);
  const {host,hooks,missingWrappers} = monitorHost(exe,reshadeProxy);
  let issue;
  if (missingWrappers.length) issue = '缺少游戏渲染器使用的 dgVoodoo 包装器。';
  else if (host.installed && pe.getBitness(path.join(bin,host.file),{dllOnly:true}) !== exe.bitness)
    issue = '已有 ReShade 架构不匹配。';
  else if (host.installed && !host.addonSupport) issue = '现有 ReShade 未提供 add-on 支持。';
  const hook = host.file || hooks.find(name=>!fs.existsSync(path.join(bin,name)));
  if (!hook) issue ||= '目标已由游戏或其他插件使用：' + hooks.join(' / ');
  return {hook:issue ? undefined : hook,issue,installed:host.installed,
    avoidedConflict:!issue && hook!==hooks[0] && fs.existsSync(path.join(bin,hooks[0])) ? hooks[0] : null};
}

async function prepareReShadeHost({gameDir,exe,manifest,payloadDir,userDataDir,reshadeProxy,registryRunner},onLog) {
  const bin = path.dirname(exe.path);
  const layer = require('./vulkan-layer');
  const sourceDir = path.join(payloadDir,'reshade-vulkan');
  if (exe.api === 'vulkan') {
    manifest.vulkanLayer = await layer.register({sourceDir,targetDir:path.join(userDataDir,'reshade-vulkan'),
      gameDir,bitness:exe.bitness,runner:registryRunner,requireAddonHost:true});
    await apply.retireVulkanDxgi(manifest,gameDir,bin);
    return;
  }
  const {hook,issue,installed} = addonProxy(exe,reshadeProxy);
  if (issue) throw fail(issue);
  if (installed) return;
  const file = path.join(bin,hook);
  const source = layer.checkedReShadeFile(sourceDir,'ReShade'+exe.bitness+'.dll');
  await apply.copyTracked(manifest,gameDir,source,file,{kind:'reshade'});
  manifest.reshade.installedByUs = true;
  manifest.reshade.file = hook;
  onLog?.({code:'reshadeInstalled',params:{version:pe.getFileVersion(file),file:hook,bitness:exe.bitness}});
}

function inspectPerformanceMonitor(gameDir, exe, deployment) {
  const bin = path.dirname(exe.path);
  try {
    const name = 'dlss5-zh-cn.addon' + exe.bitness;
    const config = textFile(journal.safePath(gameDir, path.relative(gameDir, path.join(bin, 'ReShade.ini'))));
    const file = monitorAddonPath(gameDir, exe.path, name, config);
    const release = catalog.packs.find(pack => pack.id === 'localization').files.find(item => item.path.endsWith('/' + name));
    if (!release || !fs.existsSync(file) || fs.statSync(file).size !== release.size || digest(file) !== release.sha256)
      return {installed:false, ...monitorSettings(config, 1)};
    if (!exe.api && !deployment) deployment = require('./backend-manager').readManifest(gameDir);
    const target = deployment?.game || deployment;
    const sameExe = target?.exe && path.relative(path.resolve(gameDir,target.exe),exe.path) === '';
    if (!exe.api && sameExe) exe = {...exe, api:target.api, apiLabel:target.apiLabel};
    if (!routes.supportsPerformanceMonitor(exe)) return {installed:false, ...monitorSettings(config,1)};
    const layer = sameExe && target.api === 'vulkan' && !!deployment?.vulkanLayer?.manifest &&
      fs.existsSync(deployment.vulkanLayer.manifest);
    let host = layer;
    if (exe.api !== 'vulkan') {
      const result = monitorHost(exe);
      host = !result.missingWrappers.length && result.host.addonSupport && pe.getBitness(path.join(bin,result.host.file)) === exe.bitness;
    }
    const installed = !!host && ini.enableAddons(config, [name]) === config;
    return {installed, ...monitorSettings(config, installed ? 0 : 1)};
  } catch { return {installed:false}; }
}

async function install(options) {
  validateTarget(options);
  if (options.route === 'xemfg') return require('./xemfg').install(options);
  const {
    gameDir,
    exePath,
    api,
    apiLabel,
    bitness,
    route,
    payloadDir,
    userDataDir,
    graphics = {},
    profile = {},
  } = options;
  const bin = path.dirname(exePath);
  const local = (name) => journal.safePath(gameDir, path.relative(gameDir, path.join(bin, name)));
  const manifest = apply.beginManifest(gameDir, exePath, api);
  const monitor = route === 'hud';
  const active = options.activeManifest;
  const overlayOnBackend = monitor && active && active.route !== 'hud';
  const old = overlayOnBackend ? manifest.performanceMonitor : manifest.route === route ? manifest.graphicsRoute : null;
  if (old || manifest.performanceMonitor) checkOwned(gameDir, manifest);
  if (overlayOnBackend) manifest.game = {...active.game};
  else manifest.route = route;
  manifest.game.bitness = bitness;
  manifest.game.apiLabel = apiLabel;
  const owned = old?.files || {};
  const files = { ...owned },
    settings = options.monitorSettingsOnly ? [...(old?.settings || [])] : [];
  const shared = { ...old?.shared };
  let updateNeural = false;
  function checkedSource(pack, item) {
    const source = journal.safePath(payloadDir, item.path);
    if (!fs.existsSync(source) || fs.statSync(source).size !== item.size || digest(source) !== item.sha256)
      throw Object.assign(fail('请重新准备组件：' + pack.name), { dependencies: ['runtime:' + pack.id] });
    return source;
  }
  async function copy(source, dest, sha, replaceHost = false) {
    const rel = path.relative(gameDir, dest);
    // An identical wrapper or localization add-on may already belong to the
    // game or its backend. Reuse it without taking ownership.
    if (monitor && !owned[rel] && fs.existsSync(dest) && digest(dest) === sha) return;
    if (fs.existsSync(dest) && !owned[rel] && !replaceHost) ownedConflict(rel);
    if (!fs.existsSync(dest) || digest(dest) !== sha)
      await apply.copyTracked(manifest, gameDir, source, dest, { kind: 'addon' });
    files[rel] = sha;
  }
  async function edit(dest, initial, fields, allowExisting = false) {
    const rel = path.relative(gameDir, dest);
    if (fs.existsSync(dest) && !allowExisting && !old?.settings.includes(rel)) ownedConflict(rel);
    const currentFile = fs.existsSync(dest) ? readConfig(dest) : null;
    const current = currentFile?.text ?? null;
    const encoding = currentFile?.encoding || 'utf8';
    const base = current ?? profile[rel] ?? initial;
    const bom = base.startsWith('\uFEFF') ? '\uFEFF' : '';
    let text = base.slice(bom.length);
    const created = [];
    for (const [section, key, value] of fields) {
      if (value !== undefined && ini.getIni(text, section, key) !== String(value))
        text = allowExisting ? ini.editIniField(text, section, key, String(value), created) : ini.setIni(text, section, key, String(value));
    }
    // ANR add-on and the monitor can edit different keys in an external
    // OptiScaler.ini. Keep one field-level rollback record for that file.
    const hostShared = overlayOnBackend && manifest.graphicsRoute?.shared?.[rel];
    if (
      allowExisting &&
      fields.length &&
      (current !== null || route === 'hud') &&
      !options.keepOptiHost &&
      (monitor || !manifest.optiscaler) &&
      !(overlayOnBackend && !hostShared && !old?.shared?.[rel] &&
        (active.added.includes(rel) || active.replaced.some(item => item.rel === rel && item.kind !== 'optiscaler-shared-config')))
    ) {
      const records = hostShared ? manifest.graphicsRoute.shared : shared;
      const previous = records[rel];
      const originalFields = previous?.fields || [];
      const changes = fields
        .filter(([, , value]) => value !== undefined)
        .map(([section, key, value]) => {
          const saved = originalFields.find((field) => field.section === section && field.key === key);
          return {
            section,
            key,
            value: String(value),
            before: saved && ini.getIni(current || '', section, key) === saved.value ? saved.before : ini.getIni(current || '', section, key),
          };
        });
      records[rel] = {
        created: [...new Set([...(previous?.created || []), ...created])],
        fields: [
          ...originalFields.filter(
            (field) => !changes.some((item) => item.section === field.section && item.key === field.key),
          ),
          ...changes,
        ],
        edited: previous?.edited || !!(previous && current !== null && digest(dest) !== previous.installed),
        installed: crypto
          .createHash('sha256')
          .update(bom + text, encoding)
          .digest('hex'),
      };
    }
    if (current !== bom + text)
      await apply.writeTracked(manifest, gameDir, dest, Buffer.from(bom + text, encoding), { kind: 'config' });
    if (!settings.includes(rel)) settings.push(rel);
  }
  if (monitor && options.monitorSettingsOnly) {
    if (!inspectPerformanceMonitor(gameDir,{path:exePath,rel:path.relative(gameDir,exePath),bitness,api,apiLabel},active).installed)
      throw fail('请先在附加组件中安装 F7 性能监控。');
    await edit(local('ReShade.ini'), '', [
      ['DLSS5Swapper.HUD','Mode',options.monitorMode], ['DLSS5Swapper.HUD','Corner',options.monitorCorner],
    ], true);
  } else if (monitor) {
    const exe = {path:exePath,rel:path.relative(gameDir,exePath),bitness,api,apiLabel};
    if (options.requirePayload && !inspectPerformanceMonitor(gameDir,exe,active).installed)
      await options.requirePayload({kind:'enhanced',route:'hud'});
    const catalogFile = (id, suffix, dest) => {
      const pack = catalog.packs.find((p) => p.id === id);
      const item = pack.files.find((f) => f.path.endsWith('/' + suffix));
      if (fs.existsSync(dest) && fs.statSync(dest).size === item.size && digest(dest) === item.sha256)
        return [dest,item.sha256];
      return [checkedSource(pack, item), item.sha256];
    };
    const addon = 'dlss5-zh-cn.addon' + bitness;
    if (api === 'vulkan') {
      if (process.platform !== 'win32') throw fail('Vulkan HUD 需要 Windows 的 ReShade 层。');
      if (!manifest.vulkanLayer?.manifest || !fs.existsSync(manifest.vulkanLayer.manifest)) {
        manifest.vulkanLayer = await require('./vulkan-layer').register({
          sourceDir: path.join(payloadDir, 'reshade-vulkan'),
          targetDir: path.join(userDataDir, 'reshade-vulkan'),
          gameDir,
          bitness,
          runner: options.registryRunner,
        });
      }
    } else {
      const {host,hooks,optiLoader,missingWrappers} = monitorHost(exe,options.reshadeProxy);
      if (missingWrappers.length) {
        const dg = await require('./runtime-components').ensureDgVoodoo(userDataDir);
        for (const name of missingWrappers) {
          const source = path.join(dg, 'MS', bitness === 32 ? 'x86' : 'x64', name);
          await copy(source, local(name), digest(source));
        }
        await edit(local('dgVoodoo.conf'), textFile(path.join(dg, 'dgVoodoo.conf')), [], true);
      }
      const optiChain = optiLoader && (!host.installed || host.kind === 'preloader');
      const hook = host.file || (optiChain ? 'ReShade' + bitness + '.dll' : hooks.find(name => !fs.existsSync(local(name))));
      if (!hook) ownedConflict(hooks.join(' / '));
      const existing = host.installed ? host : require('./scan').inspectReShade(bin,[hook]);
      if (existing.installed && pe.getBitness(local(hook)) !== bitness)
        throw fail('已有 ReShade 架构不匹配。');
      if (existing.installed && !existing.addonSupport) throw fail('现有 ReShade 未提供 add-on 支持。');
      if (!existing.installed || owned[path.relative(gameDir, local(hook))]) {
        const [source, sha] = catalogFile('reshade', 'ReShade' + bitness + '.dll', local(hook));
        await copy(source, local(hook), sha);
      }
      if (optiChain) {
        if (!fs.existsSync(local('OptiScaler.ini'))) throw fail('缺少 OptiScaler.ini。');
        await edit(local('OptiScaler.ini'), '', [['Plugins','LoadReshade','true']], true);
        if (active?.route === 'anr') manifest.graphicsRoute.chainReShade = true;
      }
    }
    const targetIni = local('ReShade.ini');
    const current = textFile(targetIni);
    const dest = monitorAddonPath(gameDir, exePath, addon, current);
    const [addonSource, addonSha] = catalogFile('localization', addon, dest);
    await copy(addonSource, dest, addonSha, fs.existsSync(dest) && previousLocalization[bitness].includes(digest(dest)));
    const enabled = ini.enableAddons(current, [addon]);
    await edit(
      targetIni,
      '',
      [
        ['DLSS5Swapper.HUD', 'Mode', options.monitorMode ?? ini.getIni(current, 'DLSS5Swapper.HUD', 'Mode') ?? 1],
        ['DLSS5Swapper.HUD', 'Corner', options.monitorCorner],
        ...['', 'ADDON'].map(section => [section, 'DisabledAddons', ini.getIni(enabled, section, 'DisabledAddons') ?? undefined]),
      ],
      true,
    );
  } else if (route === 'xemfg-optiscaler') {
    manifest.graphicsRoute = await require('./xemfg-optiscaler').deploy({...options, graphics, old, local, copy, edit, checkedSource});
  } else if (route === 'optifg') {
    manifest.graphicsRoute = await require('./optifg').deploy({...options, graphics, old, local, edit});
  } else {
    const pack = catalog.packs.find((p) => p.id === route);
    const addonOnly = route === 'anr-addon',
      isAnr = route.startsWith('anr');
    const opti = local('OptiScaler.ini');
    let addonDir, previousProvider;
    let chainReShade = !!old?.chainReShade,
      moveHost = false;
    if (route === 'anr' && !old && api === 'dxgi') {
      const rs = require('./scan').inspectReShade(bin);
      if (rs.installed && rs.addonSupport && ['dxgi.dll', 'reshade64.dll'].includes(rs.file.toLowerCase())) {
        if (require('./pe').getBitness(local(rs.file)) !== bitness) throw fail('已有 ReShade 架构不匹配。');
        moveHost = rs.file.toLowerCase() === 'dxgi.dll';
        if (moveHost) {
          await copy(local(rs.file), local('ReShade64.dll'), digest(local(rs.file)));
          // ANR now owns both the renamed host and its replacement DXGI proxy.
          if (manifest.performanceMonitor) delete manifest.performanceMonitor.files[path.relative(gameDir,local(rs.file))];
        }
        chainReShade = true;
      }
    }
    if (graphics.neural) {
      const host = require('./scan').inspectReShade(bin);
      if (host.file?.toLowerCase() === 'reshade64.dll') chainReShade = true;
      if (host.installed && !host.addonSupport) throw fail('现有 ReShade 未提供 add-on 支持。');
      if (api === 'vulkan') {
        if (process.platform !== 'win32') throw fail('Vulkan ReShade 需要 Windows 的层注册。');
        manifest.vulkanLayer = await require('./vulkan-layer').register({
          sourceDir: path.join(payloadDir, 'reshade-vulkan'),
          targetDir: path.join(userDataDir, 'reshade-vulkan'),
          gameDir,
          bitness,
          runner: options.registryRunner,
        });
      } else if (!host.installed) {
        const pack = catalog.packs.find((p) => p.id === 'reshade');
        const item = pack.files.find((f) => f.path.endsWith('/ReShade64.dll'));
        await copy(checkedSource(pack, item), local('ReShade64.dll'), item.sha256);
        chainReShade = true;
      }
      const pack = catalog.packs.find((p) => p.id === 'renodx-nr');
      const item = pack.files.find((f) => f.path === 'renodx-dlss5.addon64');
      const dest = local(item.path);
      if (!fs.existsSync(dest) || digest(dest) !== item.sha256)
        await copy(checkedSource(pack, item), dest, item.sha256);
      updateNeural = true;
    } else if (
      graphics.neural === false &&
      (old?.neural || (manifest.neuralRendering?.mode && manifest.neuralRendering.mode !== 'off'))
    ) {
      updateNeural = true;
      delete files[path.relative(gameDir, local('renodx-dlss5.addon64'))];
    }
    if (chainReShade) manifest.graphicsRoute = { ...manifest.graphicsRoute, chainReShade: true };
    const anrHook =
      old?.proxy ||
      (api === 'vulkan' || (!moveHost && fs.existsSync(local('dxgi.dll'))) ? 'winmm.dll' : 'dxgi.dll');
    if (route === 'anr') manifest.graphicsRoute = { ...manifest.graphicsRoute, proxy: anrHook };
    if (addonOnly) {
      if (!anrProvider.hasAddonHost(exePath, api)) throw fail('ANR 附加包需要当前游戏可加载、支持自定义帧生成提供程序的 OptiScaler。');
      addonDir = addonBase(gameDir, bin, textFile(opti));
      if (!old && fs.existsSync(addonDir)) {
        // Only replace files that match the installed release of the external provider.
        const coreName = 'nvngx_dlssg.dll';
        const binary = journal.safePath(
          gameDir,
          path.relative(gameDir, path.join(addonDir, 'dlssg', coreName)),
        );
        if (!fs.existsSync(binary)) ownedConflict(addonDir);
        const sha = digest(binary);
        previousProvider = anrProvider.identify(sha)?.files;
        if (!previousProvider) ownedConflict(binary);
      }
      if (old?.providerDir && path.relative(gameDir, addonDir) !== old.providerDir)
        throw fail('OptiScaler 组件目录已变化，请先还原之前的部署。');
    } else {
      if (route === 'anr' && !old && !await anrProvider.clearLegacyTree(gameDir, bin, proxyNames))
        throw fail('已有 OptiScaler，请选择 ANR 附加包。');
      for (const name of [
        'RTXMFG-Universal.json',
        'rtx-encore.jsonc',
        'dlss5-feed.cfg',
        'renodx-mfgunlock.addon64',
        'MFGUnlocker.asi',
        'OptiScaler/plugins/MFGUnlocker.asi',
        isAnr ? 'dlssg_sm86.ini' : 'OptiScaler.ini',
      ]) {
        if (fs.existsSync(local(name))) ownedConflict(name);
      }
      for (const name of proxyNames) {
        const proxy = local(name);
        if (
          !owned[path.relative(gameDir, proxy)] &&
          fs.existsSync(proxy) &&
          (require('./pe').versionMentions(proxy, 'OptiScaler') ||
            require('./pe').versionMentions(proxy, 'RTX Encore'))
        )
          ownedConflict(name);
      }
    }
    const multiplier = graphics.multiplier;
    const max = isAnr || graphics.engine !== 'XeSS' ? 6 : 4;
    if (multiplier !== undefined && (!Number.isInteger(multiplier) || multiplier < 2 || multiplier > max))
      throw fail('补帧倍率超出此引擎范围。');
    if (graphics.engine !== undefined && !['DLSS', 'XeSS'].includes(graphics.engine))
      throw fail('未知的补帧引擎。');
    if (graphics.sceneCut !== undefined && typeof graphics.sceneCut !== 'boolean')
      throw fail('切镜保护参数无效。');
    let generatedLoader;
    if (isAnr) {
      const dir = addonOnly ? path.join(addonDir, 'dlssg') : local(anrProvider.privatePath);
      generatedLoader = old?.generatedLoader ?? (old ? manifest.addedDirs?.includes(path.relative(gameDir, dir))
        : !fs.existsSync(journal.safePath(gameDir, path.relative(gameDir, path.join(dir, anrProvider.loaderName)))));
    }
    for (const item of pack.files) {
      const source = checkedSource(pack, item);
      const name = item.path.slice(('enhanced/' + route + '/').length);
      const dest = addonOnly
        ? journal.safePath(gameDir, path.relative(gameDir, path.join(path.dirname(addonDir), name)))
        : local(route === 'anr' && name === 'dxgi.dll' ? anrHook : name);
      if (name.endsWith('/nr_fg.ini')) {
        await edit(
          dest,
          textFile(source),
          [
            ['', 'max_generated', multiplier === undefined ? undefined : multiplier - 1],
            ['', 'scene_cut', graphics.sceneCut === undefined ? undefined : Number(graphics.sceneCut)],
          ],
          !!previousProvider || !!old?.shared?.[path.relative(gameDir, dest)],
        );
      } else if (name === 'OptiScaler.ini') {
        await edit(dest, textFile(source), chainReShade ? [['Plugins', 'LoadReshade', 'true']] : []);
      } else if (name === 'dlssg_sm86.ini') {
        const base = fs.existsSync(dest)
          ? textFile(dest)
          : (profile[path.relative(gameDir, dest)] ?? textFile(source));
        const engine = graphics.engine || ini.getIni(base, 'FrameGeneration', 'Engine') || 'DLSS';
        const frames =
          multiplier === undefined
            ? Number(ini.getIni(base, 'FrameGeneration', 'MaxGeneratedFrames'))
            : multiplier - 1;
        if (!Number.isInteger(frames) || frames < 1 || frames > (engine === 'DLSS' ? 5 : 3))
          throw fail('所选引擎不支持当前倍率。');
        const fields = [
          ['FrameGeneration', 'Engine', graphics.engine],
          ['FrameGeneration', 'MaxGeneratedFrames', frames],
        ];
        if (route === 'sm86-delta') {
          manifest.graphicsRoute = {
            ...manifest.graphicsRoute,
            deltaCache: await require('./delta-cache').register(gameDir, exePath),
          };
          const id = manifest.graphicsRoute.deltaCache.id;
          fields.push(
            ['Compatibility', 'DeltaForceGeneratedFrames', frames],
            ['Compatibility', 'DeltaForcePrivateStreamline', 1],
            ['Compatibility', 'DeltaForceRuntimeId', id],
          );
        }
        await edit(dest, base, fields);
      } else {
        let mayReplace = moveHost && name === 'dxgi.dll';
        if (previousProvider && fs.existsSync(dest)) {
          const relative = path.relative(path.join(addonDir, 'dlssg'), dest).split(path.sep).join('/');
          mayReplace = digest(dest) === (previousProvider[relative] || item.sha256);
        }
        await copy(source, dest, item.sha256, mayReplace);
      }
    }
    if (addonOnly) {
      await edit(
        opti,
        '',
        [
          ['FrameGen', 'FGInput', 'nvngxfg'],
          ['FrameGen', 'FGNvngxReplacement', provider],
          ['FrameGen', 'DisableHudless', 'false'],
        ],
        true,
      );
      manifest.graphicsRoute = { providerDir: path.relative(gameDir, addonDir) };
    }
    if (isAnr) manifest.graphicsRoute.generatedLoader = !!generatedLoader;
  }
  if (overlayOnBackend) manifest.performanceMonitor = {files, settings, shared};
  else manifest.graphicsRoute = { ...manifest.graphicsRoute, files, settings, shared };
  await apply.saveActiveManifest(gameDir, manifest);
  if (updateNeural) {
    await require('./neural-models').applyNeuralModelSelection(gameDir, {
      mode: graphics.neural ? 'latest_compatible' : 'off',
      exePath,
      apiOverride: options.apiOverride,
      payloadDir,
      userDataDir,
      gpuName: options.gpuName,
      hardwareProfile: options.hardwareProfile,
      runtimeStack: options.runtimeStack,
    });
    const updated = apply.beginManifest(gameDir, exePath, api);
    updated.game = manifest.game;
    updated.graphicsRoute.neural = graphics.neural;
    await apply.saveActiveManifest(gameDir, updated);
    return updated;
  }
  return manifest;
}
// Preserve unrelated edits to a shared host INI made after the last deployment.
async function restoreSharedConfig(gameDir, manifest, rel) {
  if (manifest.route === 'xemfg' && await require('./xemfg').restoreSharedConfig(gameDir, manifest, rel)) return true;
  const record = manifest.performanceMonitor?.shared?.[rel] || manifest.graphicsRoute?.shared?.[rel];
  if (!record) return false;
  const target = journal.safePath(gameDir, rel);
  if (!fs.existsSync(target) || (!record.edited && digest(target) === record.installed)) return false;
  const current = readConfig(target);
  let text = current.text;
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  text = text.slice(bom.length);
  for (const field of record.fields) {
    if (ini.getIni(text, field.section, field.key) !== field.value) continue;
    text = ini.editIniField(text, field.section, field.key, field.before, record.created);
  }
  await journal.capture(gameDir, target);
  await require('./replace-file').writeText(target, Buffer.from(bom + text, current.encoding));
  return true;
}

function inspect(gameDir, manifest) {
  if (!isRoute(manifest?.route) && manifest?.route !== 'hud') return null;
  if (manifest.route === 'xemfg') return require('./xemfg').inspect(gameDir, manifest);
  if (manifest.route === 'xemfg-optiscaler') return require('./xemfg-optiscaler').inspect(gameDir, manifest);
  if (manifest.route === 'optifg') return require('./optifg').inspect(gameDir, manifest);
  const anr = manifest.route.startsWith('anr');
  const config = manifest.graphicsRoute?.settings?.find(
    (rel) => path.basename(rel) === (anr ? 'nr_fg.ini' : 'dlssg_sm86.ini'),
  );
  const exePath = journal.safePath(gameDir, manifest.game.exe);
  const records = manifest.graphicsRoute;
  const filesPresent =
    !!records?.files &&
    [...Object.keys(records.files), ...(records.settings || [])].every((rel) =>
      fs.existsSync(journal.safePath(gameDir, rel)),
    );
  const status = { route: manifest.route, exePath, filesPresent };
  if (anr) {
    const external = manifest.route === 'anr-addon', bin = path.dirname(exePath);
    if (external && !anrProvider.hasAddonHost(exePath,manifest.game.api)) {
      status.filesPresent = false;
      status.error = 'ANR 附加包需要当前游戏可加载、支持自定义帧生成提供程序的 OptiScaler。';
    } else {
      try {
        const hostConfig = textFile(journal.safePath(gameDir,path.relative(gameDir,path.join(bin,'OptiScaler.ini'))));
        const liveDir = addonBase(gameDir,bin,hostConfig), expected = external
          ? records?.providerDir && journal.safePath(gameDir,records.providerDir) : path.dirname(path.join(bin,anrProvider.privatePath));
        if (!expected || path.relative(expected,liveDir) !== '' ||
            !require('./xemfg-optiscaler').acceptsFrameGenInput(hostConfig,exePath) ||
            ini.getIni(hostConfig,'FrameGen','FGInput')?.toLowerCase() !== 'nvngxfg' ||
            ini.getIni(hostConfig,'FrameGen','FGNvngxReplacement') !== provider)
          status.error = 'OptiScaler 已更换 ANR 帧生成输入、提供程序或组件目录。';
      } catch (error) { status.error = error.message; }
    }
  }
  const pack = catalog.packs.find(item => item.id === manifest.route);
  const core = pack?.files.find(item => item.path.endsWith('/nvngx_dlssg.dll'));
  const providerFile = core && Object.keys(records?.files || {}).find(rel => path.basename(rel).toLowerCase() === 'nvngx_dlssg.dll' &&
    (anr || records.files[rel] === core.sha256));
  if (providerFile) {
    const file = journal.safePath(gameDir, providerFile), sha = records.files[providerFile];
    const version = sha === core.sha256 ? pack.version : anr && anrProvider.identify(sha)?.version;
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (version && (sha === core.sha256 ? size === core.size : size > 0 && size < 32 * 1024 * 1024) && digest(file) === sha)
      status.providerVersion = version;
    else if (anr) {
      status.filesPresent = false;
      status.error = 'ANR 提供程序与部署记录不一致。';
    }
  }
  if (!config) return status;
  let text;
  try {
    text = textFile(journal.safePath(gameDir, config));
  } catch (error) {
    return { ...status, error: error.message };
  }
  const engine = anr ? undefined : ini.getIni(text, 'FrameGeneration', 'Engine');
  const rawFrames = ini.getIni(text, anr ? '' : 'FrameGeneration', anr ? 'max_generated' : 'MaxGeneratedFrames');
  const frames = Number(rawFrames);
  const validFrames = Number.isInteger(frames) && frames >= 1 && frames <= (engine === 'XeSS' ? 3 : 5);
  const sceneCut = anr ? ini.getIni(text, '', 'scene_cut') : null;
  const invalid = [];
  if (!validFrames) invalid.push(anr ? 'max_generated' : 'MaxGeneratedFrames');
  if (!anr && !['DLSS','XeSS'].includes(engine)) invalid.push('Engine');
  if (anr && !['0','1'].includes(sceneCut)) invalid.push('scene_cut');
  return {
    ...status,
    ...(invalid.length && {error: '请检查配置文件中的 ' + invalid.join('、')}),
    neural:
      manifest.graphicsRoute?.neural ??
      (!!manifest.neuralRendering && manifest.neuralRendering.mode !== 'off'),
    multiplier: validFrames ? frames + 1 : null,
    sceneCut: sceneCut === '1' ? true : sceneCut === '0' ? false : undefined,
    engine: ['DLSS','XeSS'].includes(engine) ? engine : undefined,
  };
}
module.exports = { isRoute, install, inspect, inspectPerformanceMonitor, monitorSettings, checkOwned, validateTarget, restoreSharedConfig, addonProxy, prepareReShadeHost };
