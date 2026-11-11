'use strict';
// DLSS 5 Swapper
// Finds the games already on the machine and installs DLSS 5 Neural
// Rendering into them, using the scanners in src/core.
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, Tray, nativeImage, screen } = require('electron');
const previewFs = require('./src/core/preview-fs');
const fs = previewFs.fs;
const { ComponentReview } = require('./src/core/component-review');
let componentReview;
const reviews = () => componentReview || (componentReview = new ComponentReview(app.getPath('userData')));
let unifiedComponents, componentUpdates, runtimeCache;
// Development uses the same verified, on-demand cache as packaged builds.
// Full offline payload checkouts can explicitly opt out for fixture testing.
const onDemandPayload = () => app.isPackaged || process.env.DLSS5_LIGHTWEIGHT !== '0';
function runtimes() {
  return runtimeCache ||= new (require('./src/core/runtime-payload').RuntimePayload)(app.getPath('userData'), {
    bundledRoot: app.isPackaged ? path.join(process.resourcesPath,'payload') : path.join(__dirname,'dist/runtime-bootstrap'),
    fetcher: (...args) => require('electron').net.fetch(...args)
  });
}
async function requireRuntime(options) {
  if (onDemandPayload()) await runtimes().require(require('./src/core/runtime-payload').requiredPacks(options));
}
function components() {
  return unifiedComponents ||= new (require('./src/core/component-library').ComponentLibrary)(app.getPath('userData'), {
    payloadDir: resolvePayloadRoot(), overlayDir: app.isPackaged ? path.join(process.resourcesPath, 'overlay') : path.join(__dirname, 'dist/overlay')
  });
}
function updates() { return componentUpdates ||= new (require('./src/core/component-updates').ComponentUpdates)(components(),{fetcher:(...args)=>require('electron').net.fetch(...args)}); }
async function managedReview(event, dir, request, work, token) {
  const library = components();
  const componentDeploy = require('./src/core/component-deploy');
  const resolved = componentDeploy.resolveManagedSelection(library, library.profile(dir).selected, request);
  const selected = resolved.selection;
  const hasSelection = Object.keys(selected).length > 0;
  const plan = hasSelection ? { ...resolved.request, componentSelection: selected } : resolved.request;
  const install = () => work(resolved.request.config);
  const deploy = hasSelection
    ? () => componentDeploy.managed(library, dir, selected, install)
    : install;
  // The base install, F8 files and selected component versions commit together.
  const result = await reviews().run(dir, plan, () => journal.group(dir, deploy), token);
  if (result.ok && !result.preview) {
    try {
      const manifest = backends.readManifest(dir);
      if (manifest) saveOperation(dir, manifest, 'install', e => event.sender.send('job', { ...e, dir }));
    } catch (error) {
      result.recordWarning = [result.recordWarning, error.message].filter(Boolean).join('\n');
    }
  }
  return result;
}
const path = require('path');
// Reuse the established cache, game list and version locks during the rebrand.
// An isolated profile can be selected for QA without touching the user's files.
if (typeof app.setPath === 'function') {
  const profile = process.env.NEURALFRAME_USER_DATA || path.join(app.getPath('appData'), require('./package.json').distribution.userDataDirectory);
  app.setPath('userData', profile);
}
const { pathToFileURL, fileURLToPath } = require('url');
const crypto = require('crypto');

const os = require('os');
const diagnostics = require('./src/core/diagnostics');
const { scanGame } = require('./src/core/scan.js');
let gameInspection;
function inspections() {
  return gameInspection ||= new (require('./src/core/game-inspection').GameInspection)();
}
function inspectInventory(dir) {
  return inspections().run('inventory', dir, {userDataDir: app.getPath('userData')});
}
function inspectForUi(dir, profileOverride, priority, phase) {
  const state = loadState();
  return inspections().run('inspect', dir, {
    payloadDir: resolvePayloadRoot(),
    userDataDir: app.getPath('userData'),
    hardwareProfile: profileOverride,
    defaultHardwareProfile: state.hardwareProfile,
    apiOverrides: state.apiOverrides || {}
  }, priority, phase);
}
const { folder, dedupe, isInside, steam } = require('./src/library');
const { contextForSteamGame, createSetupRunner } = require('./src/core/proton');
const art = require('./src/steamart');
const artCache = require('./src/art-cache');
const { backupRoot, saveActiveManifest, writeTracked, recoverableManifest } = require('./src/core/apply.js');
const { scanSource } = require('./src/core/scan.js');
const pe = require('./src/core/pe.js');
const { isInternalAddon } = require('./src/core/addon-policy');
const { ensureLumenite, ensureDgVoodoo, missingVCRuntime } = require('./src/core/runtime-components.js');
// A component that downloaded and verified, then vanished before it could be
// used, is a security tool quarantining it - never the connection. Saying
// "check your connection" there sends people after the wrong thing.
const componentCode = (error, fallback) => (error && error.code === 'componentRemoved' ? 'componentQuarantined' : fallback);
const installRoutes = require('./src/shared/install-routes');
const renderingApi = require('./src/shared/rendering-api');
const { projectUrl } = require('./src/core/project-links');
const optiscaler = require('./src/core/optiscaler');
const { missingPayload } = require('./src/core/payload-guidance');
const backends = require('./src/core/backend-manager');
const journal = require('./src/core/file-journal');
const guards = require('./src/core/install-guards');
const compatibility = require('./src/core/compatibility');
const antiCheatWarning = require('./src/shared/anti-cheat-warning');
const featureI18n = require('./src/shared/feature-i18n');
const featureText = (key, ...args) => featureI18n.t(desktopLanguage(), key, ...args);
const vulkanLayer = require('./src/core/vulkan-layer');
const { HistoryStore, knownFolders, fromManifests } = require('./src/core/history');
const gameMenu = require('./src/core/game-menu');
let historyStore;
const history = () => historyStore || (historyStore = new HistoryStore(path.join(app.getPath('userData'), 'history.jsonl')));
const gameName = dir => lastGames.find(game => keyFor(game.dir) === keyFor(dir))?.name || path.basename(dir);
function saveOperation(dir, manifest, action, send) {
  if (previewFs.active()) return;
  try { history().record(dir, manifest, action, gameName(dir)); }
  catch (error) {
    // The game operation succeeded. Report the separate history write failure.
    // HistoryStore retains the row in memory for a later retry.
    send({ code: 'historySaveWarning', params: { error: error.message } });
  }
  if (action === 'install') rememberGame(dir);
}

// ---------- add-on builds ----------
// The integrated RenoDX build is always installed and is not presented as an
// optional add-on. Other bundled or user-added builds still appear in the
// Add-ons screen, and an `addons` folder beside the executable remains valid.
function addonFolders() {
  if (!app.isPackaged) return [path.join(__dirname, 'addons')];
  return [
    path.join(process.resourcesPath, 'addons'),
    path.join(path.dirname(app.getPath('exe')), 'addons')
  ];
}

// What each build is, keyed by the hash of its contents so a build keeps its
// description wherever the file is moved or renamed to. The bullet lists are
// the authors' own release notes from the RenoDX Discord, kept verbatim and
// untranslated for the same reason a changelog is: they are a quote, not our
// wording. Anything unrecognised falls back to the folder it sits in.
const KNOWN = {
  // The build that used to ship. Recognised if someone adds it by hand, but
  // it is no longer the one bundled.
  '189efdee6a327833': { name: 'Stable (previous)' },
  // Superseded by the v4.7 that now ships. Kept recognised so a hand-added copy
  // is still named rather than showing up as its folder.
  '0c0a02578d2aadf2': { name: 'v4.6 (previous)' },
  // Bundled: the build the in-game overlay's adapter is fingerprinted against.
  '88116071ef689864': {
    name: 'v4.7',
    shipped: true
  }
};

// An add-on's identity is the hash of its contents, and the add-ons page asks
// for it every time it is opened - which meant reading and hashing several
// megabytes per file on each visit. A file is the same file while its path,
// size and modification time are unchanged, so the answer is kept.
const describedFiles = new Map();

function describe(file, label) {
  if (isInternalAddon(file)) return null;
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = path.resolve(file).toLowerCase();
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const remembered = describedFiles.get(key);
  let id, version, size;
  if (remembered && remembered.stamp === stamp) {
    ({ id, version, size } = remembered);
  } else {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return null; }
    version = pe.getFileVersion(file);
    id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    size = buf.length;
    describedFiles.set(key, { stamp, id, version, size });
  }
  // This former bundled companion duplicates capabilities now provided by the
  // integrated RenoDX and Feeder routes and can conflict when loaded beside
  // them. Hide stale copies left behind by an older installation too.
  if (id === '76e8a0c90a6b99a7') return null;
  const known = KNOWN[id] || {};
  return {
    ...known,
    // Identity is the content, not the path: the same build sits both in the
    // app payload and loose in the project root, and listing it twice would
    // invite someone to "switch" to the build already running.
    id,
    path: file,
    file: path.basename(file),
    label: known.name || label || path.basename(file),
    size,
    // A build with no version resource reports 0.0.0.0, which says nothing.
    version: version && version !== '0.0.0.0' ? version : null
  };
}

// The folder a build sits in is the only description we have of it, and it is
// the one the person writing it chose - "RE Engine games", "dx12 dx 11 dx 9".
function addonLibrary() {
  const found = [];
  const seen = new Set();
  const add = (file, label, own) => {
    if (typeof file !== 'string' || !/\.addon(64)?$/i.test(file) || isInternalAddon(file)) return;
    let row = describe(file, label);
    if (!row && own && !fs.existsSync(file)) {
      row = { path: file, file: path.basename(file), missing: true };
    }
    if (row && own) {
      row.custom = true;
      // Hand-added builds are listed exactly as given. Nearly every build is
      // called renodx-dlss.addon64 and several share their contents, so
      // matching on either would refuse files the person deliberately picked.
      // Only the path decides, and the row is always theirs to delete.
      row.id = 'custom:' + path.resolve(file).toLowerCase();
      // A hand-added build is described only by what the person typed. It used
      // to fall back on the recognised build's entry, so an add-on named
      // "tajriba" came back wearing somebody else's release notes and warning.
      row.label = own.name || path.basename(path.dirname(file));
      row.notes = own.notes && own.notes.length ? own.notes : null;
      row.warn = own.tag || null;
      row.caution = null;
      row.shipped = false;
    }
    // The payload copy is added first, so it is the one that survives and the
    // list says "shipped with the app" rather than naming a stray folder.
    if (row && !seen.has(row.id)) { seen.add(row.id); found.push(row); }
  };

  const p = payload(true);
  if (p && p.source.addon) add(p.source.addon, null);
  const integratedId = p?.source.addon ? describe(p.source.addon, null)?.id : null;

  for (const box of addonFolders()) {
    let dropped = [];
    try { dropped = fs.readdirSync(box); } catch { continue; /* no such folder is normal */ }
    for (const f of dropped) add(path.join(box, f), null);
  }

  for (const e of loadState().addonFiles || []) {
    const row = typeof e === 'string' ? { path: e } : e;
    add(row.path, null, {
      custom: true, name: row.name || null, notes: row.notes || null, tag: row.tag || null
    });
  }

  // The shipped build is the base, not a choice, so it is not offered.
  const base = path.basename(p?.source.addon || require('./src/core/renodx-release').CONSUMER.file).toLowerCase();
  const chosen = new Set(storedAddons(loadState()).map(file => keyFor(file)));
  return found
    .filter((r) => !r.shipped && (r.custom || r.id !== integratedId))
    .map((r) => ({
      ...r,
      active: chosen.has(keyFor(r.path)),
      // Same file name as the base means it overwrites it rather than joining.
      replaces: path.basename(r.path).toLowerCase() === base
    }));
}

