'use strict';

// Only these destinations may be opened by the renderer, never arbitrary URLs.
const links = Object.freeze({
  github: 'https://github.com/lxl2000927/NeuralFrame',
  releases: 'https://github.com/lxl2000927/NeuralFrame/releases/latest',
  coffee: 'https://github.com/lxl2000927/NeuralFrame'
});
function projectUrl(key) {
  if (key && typeof key === 'object' && typeof key.componentSource === 'string') {
    try {
      const url = new URL(key.componentSource);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
      // Version-specific documentation is registered by the application, not
      // supplied as an arbitrary browser destination by the renderer.
      if (require('../shared/component-evidence').projectEvidenceSources().includes(url.href)) return url.href;
      const repos = new Set(Object.values(require('./component-definitions').PROVIDERS).map(p => p.repo.toLowerCase()));
      // Some pinned routes have their own publisher without an optional-update
      // provider. Their built-in catalog links must remain usable in details.
      const catalog = require('./runtime-catalog.json');
      for (const pack of catalog.packs) {
        repos.add((pack.repository || catalog.repository).toLowerCase());
        for (const source of pack.upstreams || []) {
          const upstream = new URL(source.url);
          if (upstream.protocol === 'https:' && upstream.hostname === 'github.com')
            repos.add(upstream.pathname.split('/').filter(Boolean).slice(0,2).join('/').toLowerCase());
        }
      }
      repos.add('lxl2000927/neuralframe');
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password &&
          repos.has(parts.slice(0, 2).join('/').toLowerCase()) &&
          (parts.length === 2 || parts[2] === 'releases')) return url.href;
    } catch { /* Untrusted renderer input is never sent to the shell. */ }
    return null;
  }
  return typeof key === 'string' && Object.hasOwn(links, key) ? links[key] : null;
}
module.exports = { links, projectUrl };
