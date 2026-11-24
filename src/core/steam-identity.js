'use strict';
const path = require('node:path');
const {fs} = require('./preview-fs');
const {safePath} = require('./file-journal');

const reporterNames = new Set(['crs-handler.exe', 'crs-video.exe']);
const isReporter = name => reporterNames.has(path.basename(name).toLowerCase());
const kv = (text, key) => text.match(new RegExp('"' + key + '"\\s+"([^"]+)"', 'i'))?.[1];

function manifestIdentity(text, filename) {
  const appid = kv(text, 'appid'), installdir = kv(text, 'installdir');
  if (!/^[1-9]\d{0,9}$/.test(appid || '') || Number(appid) > 0xffffffff ||
      filename.toLowerCase() !== 'appmanifest_' + appid + '.acf' || !installdir ||
      installdir === '.' || installdir === '..' || /[\\/:\0]/.test(installdir)) return null;
  return {appid, installdir};
}

function isSteamMiles(exe) {
  if (!exe || path.basename(exe).toLowerCase() !== 'milesmorales.exe') return false;
  const dir = path.dirname(path.resolve(exe)), common = path.dirname(dir), apps = path.dirname(common);
  if (path.basename(common).toLowerCase() !== 'common' || path.basename(apps).toLowerCase() !== 'steamapps') return false;
  const filename = 'appmanifest_1817190.acf';
  try {
    safePath(apps, path.relative(apps, exe));
    const file = safePath(apps, filename), stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return false;
    const identity = manifestIdentity(fs.readFileSync(file, 'utf8'), filename);
    return !!identity && path.relative(dir, path.join(common, identity.installdir)) === '';
  } catch { return false; }
}

module.exports = {manifestIdentity, isSteamMiles, isReporter};
