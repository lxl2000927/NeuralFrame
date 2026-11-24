'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const preview = require('./preview-fs');
const pe = require('./pe');
const { digest } = require('./component-library');
const journal = require('./file-journal');
const { scanGame } = require('./scan');
const { readManifest } = require('./backend-manager');
const key = p => path.resolve(p).toLowerCase();
const relKey = p => path.normalize(p).toLowerCase();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const binary = file => /\.(dll|addon32|addon64|asi|exe)$/i.test(file);
const known = name => /^(nvngx|_nvngx|sl\.|libxess|amd_fidelityfx|ffx_fsr|renodx|dlss5|ReShade|OptiScaler|RTXMFG|MFGUnlocker|dxgi\.dll$|d3d\d+\.dll$|opengl32\.dll$|dinput8\.dll$|winmm\.dll$)/i.test(name);
const category = name => /nvngx_dlssnr/i.test(name) ? '神经模型' : /\.addon|\.asi/i.test(name) ? '插件' : /\.(ini|cfg|jsonc?)$/i.test(name) ? '配置' : /\.(fx|fxh|png|dds)$/i.test(name) ? '着色器 / 资源' : binary(name) ? '运行库 / 加载器' : '辅助文件';
const err = (code, message) => Object.assign(new Error(message), { code });
function regularFile(file) {
  const stat = fs.lstatSync(file, {throwIfNoEntry:false});
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw err('errUnsafeTarget', `目标不是普通文件：${file}`);
  return stat;
}
function fileMetadata(file, size, sha256) {
  const version = binary(file) ? pe.getFileVersion(file) : null;
  return {size, sha256, version:version && version !== '0.0.0.0' ? version : null};
}
function diskInfo(file) {
  const stat = regularFile(file);
  if (!stat) return null;
  const fd = fs.openSync(file, 'r'), h = crypto.createHash('sha256'), buf = Buffer.allocUnsafe(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null))) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return fileMetadata(file, stat.size, h.digest('hex'));
}
// Previews, confirmations and version locks run on Electron's main thread.
// Yield during file reads, including the fresh digest taken after a write.
async function readDiskInfo(file) {
  const before = regularFile(file);
  if (!before) return null;
  const sha256 = await digest(file);
  const after = regularFile(file);
  if (!after || ['dev','ino','size','mtimeMs','ctimeMs'].some(field => before[field] !== after[field]))
    throw err('errPreviewChanged', `校验期间文件已变化，请重新检查：${file}`);
  return fileMetadata(file, after.size, sha256);
}
class ComponentReview {
  constructor(userData) { this.root = path.join(userData, 'component-management-v1'); this.pending = new Map(); }
  file(dir) { return path.join(this.root, hash(key(dir)) + '.json'); }
  read(dir) {
    const file = this.file(dir);
    if (!fs.existsSync(file)) return { version: 1, dir: path.resolve(dir), lock: null, receipts: {} };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || key(data.dir) !== key(dir) || !data.receipts) throw err('errComponentRecord', '组件记录损坏，请先修复记录；不会自动解除版本锁定。');
    return data;
  }
  async save(dir, record) { await journal.atomicJson(this.file(dir), record); }
  async inventory(dir, inspectFile = readDiskInfo, recoveredManifest, includeTargets = true) {
    if (!path.isAbsolute(dir) || !fs.existsSync(dir)) throw err('errUnsafeTarget', '无效的游戏目录');
    const record = this.read(dir);
    const manifest = recoveredManifest === undefined ? readManifest(dir) : recoveredManifest;
    const installedExe = manifest?.game?.exe && journal.safePath(dir, manifest.game.exe);
    const scan = await scanGame(dir, installedExe);
    const files = new Map();
    const add = rel => { const file = journal.safePath(dir, rel); files.set(key(file), file); };
    const deploy = require('./component-deploy'), pinned = deploy.routeFileHashes(manifest);
    const candidates = new Set();
    for (const file of deploy.candidateFiles(dir, scan, manifest, known)) {
      if (fs.existsSync(file) && !fs.statSync(file).isFile()) continue;
      add(path.relative(dir, file));
      candidates.add(key(file));
    }
    const scannedRoles = new Map();
    for (const item of [...(scan.dlssFiles || []), ...(scan.streamlineFiles || []), ...(scan.upscalerFiles || [])]) {
      add(path.relative(dir, item.path));
      scannedRoles.set(key(item.path), !!item.featureMismatch);
    }
    for (const rel of Object.keys(record.receipts)) add(rel);
    for (const rel of Object.keys(record.lock?.files || {})) add(rel);
    const exeDir = scan.chosen ? path.dirname(scan.chosen.path) : null;
    const wuwa = require('./wuthering-waves'), protectedRoot = exeDir && wuwa.gameRoot(dir, scan.chosen.path);
    const isProtected = includeTargets && wuwa.protectedComponentFiles(protectedRoot);
    if (protectedRoot) {
      const proxy = path.join(exeDir, 'version.dll');
      if (fs.existsSync(proxy)) add(path.relative(dir, proxy));
    }
    const originals = new Map((manifest?.replaced || []).map(row => [relKey(row.rel), row]));
    const added = new Set((manifest?.added || []).map(relKey));
    const receipts = new Map(Object.entries(record.receipts).map(([rel, value]) => [relKey(rel), value]));
    const locks = new Map(Object.entries(record.lock?.files || {}).map(([rel, value]) => [relKey(rel), value]));
    const rows = [];
    for (const file of files.values()) {
      const rel = path.relative(dir, file), id = relKey(rel);
      const info = await inspectFile(file), receipt = receipts.get(id), lock = locks.get(id);
      const original = originals.get(id);
      let backup = null;
      if (original) {
        const saved = require('./apply').originalPath(dir, manifest, rel);
        if (fs.existsSync(saved)) backup = { version: original.oldVersion || pe.getFileVersion(saved) || null };
      }
      const featureMismatch = !!info && !pinned.has(id) && (scannedRoles.get(key(file)) ?? deploy.hasFeatureMismatch(file));
      rows.push({ rel, scope:'game', name: path.basename(file), category: category(file), ...info, present: !!info, featureMismatch,
        routeSha256: pinned.get(id),
        recordedVersion: original?.newVersion || undefined,
        selectionTarget: includeTargets && !!scan.chosen && (!installedExe || key(scan.chosen.path) === key(installedExe)) &&
          candidates.has(key(file)) && !featureMismatch && !pinned.has(id) && !isProtected(file),
        bitness: includeTargets && info && binary(file) ? pe.getBitness(file, {dllOnly:true}) : null,
        source: receipt && receipt.sha256 === info?.sha256 ? receipt.source : original ? '游戏原有文件（曾由管理器替换）' : added.has(id) ? '管理器安装记录' : '现有文件，来源未记录',
        writtenAt: receipt && receipt.sha256 === info?.sha256 ? receipt.writtenAt : null,
        loaded: 'unknown', backup,
        lockState: lock ? (lock.sha256 === info?.sha256 ? 'match' : 'drift') : null });
    }
    const sharedRoot = path.join(path.dirname(this.root), 'reshade-vulkan');
    const sharedNames = new Set(Object.keys(record.lock?.sharedFiles || {}).map(file=>{
      if (key(path.dirname(file))!==key(sharedRoot) || !/^ReShade(32|64)\.dll$/i.test(path.basename(file))) throw err('errComponentRecord','共享组件锁定路径无效');
      return path.basename(file);
    }));
    if (manifest?.vulkanLayer?.owned && key(manifest.vulkanLayer.dir) === key(sharedRoot)) {
      sharedNames.add('ReShade64.dll'); sharedNames.add('ReShade32.dll');
    }
      for (const name of sharedNames) {
        const file = journal.safePath(sharedRoot,name), info = await inspectFile(file), pin = record.lock?.sharedFiles?.[file];
        if (!info && !pin) continue;
        rows.push({rel:file,scope:'shared',name,category:'共享 Vulkan 图层',...info,present:!!info,loaded:'unknown',source:'管理器共享组件；可能供多个游戏使用',lockState:pin?(pin.sha256===info?.sha256?'match':'drift'):null});
      }
    rows.sort((a, b) => a.category.localeCompare(b.category) || a.rel.localeCompare(b.rel));
    return { ok: true, dir, exePath: scan.chosen?.path, rows, lock: record.lock, lastApplied: record.lastApplied || null };
  }
  async setLock(dir, enabled) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) throw err('errUnsafeTarget', '无效的游戏目录');
    const record = this.read(dir);
    if (enabled) {
      if (record.lock) throw err('errVersionLocked', '已经锁定；如要改用其他组合，请先明确解除锁定。');
      const info = await this.inventory(dir), files = {}, sharedFiles = {};
      for (const row of info.rows) if (row.present && binary(row.rel)) (row.scope==='shared'?sharedFiles:files)[row.rel] = { sha256: row.sha256, version: row.version, size: row.size };
      if (!Object.keys(files).length && !Object.keys(sharedFiles).length) throw err('errNoComponents', '没有可锁定的已安装组件。请先安装并在游戏中验证。');
      record.lock = { at: new Date().toISOString(), files, sharedFiles, configuration: record.lastApplied?.request || null };
    } else record.lock = null;
    await this.save(dir, record);
    for (const [id, plan] of this.pending) if (plan.dir === key(dir)) this.pending.delete(id);
    return { ok: true, lock: record.lock };
  }
  assertUnlockedWithin(directory) {
    let dir = path.resolve(directory);
    while (true) {
      if (fs.existsSync(this.file(dir)) && this.read(dir).lock) throw err('errVersionLocked', '此游戏已锁定组件版本，请先在游戏组件清单中手动解锁。');
      const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
    }
  }
  async lockConflicts(dir, rows, request, inspectFile = readDiskInfo) {
    const lock = this.read(dir).lock;
    const conflicts = [];
    // A shared Vulkan DLL must also respect locks belonging to other games.
    const sharedRoot = path.join(path.dirname(this.root), 'reshade-vulkan');
    const sharedChanges = rows.filter(row => row.scope === 'shared' && row.action !== 'keep' &&
      key(path.dirname(row.rel)) === key(sharedRoot) && /^ReShade(32|64)\.dll$/i.test(path.basename(row.rel)));
    if (sharedChanges.length && fs.existsSync(this.root)) for (const name of fs.readdirSync(this.root).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))) {
      let record;
      try {
        record = JSON.parse(fs.readFileSync(path.join(this.root,name),'utf8'));
        if (!record || record.version !== 1 || path.basename(this.file(record.dir)) !== name || !record.receipts) throw Error();
      } catch {
        throw err('errComponentRecord', '无法核实共享 Vulkan 组件的版本锁定，请检查组件记录。');
      }
      if (!record.lock || (request.kind==='restore' && key(record.dir)===key(dir))) continue;
      for (const [file,pin] of Object.entries(record.lock.sharedFiles || {})) {
        const row = sharedChanges.find(r=>key(r.rel)===key(file));
        if (row && row.after?.sha256!==pin.sha256) conflicts.push(`${file}：受 ${path.basename(record.dir)} 的共享组件锁保护`);
      }
    }
    if (!lock || request.kind === 'restore') return conflicts;
    for (const [file,pin] of Object.entries(lock.sharedFiles || {})) if((await inspectFile(file))?.sha256!==pin.sha256) conflicts.push(`${file}：共享组件已偏离锁定版本`);
    const gameRows = new Map(rows.filter(row => row.scope === 'game').map(row => [relKey(row.rel), row]));
    for (const [rel, expected] of Object.entries(lock.files)) {
      const now = await inspectFile(journal.safePath(dir, rel));
      if (now?.sha256 !== expected.sha256) conflicts.push(`${rel}：磁盘文件已偏离锁定版本`);
      const planned = gameRows.get(relKey(rel));
      if (planned && planned.after?.sha256 !== expected.sha256) conflicts.push(`${rel}：本次操作会更换或移除锁定版本`);
    }
    const pins = new Set(Object.keys(lock.files).map(relKey));
    for (const [id, row] of gameRows) if (binary(row.rel) && row.after && !pins.has(id)) conflicts.push(`${row.rel}：本次操作会增加锁定组合以外的组件`);
    return conflicts;
  }
  async plan(dir, request, work) {
    const { state, result } = await preview.simulate(work);
    if (result?.ok === false) throw err(result.code || 'errPreview', result.message || result.code || '无法生成预览');
    const rows = [], internal = [];
    // A confirmation runs a fresh plan. Share file fingerprints only within this pass.
    const fingerprints = new Map();
    const inspectFile = file => {
      const id = key(file);
      if (!fingerprints.has(id)) fingerprints.set(id, readDiskInfo(file));
      return fingerprints.get(id);
    };
    for (const [k, file] of state.touched) {
      const next = state.entries.get(k);
      if (next?.directory || (!next && fs.existsSync(file) && fs.statSync(file).isDirectory())) continue;
      const rel = path.relative(dir, file), scope = rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? 'game' : 'shared';
      if (scope === 'game' && (/^_DLSS5_Backup[\\/]/i.test(rel) || /^\.dlss5_write_test_/.test(path.basename(rel)))) { internal.push(rel); continue; }
      const before = await inspectFile(file);
      if (!before && !next) continue;
      const after = next ? next.buffer ? { sha256: hash(next.buffer), size: next.buffer.length, version: null } : await inspectFile(next.source) : null;
      const action = !before ? 'add' : !after ? 'remove' : before.sha256 === after.sha256 ? 'keep' : 'replace';
      rows.push({ rel: scope === 'game' ? rel : file, scope, category: category(file), action, before, after, source: next?.origin || (next?.buffer ? '管理器生成的配置' : next?.source) || null });
    }
    // Include existing components deliberately left alone (e.g. the game's
    // own Streamline ABI), not just files that happened to receive a write.
    let recoveredManifest;
    const pendingFile = journal.pendingPath(dir);
    if (request.kind === 'restore' && state.entries.get(key(pendingFile)) === null && fs.existsSync(pendingFile)) {
      // The disk still holds the interrupted write. Use the manifest validated
      // by the simulated restore; a rolled-back first install can yield null.
      recoveredManifest = result?.inventoryManifest;
      if (recoveredManifest === undefined) {
        const recovery = await preview.simulate(async () => {
          await journal.recover(dir);
          return readManifest(dir);
        });
        recoveredManifest = recovery.result;
      }
    }
    const inventory = await this.inventory(dir, inspectFile, recoveredManifest, false);
    const wuwa = require('./wuthering-waves');
    const gameRoot = wuwa.gameRoot(dir, inventory.exePath);
    if (gameRoot) wuwa.checkPreview(gameRoot, dir, rows, state, request.kind);
    require('./encore').checkPreview(dir, rows, request.kind);
    if (['component-update','component-rollback'].includes(request.kind)) {
      const record = readManifest(dir);
      const owned = new Set(Object.keys({...record?.graphicsRoute?.files,...record?.performanceMonitor?.files}).map(rel => path.normalize(rel).toLowerCase()));
      if (rows.some(row =>
        row.scope === 'game' && row.action !== 'keep' && owned.has(path.normalize(row.rel).toLowerCase())))
        throw err('errGraphicsRoute', '此运行库由已安装路线管理，请在游戏页修改。');
    }
    const plannedFiles = new Map(rows.map(row => [row.scope + ':' + relKey(row.rel), row]));
    for (const row of inventory.rows) {
      const planned = plannedFiles.get(row.scope + ':' + relKey(row.rel));
      if (planned) planned.backup = row.backup || (row.present && planned.action === 'replace' ? { version: row.version, create: true } : null);
      else if (row.present) {
        const info = { sha256: row.sha256, size: row.size, version: row.version };
        rows.push({ rel: row.rel, scope:row.scope, category:row.category, action:'keep', before:info, after:info, source:row.source, backup:row.backup });
      }
    }
    rows.sort((a, b) => a.rel.localeCompare(b.rel));
    const conflicts = await this.lockConflicts(dir, rows, request, inspectFile);
    // Classic Install already shows a native warning. The other deployment routes
    // share their existing confirmation dialog with the game-specific notice.
    let antiCheat;
    if (['enhanced', 'component-update', 'component-rollback'].includes(request.kind) &&
        rows.some(row => row.scope === 'game' && (row.action === 'add' || row.action === 'replace'))) {
      // A reviewed backend switch may target another executable while the
      // on-disk manifest (and inventory scan) still points at the old one.
      // Only the enhanced installer validates a requested target; component
      // updates and rollback keep using the installed executable.
      const requestedExe = request.kind === 'enhanced' && (request.config?.exePath || request.exePath);
      let exePath = inventory.exePath;
      if (requestedExe) {
        if (typeof requestedExe !== 'string' || !path.isAbsolute(requestedExe)) throw err('errUnsafeTarget', '无效的游戏程序路径');
        exePath = journal.safePath(dir, path.relative(dir, requestedExe));
      }
      const details = require('./compatibility').antiCheatDetails(dir, exePath);
      if (details.antiCheatWarning) antiCheat = { components: details.antiCheatComponents.sort() };
    }
    const signature = hash(JSON.stringify({ request, rows: rows.map(r => [r.rel, r.action, r.before?.sha256, r.after?.sha256, r.source]), externalSteps: state.externalSteps, antiCheat }));
    return { rows, conflicts, signature, lock: this.read(dir).lock, externalSteps: state.externalSteps, internalFiles: new Set(internal).size, antiCheat };
  }
  async run(dir, request, work, token) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) throw err('errUnsafeTarget', '无效的游戏目录');
    const now = Date.now();
    for (const [id, value] of this.pending) if (value.expires < now) this.pending.delete(id);
    if (token) {
      const prior = this.pending.get(token); this.pending.delete(token);
      if (!prior || prior.expires < now || prior.dir !== key(dir) || JSON.stringify(prior.request) !== JSON.stringify(request)) throw err('errPreviewExpired', '预览已失效或操作参数已改变，请重新预览。');
      return this.confirmReviewed(dir, request, work, prior.signature);
    }
    const plan = await this.plan(dir, request, work);
    const id = crypto.randomUUID();
    if (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value);
    this.pending.set(id, { dir: key(dir), request, signature: plan.signature, expires: now + 10 * 60 * 1000 });
    return { ok: true, preview: { ...plan, token: id, dir, kind: request.kind, expires: now + 10 * 60 * 1000 } };
  }
  confirmReviewed(dir, request, work, signature) {
    return require('./wuthering-waves').withRtxLock(dir, () => this.confirm(dir, request, work, signature));
  }
  async confirm(dir, request, work, signature) {
    const plan = await this.plan(dir, request, work);
    if (plan.signature !== signature) throw err('errPreviewChanged', '游戏文件、组件来源或安装选择已变化，请重新查看预览后再应用。');
    if (plan.conflicts.length) throw err('errVersionLocked', '版本锁定已阻止组件变更。请在组件清单中查看差异并手动解锁。');
    const result = await work();
    if (result?.ok === false) return result;
    // Receipt failures never turn a completed game install into a false failure.
    try {
      const record = this.read(dir), at = new Date().toISOString();
      const receiptKeys = new Map(Object.keys(record.receipts).map(rel => [relKey(rel), rel]));
      for (const row of plan.rows.filter(row => row.scope === 'game')) {
        if (row.action === 'keep') continue; // Observed/preserved is not a new write.
        const actual = await readDiskInfo(journal.safePath(dir, row.rel));
        const previous = receiptKeys.get(relKey(row.rel));
        if (previous && previous !== row.rel) delete record.receipts[previous];
        if (actual && actual.sha256 === row.after?.sha256) record.receipts[row.rel] = { ...actual, source: row.source || '管理器', writtenAt: at };
        else delete record.receipts[row.rel];
      }
      record.lastApplied = { at, request, restartRequired: request.kind !== 'restore' };
      if (request.kind === 'restore') record.lock = null;
      await this.save(dir, record);
    } catch (error) { result.recordWarning = `操作完成，但组件记录未保存：${error.message}`; }
    return result;
  }
}
module.exports = { ComponentReview, diskInfo, category, binary };
