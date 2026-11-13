'use strict';
const fs = require('./preview-fs').fs;
const path = require('path');
const ini = require('./feeder-config');

const CONFIG = 'NeuralFrame-Legacy.ini';
function supported(bitness, api) { return bitness === 32 && ['ddraw', 'd3d8', 'd3d9', 'opengl'].includes(api); }
function configure(text, exePath, registry) {
  const dir = path.dirname(exePath), name = path.basename(exePath).toLowerCase();
  const prototype = /^prototype(?:f)?\.exe$/.test(name) || fs.existsSync(path.join(dir, 'prototypeenginef.dll'));
  const deltaForce = /^(?:df|df2|df3|dflw|dftfd|taskforcedagger)\.exe$/.test(name);
  let result = String(text || '');
  for (const [key, value] of Object.entries({ CpuLimit: prototype ? 8 : 0, LegacyMemory: deltaForce ? 1 : 0, GoldSrc: name === 'hl.exe' ? 1 : 0 })) {
    if (ini.getIni(result, 'Compatibility', key) === null) result = ini.setIni(result, 'Compatibility', key, value);
  }
  // The namespace belongs to this install; never accept a user-supplied
  // registry destination. User-tuned compatibility switches stay untouched.
  return ini.setIni(result, 'Compatibility', 'RegistryRoot', registry ? registry.key.slice(5) : '');
}
module.exports = { CONFIG, supported, configure };