// The payload that ships with the app. `raw` skips the add-on override,
// which is how the library finds the shipped build in the first place.
function payload(raw) {
  const dir = resolvePayloadRoot();
  const probe = scanSource(dir);
  if (!probe.ok) return null;
  const setup = fs.readdirSync(dir).find((f) => /^ReShade_Setup_.*_Addon\.exe$/i.test(f));
  // Point at the chosen build instead of copying files around: the payload
  // folder is what a build ships, and switching must not rewrite it.
  // Only a same-named build changes what applySwap installs; a differently
  // named one is copied in afterwards, beside the base.
  if (!raw) {
    const state = loadState();
    const list = state.addons || (state.addon ? [state.addon] : []);
    const base = path.basename(probe.addon || '').toLowerCase();
    const over = list.find((f) => fs.existsSync(f) && path.basename(f).toLowerCase() === base);
    if (over) probe.addon = over;
  }
  if (probe.feeder) {
    const enhDir = path.join(dir, 'enhanced', 'feeder-1.19.0');
    const enhAddon32 = path.join(enhDir, 'dlss5-feed.addon32');
    const enhAddon64 = path.join(enhDir, 'dlss5-feed.addon64');
    const enhHost64 = path.join(enhDir, 'host64', 'dlss5-feed-host64.exe');
    const enhFeedFx = path.join(enhDir, 'reshade-shaders', 'Shaders', 'DLSS5_Feed.fx');
    if (fs.existsSync(enhAddon32)) probe.feeder.addon32 = enhAddon32;
    if (fs.existsSync(enhAddon64)) probe.feeder.addon64 = enhAddon64;
    if (fs.existsSync(enhHost64)) probe.feeder.host64 = enhHost64;
    if (fs.existsSync(enhFeedFx)) probe.feeder.feedShader = enhFeedFx;
    if (fs.existsSync(enhAddon32) || fs.existsSync(enhAddon64)) probe.feeder.version = '1.19.0';
  }
  return { source: probe, reshadeSetup: setup ? path.join(dir, setup) : null };
}

let win = null;

const stateFile = () => path.join(app.getPath('userData'), 'library.json');
const posterDir = () => path.join(app.getPath('userData'), 'posters');
const keyFor = (dir) => crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
const tileFile = dir => path.join(app.getPath('userData'), 'art', keyFor(dir) + '-tile.jpg');
function cachedTile(dir) {
  const file = tileFile(dir);
  return fs.existsSync(file) ? pathToFileURL(file).href : null;
}
// Bump when scan metadata or detection changes so an old wrong result is not
// kept forever merely because the folder was scanned by an earlier release.
const SCAN_RULES = 9;

// One live object, not a fresh snapshot per call. Every handler used to parse
// the file, hold that copy across an await, and write the whole thing back:
// two scans running at once each wrote their own stale copy, and whichever
// finished last silently dropped the other's result. Sharing the object means
// every write carries everything already known.
let liveState = null;
let libraryGeneration = 0;

function invalidateLibraryView() {
  libraryGeneration++;
  gameInspection?.invalidate?.();
  lastRoots = [];
  lastGames = [];
}

function readState() {
  const defaults = { folders: [], excludedRoots: [], manual: [], posters: {}, hidden: [], scans: {} };
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Older libraries may have saved preferences before their first scan.
      for (const [key, fallback] of Object.entries(defaults)) {
        // These optional indexes are created by the first cover or folder edit.
        if (!(key in value) && (key === 'posters' || key === 'excludedRoots')) continue;
        const field = value[key];
        if (!field || typeof field !== 'object' || Array.isArray(field) !== Array.isArray(fallback)) value[key] = fallback;
      }
      if (!Array.isArray(value.excludedFolders)) delete value.excludedFolders;
      return value;
    }
  } catch { /* absent or unreadable: start from the defaults below */ }
  // Nothing seeded: the drive sweep finds game libraries on its own, and a
  // path from the machine this was written on means nothing anywhere else.
  return defaults;
}

function loadState() {
  if (!liveState) liveState = readState();
  return liveState;
}

function saveState(state) {
  // A handler that built its own object still becomes the live one, so a caller
  // that does not go through loadState() cannot resurrect the old race.
  if (state && state !== liveState) liveState = state;
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    const pending = stateFile() + '.tmp';
    fs.writeFileSync(pending, JSON.stringify(liveState, null, 2), 'utf8');
    fs.renameSync(pending, stateFile());
    return true;
  } catch { liveState = readState(); return false; }
}

// A choice belongs to one executable, not every launcher in the same folder.
const { apiPreferenceKey } = require('./src/core/game-api');
function apiPreference(state, dir, exe) {
  const value = state.apiOverrides?.[apiPreferenceKey(dir, exe)];
  return renderingApi.valid(value) ? value : 'auto';
}
// #328: which file ReShade goes in as, per executable. dxgi.dll unless the
// person chose d3d11.dll for a DirectX 11 game that never loads dxgi.dll.
function reshadeProxyPreference(state, dir, exe) {
  return state.reshadeProxy?.[apiPreferenceKey(dir, exe)] === 'd3d11' ? 'd3d11' : 'dxgi';
}

// Renderer can only load what it is handed a URL for.
function posterUrl(game, state) {
  const key = keyFor(game.dir);
  const custom = state.posters?.[key];
  if (custom && fs.existsSync(custom)) return { url: `${pathToFileURL(custom).href}?v=${fs.statSync(custom).mtimeMs}`, tall: true, custom: true };
  // Art fetched earlier is already on disk; use it before the
  // launcher's own cache, which is often only a wide header.
  const record = state.art && state.art[key];
  const saved = artCache.usable(record, onDisk);
  if (saved.cover) return { url: saved.cover, tall: true, custom: false };
  // A game too new for a portrait capsule still has a banner. The grid knows
  // how to show a wide image, which beats falling back to two initials.
  if (saved.hero) return { url: saved.hero, tall: false, custom: false };
  if (game.poster && fs.existsSync(game.poster.file)) return { url: pathToFileURL(game.poster.file).href, tall: game.poster.tall, custom: false };
  return null;
}
function desktopLanguage() { return /^en(?:[-_]|$)/i.test(loadState().lang || '') ? 'en' : 'zh'; }
function uiText(zh, en) { return desktopLanguage() === 'en' ? en : zh; }

// The tray. Closing the window puts the app here rather than ending it, which
// is what #255 asked for: people close a window out of habit and then wonder
// why the overlay stopped answering in the game they are still playing.
let tray = null;
// The main process has no translations of its own, so the renderer hands these
// over the way it already does for the game context menu.
let trayLabels = { show: 'Open NeuralFrame', quit: 'Quit' };

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: trayLabels.show, click: showWindow },
    { type: 'separator' },
    // The only way out that means it: everything else hides the window.
    { label: trayLabels.quit, click: () => { quitting = true; app.quit(); } }
  ]));
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const source = nativeImage.createFromPath(path.join(__dirname, 'src', 'renderer', 'icon.png'));
  // A 16px tray icon on Windows; an empty image would throw, so a full-size
  // fallback is better than no tray at all.
  const icon = source.isEmpty() ? source : source.resize({ width: 16, height: 16, quality: 'good' });
  try { tray = new Tray(icon); } catch { return null; }
  tray.setToolTip('NeuralFrame');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  buildTrayMenu();
  return tray;
}

// The portable build runs from a folder it extracts into %TEMP% on each launch;
// an installed copy runs from where it was installed. Which one is speaking
// changes what the person should do about a missing payload.
const runningPortable = () =>
  Boolean(process.env.PORTABLE_EXECUTABLE_DIR) ||
  /[\/]Temp[\/]/i.test(process.resourcesPath || '');

const payloadMissing = () => missingPayload({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath || __dirname,
  appRoot: __dirname,
  portable: runningPortable(),
  temp: app.getPath ? (() => { try { return app.getPath('temp'); } catch { return null; } })() : null
});

let windowSaveTimer;
function saveWindowState() {
  clearTimeout(windowSaveTimer);
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const state = loadState();
  if (!state.rememberWindow) return;
  state.windowState = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  saveState(state);
}
function createWindow() {
  const state = loadState();
  const saved = state.rememberWindow ? require('./src/core/window-state').restoreBounds(state.windowState, screen.getAllDisplays(), screen.getPrimaryDisplay()) : null;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}),
    minWidth: Math.min(960, saved?.width || 960),
    minHeight: Math.min(640, saved?.height || 640),
    backgroundColor: '#191919',
    icon: path.join(__dirname, 'src', 'renderer', 'icon.png'),
    // The window draws its own title bar, so the frame comes off.
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'ui-dist', 'index.html'));
  win.once('ready-to-show', () => {
    // Windows can add a non-client inset while creating a frameless window.
    // Apply the requested outer bounds once the native window exists to avoid
    // growing its saved size on every launch (especially at fractional DPI).
    win.show();
    if (saved) win.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
    if (saved?.maximized) win.maximize();
  });
  for (const event of ['move', 'resize', 'maximize', 'unmaximize']) win.on(event, () => {
    clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(saveWindowState, 250);
  });
  // Close quits by default in portable builds unless closeToTray is explicitly enabled
  win.on('close', (event) => {
    saveWindowState();
    if (quitting || loadState().closeToTray === false || !ensureTray()) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
    // The overlay bridge holds an offscreen window, so the window list is
    // never empty and window-all-closed never arrives: without this the
    // process stayed in Task Manager with nothing on screen.
    if (!quitting) app.quit();
  });
}

// Windows groups taskbar entries and attributes shortcuts by this id. Without
// it the window is filed under whatever launched it - "Electron" when run from
// source - instead of under the app.

app.setAppUserModelId('io.github.lxl2000927.neuralframe');

// A second copy of the app is not just wasted memory: it writes its own
// overlay endpoint over the first one's and listens on its own pipe, so the
// panel in the game would be driven by whichever window happened to start
// last. Opening the app again raises the window that is already running.
//
// The lock is asked for defensively - the IPC handlers in this file are also
// exercised outside Electron, where app is a stand-in that has no such call.
const singleInstance = typeof app.requestSingleInstanceLock === 'function'
  ? app.requestSingleInstanceLock(!app.isPackaged && process.argv.includes('--restart-debug') ? { debugProject: __dirname } : {})
  : true;
if (!singleInstance) {
  app.quit();
} else {
  // Opening the app again raises the window - including when it is in the tray
  // rather than merely minimised.
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (app.isPackaged || data?.debugProject !== __dirname) return showWindow();
    if (quitting) return;
    if (mutationBusy) {
      showWindow();
      void dialog.showMessageBox(win, {
        type: 'info',
        message: uiText('当前操作正在进行。完成后重新运行调试启动脚本即可加载新版。',
          'An operation is in progress. Run the debug launcher again when it finishes.')
      });
      return;
    }
    quitting = true;
    app.relaunch();
    app.quit();
  });
}


// The same overlay library the Overlay page manages, so an install picks up
// exactly the build shown there.
function overlayLibrary() {
  const { createOverlayLibrary } = require('./src/overlays');
  const root = path.resolve(__dirname);
  const builtin = app.isPackaged
    ? path.join(process.resourcesPath, 'overlay', 'dlss5-lab-overlay.addon64')
    : path.join(root, 'dist/overlay/dlss5-lab-overlay.addon64');
  return createOverlayLibrary(path.join(app.getPath('userData'), 'overlay-library'), builtin,
    [root, app.isPackaged ? path.dirname(app.getPath('exe')) : root]);
}

