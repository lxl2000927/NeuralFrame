'use strict';
const {downloadAsset} = require('./asset-download');

function allowedAsset(address, repository) {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && url.pathname.startsWith('/' + repository + '/releases/download/');
  } catch {
    return false;
  }
}

function mirrorUrl(original, prefix) {
  if (!prefix) return null;
  let base, url;
  try { base = new URL(prefix); url = new URL(original); } catch { throw Error('无效的下载镜像地址'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw Error('镜像必须使用不含账号信息的 HTTPS 前缀');
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  const root = base.href.endsWith('/') ? base.href : base.href + '/';
  return new URL(root + url.href).href;
}
function sourceUrls(original, prefix, priority = 'mirror') {
  const mirror = mirrorUrl(original, prefix);
  return mirror ? (priority === 'official' ? [original, mirror] : [mirror, original]) : [original];
}
async function downloadWithSources(asset, options) {
  const urls = sourceUrls(asset.url, options.mirror, options.priority);
  const signal = options.signal || new AbortController().signal;
  let last;
  for (const [index, url] of urls.entries()) {
    const source = new URL(url).hostname;
    const reason = index === 0 ? (urls.length > 1 ? (options.priority === 'official' ? 'GitHub 优先' : '镜像优先') : 'GitHub 直连')
      : `上一个来源失败：${last?.message || '未知错误'}，已回退`;
    options.onSource?.(source, reason);
    try {
      return await downloadAsset({...asset, url}, {
        ...options,
        signal,
        onProgress:(loaded, info) => options.onProgress?.(loaded, source, reason, info?.connections || 0),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
    }
  }
  throw last || Error('下载失败');
}
module.exports = {allowedAsset, mirrorUrl, sourceUrls, downloadWithSources};
