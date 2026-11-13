'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { fs, active: previewState } = require('./preview-fs');
const pe = require('./pe');
const journal = require('./file-journal');
const apply = require('./apply');
const models = require('./neural-models');
const profileAdapter = require('./wuwa-profile');
const ini = require('./feeder-config');

const CLIENT = 'Client/Binaries/Win64/Client-Win64-Shipping.exe';
const INDEX = 'LocalGameResources.json';
const PROXY = 'version.dll';
const CONTROL = 'RTXMFG-Universal.json';
const UI_CONFIG = 'RTX40MFG-UI.ini';
const ENGINE_RECEIPT = '.rtx-fg-v3/install.json';
const MODEL = 'nvngx_dlssnr.dll';
const MODEL_RECEIPT = '.rtx-fg-nr/ownership.json';
// The signed RTXManager distribution of the same 1.7.0 upstream proxy.
const RTX_PROXY_HASH = 'e476ce87b215bc987c5ca0dddcd5b4e3ca4fd05c764a6c446863e04fceba8e83';
const RTX_PROXY_171_HASH = 'a6b51a6fff2035acfe902c817ca32c7f93e1635c9efb04804c5b2e6bf588d129';
const runtime = () => require('./mfg-manager').MFG_UNLOCKERS.asiPlugin;
const fail = (message) => Object.assign(new Error(message), { code: 'errWutheringWaves' });
const digest = (file, algorithm = 'sha256') =>
  crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
const key = (p) => path.resolve(p).toLowerCase();

function gameRoot(dir, exe) {
  const candidates = [dir, path.join(dir, 'Wuthering Waves Game')];
  if (exe && /[\\/]Client[\\/]Binaries[\\/]Win64[\\/]Client-Win64-Shipping\.exe$/i.test(exe))
    candidates.push(path.resolve(path.dirname(exe), '../../..'));
  return candidates.find(
    (root) => fs.existsSync(path.join(root, 'Wuthering Waves.exe')) && fs.existsSync(path.join(root, CLIENT))
  );
}

function resourceList(text) {
  const { resource } = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(resource) || !resource.length) throw Error('Missing resource list');
  return resource;
}

function resources(root) {
  const indexFile = journal.safePath(root, INDEX);
  let text;
  try { text = fs.readFileSync(indexFile, 'utf8'); }
  catch (error) {
    // Some distribution channels do not ship Kuro's launcher manifest. Only
    // a missing file permits additive deployment; unreadable files never do.
    if (error.code === 'ENOENT') return null;
    throw fail('无法读取鸣潮资源清单，请检查文件权限；未修改游戏文件。');
  }
  try {
    const resource = resourceList(text);
    const entries = new Map();
    for (const item of resource) {
      const rel = item.dest?.replace(/\\/g, '/');
      if (
        !rel ||
        rel.startsWith('/') ||
        /:/.test(rel) ||
        rel.split('/').includes('..') ||
        !/^[a-f\d]{32}$/i.test(item.md5) ||
        !(Number.isSafeInteger(item.size) && item.size >= 0)
      )
        throw Error();
      entries.set(key(path.join(root, rel)), item);
    }
    return entries;
  } catch {
    throw fail('鸣潮资源清单格式无效，无法确认受保护文件；请用对应渠道启动器校验游戏。');
  }
}

function addonPaths(root) {
  const bin = path.dirname(path.join(root, CLIENT));
  return new Set([PROXY, CONTROL, MODEL, 'MFG-Unlocker-LICENSE.txt', MODEL_RECEIPT, UI_CONFIG, ENGINE_RECEIPT]
    .map(name => key(path.join(bin, name))));
}

function identifyEngine(hash, manifest) {
  if (!hash) return null;
  let identity = require('./engine-packages').identify('mfg-universal', hash);
  if (!identity?.verified) {
    const signed = hash === RTX_PROXY_HASH || hash === RTX_PROXY_171_HASH;
    if (hash !== runtime().sha256 && !signed) return null;
    const newer = hash === RTX_PROXY_171_HASH;
    identity = { verified: true, compatible: true,
      version: newer ? '1.7.1.177' : signed ? '1.7.0.1145' : runtime().version,
      recommended: false, capabilities: { neuralStrengths: true, neuralPresets: newer,
        dx11NeuralRendering: newer, diagnosticLogging: newer } };
  }
  const saved = manifest?.route === 'wuwa-proxy' && manifest.mfgLoader?.sha256 === hash ? manifest.mfgLoader : null;
  return { ...identity, sha256: hash, packageId: saved?.packageId ?? null };
}

