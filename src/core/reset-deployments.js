'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hasBackup } = require('./game-menu');

function deploymentLocations(userData, folders, history) {
  const known = new Map();
  function add(dir, name, at = 0, deployed = false) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return;
    const absolute = path.resolve(dir), key = absolute.toLowerCase();
    const previous = known.get(key);
    known.set(key, {dir:absolute, name:name || previous?.name || path.basename(absolute),
      at:Math.max(at, previous?.at || 0), deployed:at >= (previous?.at || 0) ? deployed : previous.deployed});
  }
  for (const {dir, name} of folders) add(dir, name);
  for (const row of history) add(row.dir, row.name, Date.parse(row.date), !['restore', 'recovery'].includes(row.action));
  // These records survive a cleared game index or operation history.
  for (const folder of ['component-management-v1', 'component-library-v1/games']) {
    const root = path.join(userData, folder);
    let files;
    try { files = fs.readdirSync(root, {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const file of files) {
      if (!file.isFile() || !/^[a-f0-9]{64}\.json$/i.test(file.name)) continue;
      const record = JSON.parse(fs.readFileSync(path.join(root, file.name), 'utf8'));
      if (typeof record.dir !== 'string' || !path.isAbsolute(record.dir) ||
          crypto.createHash('sha256').update(path.resolve(record.dir).toLowerCase()).digest('hex') + '.json' !== file.name.toLowerCase())
        throw Error('无法核实游戏组件记录：' + file.name);
      const observed = Date.parse(record.backupObservedAt);
      if (Number.isFinite(observed)) add(record.dir, null, observed, true);
      const last = record.lastApplied;
      // A component selection with no file changes is not an offline installation.
      const deployed = last && last.request?.kind !== 'restore' && Object.keys(record.receipts || {}).length > 0;
      if (!last || deployed || last.request?.kind === 'restore') add(record.dir, null, Date.parse(last?.at) || 0, !!deployed);
      else add(record.dir);
    }
  }
  return known;
}

function deploymentCandidates(known, overlays) {
  const targets = [...known.values()].filter(row => row.deployed || hasBackup(row.dir))
    .map(({dir, name}) => ({dir, name, gameFiles:true, overlays:[]}));
  // EXEs often live below the game root (e.g. Binaries/Win64).
  targets.sort((a, b) => b.dir.length - a.dir.length);
  for (const overlay of overlays) {
    let target = targets.find(row => {
      const rel = path.relative(row.dir, overlay.directory);
      return !rel || (row.gameFiles && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
    });
    if (!target) {
      target = {dir:overlay.directory, name:known.get(overlay.directory.toLowerCase())?.name || path.basename(overlay.directory),
        gameFiles:false, overlays:[]};
      targets.push(target);
    }
    target.overlays.push(overlay);
  }
  return targets.sort((a, b) => a.dir.localeCompare(b.dir));
}

// The renderer receives one expiring ticket for the exact set of reviewed games.
// Signatures stay in the main process and are checked again by the single-game restore.
class DeploymentReset {
  constructor(discover, review, restore) {
    this.discover = discover;
    this.review = review;
    this.restore = restore;
    this.pending = null;
  }
  async preview() {
    this.pending = null;
    const rows = [];
    for (const target of this.discover()) {
      const {dir, name} = target;
      try {
        if (target.gameFiles && !hasBackup(dir)) throw Error('找不到游戏目录或还原备份');
        const plan = await this.review(target);
        if (plan.conflicts.length) throw Error(plan.conflicts.join('\n'));
        rows.push({dir, name, target, signature:plan.signature, files:plan.rows.filter(row => row.action !== 'keep' && row.scope === 'game').length});
      } catch (error) { rows.push({dir, name, error:error.message}); }
    }
    const token = crypto.randomUUID();
    this.pending = {token, rows, expires:Date.now() + 10 * 60 * 1000};
    return {ok:true, token, games:rows.map(({signature, target, ...row}) => row)};
  }
  async apply(token, progress) {
    const plan = this.pending;
    if (!plan || plan.token !== token || plan.expires < Date.now())
      return {ok:false, message:'还原预览已失效，请重新检查。'};
    this.pending = null;
    const results = [];
    for (const [index, row] of plan.rows.entries()) {
      const {dir, name} = row;
      progress({dir, index:index + 1, total:plan.rows.length});
      try {
        if (row.error) throw Error(row.error);
        const result = await this.restore(row.target, row.signature);
        if (!result.ok) throw Error(result.message || result.code || '还原失败');
        results.push({dir, name, restored:true, warning:result.recordWarning});
      } catch (error) { results.push({dir, name, error:error.message}); }
    }
    const done = new Map(results.map(row => [row.dir.toLowerCase(), row]));
    try {
      for (const {dir, name} of this.discover()) {
        const row = done.get(dir.toLowerCase());
        if (!row) results.push({dir, name, error:'发现预览之外的部署，请重新检查。'});
        else if (row.restored) row.warning ||= '还有部署记录需要核实，请重新检查。';
      }
    } catch (error) { return {ok:false, games:results, message:error.message}; }
    const ok = results.every(row => row.restored && !row.warning);
    return {ok, games:results, ...(!ok && {message:'部分游戏需要处理，已保留缓存和管理器设置。'})};
  }
}

module.exports = { deploymentLocations, deploymentCandidates, DeploymentReset };