// The in-game overlay draws its panel in an offscreen window here and streams
// the frames over a local pipe, so the bridge lives as long as the app does.
let overlayBridge;
let quitting = false;

// #365: on some machines the window repaints with stale tiles - rows from
// before a scroll stay on screen, in every version and at every scale. That is
// Chromium's GPU compositor, not the page. A switch in Settings turns hardware
// acceleration off for this window, which costs nothing here: it draws text,
// cards and pictures. It has to be read before the app is ready, because that
// is the last moment the flag can still be set.
let safeGraphicsAtStartup = false;
try {
  safeGraphicsAtStartup = loadState().safeGraphics === true;
  if (safeGraphicsAtStartup) app.disableHardwareAcceleration();
} catch { /* a default is fine */ }

app.whenReady().then(async () => {
  // app.quit() is asynchronous, so a copy that lost the lock still reaches
  // this point: without the guard it would create a window and take over the
  // overlay endpoint on its way out.
  if (!singleInstance) return;
  // Registered here rather than at load: main.js is exercised in a plain vm
  // context by the tests, where src modules are stubbed and cannot be called.
  require('./src/overlay-ipc')({ app, ipcMain, dialog, shell, window: () => win, bridge: () => overlayBridge, language: desktopLanguage });
  createWindow();
  // The icon is there from launch, not only after the first close - somebody
  // who wants the app parked in the tray wants to see that it is.
  if (loadState().closeToTray !== false) ensureTray();
  try {
    overlayBridge = await require('./src/overlay-bridge')({ BrowserWindow, userData: app.getPath('userData'), language: desktopLanguage });
    overlayBridge.refreshPreferences?.();
    if (quitting) overlayBridge.close();
  } catch (error) {
    if (!quitting) console.error('Overlay bridge:', error.message);
  }
});
// The overlay bridge keeps an offscreen window of its own, so closing the
// visible one no longer emptied the window list and window-all-closed never
// arrived: the process stayed in Task Manager with nothing on screen. Quitting
// follows the window the person actually closed.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { saveWindowState(); quitting = true; overlayBridge?.close(); void gameInspection?.close(); });

// ---------- library ----------

// The renderer needs a URL for the logo, and it falls back to a drawn mark if
// the file is not there.
ipcMain.handle('boot', () => {
  const state = loadState();
  const asUrl = (name) => {
    const file = path.join(__dirname, 'assets', name);
    return fs.existsSync(file) ? pathToFileURL(file).href : null;
  };
  return {
    version: require('./package.json').version,
    distribution: require('./package.json').distribution || null,
    // Said at launch rather than at the moment somebody presses Install. The
    // app used to look completely healthy right up until it could not work.
    payloadMissing: (() => {
      // Never let a probe stop the app opening: a launch that fails because it
      // could not check its own files is worse than the missing files.
      try { return onDemandPayload() || payload() ? null : payloadMissing().message; } catch { return null; }
    })(),
    theme: state.theme || 'light',
    // Which of the two skins draws the app. Theme 1 is the original design and
    // stays the default; theme 2 is the modern one.
    skin: state.skin === 'two' ? 'two' : 'one',
    // Theme 2 can keep the sidebar as a rail of icons that opens on hover.
    rail: state.rail === 'on' ? 'on' : 'off',
    lang: desktopLanguage(),
    safeGraphics: safeGraphicsAtStartup,
    groupGamesByStore: state.groupGamesByStore !== false,
    logo: asUrl('logo.png'),
    logoDark: asUrl('logo-dark.png')
  };
});

ipcMain.handle('set-lang', (_event, lang) => {
  const state = loadState();
  state.lang = lang;
  if (!saveState(state)) throw Error('Could not save settings');
  overlayBridge?.refreshPreferences?.();
  return lang;
});

