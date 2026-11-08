'use strict';
// Cover art, banners and game details from Steam's public store endpoints.
//
// No account, no key, no registration - which is the whole point. The previous
// source was IGDB, which sits behind Twitch credentials that cannot ship with
// the app, so artwork only ever appeared on the one machine that had them.
// Everyone who downloaded the build saw initials.
//
// Steam's legacy library paths are not available for every game. Keep the real
// store header returned by appdetails as a fallback, including hashed URLs.
// Known non-Steam games use public artwork linked from their official listing.
const fs = require('fs');
const path = require('path');

// library_hero is 1920x620, near enough to the 3.35:1 banner that almost
// nothing is cropped. header is the fallback for the handful of older apps
// that never got a hero image.
const asset = (id, file) =>
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/${file}`;

let lastCall = 0;

// Steam's store API is rate limited; this keeps a comfortable distance.
async function throttle() {
  const wait = 320 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

// Folder names carry edition suffixes and scene tags that no store matches.
function cleanName(name) {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(repack|fitgirl|dodi|elamigos|codex|rune|empress|plaza|skidrow|multi\d*)\b/gi, ' ')
    .replace(/[_\-–—:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const REQUEST_TIMEOUT = 10000;
const MAX_ART_BYTES = 16 * 1024 * 1024;
const KNOWN_GAMES = [
  { aliases: ['鸣潮', '鳴潮', 'Wuthering Waves'], appid: 3513350 },
  {
    aliases: ['崩坏：星穹铁道', '崩壞：星穹鐵道', '星穹铁道', '星穹鐵道', 'Honkai Star Rail', 'Star Rail', 'StarRail', 'hkrpg', 'hkrpg_bilibili'],
    name: 'Honkai: Star Rail',
    source: 'https://store.epicgames.com/p/honkai-star-rail',
    heroUrl: 'https://cdn1.epicgames.com/spt-assets/6f3979ff608f42e286c83507a69b27f5/honkai-star-rail-video-yvuqo.jpg'
  }
];
const knownGame = name => KNOWN_GAMES.find(game => game.aliases.some(alias => norm(cleanName(alias)) === norm(cleanName(name))));

// Localized 16:9 TV banners from NVIDIA's application catalog, keyed by Steam ID.
const tvBanners = {
  '3513350': '891174c3-61a5-4b20-a3a1-adc85985708e/CN/TV_BANNER_01_9a39cc89-fe1e-416c-9658-585ab6f61528.jpg',
  '2277560': 'f02ad372-a767-436b-b4ec-6ef01405abe7/ZZ/TV_BANNER_01_668f5c55-1375-4524-91a3-e63befd72d03.jpg',
  '1623730': 'a6c2a87a-b97a-4626-ab23-aa5883cfaed3/ZZ/TV_BANNER_01_4d81b04b-b675-4a34-a173-2339cf576de7.jpg',
  '292030': '368d3f86-5c63-4f9c-be03-193188752472/ZZ/TV_BANNER_01_95f8e52c-30b0-4dfb-bc45-536ffbbadf97.jpg',
  '2622380': '41884d9f-6eab-4e65-b316-bb6def389077/ZZ/TV_BANNER_01_a61c67d5-0097-4c87-b436-ae00146314cb.jpg',
  '526870': 'cf1db184-f223-45ab-8360-ae044bb17572/ZZ/TV_BANNER_01_134e69a4-9a9d-4d62-a0a4-5cffa12fed00.jpg',
  '1245620': '039f2f6f-a4c7-46ee-b557-059b0b5b55fa/ZZ/TV_BANNER_01_5f16a392-14c1-40f3-9c52-d774493a9571.jpg',
};

function tileUrls(name, appid) {
  const known = !appid && knownGame(String(name || ''));
  const id = appid || known?.appid;
  const banner = known?.name === 'Honkai: Star Rail'
    ? 'f66d19a8-4d80-406f-b1f0-075ff5e9b51c/CN/TV_BANNER_01_1dcd57ae-1156-412f-b8f4-b3111c165cf4.jpg'
    : tvBanners[id];
  const urls = banner ? [`https://img.nvidiagrid.net/apps/${banner};f=webp;q=85;w=960`] : [];
  if (/^\d+$/.test(String(id))) urls.push(asset(id, 'capsule_616x353.jpg'));
  return urls;
}

