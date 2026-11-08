'use strict';

// History normally appends operations; an explicit clear replaces only this log.
// Backups change on reinstall/restore; the audit survives both and library resets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const key = dir => path.resolve(dir).toLowerCase();
const count = value => Array.isArray(value) ? value.length : Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fingerprint = row => `${key(row.dir)}|${row.manifestDate}|${row.action}`;
const actions = new Set(['install', 'restore', 'recovery', 'component-update', 'component-rollback']);
function version(value) { return value && value !== '0.0.0.0' ? value : null; }

function validRecord(row) {
  const optionalText = value => value == null || typeof value === 'string';
  const optionalCount = value => value == null || (Number.isSafeInteger(value) && value >= 0);
  return row && typeof row.id === 'string' && typeof row.dir === 'string' && path.isAbsolute(row.dir)
    && validDate(row.date) && actions.has(row.action)
    && [row.name, row.exe, row.api, row.route].every(optionalText)
    && [row.replaced, row.added].every(optionalCount)
    && (row.files == null || (Array.isArray(row.files) && row.files.every(f =>
      f && typeof f.rel === 'string' && typeof f.action === 'string'
      && [f.before, f.after, f.beforeHash, f.afterHash].every(optionalText))))
    && (row.configuration == null || (typeof row.configuration === 'object' && !Array.isArray(row.configuration)
      && Object.values(row.configuration).every(optionalText)));
}

function operation(dir, manifest = {}, action = 'install', name) {
  return {
    id: crypto.randomUUID(), name: name || path.basename(dir), dir: path.resolve(dir),
    date: new Date().toISOString(), manifestDate: validDate(manifest.date) ? manifest.date : null,
    action, undone: action === 'restore', route: manifest.route || null,
    exe: manifest.game?.exe || null, api: manifest.game?.api || null,
    replaced: count(manifest.replaced), added: count(manifest.added),
    files: [
      ...(Array.isArray(manifest.replaced) ? manifest.replaced : []).map(f => {
        const original = version(f.oldVersion ?? f.version), installed = version(f.newVersion);
        return { rel: f.rel, action: action === 'restore' ? 'restore' : 'replace',
          before: action === 'restore' ? installed : original, after: action === 'restore' ? original : installed,
          ...(f.beforeHash && f.afterHash ? {
            beforeHash: action === 'restore' ? f.afterHash : f.beforeHash,
            afterHash: action === 'restore' ? f.beforeHash : f.afterHash
          } : {}) };
      }),
      ...(Array.isArray(manifest.added) ? manifest.added : []).map(f => ({ rel: typeof f === 'string' ? f : f.rel, action: action === 'restore' ? 'remove' : 'add' }))
    ].filter(f => typeof f.rel === 'string'),
    configuration: {
      hardwareProfile: manifest.hardwareProfile || null,
      neuralMode: manifest.neuralRendering?.mode || null,
      neuralModelId: manifest.neuralRendering?.modelId || null,
      mfgMode: manifest.mfg?.mode || null,
      ...(manifest.neuralRendering?.runtimeStack && { neuralRuntimeStack: manifest.neuralRendering.runtimeStack }),
      ...(manifest.mfg?.runtimeStack && { mfgRuntimeStack: manifest.mfg.runtimeStack }),
      ...(manifest.mfg?.backend === 'renodx-mfgunlock' && typeof manifest.mfg.hdrCompatibility === 'boolean'
        ? {qualityGuardMode: manifest.mfg.hdrCompatibility ? '2' : '0'} : {})
    }
  };
}

function knownFolders(state = {}, games = []) {
  const dirs = new Map();
  const add = (dir, name) => {
    if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir)) return;
    dirs.set(key(dir), { dir: path.resolve(dir), name: name || dirs.get(key(dir))?.name });
  };
  for (const dir of state.manual || []) add(dir);
  for (const row of state.recents || []) add(row?.dir);
  for (const scan of Object.values(state.scans || {})) add(scan?.dir);
  for (const root of state.folders || []) {
    add(root); // A selected folder can be the game itself, not a library root.
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) add(path.join(root, entry.name));
      }
    } catch { /* Removed/offline folders must not hide other history. */ }
  }
  for (const game of games) add(game.dir, game.name);
  return [...dirs.values()];
}

