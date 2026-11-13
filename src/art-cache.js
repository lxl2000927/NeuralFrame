'use strict';

// Keep usable artwork during an upgrade or a temporary outage. An incomplete
// lookup may be retried, but a page visit must not repeatedly hit a failed CDN.
const RULES = 5;
const RETRY_MS = 10 * 60 * 1000;
const WIDE_REFRESH_MS = 24 * 60 * 60 * 1000;
// Keep the caller's identity separate from the optional metadata returned by a
// store search. A different game can later occupy the same installation path.
function sourceIdentity(name, appid) {
  if (appid != null && String(appid).trim()) return `steam:${String(appid).trim()}`;
  return `name:${String(name || '').normalize('NFKC').trim().toLowerCase().replace(/[_\s]+/g, ' ')}`;
}
function matchesIdentity(record, identity) {
  if (!record) return false;
  if (record.sourceIdentity) return record.sourceIdentity === identity;
  // Older records did not distinguish the request from the search result.
  // Preserve them when possible, but never migrate an explicit contradiction.
  if (identity.startsWith('steam:') && record.appid != null)
    return sourceIdentity(null, record.appid) === identity;
  if (identity.startsWith('name:') && record.name)
    return sourceIdentity(record.name, null) === identity;
  return true;
}
function usable(record, onDisk) {
  return { cover: onDisk(record?.cover) ? record.cover : null, hero: onDisk(record?.hero) ? record.hero : null };
}
function reusable(record, onDisk, now = Date.now()) {
  if (!record || record.rules !== RULES) return false;
  const images = usable(record, onDisk);
  if (images.cover) return true;
  if (images.hero && now - record.fetchedAt < WIDE_REFRESH_MS) return true;
  // A deleted cached file is retried immediately; a network miss has no path.
  return !record.cover && !record.hero && now - record.fetchedAt < RETRY_MS;
}
// A portrait lookup must not mark an unrequested banner as a recent failure.
// Keep failed attempts per resource across restarts, but retry deleted files.
function reusableImage(record, kind, onDisk, now = Date.now()) {
  if (!record || record.rules !== RULES) return false;
  if (onDisk(record[kind])) return true;
  if (record[kind]) return false;
  const attempted = record.attempted ? record.attempted[kind] : record.fetchedAt;
  return Number.isFinite(attempted) && now - attempted < RETRY_MS;
}
module.exports = { RULES, usable, reusable, reusableImage, sourceIdentity, matchesIdentity };
