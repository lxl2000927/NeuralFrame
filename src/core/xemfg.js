'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { fs, active: previewActive } = require('./preview-fs');
const pe = require('./pe');
const catalog = require('./runtime-catalog.json');
const routes = require('../shared/install-routes');
const apply = require('./apply');
const journal = require('./file-journal');
const compatibility = require('./compatibility');

const CONTROL = 'RTXMFG-Universal.json';
const PROXY = 'version.dll';
const engine = catalog.packs.find(pack => pack.id === 'mfg-universal');
const notice = catalog.packs.find(pack => pack.id === 'mfg-license');
const intel = catalog.packs.find(pack => pack.id === 'xemfg-intel');
const releases = [
  { pack: engine, item: engine.files.find(file => file.path.endsWith('/MFGUnlocker.dll')), name: PROXY },
  { pack: notice, item: notice.files[0], name: path.basename(notice.files[0].path) },
  ...intel.files.map(item => ({ pack: intel, item, name: path.join('RTXMFG-XeSS', path.basename(item.path)) })),
];
const otherProxyNames = ['dinput8', 'winmm', 'd3d9', 'd3d10', 'd3d11', 'd3d12', 'dxgi', 'dsound',
  'wininet', 'winhttp', 'binkw64', 'bink2w64', 'xinput1_1', 'xinput1_2', 'xinput1_3',
  'xinput1_4', 'xinput9_1_0', 'xinputuap'].map(stem => stem + '.dll');
const conflicting = ['MFGUnlocker.asi', 'OptiScaler/plugins/MFGUnlocker.asi', 'OptiScaler.ini',
  'OptiScaler/OptiScaler.ini', 'renodx-mfgunlock.addon64', 'dlssg_sm86.ini', 'rtx-encore.jsonc', 'dlss5-feed.cfg'];
const neutral = { followGame: true, mode: 'follow', multiplier: 1 };
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'errGraphicsRoute' });
const conflict = name => fail('目标已由游戏或其他插件使用：' + name);
const validFrames = value => Number.isInteger(value) && value >= 2 && value <= 6;
const statusCache = new Map();
const competingLoaders = [releases[0].item, catalog.packs.find(pack => pack.id === 'mfg-optiscaler-170').files[0],
  catalog.packs.find(pack => pack.id === 'encore').files.find(item => item.path.endsWith('/rtx-encore.dll')),
  catalog.packs.find(pack => pack.id === 'anr').files.find(item => item.path.endsWith('/dxgi.dll'))];

function localPath(gameDir, exePath, name) {
  return journal.safePath(gameDir, path.relative(gameDir, path.join(path.dirname(exePath), name)));
}

function matches(file, item, diagnostics = false) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size !== item.size) return false;
  if (!diagnostics || previewActive()) return hash(fs.readFileSync(file)) === item.sha256;
  const stamp = [stat.ino, stat.ctimeMs, stat.mtimeMs, stat.size].join('/');
  let entry = statusCache.get(file);
  if (!entry || entry.stamp !== stamp) {
    entry = { stamp, sha: hash(fs.readFileSync(file)) };
    if (statusCache.size >= 64) statusCache.delete(statusCache.keys().next().value);
    statusCache.set(file, entry);
  }
  return entry.sha === item.sha256;
}

function readControl(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4096) throw fail(CONTROL + ' 超出上游配置格式或 4096 字节限制。');
  const bytes = fs.readFileSync(file);
  let text, data;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    data = JSON.parse(text);
  } catch { throw fail(CONTROL + ' 不是有效的 UTF-8 JSON 配置。'); }
  // The native parser accepts a flat JSON object with unique, unescaped keys.
  const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*(:)?/g)].filter(match => match[2]).map(match => match[1]);
  if (!data || Array.isArray(data) || typeof data !== 'object' || keys.some(key => key.includes('\\')) ||
      keys.length !== Object.keys(data).length || Object.values(data).some(value => value !== null && typeof value === 'object'))
    throw fail(CONTROL + ' 包含上游不支持的配置字段。');
  return { data, sha: hash(bytes) };
}

