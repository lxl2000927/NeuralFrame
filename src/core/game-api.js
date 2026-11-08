'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const renderingApi = require('../shared/rendering-api');

const apiPreferenceKey = (dir, exe) => crypto.createHash('sha256')
  .update(path.resolve(dir).toLowerCase()).update('\0')
  .update(path.relative(dir, exe).toLowerCase()).digest('hex');

function withGameApi(scan, override) {
  if (!scan.chosen || !override || override === 'auto') return scan;
  return { ...scan, chosen: renderingApi.effective(scan.chosen, override) };
}

module.exports = { apiPreferenceKey, withGameApi };
