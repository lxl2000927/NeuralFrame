'use strict';
const path = require('path');
// These are installed by their owning route/overlay feature. A stale manual
// "F8 fix" entry must not deploy a second copy or replace the managed bridge.
const internal = new Set([
  'dlss5-lab-overlay.addon64', 'dlss5-zh-cn.addon32',
  'dlss5-zh-cn.addon64', 'dlss5-feed-helper.addon64'
]);
function isInternalAddon(file) {
  return typeof file === 'string' && internal.has(path.basename(file).toLowerCase());
}
module.exports = { isInternalAddon };