function fromManifests(folders, onWarning = () => {}) {
  const rows = [];
  for (const { dir, name } of folders) {
    const root = path.join(dir, '_DLSS5_Backup');
    // Never import an in-flight/rolled-back switch as an installation.
    if (fs.existsSync(path.join(root, 'pending-switch.json'))) continue;
    let files;
    try { files = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const file of files) {
      const match = /^manifest\.json(\.done(?:-(\d+))?)?$/.exec(file.name);
      if (!match || !file.isFile()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, file.name), 'utf8'));
        if (manifest?.version !== 1 || !validDate(manifest.date) ||
            !Array.isArray(manifest.replaced) || !Array.isArray(manifest.added)) continue;
        // A standalone version update may create the first backup without installing a graphics route.
        if (!match[1] && manifest.componentOnlySince === manifest.date) continue;
        const row = operation(dir, manifest, match[1] ? 'restore' : 'install', name);
        // Older backups only contain a snapshot, not every historic click.
        row.imported = true;
        row.date = match[2] ? new Date(Number(match[2])).toISOString() : manifest.date;
        row.id = 'backup:' + crypto.createHash('sha256').update(fingerprint(row)).digest('hex');
        if (validRecord(row)) rows.push(row);
        else onWarning(new Error('Unreadable backup record'));
      } catch (error) { onWarning(error); }
    }
  }
  return rows;
}

class HistoryStore {
  constructor(file) { this.file = file; this.pending = new Map(); }

  read(onWarning = () => {}) {
    let content;
    try { content = fs.readFileSync(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { rows: [], clearedAt: 0 }; throw error; }
    const rows = new Map();
    let clearedAt = 0;
    let unreadable = false;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.type === 'history-cleared' && validDate(row.date)) {
          clearedAt = Math.max(clearedAt, Date.parse(row.date));
          rows.clear();
          unreadable = false;
          continue;
        }
        if (validRecord(row)) rows.set(row.id, row);
        else unreadable = true;
      } catch { unreadable = true; }
    }
    if (unreadable) onWarning(new Error('Unreadable history record'));
    return { rows: [...rows.values()], clearedAt };
  }

  saved() { return this.read().rows; }

  clear() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx');
      try {
        // Keep a cutoff so opening History cannot re-import the deleted records
        // from unchanged backup manifests. Backups and rollback stay untouched.
        fs.writeFileSync(fd, JSON.stringify({ type: 'history-cleared', date: new Date().toISOString() }) + '\n');
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file);
      this.pending.clear();
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  append(rows) {
    if (!rows.length) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.file, 'a');
    try {
      // Leading newline also separates a previously interrupted partial record.
      fs.writeFileSync(fd, '\n' + rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }

  record(dir, manifest, action, name) {
    const row = operation(dir, manifest, action, name);
    this.pending.set(row.id, row);
    this.append([row]);
    this.pending.delete(row.id);
    return row;
  }

  list(folders = [], onWarning = () => {}) {
    let saved = [];
    let clearedAt = 0;
    try { ({ rows: saved, clearedAt } = this.read(onWarning)); } catch (error) { onWarning(error); }
    const ids = new Set(saved.map(row => row.id));
    for (const id of ids) this.pending.delete(id);
    const rows = [...saved, ...[...this.pending.values()].filter(row => !ids.has(row.id))];
    const seen = new Set(rows.map(fingerprint));
    for (const row of fromManifests(folders, onWarning)) {
      if (Date.parse(row.date) <= clearedAt) continue;
      if (!seen.has(fingerprint(row))) { rows.push(row); seen.add(fingerprint(row)); }
    }
    const unsaved = rows.filter(row => !ids.has(row.id));
    try {
      this.append(unsaved);
      for (const row of unsaved) this.pending.delete(row.id);
    } catch (error) {
      for (const row of unsaved) this.pending.set(row.id, row);
      onWarning(error);
    }
    return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }
}

module.exports = { HistoryStore, knownFolders, fromManifests, operation };
