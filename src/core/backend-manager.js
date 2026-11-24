'use strict';

const fs = require('./preview-fs').fs;
const path = require('path');
const crypto = require('crypto');
const journal = require('./file-journal');
const core = require('./apply');
const ini = require('./feeder-config');
const optiscaler = require('./optiscaler');
const compatibility = require('./compatibility');
const optionalGraphics = require('./optional-graphics');

function readManifest(gameDir) {
  const file = path.join(core.backupRoot(gameDir), 'manifest.json');
  if (!fs.existsSync(file)) return null;
  journal.safePath(gameDir, path.relative(gameDir, file));
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1) throw Object.assign(new Error('errBackupInvalid'), { code: 'errBackupInvalid' });
  return manifest;
}
function profileFile(gameDir, exePath, api, route) {
  // The profile file is named after the route, so this list is what decides
  // whether a route can keep its own settings at all - and a route missing
  // from it fails the install with nothing but "Invalid route".
  if (!['native', 'feeder', 'optiscaler', 'renodx', 'encore', 'hud'].includes(route) && !optionalGraphics.isRoute(route)) throw new Error('Invalid route');
  const id = crypto.createHash('sha256').update(`${path.relative(gameDir, exePath).toLowerCase()}|${api}`).digest('hex').slice(0, 24);
  return journal.safePath(gameDir, `_DLSS5_Backup/.profiles/${id}-${route}.json`);
}
// What a settings file may be called. ReShade lets a preset be named anything,
// and mod packs routinely ship one as .txt - the writer stored those and the
// reader then refused them, which left the game unable to be installed at all
// until someone deleted the profile by hand. One list, used by both.
const CONFIG_FILE = /\.(ini|cfg|conf|txt|jsonc)$/i;

function configPaths(gameDir, exePath, route) {
  const dir = path.dirname(exePath);
  if (route === 'encore') return [path.join(dir, 'rtx-encore.jsonc')];
  if (route === 'optiscaler') return [path.join(dir, 'OptiScaler.ini')];
  const reshade = path.join(dir, 'ReShade.ini');
  const preset = ini.presetPath(dir, ini.readText(reshade));
  const files = [reshade, path.join(dir, 'dlss5-feed.cfg'), path.join(dir, 'host64', 'ReShade.ini')];
  if (route === 'feeder') {
    files.push(path.join(dir, 'NeuralFrame-Legacy.ini'), path.join(dir, 'dgVoodoo.conf'));
    for (const sub of ['e2driver', 'drivers', 'driver', 'renderers']) files.push(path.join(dir, sub, 'dgVoodoo.conf'));
  }
  const rel = path.relative(gameDir, preset);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) files.push(preset);
  return files.filter(file => CONFIG_FILE.test(file));
}
async function saveProfile(gameDir, old) {
  // These routes use field-level restoration or their own control file.
  if (['wuwa-proxy', 'xemfg', 'xemfg-optiscaler', 'optifg'].includes(old.route)) return;
  const exe = journal.safePath(gameDir, old.game.exe);
  const route = old.route || (old.game.bitness === 32 ? 'feeder' : 'native');
  const files = {};
  const paths = optionalGraphics.isRoute(route) || route === 'hud' ? (old.graphicsRoute?.settings || [])
    .filter(rel => !(route === 'anr-addon' && path.basename(rel).toLowerCase() === 'optiscaler.ini'))
    .map(rel => journal.safePath(gameDir,rel)) : configPaths(gameDir, exe, route);
  for (const file of paths) {
    const rel = path.relative(gameDir, file);
    journal.safePath(gameDir, rel);
    if (fs.existsSync(file) && fs.statSync(file).size < 4 * 1024 * 1024) files[rel] = ini.readText(file);
  }
  const file = profileFile(gameDir, exe, old.game.api, route);
  await journal.capture(gameDir, file);
  await journal.atomicJson(file, { version: 1, files });
}
function loadProfile(config) {
  const file = profileFile(config.gameDir, config.exePath, config.api, config.route);
  if (!fs.existsSync(file)) return {};
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (profile.version !== 1 || !profile.files || typeof profile.files !== 'object') throw new Error('Invalid backend profile');
  const files = {};
  for (const [rel, text] of Object.entries(profile.files)) {
    journal.safePath(config.gameDir, rel);
    // A path escaping the game, a non-string, an oversized blob or anything
    // aimed at the backup folder is refused: that is tampering, not a setting.
    if (typeof text !== 'string' || text.length > 4 * 1024 * 1024 || rel.toLowerCase().includes('_dlss5_backup')) {
      throw new Error('Invalid backend profile');
    }
    // Anything that is not a settings file is simply not restored, rather than
    // making the whole install impossible.
    if (CONFIG_FILE.test(rel)) files[rel] = text;
  }
  return files;
}
// #328: only a ReShade this app put there, and only between its two DirectX
// 11 names. A ReShade the game came with is reused as it is.
function reshadeFileChanged(old, config) {
  const file = old.reshade && old.reshade.installedByUs ? String(old.reshade.file || '').toLowerCase() : '';
  if (config.api !== 'dxgi' || !/^(dxgi|d3d11)\.dll$/.test(file)) return false;
  return file !== core.hookForApi(config.api, config.reshadeProxy);
}

