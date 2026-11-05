'use strict';

// Keep usable artwork during an upgrade or a temporary outage. An incomplete
// lookup may be retried, but a page visit must not repeatedly hit a failed CDN.
const RULES = 5;
const RETRY_MS = 10 * 60 * 1000;
const WIDE_REFRESH_MS = 24 * 60 * 60 * 1000;
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
module.exports = { RULES, usable, reusable };