function engineReceiptRecord(file, hash) {
  let record;
  try {
    if (fs.statSync(file).size > 65536) throw Error();
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { throw fail('无法读取 RTXManager 加载器归属记录；已保留现有文件。'); }
  const proxies = record.proxies || [record.proxy];
  if (record.backend !== 'rtx40mfg' || !hash || record.hashes?.[PROXY] !== hash ||
      !Array.isArray(proxies) || !proxies.length || proxies.some(name => name !== PROXY))
    throw fail('当前 RTXManager 方案使用其他加载器，请先在 RTXManager 中还原该方案。');
  return record;
}

function allowEnginePair(bin, proxyHash, receiptHash) {
  const state = previewState();
  if (state) state.wuwaEnginePair = new Map([
    [key(path.join(bin, PROXY)), proxyHash], [key(path.join(bin, ENGINE_RECEIPT)), receiptHash]
  ]);
}

function engineReceiptUpdate(dir, bin, manifest, hash, nextHash) {
  const file = journal.safePath(bin, ENGINE_RECEIPT);
  if (!fs.existsSync(file) && !manifest.rtxProxySwap) return null;
  const record = engineReceiptRecord(file, hash);
  const receiptHash = digest(file), previous = manifest.rtxProxySwap;
  if (previous && (previous.proxyAfter !== hash || previous.receiptAfter !== receiptHash))
    throw fail('RTXManager 加载器或归属记录已变化，请刷新游戏配置后再应用。');
  const proxyBefore = previous?.proxyBefore || hash, receiptBefore = previous?.receiptBefore || receiptHash;
  for (const [target, expected] of [[path.join(bin, PROXY), proxyBefore], [file, receiptBefore]]) {
    const backup = apply.originalPath(dir, manifest, path.relative(dir, target));
    if (manifest.added.some(rel => key(path.join(dir, rel)) === key(target)) ||
        ((previous || fs.existsSync(backup)) && !hasDigest(backup, expected)))
      throw fail('现有备份与 RTXManager 的加载器不匹配，请先还原 NeuralFrame 的上次部署。');
  }
  if (nextHash === hash) return null;
  const json = JSON.stringify({ ...record, hashes: { ...record.hashes, [PROXY]: nextHash } }, null, 2);
  return { file, json, swap: { proxyBefore, receiptBefore, proxyAfter: nextHash,
    receiptAfter: crypto.createHash('sha256').update(json).digest('hex') } };
}

function trackedAddon(manifest, dir, file) {
  return manifest?.route === 'wuwa-proxy' && [
    ...(manifest.added || []), ...(manifest.replaced || []).map(item => item.rel)
  ].some(rel => key(journal.safePath(dir, rel)) === key(file));
}

// An older install can leave a second copy beside the executable. Only paths
// listed by the launcher describe the game's own stack, including after updates.
let lastRuntimeIndex;
async function inspectNativeStack(root) {
  try {
    const index = journal.safePath(root, INDEX);
    const stat = await fs.promises.stat(index);
    const stamp = [index, stat.size, stat.ctimeMs, stat.mtimeMs].join('|');
    let paths = lastRuntimeIndex?.stamp === stamp ? lastRuntimeIndex.paths : null;
    if (!paths) {
      const list = resourceList(await fs.promises.readFile(index, 'utf8'));
      paths = list.map(item => item.dest).filter(rel => typeof rel === 'string' &&
        /(?:^|[\\/])(?:nvngx_dlssg?|sl\.(?:interposer|common))\.dll$/i.test(rel) &&
        !/(?:^|[\\/])win32[\\/]/i.test(rel));
      lastRuntimeIndex = { stamp, paths };
    }

    const files = new Map();
    for (const rel of paths) {
      const file = journal.safePath(root, rel.replace(/\\/g, '/'));
      const name = path.basename(file).toLowerCase();
      if (files.has(name) || !fs.existsSync(file) || pe.getBitness(file) === 32) continue;
      files.set(name, { rel, version: pe.getFileVersion(file) });
    }
    return { indexAvailable: true, sr: files.get('nvngx_dlss.dll'), fg: files.get('nvngx_dlssg.dll'),
      streamline: files.get('sl.interposer.dll') || files.get('sl.common.dll') };
  } catch (error) {
    return { indexAvailable: false, ...(error.code === 'ENOENT' ? { indexMissing: true } : {}) };
  }
}

function matchesResource(file, item) {
  return (
    fs.existsSync(file) &&
    fs.statSync(file).size === item.size &&
    digest(file, 'md5') === item.md5.toLowerCase()
  );
}

function rtxFiles(bin) {
  const files = new Set();
  const receipt = path.join(bin, '.rtx-fg-v3', 'install.json');
  if (fs.existsSync(receipt)) {
    const { hashes } = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    for (const name of Object.keys(hashes || {})) {
      if (path.basename(name) === name) files.add(key(journal.safePath(bin, name)));
    }
  }
  if (fs.existsSync(path.join(bin, MODEL_RECEIPT))) {
    files.add(key(path.join(bin, MODEL)));
    files.add(key(path.join(bin, MODEL_RECEIPT)));
  }
  return files;
}

function hasDigest(file, expected) {
  return fs.existsSync(file) && digest(file) === expected;
}

// RTXManager serializes writes with a Win32 mutex keyed by the client directory.
// Hold the same mutex from confirmation-time reinspection through journal commit.
async function withRtxLock(dir, work) {
  const root = gameRoot(dir, path.join(dir, path.basename(CLIENT)));
  if (process.platform !== 'win32' || !root) return work();
  const bin = path.dirname(path.join(root, CLIENT));
  if (!fs.existsSync(path.join(bin, MODEL_RECEIPT)) && !fs.existsSync(path.join(bin, '.rtx-fg-v3/install.json')))
    return work();
  const id = crypto.createHash('sha256').update(key(bin)).digest('hex');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$m=[Threading.Mutex]::new($false,'Local\\RTXFG-v3-${id}')`,
    'try { $held=$m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held=$true }',
    'if (!$held) { exit 2 }',
    "try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $m.ReleaseMutex(); $m.Dispose() }"
  ].join('; ');
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = require('node:child_process').spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = require('node:events').once(child, 'close').then(([code]) => code, () => -1);
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const output = require('node:readline').createInterface({ input: child.stdout });
    for await (const line of output) {
      if (line !== 'locked') break;
      clearTimeout(timer);
      return await work();
    }
    if (await closed === 2) throw fail('RTXManager 正在操作此游戏，请等它完成后再应用。');
    throw fail('未能取得 RTXManager 的游戏写入锁。');
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    await closed;
  }
}

// Permit only the two exact outputs of a validated RTXManager model switch.
// The final component plan can include other installers in the same transaction.
function allowModelPair(bin, modelHash, receiptHash) {
  const state = previewState();
  if (state) state.wuwaModelPair = new Map([
    [key(path.join(bin, MODEL)), modelHash],
    [key(path.join(bin, MODEL_RECEIPT)), receiptHash]
  ]);
}

function modelReceiptUpdate(dir, bin, manifest, nextHash) {
  const file = journal.safePath(bin, MODEL_RECEIPT);
  const model = journal.safePath(bin, MODEL);
  if (!fs.existsSync(file) && !manifest.rtxModelSwap) return null;
  const invalid = () => fail('RTXManager 模型或归属记录已变化，请刷新游戏配置后再应用。');
  if (!fs.existsSync(file) || fs.statSync(file).size > 16384) throw invalid();
  const bytes = fs.readFileSync(file);
  let record;
  try { record = JSON.parse(bytes.toString('utf8')); } catch { throw invalid(); }
  const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (record?.schema !== 1 || typeof record.game !== 'string' || typeof record.directory !== 'string' ||
      key(record.game) !== key(path.join(bin, path.basename(CLIENT))) || key(record.directory) !== key(bin) ||
      !validHash(record.installed) || !hasDigest(model, record.installed) ||
      ![record.previous, record.original].every(value => value == null || validHash(value)) ||
      (record.original && !hasDigest(journal.safePath(bin, '.rtx-fg-nr/original.dll'), record.original)))
    throw invalid();
  const receiptHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const previous = manifest.rtxModelSwap;
  if (previous && (previous.modelAfter !== record.installed || previous.receiptAfter !== receiptHash)) throw invalid();
  const modelBefore = previous?.modelBefore || record.installed;
  const receiptBefore = previous?.receiptBefore || receiptHash;
  for (const [target, expected] of [[model, modelBefore], [file, receiptBefore]]) {
    const rel = path.relative(dir, target);
    const backup = apply.originalPath(dir, manifest, rel);
    if (manifest.added.some(item => key(path.join(dir, item)) === key(target)) ||
        ((previous || fs.existsSync(backup)) && !hasDigest(backup, expected)))
      throw fail('现有备份与 RTXManager 的模型不匹配，请先还原 NeuralFrame 的上次部署。');
  }
  // A duplicate local source is not another model switch. Keep the original
  // previous-model chain and the receipt's exact bytes on a repeated apply.
  if (nextHash === record.installed) return null;
  // Match RTXManager's own switch format, retaining its original.dll chain.
  const json = JSON.stringify({ ...record, previous: record.installed, installed: nextHash }, null, 2);
  const swap = { modelBefore, receiptBefore, modelAfter: nextHash,
    receiptAfter: crypto.createHash('sha256').update(json).digest('hex') };
  return { file, json, swap };
}

// An archived NeuralFrame install can mention the very same filename that
// RTXManager subsequently installed. Its existence is no longer evidence of
// a residual NeuralFrame file. A live configuration edit retains its backup.
function restoreManifest(dir, manifest, archived, checkOriginals = false, onLog) {
  const root = gameRoot(dir, path.join(dir, manifest.game?.exe || ''));
  if (!root) return manifest;
  const bin = path.dirname(path.join(root, CLIENT)),
    owned = rtxFiles(bin);
  const swap = manifest.rtxModelSwap;
  const pair = new Set([key(path.join(bin, MODEL)), key(path.join(bin, MODEL_RECEIPT))]);
  const control = path.join(bin, CONTROL);
  const uiFile = path.join(bin, UI_CONFIG);
  const keepDiagnostics = manifest.wuwaDiagnosticsHash && (archived || !hasDigest(uiFile, manifest.wuwaDiagnosticsHash));
  const keepChangedLoader = manifest.mfgLoader && !hasDigest(path.join(bin, PROXY), manifest.mfgLoader.sha256);
  const engineSwap = manifest.rtxProxySwap;
  const enginePair = new Set([key(path.join(bin, PROXY)), key(path.join(bin, ENGINE_RECEIPT))]);
  let restoreEnginePair = false;
  if (engineSwap && !archived && manifest.route === 'wuwa-proxy' && checkOriginals) {
    restoreEnginePair = hasDigest(path.join(bin, PROXY), engineSwap.proxyAfter) &&
      hasDigest(path.join(bin, ENGINE_RECEIPT), engineSwap.receiptAfter);
    if (restoreEnginePair) {
      for (const [file, expected] of [[path.join(bin, PROXY), engineSwap.proxyBefore],
        [path.join(bin, ENGINE_RECEIPT), engineSwap.receiptBefore]]) {
        const rel = path.relative(dir, file);
        if (!manifest.replaced.some(item => key(path.join(dir, item.rel)) === key(file)) ||
            !hasDigest(apply.originalPath(dir, manifest, rel), expected))
          throw fail('RTXManager 加载器的原始备份缺失或已变化，无法还原。');
      }
      allowEnginePair(bin, engineSwap.proxyBefore, engineSwap.receiptBefore);
    }
  }
  const keepExternalControl = manifest.rtxControlHash && (archived || !hasDigest(control, manifest.rtxControlHash));
  let restorePair = false;
  if (swap && !archived && manifest.route === 'wuwa-proxy' && checkOriginals) {
    const model = journal.safePath(dir, path.relative(dir, path.join(bin, MODEL)));
    const receipt = journal.safePath(dir, path.relative(dir, path.join(bin, MODEL_RECEIPT)));
    restorePair = hasDigest(model, swap.modelAfter) && hasDigest(receipt, swap.receiptAfter);
    if (restorePair) {
      for (const [file, expected] of [[model, swap.modelBefore], [receipt, swap.receiptBefore]]) {
        const rel = path.relative(dir, file);
        if (!manifest.replaced.some(item => key(path.join(dir, item.rel)) === key(file)) ||
            !hasDigest(apply.originalPath(dir, manifest, rel), expected))
          throw fail('RTXManager 模型的原始备份缺失或已变化，无法还原。');
      }
      allowModelPair(bin, swap.modelBefore, swap.receiptBefore);
    } else onLog?.({ code: 'wuwaExternalModelKept', params: { file: MODEL } });
  }
  const keep = (rel) => {
    const file = key(path.join(dir, rel));
    return !(swap && pair.has(file)) && !(engineSwap && enginePair.has(file)) &&
      !(keepChangedLoader && file === key(path.join(bin, PROXY))) &&
      !(keepDiagnostics && file === key(uiFile)) && !(keepExternalControl && file === key(control)) && !owned.has(file);
  };
  const filtered = {
    ...manifest,
    added: manifest.added.filter(keep),
    replaced: manifest.replaced.filter(
      (item) =>
        keep(item.rel) || (restorePair && pair.has(key(path.join(dir, item.rel)))) ||
        (restoreEnginePair && enginePair.has(key(path.join(dir, item.rel)))) ||
        (!archived && !keepDiagnostics && manifest.wuwaDiagnosticsHash && key(path.join(dir, item.rel)) === key(uiFile)) ||
        (!archived && !keepExternalControl &&
          manifest.route === 'wuwa-proxy' &&
          key(path.join(dir, item.rel)) === key(path.join(bin, CONTROL)))
    )
  };
  if (checkOriginals && !keepDiagnostics && manifest.wuwaDiagnosticsHash) {
    const state = previewState();
    const original = filtered.replaced.find(item => key(path.join(dir, item.rel)) === key(uiFile));
    const added = filtered.added.some(rel => key(path.join(dir, rel)) === key(uiFile));
    if (state && (original || added)) state.wuwaDiagnosticWrites = new Map([[key(uiFile), original ?
      digest(apply.originalPath(dir, manifest, original.rel)) : null]]);
  }
  if (checkOriginals) {
    const index = resources(root);
    if (!index) {
      // Without the official index we cannot validate legacy runtime backups.
      // A protected deployment only owns these adjacent add-on paths.
      const allowed = addonPaths(root);
      if (manifest.route !== 'wuwa-proxy' ||
          [...filtered.added, ...filtered.replaced.map(item => item.rel)]
            .some(rel => !allowed.has(key(journal.safePath(dir, rel)))))
        throw fail('当前渠道没有鸣潮官方资源清单，无法验证旧安装的运行库备份；已停止还原，保留现有文件。');
      return filtered;
    }
    // A game update can ship a new official DLL after our original backup.
    // Preserve the launcher's current bytes even when the old backup exists.
    const needsRestore = ({ rel }) => {
      const file = journal.safePath(dir, rel),
        item = index.get(key(file));
      if (!item) return true;
      if (matchesResource(file, item)) return false;
      if (!matchesResource(apply.originalPath(dir, manifest, rel), item))
        throw fail('备份与鸣潮当前版本不匹配，请先用启动器修复，再还原补丁：' + rel);
      return true;
    };
    filtered.replaced = filtered.replaced.filter(needsRestore);
    filtered.added = filtered.added.filter((rel) => !index.has(key(journal.safePath(dir, rel))));
  }
  return filtered;
}

// Covers classic installs and component updates as well as the graphics page.
// Restoring an older deployment may legitimately write the exact official bytes.
function checkPreview(root, dir, rows, state, kind) {
  const index = resources(root);
  const bin = path.dirname(path.join(root, CLIENT)),
    owned = rtxFiles(bin);
  const allowedAddons = !index && addonPaths(root);
  const manifest = !index && require('./backend-manager').readManifest(dir);
  for (const row of rows) {
    if (row.scope !== 'game' || row.action === 'keep') continue;
    const file = key(path.join(dir, row.rel)),
      item = index?.get(file);
    const source = state.entries.get(file)?.source;
    const recoveredModelFile = kind === 'restore' && source &&
      [key(path.join(bin, MODEL)), key(path.join(bin, MODEL_RECEIPT))].includes(file) &&
      state.recoveredSources?.get(file) === key(source);
    const recoveredEngineFile = kind === 'restore' && source &&
      [key(path.join(bin, PROXY)), key(path.join(bin, ENGINE_RECEIPT))].includes(file) &&
      state.recoveredSources?.get(file) === key(source);
    const enginePairWrite = typeof row.after?.sha256 === 'string' && state.wuwaEnginePair?.get(file) === row.after.sha256;
    const diagnosticWrite = state.wuwaDiagnosticWrites?.has(file) &&
      state.wuwaDiagnosticWrites.get(file) === (row.after?.sha256 ?? null);
    const allowed = ['enhanced', 'restore'].includes(kind) && (
      file === key(path.join(bin, CONTROL)) || recoveredModelFile || recoveredEngineFile || enginePairWrite || diagnosticWrite ||
      (row.action === 'replace' && state.wuwaModelPair?.get(file) === row.after.sha256)
    );
    if (file === key(path.join(bin, ENGINE_RECEIPT)) && !enginePairWrite && !recoveredEngineFile)
      throw fail('加载器归属记录只能与已验证的独立加载器一起更新。');
    if (owned.has(file) && !allowed)
      throw fail('此文件由 RTXManager 管理：' + row.rel + '。请先在 RTXManager 中还原对应组件。');
    if (!index) {
      const adjacentOnly = ['enhanced', 'restore'].includes(kind) && allowedAddons.has(file);
      const knownControl = file === key(path.join(bin, CONTROL)) && inspectProxy(bin);
      if (!adjacentOnly || (row.action === 'replace' &&
          !trackedAddon(manifest, dir, file) && !allowed && !knownControl))
        throw fail('当前渠道没有鸣潮官方资源清单，仅支持独立加载补丁文件；禁止修改游戏原有文件：' + row.rel);
      continue;
    }
    if (!item && file !== key(path.join(root, INDEX))) continue;
    const next = state.entries.get(file);
    if (kind === 'restore') {
      if (item && next?.source && matchesResource(next.source, item)) continue;
      throw fail('备份与鸣潮当前版本不匹配，请先用启动器修复，再还原补丁：' + row.rel);
    }
    throw fail(
      '此操作会改变鸣潮启动器校验的文件：' + row.rel + '。请从“画质与补帧”应用，并清除该组件的版本覆盖。'
    );
  }
}

function readControl(file) {
  if (!fs.existsSync(file)) return { followGame: true, mode: 'follow', multiplier: 1 };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    /* Report a configuration error without overwriting the source. */
  }
  throw fail('无法读取现有的 RTXMFG 配置。');
}

function readUiSettings(file) {
  if (!fs.existsSync(file)) return '';
  try {
    if (fs.statSync(file).size > 65536) throw Error();
    const bytes = fs.readFileSync(file);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') :
      bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (text.includes('\0')) throw Error();
    return text;
  } catch { throw fail('无法读取现有的独立加载器界面设置；已保留 RTX40MFG-UI.ini。'); }
}

function proxyHash(bin) {
  const file = path.join(bin, PROXY);
  if (!fs.existsSync(file)) return null;
  return digest(file);
}

function inspectProxy(bin, manifest) {
  const hash = proxyHash(bin);
  const engine = identifyEngine(hash, manifest);
  if (!engine) return null;
  let settings;
  let logging = false;
  try {
    settings = readControl(path.join(bin, CONTROL));
    if (engine.capabilities.diagnosticLogging && fs.existsSync(path.join(bin, UI_CONFIG)))
      logging = ini.getIni(readUiSettings(path.join(bin, UI_CONFIG)), 'Diagnostics', 'Logging') === '1';
  } catch {
    return null;
  }
  const dynamic = settings.followGame !== true && settings.mode === 'dynamic';
  const fixed =
    settings.followGame !== true && !dynamic && [2, 3, 4, 5, 6].includes(settings.multiplier);
  return {
    nr: settings.dlss5 === true,
    mfg: {
      installed: true,
      backend: 'wuwa-proxy',
      backendName: `MFG Unlocker ${engine.version} · version.dll`,
      version: engine.version,
      packageId: engine.packageId,
      engine,
      advanced: profileAdapter.inspectAdvanced(settings, logging),
      mode: dynamic ? 'dynamic' : fixed ? 'x' + settings.multiplier : settings.followGame ? 'follow' : 'off',
      multiplier: fixed ? settings.multiplier : null,
      settings
    }
  };
}

async function configure(dir, root, scan, config, onLog) {
  const { neuralMode, mfgMode, hardwareProfile, payloadDir, gpuName, userDataDir } = config;
  let advanced;
  try { advanced = profileAdapter.validateAdvanced(config.mfgAdvanced); } catch (error) { throw fail(error.message); }
  if (config.resetNeuralTuning !== undefined && typeof config.resetNeuralTuning !== 'boolean')
    throw fail('重置神经渲染设置必须是布尔值。');
  if (config.mfgPackageId !== undefined && (typeof config.mfgPackageId !== 'string' ||
      (config.mfgPackageId !== '' && !/^[a-f0-9]{64}$/.test(config.mfgPackageId))))
    throw fail('独立加载器版本选择无效。');
  if (
    (neuralMode !== undefined && !['off', 'legacy', 'latest_compatible'].includes(neuralMode)) ||
    (mfgMode !== undefined && !['off', 'x2', 'x3', 'x4', 'x5', 'x6', 'dynamic', 'follow'].includes(mfgMode))
  )
    throw fail('不支持此渲染模式或补帧倍率。');
  const enableNr = !!neuralMode && neuralMode !== 'off',
    enableFg = !!mfgMode && mfgMode !== 'off';
  const exe = journal.safePath(dir, path.relative(dir, path.join(root, CLIENT)));
  if (key(exe) !== key(scan.chosen.path)) throw fail('请将鸣潮的目标程序设为 Client-Win64-Shipping.exe。');
  if (
    (enableNr || enableFg) &&
    (scan.chosen.bitness !== 64 ||
      !['dxgi', 'vulkan'].includes(scan.chosen.api) ||
      /DirectX (?:10|11)$/.test(scan.chosen.apiLabel))
  )
    throw fail('请在鸣潮和 NeuralFrame 中选择 64 位 DirectX 12 渲染模式。');
  if (enableFg && config.hdrCompatibility) throw fail('鸣潮独立加载模式不支持 RenoDX 的 HDR UI 保护设置。');
  const bin = path.dirname(exe),
    proxy = path.join(bin, PROXY),
    control = path.join(bin, CONTROL),
    model = path.join(bin, MODEL);
  const index = resources(root);
  const manifest = apply.beginManifest(dir, exe, scan.chosen.api);
  if (manifest.route && manifest.route !== 'wuwa-proxy')
    throw fail('鸣潮仍有旧部署记录，请先在 NeuralFrame 中还原原始文件，再应用独立加载配置。');
  const licenseDest = path.join(bin, 'MFG-Unlocker-LICENSE.txt');
  for (const file of [proxy, control, model, licenseDest, ...(advanced.diagnosticLogging !== undefined ? [path.join(bin, UI_CONFIG)] : [])]) {
    journal.safePath(dir, path.relative(dir, file));
    if (index?.has(key(file))) throw fail('加载位置属于鸣潮官方资源：' + path.basename(file));
  }
  const hash = proxyHash(bin);
  const installedEngine = identifyEngine(hash, manifest);
  if (hash && !installedEngine)
    throw fail('version.dll 已被其他插件占用，请先在原管理器中还原。');
  if (!index && !hash && fs.existsSync(control) && !trackedAddon(manifest, dir, control))
    throw fail('当前渠道没有官方资源清单，且存在来源未确认的 RTXMFG 配置；已保留该文件，请先确认原加载器。');
  if (!hash && !enableNr && !enableFg) {
    if (Object.keys(advanced).length || config.mfgPackageId !== undefined)
      throw fail('请先启用鸣潮独立加载，再应用高级设置或切换加载器版本。');
    return { ok: true, hardwareProfile };
  }
  const otherHook = [
    'renodx-mfgunlock.addon64',
    'renodx-dlss5.addon64',
    'renodx-dlss.addon64',
    'OptiScaler/plugins/MFGUnlocker.asi'
  ].find((name) => fs.existsSync(path.join(bin, name)));
  if (otherHook) throw fail('请先还原旧加载插件，再应用鸣潮独立加载配置：' + otherHook);
  const receipt = journal.safePath(bin, ENGINE_RECEIPT);
  if (fs.existsSync(receipt)) engineReceiptRecord(receipt, hash);
  if (manifest.mfgLoader && trackedAddon(manifest, dir, proxy) && manifest.mfgLoader.sha256 !== hash)
    throw fail('现有独立加载器已被其他工具修改，请先还原或重新确认归属。');
  for (const item of index?.values() || []) {
    if (!/(?:^|[\\/])nvngx_dlssg?\.dll$/i.test(item.dest)) continue;
    if (!matchesResource(journal.safePath(root, item.dest), item))
      throw fail('鸣潮的原版 DLSS 文件已改变，请先还原旧补丁或用启动器修复：' + item.dest);
  }
  const settings = readControl(control);
  let chosen;
  if (enableNr) {
    const id =
      models.normalizeModelId(config.neuralModelId) ||
      (neuralMode === 'legacy' ? '310.8.0-RTX40' : '310.8.SF-v2');
    const installed = fs.existsSync(model) && models.inspectNeuralModelBinary(model, {fresh:true});
    chosen =
      installed?.valid &&
      models.matchesModelId(installed, id) &&
      (!config.neuralModelSha256 || installed.sha256 === config.neuralModelSha256)
        ? installed
        : models.findLocalModel(
            models.listNeuralModels({ payloadDir, userDataDir, gpuName, hardwareProfile }),
            id,
            config.neuralModelSha256
          );
    if (!chosen && id !== '310.8.SF-v2') throw fail('请先在模型库下载或导入所选神经渲染模型。');
    if (!chosen && !config.requirePayload) throw fail('所选神经渲染模型尚未就绪。');
    if (chosen) {
      const inspected = models.inspectNeuralModelBinary(chosen.filePath, {fresh:true});
      if (!inspected.valid || inspected.sha256 !== chosen.sha256)
        throw fail('所选神经模型指纹已变化，请重新预览。');
      const compatible = models.evaluateModelGpuCompatibility(inspected, gpuName);
      if (!compatible.compatible) throw fail(compatible.reason);
    }
  }
  if (config.requirePayload)
    await config.requirePayload({
      kind: 'enhanced',
      route: 'wuwa-proxy',
      config,
      reuseProxy: (!!hash && config.mfgPackageId === undefined) || !!config.mfgPackageId,
      customModel: !!chosen
    });
  if (enableNr && !chosen) throw fail('所选神经渲染模型尚未就绪。');
  const selectedEngine = !hash || config.mfgPackageId !== undefined ?
    await require('./engine-packages').resolve({ component: 'mfg-universal', packageId: config.mfgPackageId, userDataDir, payloadDir }) : null;
  const engine = selectedEngine || installedEngine;
  if (advanced.diagnosticLogging !== undefined && !engine.capabilities.diagnosticLogging)
    throw fail('当前独立加载器不支持诊断日志开关，请选择已适配的 1.7.1 或更新版本。');
  const uiFile = journal.safePath(bin, UI_CONFIG);
  if (advanced.diagnosticLogging !== undefined && !index && fs.existsSync(uiFile) &&
      !hash && !trackedAddon(manifest, dir, uiFile))
    throw fail('当前渠道没有官方资源清单，无法确认现有诊断设置的归属；已保留 RTX40MFG-UI.ini。');
  if (!index && chosen && key(chosen.filePath) !== key(model) && fs.existsSync(model) &&
      !trackedAddon(manifest, dir, model) && !fs.existsSync(path.join(bin, MODEL_RECEIPT)))
    throw fail('当前渠道没有官方资源清单，无法确认现有神经模型的归属；已保留 nvngx_dlssnr.dll，请先在原工具中还原。');
  return journal.transaction(dir, async () => {
    if (selectedEngine && hash !== selectedEngine.sha256) {
      const source = selectedEngine.filePath;
      if (!fs.existsSync(source) || digest(source) !== selectedEngine.sha256)
        throw fail('独立加载器缺失或指纹不匹配，请重新准备 MFG Unlocker 组件。');
      const update = engineReceiptUpdate(dir, bin, manifest, hash, selectedEngine.sha256);
      if (update) {
        if (index?.has(key(update.file))) throw fail('加载器归属记录被鸣潮标记为官方资源。');
        await apply.writeTracked(manifest, dir, update.file, update.json, { kind: 'config' });
      }
      await apply.copyTracked(manifest, dir, source, proxy, { kind: 'proxy' });
      if (!hasDigest(proxy, selectedEngine.sha256)) throw fail('写入的独立加载器指纹与预览不一致。');
      if (update) {
        manifest.rtxProxySwap = update.swap;
        allowEnginePair(bin, update.swap.proxyAfter, update.swap.receiptAfter);
      }
      const license = selectedEngine.noticePath || (payloadDir && path.join(payloadDir, 'enhanced/mfg/licenses/MFG-Unlocker-LICENSE.txt'));
      if (license && fs.existsSync(license) && (index || !fs.existsSync(licenseDest) || trackedAddon(manifest, dir, licenseDest)))
        await apply.copyTracked(manifest, dir, license, licenseDest, { kind: 'license' });
    }
    if (chosen && key(chosen.filePath) !== key(model)) {
      const update = modelReceiptUpdate(dir, bin, manifest, chosen.sha256);
      if (update) {
        if (index?.has(key(update.file))) throw fail('模型归属记录被鸣潮标记为官方资源。');
        await apply.writeTracked(manifest, dir, update.file, update.json, { kind: 'config' });
      }
      await apply.copyTracked(manifest, dir, chosen.filePath, model, {
        kind: 'runtime',
        newVersion: chosen.version
      });
      if (update) {
        if (!hasDigest(model, chosen.sha256)) throw fail('写入的神经模型指纹与预览不一致。');
        manifest.rtxModelSwap = update.swap;
        allowModelPair(bin, update.swap.modelAfter, update.swap.receiptAfter);
      }
    }
    if (neuralMode !== undefined) {
      if (enableNr) profileAdapter.configureNeural(settings, hardwareProfile, {
        previousProfile: manifest.neuralRendering?.hardwareProfile, reset: config.resetNeuralTuning === true
      });
      settings.dlss5 = enableNr;
      manifest.neuralRendering = {
        mode: neuralMode,
        modelId: chosen?.modelId || chosen?.id,
        sha256: chosen?.sha256,
        hardwareProfile,
        profileAdapterVersion: 2,
        updatedAt: new Date().toISOString()
      };
    }
    if (mfgMode !== undefined) {
      const dynamic = { dynamicTargetFrameRate: settings.dynamicTargetFrameRate,
        dynamicExperimental56: settings.dynamicExperimental56 };
      Object.assign(settings, mfgMode === 'follow'
        ? { followGame: true, mode: 'follow', multiplier: 1 }
        : profileAdapter.mfgSettings(mfgMode));
      if (mfgMode === 'dynamic') for (const [name, value] of Object.entries(dynamic))
        if (value !== undefined) settings[name] = value;
      manifest.mfg = {
        mode: mfgMode,
        backend: 'wuwa-proxy',
        multiplier: settings.multiplier,
        hardwareProfile,
        updatedAt: new Date().toISOString()
      };
    }
    profileAdapter.configureAdvanced(settings, advanced);
    if (advanced.diagnosticLogging !== undefined) {
      const text = readUiSettings(uiFile);
      const next = ini.setIni(text, 'Diagnostics', 'Logging', advanced.diagnosticLogging ? '1' : '0');
      await apply.writeTracked(manifest, dir, uiFile, next, { kind: 'config' });
      manifest.wuwaDiagnosticsHash = crypto.createHash('sha256').update(next).digest('hex');
      const state = previewState();
      if (state) state.wuwaDiagnosticWrites = new Map([[key(uiFile), manifest.wuwaDiagnosticsHash]]);
    }
    manifest.mfgLoader = { version: engine.version, packageId: engine.packageId ?? null, sha256: engine.sha256 };
    if (manifest.mfg) Object.assign(manifest.mfg, manifest.mfgLoader);
    // Upstream reads at most 4096 bytes from the control file.
    const json = JSON.stringify(settings);
    if (Buffer.byteLength(json) > 4096) throw fail('RTXMFG 配置超出加载器的 4096 字节读取上限。');
    await apply.writeTracked(manifest, dir, control, json, { kind: 'config' });
    if (fs.existsSync(receipt) || manifest.rtxModelSwap) {
      manifest.rtxControlHash = crypto.createHash('sha256').update(json).digest('hex');
    }
    manifest.route = 'wuwa-proxy';
    manifest.resourceProtection = index ? 'launcher-index' : 'adjacent-only';
    manifest.hardwareProfile = hardwareProfile;
    await apply.saveActiveManifest(dir, manifest);
    onLog({ code: 'wuwaProxyConfigured', params: { file: PROXY } });
    return { ok: true, hardwareProfile, neuralResult: manifest.neuralRendering, mfgResult: manifest.mfg };
  });
}
module.exports = { gameRoot, checkPreview, inspectNativeStack, inspectProxy, configure, restoreManifest, withRtxLock };
