'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const installRoutes = require('../shared/install-routes');
const renderingApi = require('../shared/rendering-api');

const apiPreferenceKey = (dir, exe) => crypto.createHash('sha256')
  .update(path.resolve(dir).toLowerCase()).update('\0')
  .update(path.relative(dir, exe).toLowerCase()).digest('hex');

function withGameApi(scan, override) {
  if (!scan.chosen || !override || override === 'auto') return scan;
  return { ...scan, chosen: renderingApi.effective(scan.chosen, override) };
}

function setupTarget(dir, scan, exe, override) {
  const local = scan.chosen && path.relative(scan.chosen.path,exe.path) === '' ? scan : null;
  const target = {
    ...renderingApi.effective(exe, override),
    hasNativeDlss: exe.hasNativeDlss ?? installRoutes.nativeDlssPresent(local),
    hasNativeUpscaler: exe.hasNativeUpscaler ?? installRoutes.nativeUpscalerPresent(local),
    hasXeMfgDx12Upscaler: exe.hasXeMfgDx12Upscaler ?? installRoutes.nativeXeMfgDx12UpscalerPresent(local),
    hasNativeDlssFg: exe.hasNativeDlssFg ?? installRoutes.nativeFgPresent(local, true),
    hasNativeFg: exe.hasNativeFg ?? installRoutes.nativeFgPresent(local),
    launcherProtected: !!require('./wuthering-waves').gameRoot(dir, exe.path)
  };
  target.hasAnrAddonHost = target.bitness === 64 && target.hasNativeDlssFg &&
    (target.api === 'vulkan' || target.apiLabel === 'DirectX 12') &&
    require('./anr').hasAddonHost(exe.path, target.api);
  if (installRoutes.supportsMfg(target) && !target.launcherProtected) {
    const installed = scan.install?.exe && path.relative(path.resolve(dir,scan.install.exe),exe.path) === '' ? scan.install : null;
    target.classicMfgIssue = require('./mfg-manager').classicMfgTarget(target, installed,'auto',true).issue;
  }
  return target;
}
module.exports = { apiPreferenceKey, withGameApi, setupTarget };