// A search for "Control" happily returns "Star Control", so the closest title
// wins rather than the first row.
function pick(rows, query) {
  const q = norm(query);
  if (!q) return null;
  const qWords = new Set(q.split(' '));
  let best = null;
  let bestScore = -1;

  for (const row of rows) {
    if (row.type && row.type !== 'app') continue;
    const n = norm(row.name || '');
    if (!n) continue;
    const words = n.split(' ');
    const shared = words.filter((w) => qWords.has(w)).length;

    let score = 0;
    if (n === q) score += 120;
    else if (n.startsWith(q) || q.startsWith(n)) score += 70;
    score += (shared / Math.max(qWords.size, 1)) * 40;
    // Extra words mean a different, longer title.
    score -= Math.max(0, words.length - qWords.size) * 6;

    if (score > bestScore) { bestScore = score; best = row; }
  }
  return bestScore > 10 ? best : null;
}

async function getJson(url) {
  await throttle();
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!res.ok) throw new Error(`Steam replied ${res.status}`);
  return res.json();
}

async function findAppId(name) {
  const query = cleanName(name);
  if (!query) return null;
  const j = await getJson(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=us&l=en`
  );
  const hit = pick(j.items || [], query);
  return hit ? { id: hit.id, name: hit.name } : null;
}

// Details are a bonus: the art is what matters, so a failure here is not one.
async function detailsFor(appid) {
  try {
    const j = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`
    );
    const row = j && j[String(appid)];
    if (!row || !row.success || !row.data) return null;
    const d = row.data;
    return {
      name: d.name || null,
      headerUrl: d.header_image || null,
      summary: d.short_description || null,
      released: (d.release_date && /\d{4}/.test(d.release_date.date || ''))
        ? Number((d.release_date.date.match(/\d{4}/) || [])[0])
        : null,
      rating: (d.metacritic && d.metacritic.score) || null,
      genres: (d.genres || []).map((g) => g.description).slice(0, 3)
    };
  } catch {
    return null;
  }
}

// `appid` is passed straight through for Steam games, where the launcher
// already knows it - no search, so no chance of matching the wrong game.
async function look(name, appid) {
  const known = !appid && knownGame(String(name || ''));
  if (known?.heroUrl) return { name: known.name, source: known.source, appid: null,
    coverUrl: null, heroUrl: known.heroUrl, heroFallbackUrl: null, genres: [] };
  let id = appid || known?.appid || null;
  let searchName = null;
  if (!id) {
    const found = await findAppId(name);
    if (!found) return null;
    id = found.id;
    searchName = found.name;
  }

  const info = await detailsFor(id);
  return {
    appid: id,
    name: (info && info.name) || searchName || name,
    summary: (info && info.summary) || null,
    released: (info && info.released) || null,
    rating: (info && info.rating) || null,
    genres: (info && info.genres) || [],
    coverUrl: asset(id, 'library_600x900.jpg'),
    heroUrl: asset(id, 'library_hero.jpg'),
    heroFallbackUrl: info?.headerUrl || asset(id, 'header.jpg')
  };
}

async function download(url, dest) {
  if (!url) throw new Error('artwork URL unavailable');
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  if (Number(res.headers.get('content-length')) > MAX_ART_BYTES) throw new Error('artwork too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_ART_BYTES) throw new Error('artwork too large');
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  // A missing asset can come back as a tiny placeholder rather than a 404.
  if (buf.length < 2000) throw new Error('asset too small to be artwork');
  const isImage = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
  if (!isImage) throw new Error('response is not supported artwork');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

// Nothing to configure, so it is always on.
const available = () => true;

module.exports = { available, look, download, cleanName, pick, tileUrls };