// Theme 2's game page has a Play button. Steam games are started through the
// launcher that owns them; anything else opens its own executable. Nothing is
// installed or changed by this - it is the same double click the person would
// do in their library.
ipcMain.handle('launch-game', async (_event, dir) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, message: 'errApiChoice' };
  const known = lastGames.find((game) => keyFor(game.dir) === keyFor(dir));
  if (known && known.appid) {
    await shell.openExternal(`steam://rungameid/${String(known.appid).replace(/[^0-9]/g, '')}`);
    return { ok: true, via: 'steam' };
  }
  try {
    const scan = await scanGame(dir);
    const exe = scan.chosen && scan.chosen.path;
    if (!exe) return { ok: false, message: 'No game executable found' };
    const error = await shell.openPath(exe);
    return error ? { ok: false, message: error } : { ok: true, via: 'exe' };
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('set-rail', (_event, rail) => {
  const state = loadState();
  state.rail = rail === 'on' ? 'on' : 'off';
  return saveState(state) ? { ok: true, rail: state.rail } : { ok: false, rail: state.rail };
});
ipcMain.handle('set-skin', (_event, skin) => {
  const state = loadState();
  state.skin = skin === 'two' ? 'two' : 'one';
  return saveState(state) ? { ok: true, skin: state.skin } : { ok: false, skin: state.skin };
});
ipcMain.handle('set-theme', (_event, theme) => {
  const state = loadState();
  state.theme = theme;
  if (!saveState(state)) throw Error('Could not save settings');
  return theme;
});

// Import legacy backups from known locations only. Do not scan all drives.
ipcMain.handle('history', () => {
  let warning = false;
  const rows = history().list(mutationBusy ? [] : knownFolders(loadState(), lastGames), () => { warning = true; });
  return { rows, warning };
});
ipcMain.handle('history-clear', () => {
  if (mutationBusy) return { ok: false, code: 'busy' };
  try { history().clear(); return { ok: true }; }
  catch (error) { return { ok: false, code: 'historyClearFailed', message: error.message }; }
});

// One file with everything a report needs: the app's own log, the game's
// ReShade and Feeder logs, the install manifest, the driver. Asking for those
// one at a time costs a round trip per report and half arrive incomplete.
//
// Nothing is gathered silently. The person is shown every file that would go in
// and where it came from, and chooses where to save it.
ipcMain.handle('save-diagnostics', async (event, dir, activity) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false };
  const window = BrowserWindow.fromWebContents(event.sender);
  const userData = app.getPath('userData');
  let exeDir = null;
  try {
    const scan = await scanGame(dir);
    if (scan.chosen) exeDir = path.dirname(scan.chosen.path);
  } catch { /* the folder alone is still worth reporting */ }

  const found = diagnostics.sources({ gameDir: dir, exeDir, userData });
  const list = found.length
    ? found.map(item => `\u2022 ${item.file}  (${Math.ceil(item.bytes / 1024)} KB)`).join('\n')
    : 'No log files were found for this game yet.';
  const consent = await dialog.showMessageBox(window, {
    type: 'question', title: 'Save diagnostics',
    message: 'These files will be copied into one text file:',
    detail: `${list}\n\nIt also records the app version, your GPU and driver, and this session's activity log. Game folder paths appear in it. Read it before attaching it anywhere.`,
    buttons: ['Cancel', 'Choose where to save'], defaultId: 1, cancelId: 0
  });
  if (consent.response !== 1) return { ok: false, cancelled: true };

  let gpu = null;
  try { gpu = guards.driverNames(await guards.gpuInfo()); } catch { /* advice only */ }
  const { text } = diagnostics.report({
    gameDir: dir, exeDir, userData,
    facts: {
      app: app.getVersion(), electron: process.versions.electron, platform: `${process.platform} ${os.release()}`,
      gpu, game: path.basename(dir), 'game folder': dir, 'executable folder': exeDir,
      activity: typeof activity === 'string' && activity.length <= 512 * 1024 ? `\n${activity}` : null
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const picked = await dialog.showSaveDialog(window, {
    title: 'Save diagnostics',
    defaultPath: path.join(app.getPath('documents'), `dlss5-swapper-diagnostics-${stamp}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }]
  });
  if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
  try {
    await fs.promises.writeFile(picked.filePath, text, 'utf8');
    return { ok: true, file: picked.filePath, count: found.length };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('copy-text', (_event, text) => {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) return false;
  try { clipboard.writeText(text); return true; } catch { return false; }
});

ipcMain.handle('game-menu', async (event, dir, options) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return null;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return null;
  return gameMenu.show({ Menu, dialog, window, dir, name: gameName(dir),
    labels: options?.labels, position: options?.position, busy: mutationBusy || options?.busy === true });
});

ipcMain.handle('restore-status', (_event, dir) => ({
  canRestore: typeof dir === 'string' && path.isAbsolute(dir) && gameMenu.hasBackup(dir)
}));

ipcMain.handle('settings', () => {
  const state = loadState();
  let posterCount = 0;
  try { posterCount = fs.readdirSync(posterDir()).length; } catch {}
  return {
    folders: state.folders || [], stateFile: stateFile(), posterDir: posterDir(), posterCount,
    roots: lastRoots,
    excludedRoots: state.excludedRoots || [],
    hidden: [...(state.hidden || [])],
    autoScanDrives: state.autoScanDrives === true,
    groupGamesByStore: state.groupGamesByStore !== false,
    closeToTray: state.closeToTray !== false,
    safeGraphics: state.safeGraphics === true,
    rememberWindow: state.rememberWindow === true,
    skin: state.skin === 'two' ? 'two' : 'one'
  };
});

ipcMain.handle('set-safe-graphics', (_event, enabled) => {
  const state = loadState();
  state.safeGraphics = enabled === true;
  // It reads the flag at startup, so the change lands on the next launch.
  return saveState(state) ? { ok: true, on: state.safeGraphics } : { ok: false, on: !state.safeGraphics };
});
ipcMain.handle('set-remember-window', (_event, enabled) => {
  const state = loadState();
  state.rememberWindow = enabled === true;
  if (!state.rememberWindow) delete state.windowState;
  if (!saveState(state)) throw Error('Could not save settings');
  if (state.rememberWindow) saveWindowState();
  return state.rememberWindow;
});
ipcMain.handle('restore-scan-root', (_event, dir) => {
  const state = loadState();
  const matches = item => keyFor(item) === keyFor(dir);
  const previousFolder = state.excludedFolders?.find(matches);
  if (previousFolder && !state.folders.some(matches)) state.folders.push(previousFolder);
  state.excludedFolders = (state.excludedFolders || []).filter(item => !matches(item));
  state.excludedRoots = (state.excludedRoots || []).filter(item => !matches(item));
  if (!saveState(state)) throw Error('Could not save settings');
  return true;
});
ipcMain.handle('reset-library', () => {
  const state = loadState();
  Object.assign(state, { folders: [], excludedRoots: [], manual: [], hidden: [], scans: {}, posters: {}, recents: [] });
  delete state.excludedFolders;
  if (!saveState(state)) throw Error('Could not save settings');
  invalidateLibraryView();
  return true;
});
ipcMain.handle('set-close-to-tray', (_event, enabled) => {
  const state = loadState();
  state.closeToTray = enabled === true;
  if (!saveState(state)) throw Error('Could not save settings');
  if (state.closeToTray) ensureTray();
  // Turning it off leaves the icon alone: the window is open, and taking the
  // tray away under a menu somebody may have just opened is worse than a
  // harmless icon that does the same two things.
  return state.closeToTray;
});

ipcMain.handle('set-tray-labels', (_event, labels) => {
  if (labels && typeof labels.show === 'string' && typeof labels.quit === 'string') {
    trayLabels = { show: labels.show, quit: labels.quit };
    buildTrayMenu();
  }
  return true;
});

ipcMain.handle('set-group-games-by-store', (_event, enabled) => {
  const state = loadState();
  state.groupGamesByStore = enabled === true;
  if (!saveState(state)) throw Error('Could not save settings');
  return state.groupGamesByStore;
});

ipcMain.handle('set-auto-scan-drives', (_event, enabled) => {
  const state = loadState();
  state.autoScanDrives = enabled === true;
  if (!saveState(state)) throw Error('Could not save settings');
  if (!state.autoScanDrives) lastRoots = [];
  return state.autoScanDrives;
});

// Both the native picker and a desktop drop add a single game directory.
function addGameDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return null;
  const state = loadState();
  if (!state.manual.some(item => keyFor(item) === keyFor(dir))) {
    state.manual.push(dir);
    if (!saveState(state)) throw Error(uiText('无法保存游戏目录', 'Could not save the game directory'));
  }
  return dir;
}
ipcMain.handle('add-game-path', (_event, dir) => addGameDirectory(dir));

// The roots found on the drives, kept so Settings can show what was searched
// without paying for the sweep twice.
let lastRoots = [];
let lastGames = [];

function discoveryOptions(state) {
  return {
    folders: [...state.folders],
    scanDrives: state.autoScanDrives === true,
    excludedRoots: [...(state.excludedRoots || [])]
  };
}

ipcMain.handle('library', async () => {
  const generation = libraryGeneration;
  let found;
  // A folder can be added or excluded while the worker is reading launcher files.
  // Publish only a result for the current roots, and respect an explicit library reset.
  for (;;) {
    const options = discoveryOptions(loadState());
    found = await inspections().run('discover', null, options);
    if (generation !== libraryGeneration) return lastGames;
    if (JSON.stringify(options) === JSON.stringify(discoveryOptions(loadState()))) break;
  }
  const state = loadState();
  lastRoots = found.roots;
  const games = found.games.concat(
    state.manual
      .filter((dir) => fs.existsSync(dir))
      .map((dir) => ({ launcher: 'Added by hand', id: null, name: path.basename(dir), dir, poster: null }))
  );

  const hidden = new Set(state.hidden.map((d) => d.toLowerCase()));
  lastGames = dedupe(games)
    .filter((g) => !hidden.has(path.resolve(g.dir).toLowerCase()))
    .map((g) => ({
      key: keyFor(g.dir),
      launcher: g.launcher,
      // Steam records the app id, so its games never need a name search.
      appid: g.launcher === 'Steam' ? g.id : null,
      name: g.name,
      dir: g.dir,
      poster: posterUrl(g, state),
      tile: cachedTile(g.dir),
      hero: artCache.usable(state.art?.[keyFor(g.dir)], onDisk).hero || null,
      // Whatever the last scan found, so cards can render before rescanning.
      cached: state.scans[keyFor(g.dir)] && state.scans[keyFor(g.dir)].rules === SCAN_RULES
        ? state.scans[keyFor(g.dir)]
        : null
    }));
  // Browsing the library is read-only; repairs belong to explicit apply operations.
  return lastGames;
});

// Scanning 37 folders takes seconds, so each card asks for its own result and
// the grid fills in as they land.
ipcMain.handle('scan', async (_event, dir) => {
  const generation = libraryGeneration;
  const key = keyFor(dir);
  try {
    const scan = await inspections().run('scan', dir);
    let dlss = scan.primaryDlss;
    if (!dlss && scan.chosen && scan.chosen.bitness === 32) {
      const hostDlss = path.join(path.dirname(scan.chosen.path), 'host64', 'nvngx_dlss.dll');
      if (fs.existsSync(hostDlss)) {
        dlss = {
          path: hostDlss,
          rel: path.relative(dir, hostDlss),
          name: 'nvngx_dlss.dll',
          version: pe.getFileVersion(hostDlss),
          bitness: 64
        };
      }
    }
    const result = {
      dir,
      ok: Boolean(scan.chosen),
      installable: installRoutes.routesFor(scan.chosen).length > 0,
      api: scan.chosen ? scan.chosen.apiLabel : null,
      bitness: scan.chosen ? scan.chosen.bitness : null,
      dx12: Boolean(scan.chosen && scan.chosen.apiLabel === 'DirectX 12'),
      exe: scan.chosen ? scan.chosen.rel : null,
      reason: scan.emptyReason || null,
      dlss: dlss ? dlss.version : null,
      hasDlss: Boolean(dlss),
      managed: Boolean(scan.install),
      addon: Boolean(scan.addonPresent),
      optiscaler: Boolean(scan.install?.optiscaler?.installed),
      reshade: scan.reshade.installed ? scan.reshade.version : null,
      scannedAt: Date.now(),
      rules: SCAN_RULES
    };
    if (generation === libraryGeneration) {
      const state = loadState();
      state.scans[key] = result;
      saveState(state);
    }
    return result;
  } catch (err) {
    return { ok: false, api: null, dx12: false, reason: 'error', error: err.message };
  }
});

// ---------- editing the library ----------

ipcMain.handle('add-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: uiText('扫描游戏文件夹', 'Scan this folder for games') });
  if (res.canceled) return null;
  const state = loadState();
  if (!state.folders.some(folder => keyFor(folder) === keyFor(res.filePaths[0]))) state.folders.push(res.filePaths[0]);
  state.excludedFolders = (state.excludedFolders || []).filter(folder => keyFor(folder) !== keyFor(res.filePaths[0]));
  state.excludedRoots = (state.excludedRoots || []).filter(
    (root) => path.resolve(root).toLowerCase() !== path.resolve(res.filePaths[0]).toLowerCase()
  );
  if (!saveState(state)) throw Error(uiText('无法保存扫描目录', 'Could not save the scan folder'));
  return res.filePaths[0];
});

function excludeScanRoot(_event, dir) {
  const state = loadState();
  const matches = item => keyFor(item) === keyFor(dir);
  const folder = state.folders.find(matches);
  if (folder) {
    state.excludedFolders ||= [];
    if (!state.excludedFolders.some(matches)) state.excludedFolders.push(folder);
  }
  state.excludedRoots ||= [];
  if (!state.excludedRoots.some(matches)) state.excludedRoots.push(dir);
  state.folders = state.folders.filter(item => !matches(item));
  if (!saveState(state)) throw Error('Could not save settings');
  lastRoots = lastRoots.filter(item => !matches(item));
  return true;
}
ipcMain.handle('exclude-root', excludeScanRoot);
ipcMain.handle('remove-folder', excludeScanRoot);

ipcMain.handle('add-game', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: uiText('添加游戏目录', 'Add one game') });
  if (res.canceled) return null;
  return addGameDirectory(res.filePaths[0]);
});

ipcMain.handle('set-poster', async (_event, dir) => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: uiText('选择游戏封面', 'Choose a game cover'),
    filters: [{ name: uiText('图片', 'Images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  });
  if (res.canceled) return null;

  // Keep the previous cover reachable until the updated index is on disk.
  const state = loadState();
  const folder = posterDir(), key = keyFor(dir), source = res.filePaths[0];
  const previous = state.posters?.[key];
  fs.mkdirSync(folder, { recursive: true });
  const dest = path.join(folder, key + '-' + crypto.randomUUID() + path.extname(source));
  try {
    fs.copyFileSync(source, dest);
    state.posters ||= {};
    state.posters[key] = dest;
    if (!saveState(state)) throw Error(uiText('无法保存封面设置', 'Could not save the cover setting'));
  } catch (error) {
    fs.rmSync(dest, { force: true });
    throw error;
  }
  if (typeof previous === 'string' && path.dirname(previous) === folder &&
      new RegExp('^' + key + '(?:-[a-f0-9-]{36})?\\.(?:png|jpe?g|webp)$', 'i').test(path.basename(previous))) {
    try { fs.unlinkSync(previous); } catch { /* The old cover may already be gone. */ }
  }
  return pathToFileURL(dest).href;
});

ipcMain.handle('hide', (_event, dir) => {
  const state = loadState();
  if (!state.hidden.some(item => keyFor(item) === keyFor(dir))) state.hidden.push(dir);
  if (!saveState(state)) throw Error('Could not save settings');
  return true;
});

// Hiding a game only takes it out of the list, so it has to be possible to
// put it back. Without this the only way out was resetting the whole library.
ipcMain.handle('unhide', (_event, dir) => {
  const state = loadState();
  const wanted = path.resolve(String(dir)).toLowerCase();
  state.hidden = (state.hidden || []).filter((item) => path.resolve(item).toLowerCase() !== wanted);
  if (!saveState(state)) throw Error('Could not save settings');
  return true;
});

ipcMain.handle('reset', () => {
  try { fs.unlinkSync(stateFile()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Clear the in-memory object too; otherwise the next setting save resurrects
  // the configuration that was just reset on disk.
  liveState = null;
  invalidateLibraryView();
  overlayBridge?.refreshPreferences();
  return true;
});

ipcMain.handle('open', async (_event, dir) => {
  if (dir === posterDir()) await fs.promises.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('open-project', async (_event, destination) => {
  const url = projectUrl(destination);
  if (!url) return false;
  try { await shell.openExternal(url); return true; } catch { return false; }
});

// The home page lists the last games touched, newest first.
function rememberGame(dir) {
  const state = loadState();
  state.recents = [{ dir, at: Date.now() }]
    .concat((Array.isArray(state.recents) ? state.recents : []).filter(r => typeof r?.dir === 'string' && keyFor(r.dir) !== keyFor(dir)))
    .slice(0, 12);
  saveState(state);
  return state.recents;
}
ipcMain.handle('touch', (_event, dir) => rememberGame(dir));

// Before anything has been installed in this session, the row is filled from
// the backup manifests already sitting in the game folders - real installs
// with real dates rather than an empty shelf.
function recentsFromManifests(state) {
  const latest = new Map();
  for (const row of fromManifests(knownFolders(state, lastGames))) {
    const key = keyFor(row.dir);
    const at = Date.parse(row.date);
    if (!latest.has(key) || latest.get(key).at < at) latest.set(key, { dir: row.dir, at });
  }
  return [...latest.values()].sort((a, b) => b.at - a.at).slice(0, 12);
}

ipcMain.handle('recents', () => {
  const state = loadState();
  const excluded = state.excludedRoots || [];
  const manual = new Set((state.manual || []).map((dir) => path.resolve(dir).toLowerCase()));
  const saved = (state.recents || []).filter((r) =>
    fs.existsSync(r.dir) && (
      manual.has(path.resolve(r.dir).toLowerCase()) || !excluded.some((root) => isInside(r.dir, root))
    )
  );
  return saved.length ? saved : recentsFromManifests(state);
});

// ---------- artwork ----------

// Which builds are switched on. Any number can be, because ReShade loads every
// .addon64 in the folder. `state.addon` was a single path in earlier versions.
function storedAddons(state) {
  return (state.addons || (state.addon ? [state.addon] : [])).filter(file => typeof file === 'string' && file);
}
function enabledAddons() {
  return storedAddons(loadState()).filter(f => fs.existsSync(f) && describe(f, null));
}

// The one that takes the base's place, if any: same file name means the same
// file on disk, so it lands on top rather than beside it.
function replacementAddon() {
  const p = payload(true);
  if (!p?.source.addon) return null;
  const base = path.basename(p.source.addon).toLowerCase();
  return enabledAddons().find((f) => path.basename(f).toLowerCase() === base) || null;
}

// The rest ride along with the base. Two builds sharing a file name cannot both
// be written, so the first switched on keeps the name.
function companionAddons() {
  const p = payload(true);
  if (!p?.source.addon) return [];
  const taken = new Set([path.basename(p.source.addon).toLowerCase()]);
  const out = [];
  for (const f of enabledAddons()) {
    const name = path.basename(f).toLowerCase();
    if (taken.has(name)) continue;
    taken.add(name);
    out.push(f);
  }
  return out;
}

// apply.js keeps its own copy of this private to the module, and the same
// thing is needed here for the second add-on placed beside it.
function enableAddon(exeDir, addonName) {
  const ini = path.join(exeDir, 'ReShade.ini');
  if (!fs.existsSync(ini)) return;
  const text = fs.readFileSync(ini, 'utf8');
  const stem = addonName.replace(/\.addon(64)?$/i, '');
  const match = text.match(/^DisabledAddons=(.*)$/m);
  if (match && match[1].toLowerCase().includes(stem.toLowerCase())) {
    fs.writeFileSync(ini, text.replace(/^DisabledAddons=.*$/m, 'DisabledAddons='), 'utf8');
  }
}

ipcMain.handle('window', (_event, action) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
});

// #229, #258, #104: the driver warning was a line in the install log, and
// every line after it said "added" and "done". Three people spent days on a
// driver the app had already named. It is a question now - answered once per
// driver version, never a block: the install is still theirs to make.
ipcMain.handle('driver-neural-fault', async () => {
  const rows = await guards.gpuInfo();
  if (!rows || !guards.driverNeuralFault(rows)) return { fault: false };
  const names = guards.driverNames(rows);
  const state = loadState();
  return { fault: true, names, acknowledged: (state.driverAcknowledged || []).includes(names) };
});

ipcMain.handle('acknowledge-driver', (_event, names) => {
  if (typeof names !== 'string' || !names) return false;
  const state = loadState();
  const seen = state.driverAcknowledged || [];
  // Keyed by the exact adapter-and-version string, so a driver change asks
  // again and a reinstall of the same one does not.
  if (!seen.includes(names)) { state.driverAcknowledged = [...seen, names].slice(-8); saveState(state); }
  return true;
});

// Which OptiScaler build a game uses, and the ones it may choose between. Only
// names from the pinned list are accepted - the folder is still hash-verified
// and still puts back anything swapped into it by hand (#191).
ipcMain.handle('optiscaler-builds', (_event, dir) => ({
  // The version is the identity; the label is what a person reads. Two of these
  // are one project's versions and one is another fork entirely, so a bare
  // number would read as "older" when it is neither older nor newer.
  builds: optiscaler.RELEASES.map((r) => ({ version: r.version, label: r.label || r.version })),
  current: (loadState().optiscalerVersion || {})[path.resolve(String(dir || '')).toLowerCase()] || optiscaler.RELEASE.version
}));

ipcMain.handle('set-optiscaler-build', (_event, dir, version) => {
  if (typeof dir !== 'string' || !dir) return null;
  const state = loadState();
  const key = path.resolve(dir).toLowerCase();
  const chosen = optiscaler.releaseFor(version).version;
  const map = { ...(state.optiscalerVersion || {}) };
  if (chosen === optiscaler.RELEASE.version) delete map[key]; else map[key] = chosen;
  state.optiscalerVersion = map;
  if (!saveState(state)) throw Error('Could not save settings');
  return chosen;
});

ipcMain.handle('addons', () => addonLibrary());

// Switching one on leaves the others alone. The single exception is a build
// that would be written under a name another switched-on build already claims:
// only one file can hold that name, so the older choice steps aside.
ipcMain.handle('addon-toggle', (_event, file, on) => {
  const state = loadState();
  let list = storedAddons(state);
  let clash;

  if (!on) {
    list = list.filter((f) => keyFor(f) !== keyFor(file));
  } else {
    const row = addonLibrary().find((r) => keyFor(r.path) === keyFor(file));
    if (!row || row.missing) return { ok: false, message: 'That build is no longer there' };
    const name = path.basename(file).toLowerCase();
    clash = list.find((f) => keyFor(f) !== keyFor(file) && path.basename(f).toLowerCase() === name);
    list = list.filter((f) => path.basename(f).toLowerCase() !== name);
    list.push(row.path);
  }
  delete state.addon;
  state.addons = list;
  if (!saveState(state)) return { ok: false, message: 'Could not save add-on settings' };
  return clash ? { ok: true, replaced: path.basename(clash) } : { ok: true };
});

// Picking only reports what was chosen; nothing is stored until the dialog in
// the window is filled in and confirmed.
ipcMain.handle('addon-pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: uiText('添加附加组件', 'Add an add-on build'),
    filters: [{ name: 'ReShade add-on', extensions: ['addon64', 'addon'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths.length) return null;

  const file = res.filePaths[0];
  const row = describe(file, null);
  if (!row) return { error: 'unreadable' };
  return {
    path: file,
    file: row.file,
    size: row.size,
    version: row.version,
    // The folder is a better first guess than the file name, which is the same
    // for every build.
    suggestedName: path.basename(path.dirname(file))
  };
});

ipcMain.handle('addon-save', (_event, entry) => {
  if (!entry || typeof entry.path !== 'string' || !/\.addon(64)?$/i.test(entry.path) || !describe(entry.path, null)) throw Error('That build is no longer there');
  const state = loadState();
  const list = (state.addonFiles || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.addonFiles = [
    ...list.filter((e) => keyFor(e.path) !== keyFor(entry.path)),
    {
      path: entry.path,
      name: (entry.name || '').trim() || null,
      tag: (entry.tag || '').trim() || null,
      notes: String(entry.description || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    }
  ];
  return saveState(state);
});

ipcMain.handle('addon-remove', (_event, file) => {
  const state = loadState();
  const list = (state.addonFiles || []).map((e) => (typeof e === 'string' ? { path: e } : e));
  state.addonFiles = list.filter((e) => keyFor(e.path) !== keyFor(file));
  // Removing the one that was switched on falls back to the built-in add-on.
  state.addons = storedAddons(state).filter((f) => keyFor(f) !== keyFor(file));
  delete state.addon;
  return saveState(state);
});

ipcMain.handle('art-status', () => ({ available: art.available() }));

// Bumped whenever the art picked for a game could change, so folders cached
// under the old rule fetch again instead of keeping a bad banner forever.
const ART_RULES = artCache.RULES;

const onDisk = url => {
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  try { return fs.existsSync(fileURLToPath(url)); } catch { return false; }
};
const tileRequests = new Map();
const tileRetryAfter = new Map();
async function fetchHomeTile(dir, name, appid) {
  const existing = cachedTile(dir);
  if (existing) return { tile: existing };
  const file = tileFile(dir);
  if (tileRequests.has(file)) return tileRequests.get(file);
  if (Date.now() < (tileRetryAfter.get(file) || 0)) return {};
  const urls = art.tileUrls(name, appid || loadState().art?.[keyFor(dir)]?.appid);
  if (!urls.length) return {};
  const generation = libraryGeneration;
  const pending = (async () => {
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      for (const url of urls) {
        try { await art.download(url, tmp); }
        catch { continue; }
        if (libraryGeneration !== generation) return {};
        fs.renameSync(tmp, file);
        tileRetryAfter.delete(file);
        return { tile: pathToFileURL(file).href };
      }
      tileRetryAfter.set(file, Date.now() + 10 * 60 * 1000);
      return {};
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })();
  tileRequests.set(file, pending);
  try { return await pending; }
  finally { tileRequests.delete(file); }
}

ipcMain.handle('art-fetch', async (_event, dir, name, appid, kind) => {
  if (kind === 'tile') return fetchHomeTile(dir, name, appid);
  const generation = libraryGeneration;
  const state = loadState();
  const key = keyFor(dir);
  const cached = state.art && state.art[key];
  if (artCache.reusable(cached, onDisk)) return { ...cached, ...artCache.usable(cached, onDisk) };

  const remember = record => {
    if (generation !== libraryGeneration) return record;
    const latest = loadState();
    latest.art = latest.art || {};
    latest.art[key] = record;
    saveState(latest);
    return record;
  };
  const previous = artCache.usable(cached, onDisk);
  const miss = () => remember({ ...cached, ...previous, rules: ART_RULES, fetchedAt: Date.now() });

  try {
    const hit = await art.look(name, appid);
    if (!hit) return miss();

    const dest = path.join(app.getPath('userData'), 'art');
    const record = { ...hit, cover: null, hero: null, rules: ART_RULES, fetchedAt: Date.now() };
    const grab = async (url, suffix) => {
      if (!url) return null;
      try { return pathToFileURL(await art.download(url, path.join(dest, key + suffix))).href; }
      catch { return null; }
    };
    record.cover = previous.cover || await grab(hit.coverUrl, '-cover.jpg');
    // A few older apps have no hero image; the store header is the same shape.
    record.hero = previous.hero || await grab(hit.heroUrl, '-hero.jpg');
    if (!record.hero && hit.heroFallbackUrl) record.hero = await grab(hit.heroFallbackUrl, '-hero.jpg');

    return remember(record);
  } catch (err) {
    return { ...miss(), error: err.message };
  }
});

// ---------- installing ----------

// Releases move quickly and nothing here updates itself, so someone can sit
// on a build for weeks without knowing. One lookup per launch, no identifiers
// sent, no download started: the answer is a version number and a link the
// person may click. Any failure is silence - this must never delay a start.
let updateAnswer = null;
let updateInFlight = null;
// Nothing wrote the app's own failures down anywhere, so a crash left the
// person with nothing to report but a description. Keep the last few in
// userData, bounded, and let the diagnostics file carry them.
function recordCrash(kind, error) {
  try {
    const file = path.join(app.getPath('userData'), 'crash.log');
    const entry = `[${new Date().toISOString()}] ${kind}: ${error && error.stack ? error.stack : String(error)}\n\n`;
    let previous = '';
    try { previous = fs.readFileSync(file, 'utf8'); } catch { /* first one */ }
    // Newest last, oldest dropped: 256 KB is plenty and cannot grow unbounded.
    const combined = (previous + entry).slice(-256 * 1024);
    fs.writeFileSync(file, combined, 'utf8');
  } catch { /* a failure to record a failure is not worth a second one */ }
}
// Guarded because main.js is also evaluated in test sandboxes that are not a
// real process; a module should not install global handlers regardless.
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('uncaughtException', (error) => recordCrash('uncaughtException', error));
  process.on('unhandledRejection', (reason) => recordCrash('unhandledRejection', reason));
}

const releaseTag = /^v?(\d+)\.(\d+)\.(\d+)/;
function newerRelease(current, latest) {
  const a = releaseTag.exec(current), b = releaseTag.exec(latest);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(b[i]) > Number(a[i])) return true;
    if (Number(b[i]) < Number(a[i])) return false;
  }
  return false;
}
async function checkRelease() {
  const current = app.getVersion();
  const distribution = require('./package.json').distribution;
  const repository = distribution?.channel === 'independent' ? distribution.releaseRepository : 'skyi7943-cmd/DLSS5-Swapper-Enhanced';
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return { current, latest: null, newer: false, channel: 'independent', status: 'unconfigured',
      message: '独立分支尚未配置软件发布源；插件可在组件库中单独检查更新。' };
  }
  try {
    const response = await require('electron').net.fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { 'User-Agent': `DLSS5-Swapper-Enhanced/${current}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw Error(String(response.status));
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const answer = { current, latest, newer: newerRelease(current, latest) };
    if (typeof release.body === 'string' && release.body.trim()) answer.notes = release.body.trim();
    if (typeof release.name === 'string' && release.name.trim()) answer.title = release.name.trim();
    if (typeof release.published_at === 'string' && release.published_at.trim()) answer.publishedAt = release.published_at.trim();
    return answer;
  } catch {
    // Offline, rate-limited or blocked: say nothing rather than worry anyone.
    return { current, latest: null, newer: false };
  }
}
ipcMain.handle('update-check', (_event, refresh) => {
  if (updateInFlight) return updateInFlight;
  if (!refresh && updateAnswer) return updateAnswer;
  updateInFlight = checkRelease().then(answer => (updateAnswer = answer))
    .finally(() => { updateInFlight = null; });
  return updateInFlight;
});
ipcMain.handle('details', async (_event, dir, priority) => {
  let inspection;
  try {
    inspection = await inspectForUi(dir, undefined, priority, 'details');
  } catch (error) {
    if (error.code === 'SELECTION_SUPERSEDED') return { ok: false, cancelled: true };
    throw error;
  }
  const { scan, newDlss } = inspection;
  // Opening game details must not change permissions or configuration files.
  const state = loadState();
  const hasNativeDlss = installRoutes.nativeDlssPresent(scan);
  const hasNativeUpscaler = installRoutes.nativeUpscalerPresent ? installRoutes.nativeUpscalerPresent(scan) : false;
  const hostDlssFiles = [];
  let effectivePrimaryDlss = scan.primaryDlss;
  if (scan.chosen && scan.chosen.bitness === 32) {
    const hostDir = path.join(path.dirname(scan.chosen.path), 'host64');
    for (const name of ['nvngx_dlss.dll', 'nvngx_dlssnr.dll']) {
      const full = path.join(hostDir, name);
      if (fs.existsSync(full)) {
        const item = {
          path: full,
          rel: path.relative(dir, full),
          name,
          version: pe.getFileVersion(full),
          bitness: 64
        };
        hostDlssFiles.push(item);
        if (!effectivePrimaryDlss && name === 'nvngx_dlss.dll') effectivePrimaryDlss = item;
      }
    }
  }
  const files = [...scan.dlssFiles, ...hostDlssFiles, ...scan.streamlineFiles]
    .map((f) => ({ rel: f.rel, name: f.name, version: f.version }));
  const antiCheatDirectories = new Map();
  return {
    ok: Boolean(scan.chosen),
    reason: scan.chosen ? null : (scan.emptyReason || null),
    exe: scan.chosen ? scan.chosen.rel : null,
    exePath: scan.chosen ? scan.chosen.path : null,
    api: scan.chosen ? scan.chosen.apiLabel : null,
    apiKey: scan.chosen ? scan.chosen.api : null,
    bitness: scan.chosen ? scan.chosen.bitness : null,
    via: scan.chosen ? scan.chosen.via : null,
    emulator: scan.emulator,
    installedRoute: scan.install && scan.install.route,
    launcherProtected: !!require('./src/core/wuthering-waves').gameRoot(dir, scan.chosen?.path),
    ...compatibility.antiCheatDetails(dir, scan.chosen?.path, antiCheatDirectories),
    installedApi: scan.install && scan.install.api,
    installedExe: scan.install && scan.install.exe,
    previousReShadeRoute: scan.install && scan.install.previousReShadeRoute,
    optiscaler: scan.install && scan.install.optiscaler,
    recommendedRoute: installRoutes.recommendedRoute(scan),
    exes: scan.exeCandidates.map(e => {
      const capabilities = { hasNativeDlss: e.hasNativeDlss ?? hasNativeDlss, hasNativeUpscaler: e.hasNativeUpscaler ?? hasNativeUpscaler };
      return {
        rel: e.rel, path: e.path, apiLabel: e.apiLabel, api: e.api,
        bitness: e.bitness, size: e.size, via: e.via, emulator: e.emulator,
        installIssue: compatibility.targetIssue(dir, e.path),
        ...compatibility.antiCheatDetails(dir, e.path, antiCheatDirectories),
        ...capabilities,
        apiOverride: apiPreference(state, dir, e.path),
        reshadeProxy: reshadeProxyPreference(state, dir, e.path),
        apiChoices: e.apiChoices || [{ api: e.api, label: e.apiLabel }],
        routes: installRoutes.routesFor({ ...e, ...capabilities })
      };
    }),
    files,
    currentDlss: effectivePrimaryDlss ? {
      rel: effectivePrimaryDlss.rel,
      version: effectivePrimaryDlss.version,
      bitness: effectivePrimaryDlss.bitness
    } : null,
    addon: scan.addonPresent,
    reshade: scan.reshade,
    hasBackup: scan.hasBackup || fs.existsSync(journal.pendingPath(dir)),
    newDlss
  };
});

let mutationBusy = false;
let mutationFinished;
const libraryReads = new Map();
ipcMain.handle('set-api-override', async (_event, dir, exePath, value) => {
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!renderingApi.valid(value) || typeof dir !== 'string' || !path.isAbsolute(dir) || typeof exePath !== 'string') {
    return { ok: false, code: 'errApiChoice' };
  }
  const scan = await scanGame(dir);
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!scan.exeCandidates.some(exe => exe.path === exePath)) return { ok: false, code: 'errApiChoice' };
  const state = loadState();
  state.apiOverrides = state.apiOverrides && typeof state.apiOverrides === 'object' && !Array.isArray(state.apiOverrides)
    ? state.apiOverrides : {};
  const key = apiPreferenceKey(dir, exePath);
  if (value === 'auto') delete state.apiOverrides[key];
  else state.apiOverrides[key] = value;
  return saveState(state) ? { ok: true } : { ok: false, code: 'errApiSave' };
});
ipcMain.handle('set-reshade-proxy', async (_event, dir, exePath, value) => {
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!['dxgi', 'd3d11'].includes(value) || typeof dir !== 'string' || !path.isAbsolute(dir) || typeof exePath !== 'string') {
    return { ok: false, code: 'errApiChoice' };
  }
  const scan = await scanGame(dir);
  if (mutationBusy) return { ok: false, code: 'errJobBusy' };
  if (!scan.exeCandidates.some(exe => exe.path === exePath)) return { ok: false, code: 'errApiChoice' };
  const state = loadState();
  state.reshadeProxy = state.reshadeProxy && typeof state.reshadeProxy === 'object' && !Array.isArray(state.reshadeProxy)
    ? state.reshadeProxy : {};
  const key = apiPreferenceKey(dir, exePath);
  if (value === 'dxgi') delete state.reshadeProxy[key];
  else state.reshadeProxy[key] = value;
  return saveState(state) ? { ok: true } : { ok: false, code: 'errApiSave' };
});
async function exclusiveMutation(work) {
  if (mutationBusy) return { ok: false, code: 'errJobBusy', message: uiText('另一项操作正在进行，请稍后重试。', 'Another operation is in progress. Try again shortly.') };
  mutationBusy = true;
  let release;
  mutationFinished = new Promise(resolve => { release = resolve; });
  try {
    // Finish snapshots and first-use catalog seeding before publishing new files.
    if (libraryReads.size) await Promise.allSettled([...libraryReads.values()]);
    return await work();
  }
  catch (err) { return { ok: false, code: err.code, message: err.message, dependencies: err.dependencies, downloads: err.downloads }; }
  finally { mutationBusy = false; mutationFinished = undefined; gameInspection?.invalidate(); release(); }
}

ipcMain.handle('install', (event, dir, exePath, requestedRoute, requestedApi, reviewToken) => exclusiveMutation(() => managedReview(event, dir, { kind: 'install', exePath, requestedRoute, requestedApi }, async () => {
  const scan = await scanGame(dir, exePath);
  const detected = exePath
    ? scan.exeCandidates.find(e => typeof exePath === 'string' && path.isAbsolute(exePath) && path.relative(e.path, exePath) === '')
    : scan.chosen;
  if (!detected) return exePath
    ? { ok:false, code:'errSelectedExeMissing', message:uiText('所选游戏程序已不在扫描列表中，请刷新后重新选择。', 'The selected executable is no longer in the scan. Refresh and select it again.') }
    : { ok:false, message:uiText('未找到游戏主程序。','No game executable found.') };
  const selection = requestedApi ?? apiPreference(loadState(), dir, detected.path);
  const target = renderingApi.effective(detected, selection);
  compatibility.assertSafeTarget(dir, target.path);
  target.hasNativeDlss = detected.hasNativeDlss ?? installRoutes.nativeDlssPresent(scan);
  target.hasNativeUpscaler = detected.hasNativeUpscaler ?? (installRoutes.nativeUpscalerPresent ? installRoutes.nativeUpscalerPresent(scan) : false);
  const api = target.api;
  const availableRoutes = installRoutes.routesFor(target, api);
  const routeSpecified = requestedRoute != null && requestedRoute !== '';
  if (routeSpecified && !availableRoutes.includes(requestedRoute)) {
    if (requestedRoute === 'optiscaler') {
      const code = installRoutes.optiReason(target, api) || 'optiUnsupported';
      return { ok: false, code, message: featureText(code) };
    }
    return { ok: false, code: 'errSelectedRouteUnavailable', message: uiText(
      '所选安装路线已不适用于当前游戏程序和图形 API。请刷新游戏详情，重新选择安装路线。',
      'The selected install route is unavailable for this executable and graphics API. Refresh the game details and select a route again.'
    ) };
  }
  if (!availableRoutes.length) return { ok: false, code: 'unsupportedRendererHint', message: 'This rendering API is not supported. Select the game’s DirectX 11 mode where available.' };
  const route = routeSpecified ? requestedRoute : installRoutes.recommendedRoute(scan, target);

  // ReShade Setup is a Windows executable. On Linux, support Windows games
  // launched with Steam Play by using their existing Proton prefix; native
  // Linux games do not load the Windows DLSS/ReShade payload.
  const protonGame = process.platform === 'linux'
    ? steam().find((game) => path.resolve(game.dir) === path.resolve(dir))
    : null;
  const proton = contextForSteamGame(protonGame);
  if (process.platform === 'linux' && !proton) {
    return { ok: false, code: 'errProtonRequired', message: 'This installer supports Windows games launched through Steam Proton. Launch the game once with Proton, then try again.' };
  }
  if (process.platform === 'linux' && api === 'vulkan') {
    return { ok: false, code: 'errLinuxVulkanUnsupported', message: 'The Vulkan Feeder route needs a host Vulkan layer and is not supported on Linux yet. Select a DirectX renderer in the game.' };
  }

  const send = (e) => { if (!previewFs.active()) event.sender.send('job', { ...e, dir }); };
  await guards.assertGameClosed(dir, target.path);
  await requireRuntime({kind:'install',route,target,scan});
  const p = payload();
  if (!p) return {ok:false,...payloadMissing()};
  if (journal.hasPendingRecovery(dir)) return { ok: false, code: 'errBackendRecovery' };
  const old = backends.readManifest(dir);
  const changed = old && (old.route !== route || old.game.api !== api || old.game.exe.toLowerCase() !== target.rel.toLowerCase());
  if (changed && (old.game.api === 'vulkan' || api === 'vulkan')) return { ok: false, code: 'errBackendVulkanSwitch' };
  let antiCheatAcknowledged = false;
  if (compatibility.hasAntiCheat(dir, target.path)) {
    const answer = previewFs.active() ? { response: 1 } : await dialog.showMessageBox(win, antiCheatWarning.dialogOptions(desktopLanguage(), dir, target.path));
    if (answer.response !== 1) return { ok: false, cancelled: true };
    antiCheatAcknowledged = true;
    send({ code: 'antiCheatRiskAccepted', params: {} });
  }
  // The ReShade and Feeder routes both drive the RenoDX neural consumer, which
  // upstream has measured faulting inside NVIDIA's runtime on a known driver
  // range. Say so before the work starts; it never stops the install.
  if (route === 'native' || route === 'feeder') {
    // Advice only: nothing about reading the driver may decide whether an
    // install runs.
    try {
      const rows = await guards.gpuInfo();
      if (guards.driverNeuralFault(rows)) send({ code: 'driverNeuralFault', params: { gpu: guards.driverNames(rows) } });
    } catch {}
  }

  let optiRoot = null;
  let optiVersion = null;
  if (route === 'optiscaler') {
    optiscaler.checkConflicts(dir, target.path, old, api);
    if (api === 'vulkan' && await vulkanLayer.existing(vulkanLayer.defaultRunner)) return { ok: false, code: 'errOptiVulkanLayer' };
    const gpu = await guards.gpuInfo();
    // Neither the card nor the driver is refused outright any more. Upstream
    // 0.2.0 says plainly that architectures older than Blackwell work with a
    // modded nvngx_dlssnr.dll, which the person supplies themselves - so this
    // is their decision to make, with both facts in front of them.
    const oldCard = gpu ? !guards.gpuModelSupported(gpu) : false;
    const oldDriver = gpu ? !guards.driverSupported(gpu) : false;
    const confirmation = previewFs.active() ? { response: 0 } : await dialog.showMessageBox(win, {
      type: 'warning', title: 'OptiScaler DLSS-NR',
      message: featureText('optiConfirm'),
      detail: [gpu ? gpu.map(g => `${g.name} — ${g.driver}`).join('\n') : featureText('errOptiHardware'),
        oldCard ? featureText('optiCardOld') : null,
        oldDriver ? featureText('optiDriverOld') : null,
        featureText('optiHint'), featureText('optiBridgeHint'), featureText('backendHint')].filter(Boolean).join('\n\n'),
      buttons: [featureText('installOpti'), featureText('cancel')], defaultId: 1, cancelId: 1
    });
    if (confirmation.response !== 0) return { ok: false, cancelled: true };
    const missing = missingVCRuntime(64, path.dirname(target.path), process.env.SystemRoot, ['msvcp140_atomic_wait.dll']);
    if (missing.length) return { ok: false, code: 'runtimeRequiredHint', message: missing.join(', ') };
    send({ code: 'optiDownloading', params: {} });
    // A game may name an older pinned build. #238: No Man's Sky runs on
    // 0.1.1.5 and crashes on 0.2.0-patch1, and until now the only way back was
    // to keep an old copy of the whole app.
    const wanted = (loadState().optiscalerVersion || {})[path.resolve(dir).toLowerCase()];
    const release = optiscaler.releaseFor(wanted);
    optiVersion = release.version;
    try { optiRoot = await optiscaler.ensureOptiScaler(app.getPath('userData'), release.version); }
    catch (err) { return { ok: false, code: componentCode(err, 'errOptiDownload'), message: err.message }; }
    send({ code: 'optiVerified', params: { version: release.version } });
  }

  // Check before restoring or touching the game: these DLLs are imported by
  // Feeder and its helper. Never report a working installation if absent.
  if (route === 'feeder') {
    if (!p.source.feeder || !(target.bitness === 32 ? p.source.feeder.ok32 : p.source.feeder.ok64)) {
      return { ok: false, message: 'Feeder payload is incomplete or from mixed releases. Reinstall the updated Swapper package.' };
    }
    const checks = [[target.bitness, path.dirname(target.path)]];
    if (target.bitness === 32) checks.push([64, path.join(path.dirname(target.path), 'host64')]);
    for (const [bits, folder] of checks) {
      const missing = missingVCRuntime(bits, folder);
      if (missing.length) {
        if (previewFs.active()) return { ok: false, code: 'runtimeRequiredHint', message: missing.join(', ') };
        const response = await dialog.showMessageBox(win, {
          type: 'warning', title: 'Microsoft Visual C++ Runtime',
          message: featureText('runtimeRequiredHint'),
          detail: `${bits === 32 ? 'x86' : 'x64'}\n${missing.join(', ')}\n${folder}`,
          buttons: [featureText('runtimeDownload'), featureText('cancel')], cancelId: 1, defaultId: 0
        });
        if (response.response === 0) await shell.openExternal(`https://aka.ms/vc14/vc_redist.${bits === 32 ? 'x86' : 'x64'}.exe`);
        return { ok: false, code: 'runtimeRequiredHint' };
      }
    }
    // DirectDraw goes through dgVoodoo exactly as DX8 and DX9 do - apply.js
    // refuses a ddraw install without it - and it was never downloaded for one,
    // so every DirectDraw install failed with errDgVoodooMissing (#292, #279).
    if (api === 'd3d8' || api === 'd3d9' || api === 'ddraw') {
      try {
        p.source.feeder.dgVoodooDir = await ensureDgVoodoo(app.getPath('userData'));
        send({ code: 'legacyWrapperReady', params: { api, bitness: target.bitness } });
      } catch (error) {
        return { ok: false, code: componentCode(error, 'legacyDownloadHint'), message: error.message };
      }
    }
  }

  if (route === 'feeder') {
    try {
      p.source.feeder.lumeniteRoot = await ensureLumenite(app.getPath('userData'));
      send({ code: 'motionProviderReady', params: { provider: 'LumeniteFX Kernel 2.0' } });
    } catch (err) {
      // VORT is bundled under MIT as an offline fallback. The install remains
      // usable even when GitHub is unavailable.
      p.source.feeder.lumeniteRoot = null;
      send({ code: 'motionProviderFallback', params: { error: err.message } });
    }
  }

  // Only user-selected companion builds are installed. Leave unrelated
  // add-ons alone; all managed copies now participate in the transaction.
  const companions = route === 'native' && target.bitness === 64 ? companionAddons() : [];

  // The in-game overlay rides along with the install when it is switched on and
  // the executable is one it supports. Prepared before anything is written, so
  // an unsupported build refuses the install rather than half-finishing it.
  const gameOverlay = require('./src/game-overlay');
  let overlayWanted = false;
  // An unreadable preference means the overlay is off. A DLSS install must not
  // fail because of it.
  try { overlayWanted = require('./src/overlay-preferences').read(app.getPath('userData')).enabled === true; } catch {}

  let overlayPlan = null;
  if (overlayWanted) {
    try {
      if (gameOverlay.routes(target).includes(route)) {
        overlayPlan = gameOverlay.prepare({ library: overlayLibrary(), target, route });
      } else {
        // Never silently. A route or an API the panel cannot ride on produced
        // an install with no overlay file and no line saying why, which is
        // indistinguishable from a bug.
        // The one reason that applies, in words: "does not attach on
        // renodx/DirectX 11" read as a fault on every route (#338).
        const why = target.bitness !== 64 ? 'bits' : route === 'renodx' ? 'multipass' : route === 'optiscaler' ? 'optiscaler' : 'api';
        send({ code: 'overlayNotForRoute', params: { why, api: target.apiLabel || target.api } });
      }
    } catch (error) {
      // DLSS is the job; the overlay rides along. A missing or conflicting
      // overlay build is reported and skipped - the switch defaults to on, so
      // failing here would break every install on a machine without one.
      send({ code: 'overlaySkipped', params: { error: error.message } });
    }
  }

  try {
    // A game could have been launched while the component download ran.
    await guards.assertGameClosed(dir, target.path);
    // Preserve the previous snapshot before a repeat install changes it.
    if (!previewFs.active()) history().list([{ dir, name: gameName(dir) }], error => send({ code: 'historySaveWarning', params: { error: error.message } }));
    const manifest = await backends.install({
      gameDir: dir,
      exePath: target.path,
      api,
      apiLabel: target.apiLabel,
      bitness: target.bitness,
      route,
      antiCheatAcknowledged,
      emulator: target.emulator,
      source: p.source,
      optiRoot,
      optiVersion,
      companions,
      reshadeSetup: p.reshadeSetup,
      setupRunner: proton ? createSetupRunner(proton) : undefined,
      vulkanLayerTarget: path.join(app.getPath('userData'), 'reshade-vulkan'),
      // DirectX 11 (#328) and the wrapped DirectX 8/9 titles that become
      // DirectX 11 inside dgVoodoo (#343). Not DirectX 12, which never loads
      // d3d11.dll, and not OptiScaler, which has no ReShade of its own.
      reshadeProxy: ['dxgi', 'd3d8', 'd3d9', 'ddraw'].includes(api) && target.apiLabel !== 'DirectX 12' && route !== 'optiscaler'
        ? reshadeProxyPreference(loadState(), dir, target.path) : 'dxgi',
      installReShade: true,
      addMissingDlss: true,
      addStreamline: false,
      upgradeReShade: false
    }, send);
    // Preflight can skip an unavailable overlay. Once file changes start, a
    // failure must reach the transaction that also owns the base install.
    if (overlayPlan) {
      const exeDir = path.dirname(target.path);
      // Feeder's own config template omits two upstream defaults the overlay
      // reads; fill them without touching a choice already made.
      if (route === 'feeder') {
        const cfg = path.join(exeDir, 'dlss5-feed.cfg');
        if (fs.existsSync(cfg)) {
          await writeTracked(manifest, dir, cfg,
            gameOverlay.completeFeederConfig(fs.readFileSync(cfg, 'utf8')), { kind: 'config' });
        }
      }
      await gameOverlay.attach({
        library: overlayLibrary(), target, gameDir: dir, manifest,
        saveManifest: saveActiveManifest, plan: overlayPlan
      });
      send({ code: 'addonInstalled', params: { name: 'DLSS 5 Overlay (F8)' } });
    }
    return { ok: true, replaced: manifest.replaced.length, added: manifest.added.length };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}, reviewToken)));

ipcMain.handle('restore', (event, dir, reviewToken) => exclusiveMutation(() => reviews().run(dir, { kind: 'restore' }, async () => {
  let restoredManifest = null;
  const send = (e) => {
    if (e.code === 'restoreDone') restoredManifest = e.params;
    if (!previewFs.active()) event.sender.send('job', { ...e, dir });
  };
  try {
    let old = null;
    const pending = fs.existsSync(journal.pendingPath(dir));
    try { old = backends.readManifest(dir); } catch (error) { if (!pending) throw error; }
    if (!old && !pending) old = recoverableManifest(dir)?.manifest;
    // Recovery belongs to the manifest/journal, not the graphics scanner.
    // A missing/updated/unrecognised executable must not strand our hooks.
    if (!old && !pending) return { ok: false, code: 'errNoBackup' };
    let exe = null;
    if (old) {
      try { exe = journal.safePath(dir, old.game?.exe); } catch (error) { if (!pending) throw error; }
    }
    await guards.assertGameClosed(dir, exe);
    if (!previewFs.active()) history().list([{ dir, name: gameName(dir) }], error => send({ code: 'historySaveWarning', params: { error: error.message } }));
    const restoreOptions = { vulkanLayerTarget: path.join(app.getPath('userData'), 'reshade-vulkan') };
    if (!await backends.restore(dir, send, manifest => { restoredManifest = manifest; }, restoreOptions)) return { ok: false, code: 'errNoBackup' };
    const result = previewFs.active() ? { ok: true, inventoryManifest: restoredManifest } : { ok: true };
    if (restoredManifest?.labOverlay) {
      try {
        const dirOfExe = path.dirname(journal.safePath(dir, restoredManifest.game.exe));
        require('./src/game-overlay').cleanupMissing(overlayLibrary(), dirOfExe);
      } catch (error) {
        result.recordWarning = error.message;
      }
    }
    saveOperation(dir, restoredManifest || {}, restoredManifest ? 'restore' : 'recovery', send);
    return result;
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}, reviewToken)));

// ---------- Enhanced Modules (DLSS 5 Neural Rendering + RTX 40 MFG + Diagnostics) ----------
const neuralModels = require('./src/core/neural-models');
const combinedManager = require('./src/core/combined-manager');

function resolvePayloadRoot() {
  return onDemandPayload() ? runtimes().payloadDir : require('./src/core/payload-root').resolvePayloadDir(undefined, process.resourcesPath, __dirname);
}

require('./src/hardware-ipc')({
  ipcMain, screen, window: () => win, loadState, saveState, inspections,
  payloadRoot: resolvePayloadRoot, userData: () => app.getPath('userData')
});

ipcMain.handle('enhanced-import-model', (_event, filePath, meta) => exclusiveMutation(async () => {
  try {
    let targetPath = filePath;
    if (!targetPath) {
      const res = await dialog.showOpenDialog(win, {
        title: meta?.expectedModelId
          ? uiText(`为 ${meta.expectedModelId} 选择 nvngx_dlssnr.dll`, `Choose nvngx_dlssnr.dll for ${meta.expectedModelId}`)
          : uiText('选择模型文件 nvngx_dlssnr.dll', 'Choose the model file nvngx_dlssnr.dll'),
        filters: [{ name: 'DLSS 5 Neural Rendering DLL', extensions: ['dll'] }],
        properties: ['openFile']
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, cancelled: true };
      targetPath = res.filePaths[0];
    }
    const record = neuralModels.importNeuralModel(targetPath, app.getPath('userData'), meta || {});
    await components().importPackage({component:'dlss-nr',version:record.version,files:{'nvngx_dlssnr.dll':record.filePath},source:'手动导入'});
    const hw = await combinedManager.detectHardwareEnvironment();
    const state = loadState();
    const activeProfile = combinedManager.resolveHardwareProfile(state.hardwareProfile, hw.gpu.name, null, null, hw.gpu.vramTotalMB);
    const compat = neuralModels.evaluateModelGpuCompatibility(record, hw.gpu.name, activeProfile);
    return { ok: true, model: { ...record, compatibility: compat } };
  } catch (err) {
    return { ok: false, code: err.code || 'errInvalidNeuralModel', message: err.message, details: err.details || null };
  }
}));

ipcMain.handle('enhanced-status', async (_event, dir, profileOverride, priority) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) {
    return { ok: false, message: '无效的游戏目录' };
  }
  try {
    return (await inspectForUi(dir, profileOverride, priority)).status;
  } catch (err) {
    if (err.code === 'SELECTION_SUPERSEDED') return { ok: false, cancelled: true };
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('enhanced-apply', (event, dir, config, reviewToken) => exclusiveMutation(() => managedReview(event, dir, { kind: 'enhanced', config }, async (resolvedConfig) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, message: '无效的游戏目录' };
  const state = loadState();
  const send = (e) => { if (!previewFs.active()) event.sender.send('job', { ...e, dir }); };
  const scanForOverride = await scanGame(dir).catch(() => null);
  const chosenExe = scanForOverride?.chosen?.path;
  return combinedManager.applyCombinedConfiguration(dir, {
    defaultHardwareProfile: state.hardwareProfile,
    apiOverride: chosenExe ? apiPreference(state, dir, chosenExe) : 'auto',
    reshadeProxy: chosenExe ? reshadeProxyPreference(state, dir, chosenExe) : 'dxgi',
    ...resolvedConfig,
    payloadDir: resolvePayloadRoot(),
    userDataDir: app.getPath('userData'),
    requirePayload: requireRuntime
  }, send);
}, reviewToken)));

ipcMain.handle('component-inventory', async (_event, dir) => {
  if (mutationBusy) return { ok: false, message: '安装操作进行中，请完成后再刷新组件清单。' };
  try { return await inspectInventory(dir); }
  catch (error) { return { ok: false, message: error.message, code: error.code }; }
});
async function readLibraryComponents(dir) {
  try {
    const result = await components().list(dir);
    result.updates = updates().status();
    result.runtimePacks = runtimes().list();
    if (dir) {
      result.inventory = await inspectInventory(dir);
      result.rollback = backends.readManifest(dir)?.componentHistory?.at(-1) || null;
    }
    return result;
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}
ipcMain.handle('library-components', async (_event, dir) => {
  // A seeded global catalog and update index are atomically published snapshots.
  // They remain readable during a long download or game install.
  if (dir || !components().initialized) {
    while (mutationFinished) await mutationFinished;
  }
  const key = dir || '';
  if (!libraryReads.has(key)) {
    libraryReads.set(key, readLibraryComponents(dir).finally(() => libraryReads.delete(key)));
  }
  return libraryReads.get(key);
});
ipcMain.handle('library-select', (_event, dir, selection) => exclusiveMutation(()=>components().select(dir,selection)));
ipcMain.handle('library-check-runtime', (_event, id) => exclusiveMutation(async () => {
  await runtimes().require([id]);
  return { ok: true };
}));
ipcMain.handle('library-check', async () => {
  // Update metadata is published atomically. Checking it doesn't change games or the package catalog.
  try { return await updates().check(); }
  catch (error) { return { ok: false, code: error.code, message: error.message }; }
});
let libraryTransferSender;
ipcMain.handle('library-download', (event, id) => exclusiveMutation(async () => {
  await components().init();
  libraryTransferSender = event.sender;
  const updater = updates();
  updater.onProgress = p => { if (!event.sender.isDestroyed()) event.sender.send('library-progress', p); };
  try { return await updater.download(id); }
  finally { updater.onProgress = () => {}; libraryTransferSender = null; }
}));
ipcMain.handle('library-cancel', event => { if (libraryTransferSender === event.sender) return updates().cancel(); });
function recordComponentChange(dir, result, action) {
  if (!result.ok || !result.historyManifest) return;
  saveOperation(dir, result.historyManifest, action, ({ params }) => {
    const warning = uiText('未能写入操作历史', 'Could not save operation history') + ' · ' + params.error;
    result.recordWarning = [result.recordWarning, warning].filter(Boolean).join('\n');
  });
  delete result.historyManifest;
}
ipcMain.handle('library-apply', (_event, dir, token, draft) => exclusiveMutation(async () => {
  const library = components();
  const previous = library.profile(dir).selected;
  const selection = draft === undefined ? previous : draft;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw Error('无效的版本选择');
  const hasSelection = Object.keys(selection).length > 0;
  if (!hasSelection && !Object.keys(previous).length) throw Error('请先选择组件版本');
  const request = { kind: 'component-update', selection, previous };
  const result = await reviews().run(dir, request, () => hasSelection
    ? library.apply(dir, selection, { strict: true, previousSelection: draft === undefined ? undefined : previous })
    : Promise.resolve({ ok: true, changed: 0 }), token);
  if (draft !== undefined && result.ok && !result.preview) {
    try { await library.select(dir, selection); }
    catch (error) { result.recordWarning = [result.recordWarning, uiText('未能保存版本选择', 'Could not save the version selection') + ' · ' + error.message].filter(Boolean).join('\n'); }
  }
  recordComponentChange(dir, result, 'component-update');
  return result;
}));
ipcMain.handle('library-rollback', (_event,dir,id,token) => exclusiveMutation(async()=>{
  const result=await reviews().run(dir,{kind:'component-rollback',id},()=>components().rollback(dir,id),token);
  if(result.ok&&!result.preview){try{await components().select(dir,result.selection);}catch(e){result.recordWarning=[result.recordWarning,uiText('组件已回滚，但版本选择未保存', 'Rolled back the component files, but could not save the version selection')+' · '+e.message].filter(Boolean).join('\n');}}
  recordComponentChange(dir, result, 'component-rollback');
  return result;
}));
ipcMain.handle('library-import', (_event, component) => exclusiveMutation(async()=>{
  const definition=require('./src/core/component-definitions').DEFINITIONS[component];
  if(!definition||definition.pinned||definition.internal)throw Error('这个内部组件由程序维护');
  const chosen=await dialog.showOpenDialog({title:'导入组件文件或完整 ZIP 包',properties:['openFile'],filters:[{name:'组件文件',extensions:['zip','dll','addon64','addon32']}]});
  if(chosen.canceled)return{ok:false,cancelled:true};
  const file=chosen.filePaths[0],library=components();await library.init();
  const staging=require('./src/core/component-library').safe(library.root,'imports/'+crypto.randomUUID());
  let files;
  try{
    if(/\.zip$/i.test(file)){await fs.promises.mkdir(staging,{recursive:true});await require('./src/core/component-updates').unpack(file,staging);files=await require('./src/core/component-updates').mapFiles(staging,component);}
    else {if(definition.files.length!==1)throw Error('该组件需要完整 ZIP 配套包');files={[definition.files[0]]:file};}
    const p=await library.importPackage({component,files,source:'手动导入',trustedAdapter:false});return{ok:true,package:p};
  }finally{if(fs.existsSync(staging))await fs.promises.rm(staging,{recursive:true,force:true});}
}));
let runtimeDetector;
ipcMain.handle('component-runtime', async (_event, dir) => {
  try {
    runtimeDetector ||= new (require('./src/core/runtime-status').RuntimeStatus)();
    return await runtimeDetector.inspect(dir);
  } catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('component-lock', (_event, dir, enabled) => exclusiveMutation(async () => {
  if (typeof enabled !== 'boolean') throw new Error('无效的锁定状态');
  return reviews().setLock(dir, enabled);
}));
let preparation;
ipcMain.handle('component-cancel-prepare', event => {
  if (preparation?.sender !== event.sender) return;
  preparation.controller.abort();
  runtimes().cancel();
});
ipcMain.handle('component-prepare', (event, dependencies) => exclusiveMutation(async () => {
  if (!Array.isArray(dependencies) || dependencies.length > 24) throw new Error('无效的缓存准备请求');
  const controller = new AbortController(), {signal} = controller;
  preparation = {sender:event.sender, controller};
  const cache = runtimes();
  const send = p => { if (!event.sender.isDestroyed()) event.sender.send('component-progress', p); };
  cache.onProgress = send;
  try {
    const selected = [...new Set(dependencies)];
    const runtimeIds = selected.filter(d => typeof d === 'string' && d.startsWith('runtime:')).map(d => d.slice(8));
    if (runtimeIds.length) {
      send({stage:'prepare', name:cache.pack(runtimeIds[0]).name});
      const result = await cache.prepare(runtimeIds);
      if (result.cancelled) return result;
      if (unifiedComponents) unifiedComponents.initialized = false;
    }
    const dir = app.getPath('userData');
    for (const dependency of selected) {
      signal.throwIfAborted();
      if (typeof dependency === 'string' && dependency.startsWith('runtime:')) continue;
      send({stage:'prepare', name:dependency});
      if (dependency === 'dgvoodoo') await ensureDgVoodoo(dir, signal);
      else if (dependency === 'lumenite') await ensureLumenite(dir, signal);
      else if (typeof dependency === 'string' && optiscaler.RELEASES.some(r => dependency === 'optiscaler:' + r.version))
        await optiscaler.ensureOptiScaler(dir, dependency.slice(11), signal);
      else throw new Error('未知的缓存组件');
    }
    signal.throwIfAborted();
    return {ok:true};
  } catch (error) {
    if (signal.aborted) return {ok:false, cancelled:true};
    throw error;
  } finally { cache.onProgress = () => {}; preparation = null; }
}));