function validateControl(data) {
  if (!Number.isInteger(data.multiplier) || data.multiplier < 1 || data.multiplier > 6 ||
      (Object.hasOwn(data, 'followGame') && typeof data.followGame !== 'boolean') ||
      (Object.hasOwn(data, 'mode') && !['fixed', 'dynamic', ...(data.followGame ? ['follow'] : [])].includes(data.mode)) ||
      (Object.hasOwn(data, 'dlss5') && typeof data.dlss5 !== 'boolean'))
    throw fail(CONTROL + ' 的通用倍率或模式无效。');
  for (const key of ['xemfgStandalone', 'xemfgDynamic']) {
    if (Object.hasOwn(data, key) && ![0, 1].includes(data[key])) throw fail(CONTROL + ' 的 ' + key + ' 需要为 0 或 1。');
  }
  if (Object.hasOwn(data, 'xemfgFrames') && !validFrames(data.xemfgFrames)) throw fail(CONTROL + ' 的 xemfgFrames 需要为 2–6。');
}

function serialize(data) {
  const text = JSON.stringify(data) + '\n';
  if (Buffer.byteLength(text) > 4096) throw fail(CONTROL + ' 超出上游 4096 字节限制。');
  return text;
}

function planControl(current, previous, multiplier, startingLoader) {
  const data = { ...current?.data };
  const fields = { ...previous?.fields };
  function set(key, value) {
    if (data[key] === value) return;
    const saved = fields[key];
    if (saved && data[key] === saved.value) fields[key] = { ...saved, value };
    else fields[key] = Object.hasOwn(data, key) ? { before: data[key], value } : { value };
    data[key] = value;
  }
  // The native parser requires multiplier even when the standalone host is the
  // only active backend. A missing followGame on a legacy file means "fixed".
  if (!current) for (const [key, value] of Object.entries(neutral)) set(key, value);
  validateControl(data);
  if (startingLoader && (data.dlss5 === true || (!data.followGame && (data.mode === 'dynamic' || data.multiplier > 1))))
    throw fail('现有配置已开启 NVIDIA 帧生成或神经渲染，请先在原配置中关闭。');
  if (!previous || multiplier !== undefined || !current) {
    set('xemfgStandalone', 1);
    set('xemfgFrames', multiplier ?? 2);
    set('xemfgDynamic', 0);
  }
  const changed = !current || Object.keys(data).some(key => data[key] !== current.data[key]);
  const text = changed ? serialize(data) : null;
  return { text, record: { fields, created: previous?.created ?? !current,
    edited: !!(previous?.edited || (previous && current?.sha !== previous.installed)),
    installed: changed ? hash(text) : current.sha } };
}

async function install(options) {
  const { gameDir, exePath, api, apiLabel, bitness, graphics = {}, target = {} } = options;
  const local = name => localPath(gameDir, exePath, name);
  journal.safePath(gameDir, path.relative(gameDir, exePath));
  const reason = routes.xemfgReason({ ...target, api, apiLabel, bitness,
    launcherProtected: target.launcherProtected || !!require('./wuthering-waves').gameRoot(gameDir, exePath),
    antiCheatWarning: target.antiCheatWarning || compatibility.hasAntiCheat(gameDir, exePath) });
  if (reason) throw fail(reason);
  if (graphics.multiplier !== undefined && !validFrames(graphics.multiplier)) throw fail('独立 XeMFG 固定倍率需要为 2–6 的整数。');
  if (graphics.neural === true || (graphics.engine !== undefined && graphics.engine !== 'XeSS'))
    throw fail('独立 XeMFG 仅支持 XeSS 帧生成。');
  return journal.transaction(gameDir, async () => {
    const manifest = apply.beginManifest(gameDir, exePath, api, { requireSameExe: true });
    if (manifest.route && manifest.route !== 'xemfg') throw conflict(manifest.route);
    const old = manifest.graphicsRoute;
    if (old || manifest.performanceMonitor) require('./optional-graphics').checkOwned(gameDir, manifest);
    for (const name of conflicting) if (fs.existsSync(local(name))) throw conflict(name);
    for (const name of otherProxyNames) {
      const file = local(name);
      if (fs.existsSync(file) && (competingLoaders.some(item => matches(file, item)) ||
          ['MFG Unlocker', 'MFGUnlocker.dll', 'RTXMFG.dll', 'OptiScaler'].some(marker => pe.versionMentions(file, marker))))
        throw conflict(name);
    }
    const files = { ...old?.files };
    const pending = [];
    for (const { pack, item, name } of releases) {
      const dest = local(name);
      if (matches(dest, item)) continue;
      if (fs.existsSync(dest)) throw conflict(name);
      const src = journal.safePath(options.payloadDir, item.path);
      if (!matches(src, item)) {
        throw Object.assign(fail('请重新准备组件：' + pack.name), { dependencies: ['runtime:' + pack.id] });
      }
      pending.push({ src, dest, item });
      files[path.relative(gameDir, dest)] = item.sha256;
    }
    const control = local(CONTROL);
    const rel = path.relative(gameDir, control);
    const { text, record } = planControl(readControl(control), old?.control, graphics.multiplier, !fs.existsSync(local(PROXY)));
    manifest.route = 'xemfg';
    Object.assign(manifest.game, { bitness, apiLabel });
    manifest.graphicsRoute = { files, settings: [rel], control: record, version: engine.version, proxy: PROXY };
    for (const { src, dest, item } of pending) {
      await apply.copyTracked(manifest, gameDir, src, dest, { kind: 'addon' });
      if (!matches(dest, item)) throw fail('部署后组件指纹不匹配：' + path.basename(dest));
    }
    if (text !== null) await apply.writeTracked(manifest, gameDir, control, text, { kind: 'config' });
    await apply.saveActiveManifest(gameDir, manifest);
    return manifest;
  });
}

