'use strict';

const { HARDWARE_PROFILES, detectGpuArchitecture } = require('./neural-models');

// Keep the deployed preset ID separate from why it was selected. A borrowed
// preset describes the settings to use, not the physical model of the GPU.
function selectHardwareProfile({ requestedProfile, manifestProfile, defaultProfile, gpu = {} } = {}) {
  for (const [id, source] of [[requestedProfile, 'selected'], [manifestProfile, 'manifest'], [defaultProfile, 'default']]) {
    if (typeof id === 'string' && Object.hasOwn(HARDWARE_PROFILES, id)) return { id, source };
  }

  const name = gpu?.detected === false ? '' : gpu?.name;
  const arch = detectGpuArchitecture(name);
  if (arch.code === 'blackwell') {
    return { id: 'rtx50_desktop', source: arch.isLaptop ? 'blackwell-mobile' : 'detected' };
  }
  if (/\bRTX\s*40\d{2}/i.test(name || '')) {
    if (arch.isLaptop) return { id: 'rtx40_laptop', source: 'detected' };
    if (Number.isFinite(gpu.vramTotalMB) && gpu.vramTotalMB > 0 && gpu.vramTotalMB < 10 * 1024) {
      return { id: 'rtx40_laptop', source: 'low-vram' };
    }
    return { id: 'rtx40_desktop', source: 'detected' };
  }
  return { id: 'rtx40_laptop', source: 'fallback' };
}

module.exports = { selectHardwareProfile };