function assertWritableTarget(config) {
  compatibility.assertSafeTarget(config.gameDir, config.exePath);
  // #301: a game under Program Files cannot be written to without elevation,
  // and the first write is the backup folder - which failed as a bare EPERM
  // before anything useful was said. Asked once, up front, in words.
  if (!core.canWrite(config.gameDir)) throw Object.assign(new Error('errNoWriteAccess'), { code: 'errNoWriteAccess' });
  compatibility.assertAntiCheatConsent(config.gameDir, config.exePath, config.antiCheatAcknowledged);
}

function matchesTarget(game, config) {
  return typeof game?.exe === 'string' && game.api === config.api &&
    path.relative(path.resolve(config.gameDir, game.exe), config.exePath) === '';
}

async function configurePerformanceMonitor(config) {
  assertWritableTarget(config);
  if (config.monitorMode !== undefined && ![0,1,2].includes(config.monitorMode))
    throw new Error('无效的性能监控显示模式。');
  if (config.monitorCorner !== undefined && ![0,1,2,3].includes(config.monitorCorner))
    throw new Error('无效的监控浮窗位置。');
  return journal.transaction(config.gameDir, async () => {
    const activeManifest = readManifest(config.gameDir);
    if (activeManifest && !matchesTarget(activeManifest.game,config))
      throw new Error('请为当前已部署的游戏程序和渲染 API 配置性能监控。');
    return optionalGraphics.install({...config, route:'hud', activeManifest});
  });
}