function inspect(gameDir, manifest) {
  if (manifest?.route !== 'xemfg') return null;
  const exePath = journal.safePath(gameDir, manifest.game.exe);
  const local = name => localPath(gameDir, exePath, name);
  const state = { route: 'xemfg', exePath, version: manifest.graphicsRoute?.version,
    engine: 'XeSS', neural: false, multiplier: null, dynamic: null, enabled: null, filesPresent: false };
  try {
    const intact = releases.every(({ item, name }) => matches(local(name), item, true));
    if (intact) state.providerVersion = engine.version;
    state.filesPresent = intact && fs.existsSync(local(CONTROL));
    const control = readControl(local(CONTROL));
    if (!control) throw fail('缺少 ' + CONTROL);
    validateControl(control.data);
    const data = control.data;
    return { ...state, multiplier: data.xemfgFrames ?? (data.followGame ? 2 : Math.max(2, data.multiplier)),
      dynamic: data.xemfgDynamic === 1, enabled: data.xemfgStandalone === 1 };
  } catch (error) { return { ...state, error: error.message }; }
}

async function restoreSharedConfig(gameDir, manifest, rel) {
  if (manifest?.route !== 'xemfg' || !manifest.graphicsRoute?.control) return false;
  const file = localPath(gameDir, journal.safePath(gameDir, manifest.game.exe), CONTROL);
  if (path.relative(gameDir, file) !== rel) return false;
  const saved = manifest.graphicsRoute.control;
  let current;
  try { current = readControl(file); }
  catch (error) {
    // The user may have replaced the JSON with a different format. Leave it
    // untouched and continue restoring our binaries.
    if (error.code === 'errGraphicsRoute') return true;
    throw error;
  }
  if (!current) return true;
  if (!saved.edited && saved.installed === current.sha) return false;
  const data = { ...current.data };
  for (const [key, field] of Object.entries(saved.fields)) {
    if (data[key] !== field.value) continue;
    if (Object.hasOwn(field, 'before')) data[key] = field.before;
    else delete data[key];
  }
  if (saved.created && !Object.keys(data).length) return false;
  // When the game menu added settings to our new file, leave a valid control
  // file. Dropping followGame on this path would enable a legacy DLSS-G mode.
  if (saved.created) {
    if (!Object.hasOwn(data, 'followGame')) data.followGame = current.data.followGame ?? true;
    if (!Object.hasOwn(data, 'multiplier')) data.multiplier = current.data.multiplier ?? 1;
  }
  await journal.capture(gameDir, file);
  await require('./replace-file').writeText(file, serialize(data));
  return true;
}

module.exports = { install, inspect, restoreSharedConfig };
