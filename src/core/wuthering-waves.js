'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { fs, active: previewState } = require('./preview-fs');
const pe = require('./pe');
const journal = require('./file-journal');
const apply = require('./apply');
const models = require('./neural-models');
const profileAdapter = require('./wuwa-profile');

const CLIENT = 'Client/Binaries/Win64/Client-Win64-Shipping.exe';
const INDEX = 'LocalGameResources.json';
const PROXY = 'version.dll';
const CONTROL = 'RTXMFG-Universal.json';
const MODEL = 'nvngx_dlssnr.dll';
const MODEL_RECEIPT = '.rtx-fg-nr/ownership.json';
// The signed RTXManager distribution of the same 1.7.0 upstream proxy.
const RTX_PROXY_HASH = 'e476ce87b215bc987c5ca0dddcd5b4e3ca4fd05c764a6c446863e04fceba8e83';
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
  try {
    const resource = resourceList(fs.readFileSync(journal.safePath(root, INDEX), 'utf8'));
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
    throw fail('无法读取鸣潮启动器的资源清单，请先用启动器校验游戏。');
  }
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
  } catch {
    return { indexAvailable: false };
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
    return !(swap && pair.has(file)) && !(keepExternalControl && file === key(control)) && !owned.has(file);
  };
  const filtered = {
    ...manifest,
    added: manifest.added.filter(keep),
    replaced: manifest.replaced.filter(
      (item) =>
        keep(item.rel) || (restorePair && pair.has(key(path.join(dir, item.rel)))) ||
        (!archived && !keepExternalControl &&
          manifest.route === 'wuwa-proxy' &&
          key(path.join(dir, item.rel)) === key(path.join(bin, CONTROL)))
    )
  };
  if (checkOriginals) {
    const index = resources(root);
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
  for (const row of rows) {
    if (row.scope !== 'game' || row.action === 'keep') continue;
    const file = key(path.join(dir, row.rel)),
      item = index.get(file);
    const source = state.entries.get(file)?.source;
    const recoveredModelFile = kind === 'restore' && source &&
      [key(path.join(bin, MODEL)), key(path.join(bin, MODEL_RECEIPT))].includes(file) &&
      state.recoveredSources?.get(file) === key(source);
    const allowed = ['enhanced', 'restore'].includes(kind) && (
      file === key(path.join(bin, CONTROL)) || recoveredModelFile ||
      (row.action === 'replace' && state.wuwaModelPair?.get(file) === row.after.sha256)
    );
    if (owned.has(file) && !allowed)
      throw fail('此文件由 RTXManager 管理：' + row.rel + '。请先在 RTXManager 中还原对应组件。');
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

function proxyHash(bin) {
  const file = path.join(bin, PROXY);
  if (!fs.existsSync(file)) return null;
  return digest(file);
}

function inspectProxy(bin) {
  const hash = proxyHash(bin);
  if (hash !== RTX_PROXY_HASH && hash !== runtime().sha256) return null;
  let settings;
  try {
    settings = readControl(path.join(bin, CONTROL));
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
      backendName: 'MFG Unlocker 1.7.0 · version.dll',
      mode: dynamic ? 'dynamic' : fixed ? 'x' + settings.multiplier : settings.followGame ? 'follow' : 'off',
      multiplier: fixed ? settings.multiplier : null,
      settings
    }
  };
}

async function configure(dir, root, scan, config, onLog) {
  const { neuralMode, mfgMode, hardwareProfile, payloadDir, gpuName, userDataDir } = config;
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
  for (const file of [proxy, control, model, licenseDest]) {
    journal.safePath(dir, path.relative(dir, file));
    if (index.has(key(file))) throw fail('加载位置属于鸣潮官方资源：' + path.basename(file));
  }
  const hash = proxyHash(bin);
  if (hash && hash !== RTX_PROXY_HASH && hash !== runtime().sha256)
    throw fail('version.dll 已被其他插件占用，请先在原管理器中还原。');
  if (!hash && !enableNr && !enableFg) return { ok: true, hardwareProfile };
  const otherHook = [
    'renodx-mfgunlock.addon64',
    'renodx-dlss5.addon64',
    'renodx-dlss.addon64',
    'OptiScaler/plugins/MFGUnlocker.asi'
  ].find((name) => fs.existsSync(path.join(bin, name)));
  if (otherHook) throw fail('请先还原旧加载插件，再应用鸣潮独立加载配置：' + otherHook);
  const receipt = path.join(bin, '.rtx-fg-v3', 'install.json');
  if (fs.existsSync(receipt)) {
    const record = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (
      record.backend !== 'rtx40mfg' ||
      !hash ||
      record.hashes?.[PROXY] !== hash ||
      (record.proxies || [record.proxy]).some((name) => name !== PROXY)
    )
      throw fail('当前 RTXManager 方案使用其他加载器，请先在 RTXManager 中还原该方案。');
  }
  for (const item of index.values()) {
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
    const installed = fs.existsSync(model) && models.inspectNeuralModelBinary(model);
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
      const inspected = models.inspectNeuralModelBinary(chosen.filePath);
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
      reuseProxy: !!hash,
      customModel: !!chosen
    });
  if (enableNr && !chosen) throw fail('所选神经渲染模型尚未就绪。');
  return journal.transaction(dir, async () => {
    if (!hash) {
      const source = path.join(payloadDir, runtime().relPath);
      if (!fs.existsSync(source) || digest(source) !== runtime().sha256)
        throw fail('独立加载器缺失或指纹不匹配，请重新准备 MFG Unlocker 组件。');
      await apply.copyTracked(manifest, dir, source, proxy, { kind: 'proxy' });
      const license = path.join(payloadDir, 'enhanced/mfg/licenses/MFG-Unlocker-LICENSE.txt');
      if (fs.existsSync(license))
        await apply.copyTracked(manifest, dir, license, licenseDest, { kind: 'license' });
    }
    if (chosen && key(chosen.filePath) !== key(model)) {
      const update = modelReceiptUpdate(dir, bin, manifest, chosen.sha256);
      if (update) {
        if (index.has(key(update.file))) throw fail('模型归属记录被鸣潮标记为官方资源。');
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
      if (enableNr) Object.assign(settings, profileAdapter.neuralSettings(hardwareProfile));
      settings.dlss5 = enableNr;
      manifest.neuralRendering = {
        mode: neuralMode,
        modelId: chosen?.modelId || chosen?.id,
        sha256: chosen?.sha256,
        hardwareProfile,
        profileAdapterVersion: 1,
        updatedAt: new Date().toISOString()
      };
    }
    if (mfgMode !== undefined) {
      Object.assign(settings, mfgMode === 'follow'
        ? { followGame: true, mode: 'follow', multiplier: 1 }
        : profileAdapter.mfgSettings(mfgMode));
      manifest.mfg = {
        mode: mfgMode,
        backend: 'wuwa-proxy',
        multiplier: settings.multiplier,
        hardwareProfile,
        updatedAt: new Date().toISOString()
      };
    }
    // Upstream reads at most 4096 bytes from the control file.
    const json = JSON.stringify(settings);
    if (Buffer.byteLength(json) > 4096) throw fail('RTXMFG 配置超出加载器的 4096 字节读取上限。');
    await apply.writeTracked(manifest, dir, control, json, { kind: 'config' });
    if (fs.existsSync(receipt) || manifest.rtxModelSwap) {
      manifest.rtxControlHash = crypto.createHash('sha256').update(json).digest('hex');
    }
    manifest.route = 'wuwa-proxy';
    manifest.hardwareProfile = hardwareProfile;
    await apply.saveActiveManifest(dir, manifest);
    onLog({ code: 'wuwaProxyConfigured', params: { file: PROXY } });
    return { ok: true, hardwareProfile, neuralResult: manifest.neuralRendering, mfgResult: manifest.mfg };
  });
}
module.exports = { gameRoot, checkPreview, inspectNativeStack, inspectProxy, configure, restoreManifest, withRtxLock };
