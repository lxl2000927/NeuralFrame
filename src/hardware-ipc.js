'use strict';

const { detectHardwareEnvironment } = require('./core/combined-manager');
const { selectHardwareProfile } = require('./core/hardware-profile');
const { createDisplayReader } = require('./core/display-info');
const neuralModels = require('./core/neural-models');
const { MFG_UNLOCKERS } = require('./core/mfg-manager');

module.exports = function registerHardwareIpc({ ipcMain, screen, window, inspections, payloadRoot, userData }) {
  const currentDisplay = createDisplayReader(screen);
  const catalog = neuralModels.HARDWARE_PROFILES;

  ipcMain.handle('enhanced-hardware', async (_event, forceRefresh, includeDisplay) => {
    try {
      const refresh = forceRefresh === true;
      const [hardware, display] = await Promise.all([
        detectHardwareEnvironment(refresh),
        // Component compatibility only needs the GPU. DPI-aware monitor probing
        // launches PowerShell on Windows and must not delay that answer.
        includeDisplay === false ? null : currentDisplay(window(), refresh).catch(() => null)
      ]);
      if (refresh) inspections().setHardware(hardware);
      // The retired app-wide preset must not silently override automatic
      // hardware matching now that its settings control has been removed.
      const selection = selectHardwareProfile({ gpu: hardware.gpu });
      return {
        ok: true,
        hardwareProfile: selection.id,
        hardwareProfileSource: selection.source,
        hardwareProfiles: catalog,
        hardware: { ...hardware, display, activeProfile: selection.id, activeProfileInfo: catalog[selection.id] }
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('enhanced-models', async (_event, requestedProfile) => {
    try {
      const { gpu } = await detectHardwareEnvironment();
      const { id } = selectHardwareProfile({ requestedProfile, gpu });
      const models = await inspections().run('models', null, {
        payloadDir: payloadRoot(), userDataDir: userData(), gpuName: gpu.name, hardwareProfile: id
      });
      return { ok: true, models, runtimeStacks: neuralModels.RUNTIME_STACKS, unlockers: MFG_UNLOCKERS,
        hardwareProfile: id, hardwareProfiles: catalog };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
};
