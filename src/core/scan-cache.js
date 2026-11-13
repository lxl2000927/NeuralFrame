'use strict';
// Browsing-only PE symbol results. Directory discovery still runs on every
// scan; install/preview processes never enable this cache.
const fs = require('node:fs'), path = require('node:path');
const { atomicJson } = require('./file-journal');
let location = null, entries = new Map(), revision = 0, saved = 0;
let writing = Promise.resolve();
const limit = 512;

function configure(file) {
  if (location === file) return;
  location = file; entries = new Map(); revision = saved = 0;
  if (!file) return;
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) return;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.schema === 1 && Array.isArray(data.entries)) {
      entries = new Map(data.entries.filter(row => Array.isArray(row) && row.length === 2 &&
        typeof row[0] === 'string' && typeof row[1]?.stamp === 'string' &&
        Array.isArray(row[1]?.found) && row[1].found.every(value => typeof value === 'string')).slice(-limit));
    }
  } catch { /* A missing or invalid browsing cache simply triggers a fresh read. */ }
}
function stamp(file) {
  const s = fs.statSync(file);
  if (!s.isFile()) return null;
  return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
}
function probe(file, markers) {
  if (!location) return null;
  try {
    const key = JSON.stringify([path.resolve(file), markers]), current = stamp(file);
    if (!current) return null;
    const cached = entries.get(key);
    return {key, stamp:current, found:cached?.stamp === current ? new Set(cached.found.filter(m => markers.includes(m))) : null};
  } catch { return null; }
}
function remember(file, record, found) {
  if (!record) return;
  try {
    if (stamp(file) !== record.stamp) return;
    entries.delete(record.key);
    entries.set(record.key,{stamp:record.stamp,found:[...found]});
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    revision++;
  } catch { /* File was replaced during the read. */ }
}
async function flush() {
  if (!location || saved === revision) return;
  const target = location, version = revision;
  const data = {schema:1,entries:[...entries]};
  try {
    writing = writing.catch(() => {}).then(() => atomicJson(target, data));
    await writing;
    if (location === target) saved = Math.max(saved, version);
  } catch { /* Cache writes must not prevent browsing games. */ }
}
module.exports = {configure,probe,remember,flush};
