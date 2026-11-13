'use strict';
// Every report worth answering has needed the same four things: the app's own
// install log, the game's ReShade.log, the game's dlss5-feed.log, and which
// driver the person is on. Asking for them one at a time costs a round trip per
// report, and half arrive incomplete. This gathers them into one file.
//
// Nothing is collected that the person cannot see first: report() returns the
// list of sources so the app can show them before anything is written.
const fs = require('fs');
const path = require('path');

// A ReShade log from a long session runs to megabytes and the useful part is
// the end. Keep the tail, and say so where it was cut.
const TAIL_BYTES = 256 * 1024;
const BACKUP_DIR = '_DLSS5_Backup';
const ENCORE_LOG_DIR = 'rtx-encore-logs';
const ENCORE_LOG_LIMIT = 3;
// Encore v2 session and exception text logs. Do not gather arbitrary .log
// files, frame CSV/JSONL data or potentially huge memory dumps from the folder.
const encoreLogName = name => /^rtx-encore(?:-[0-9]{1,10}-[0-9]{1,20})?(?:\.crash)?\.log$/i.test(name) ||
  /^rtx-encore\.log\.previous-(?:legacy|[0-9]{8}-[0-9]{6}-[0-9]{3}-[0-9]{1,10})\.log$/i.test(name) ||
  /^rtx-encore\.gpu-bootstrap\.log$/i.test(name);

// The logs a game writes beside its executable, in the order they matter.
const GAME_LOGS = [
  'RTXMFG-Universal.log',
  'RTXMFG-Universal.status.json',
  'OptiScaler.log',
  'rtx-encore.jsonc',
  path.join('rtx-encore-logs', 'rtx-encore-status.json'),
  'dlss5-feed.log',
  'ReShade.log',
  path.join('host64', 'dlss5-feed-host.log'),
  path.join('host64', 'ReShade.log'),
  'dlss5-feed-crash.dmp.txt'
];

function readTail(file) {
  const handle = fs.openSync(file, 'r');
  try {
    // Logs may grow or rotate during export. Size and read the same handle,
    // cap even a small log, and omit unread bytes after a concurrent truncate.
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new Error('The log is no longer a regular file');
    const size = stat.size, length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length), start = size - length;
    let read = 0;
    while (read < length) {
      const count = fs.readSync(handle, buffer, read, length - read, start + read);
      if (!count) break;
      read += count;
    }
    return { text: buffer.subarray(0, read).toString('utf8'), size, truncated: size > TAIL_BYTES };
  } finally {
    fs.closeSync(handle);
  }
}

// What would go in, without reading any of it. The app shows this and waits.
function sources({ gameDir, exeDir, userData }) {
  const found = [];
  const added = new Set();
  const add = (label, file, base = path.dirname(file)) => {
    let stat;
    try {
      // The chosen game root can itself be a library junction. Within it,
      // exported sources must be ordinary files, not links to unrelated data.
      const rel = path.relative(base, file);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
      let current = base;
      for (const segment of rel.split(path.sep)) {
        current = path.join(current, segment);
        if (fs.lstatSync(current).isSymbolicLink()) return;
      }
      stat = fs.lstatSync(file);
    } catch { return; }
    const key = path.resolve(file).toLowerCase();
    if (stat.isFile() && !added.has(key)) {
      found.push({ label, file, bytes: stat.size });
      added.add(key);
    }
  };
  const addEncoreLogs = base => {
    const folder = path.join(base, ENCORE_LOG_DIR), candidates = [];
    let handle;
    try {
      const stat = fs.lstatSync(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
      handle = fs.opendirSync(folder);
      // The upstream preference retains at most 100 sessions; cap enumeration
      // too, so a foreign log folder cannot stall a diagnostics export.
      for (let budget = 512; budget > 0; budget--) {
        const entry = handle.readSync();
        if (!entry) break;
        if (!entry.isFile() || !encoreLogName(entry.name)) continue;
        const file = path.join(folder, entry.name), info = fs.lstatSync(file);
        if (info.isFile() && !info.isSymbolicLink()) candidates.push({file,name:entry.name,at:info.mtimeMs,crash:/\.crash\.log$/i.test(entry.name)});
      }
    } catch { /* A running game may rotate or remove a log during enumeration. */ }
    finally { handle?.closeSync(); }
    candidates.sort((a,b) => b.at-a.at || a.name.localeCompare(b.name));
    const counts = [0,0];
    for (const item of candidates) {
      const category = item.crash ? 1 : 0;
      if (counts[category]++ >= ENCORE_LOG_LIMIT) continue;
      add(`game: ${path.join(ENCORE_LOG_DIR,item.name)}`,item.file,base);
    }
  };
  if (exeDir) {
    for (const name of GAME_LOGS) add(`game: ${name}`, path.join(exeDir, name), exeDir);
    addEncoreLogs(exeDir);
  }
  if (gameDir) {
    add('install manifest', path.join(gameDir, BACKUP_DIR, 'manifest.json'), gameDir);
    // The executable's own folder is usually not the game folder.
    if (!exeDir || path.resolve(exeDir) !== path.resolve(gameDir)) {
      for (const name of GAME_LOGS) add(`game: ${name}`, path.join(gameDir, name), gameDir);
      addEncoreLogs(gameDir);
    }
  }
  if (userData) add('app crash log', path.join(userData, 'crash.log'));
  return found;
}

function section(title, body) {
  const rule = '='.repeat(72);
  return `${rule}\n${title}\n${rule}\n${body}\n`;
}

// `facts` is whatever the caller already knows - version, platform, GPU rows,
// the activity log. This module never goes looking for machine details of its
// own, so what ends up in the file stays predictable.
function report({ gameDir, exeDir, userData, facts = {}, now = new Date(), approvedSources }) {
  if (approvedSources !== undefined && !Array.isArray(approvedSources)) throw Error('Invalid approved diagnostic sources');
  const approved = approvedSources === undefined ? null : new Set(approvedSources
    .filter(item => typeof item?.file === 'string')
    .map(item => path.resolve(item.file).toLowerCase()));
  // A game can rotate logs while its source list is being confirmed. Recheck
  // the ordinary-file allowlist, then only read paths from that exact list.
  const found = sources({ gameDir, exeDir, userData })
    .filter(item => !approved || approved.has(path.resolve(item.file).toLowerCase()));
  const head = [
    `DLSS 5 Swapper diagnostics`,
    `generated: ${now.toISOString()}`,
    ...Object.entries(facts)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
  ].join('\n');

  let text = section('Environment', head);
  if (!found.length) {
    text += section('Logs', 'No log files were found for this game.\n' +
      'Run the install once, launch the game, then save this again.');
    return { text, sources: found };
  }
  for (const item of found) {
    let body;
    try {
      const read = readTail(item.file);
      body = read.truncated
        ? `[the first ${read.size - TAIL_BYTES} bytes are omitted; this is the end of the file]\n\n${read.text}`
        : read.text;
    } catch (error) {
      body = `Could not be read: ${error.message}`;
    }
    text += section(`${item.label}  (${item.file}, ${item.bytes} bytes)`, body);
  }
  return { text, sources: found };
}

module.exports = { report, sources, GAME_LOGS, TAIL_BYTES };