async function install(config, log = () => {}) {
  if (config.route === 'hud') return configurePerformanceMonitor(config);
  assertWritableTarget(config);
  const old = readManifest(config.gameDir);
  const sameTarget = old && matchesTarget(old.game,config);
  const keepOptiHost = sameTarget && old.route === 'optiscaler' && ['anr-addon', 'optifg'].includes(config.route);
  const keepReShade = sameTarget && config.api === 'dxgi' && config.route === 'anr' &&
    ['native','renodx'].includes(old.route) && !old.mfg?.enabled && (!old.mfg?.mode || old.mfg.mode === 'off');
  const reuseMonitorLayer = sameTarget && old.route === 'hud' && config.api === 'vulkan';
  const changed = old && !reuseMonitorLayer && !keepReShade && !keepOptiHost &&
    (old.route !== config.route || !sameTarget || reshadeFileChanged(old, config));
  const retainMonitor = sameTarget && (old.route === 'hud' || old.performanceMonitor);
  const monitorSettings = retainMonitor ? optionalGraphics.monitorSettings(ini.readText(journal.safePath(config.gameDir,
    path.relative(config.gameDir, path.join(path.dirname(config.exePath),'ReShade.ini'))))) : null;
  // Global Vulkan registration has shared ownership. Until an explicit layer
  // migration is available, require restoring first instead of changing other
  // games' registration or leaving it behind during a failed transaction.
  if (changed && (old.game.api === 'vulkan' || config.api === 'vulkan')) {
    throw Object.assign(new Error('errBackendVulkanSwitch'), { code: 'errBackendVulkanSwitch' });
  }
  return journal.transaction(config.gameDir, async () => {
    if (reuseMonitorLayer) {
      optionalGraphics.checkOwned(config.gameDir,old);
      old.performanceMonitor = old.graphicsRoute;
      delete old.graphicsRoute;
      delete old.route;
      await core.saveActiveManifest(config.gameDir,old);
    }
    if (config.api === 'vulkan' && config.route === 'feeder') {
      compatibility.assertLoaderCompatible(config, old);
      const profile = !old ? loadProfile(config) : {};
      if (Object.keys(profile).length) {
        const manifest = core.beginManifest(config.gameDir, config.exePath, config.api);
        manifest.route = config.route;
        for (const [rel, text] of Object.entries(profile)) await core.writeTracked(manifest, config.gameDir, journal.safePath(config.gameDir, rel), text, { kind: 'config' });
      }
      return core.applySwap(config, log);
    }
    const optional = optionalGraphics.isRoute(config.route);
    if (!old && !optional && !['optiscaler','encore'].includes(config.route)) {
      // Native ReShade may already have an untouched custom preset. Capture
      // its original bytes before the first managed session, while saving
      // subsequent user tuning separately for round-trip backend switches.
      const initial = core.beginManifest(config.gameDir, config.exePath, config.api);
      for (const file of configPaths(config.gameDir, config.exePath, config.route)) {
        if (fs.existsSync(file)) await core.trackBeforeWrite(initial, config.gameDir, file, { kind: 'config' });
      }
      await core.saveActiveManifest(config.gameDir, initial);
    }
    if (changed) {
      log({ code: 'backendSwitching', params: { from: old.route, to: config.route } });
      await saveProfile(config.gameDir, old);
      await core.restoreFiles(config.gameDir, old, log, { registryRunner: config.registryRunner });
      // The old target is fully restored. Start a fresh ownership record so a
      // later restore cannot delete a new file in the former EXE directory.
      const activeFile = path.join(core.backupRoot(config.gameDir), 'manifest.json');
      await journal.capture(config.gameDir, activeFile);
      await fs.promises.unlink(activeFile);
      if (old.route === 'sm86-delta' && old.graphicsRoute?.deltaCache?.owned) {
        const detach = () => require('./delta-cache').detach(config.gameDir,old);
        if (!journal.deferExternal(config.gameDir,'detach-delta',detach)) await detach();
      }
      if (old.graphicsRoute?.milesProfile || require('./miles-profile').owns(config.gameDir,config.milesDriver?.base))
        await require('./miles-profile').detach(config.gameDir,config.milesDriver);
    }
    if (!optional && !['optiscaler','encore'].includes(config.route)) compatibility.assertLoaderCompatible(config, changed ? null : old);
    const profile = changed || !old ? loadProfile(config) : {};
    if (!optional && !['optiscaler','encore'].includes(config.route) && Object.keys(profile).length) {
      const manifest = core.beginManifest(config.gameDir, config.exePath, config.api);
      for (const [rel, text] of Object.entries(profile)) {
        await core.writeTracked(manifest, config.gameDir, journal.safePath(config.gameDir, rel), text, { kind: 'config' });
      }
    }
    let manifest;
    if (optional) manifest = await optionalGraphics.install({...config,profile,keepOptiHost});
    else if (config.route === 'encore') manifest = await require('./encore').install({ ...config, profile }, log);
    else if (config.route === 'optiscaler') manifest = await optiscaler.install({ ...config, profile }, log);
    else manifest = await core.applySwap(config, log);
    for (const companion of config.route === 'native' ? (config.companions || []) : []) {
      const dest = path.join(path.dirname(config.exePath), path.basename(companion));
      await core.copyTracked(manifest, config.gameDir, companion, dest, { kind: 'addon' });
      await core.enableAddonInIni(path.dirname(config.exePath), path.basename(companion),
        (code, params) => log({ code, params }), config.gameDir, manifest, config.source?.payloadRoot);
    }
    if (config.route === 'optiscaler' && ['feeder','native','renodx'].includes(old?.route)) manifest.previousReShadeRoute = old.route;
    await core.saveActiveManifest(config.gameDir, manifest);
    if (retainMonitor && changed) {
      manifest = await optionalGraphics.install({...config, graphics:{}, route:'hud', monitorMode:monitorSettings.mode, monitorCorner:monitorSettings.corner,
        activeManifest:manifest, payloadDir:config.payloadDir || config.source?.payloadRoot});
    }
    return manifest;
  });
}
async function restore(gameDir, log = () => {}, onRestored, { vulkanLayerTarget, milesDriver } = {}) {
  const recovered = await journal.recover(gameDir);
  if (recovered) log({ code: 'backendRecovered', params: {} });
  const old = readManifest(gameDir);
  // A recovered first install can leave no active deployment. Its journal is
  // authoritative; never roll back an older installation as a second step.
  if (!old && recovered) return true;
  try {
    await core.restore(gameDir, log, onRestored, {
      vulkanLayerTarget, milesDriver,
      beforeFiles: old && (async () => {
        try { await saveProfile(gameDir, old); }
        catch (error) { log({ code: 'restoreProfileWarning', params: { error: error.message } }); }
      })
    });
  }
  catch (error) { if (error.code === 'errNoBackup') return false; throw error; }
  return true;
}
module.exports = { install, configurePerformanceMonitor, restore, readManifest, saveProfile, loadProfile };
