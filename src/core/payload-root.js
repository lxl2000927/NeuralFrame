'use strict';

const path = require('node:path');
const fs = require('./preview-fs').fs;

// A caller-supplied cache or source is authoritative even while it is empty.
// Portable extraction is already covered by Electron's own resourcesPath.
function resolvePayloadDir(payloadDir, resourcesPath = process.resourcesPath, appRoot = path.resolve(__dirname, '../..')) {
  if (payloadDir) return path.resolve(payloadDir);
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'payload');
    try {
      if (fs.statSync(bundled).isDirectory()) return bundled;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return path.join(appRoot, 'payload');
}

module.exports = { resolvePayloadDir };
