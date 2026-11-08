'use strict';

const { detectHardwareEnvironment } = require('./core/combined-manager');
const { selectHardwareProfile } = require('./core/hardware-profile');
const { createDisplayReader } = require('./core/display-info');
const neuralModels = require('./core/neural-models');
const { MFG_UNLOCKERS } = require('./core/mfg-manager');

module.exports = function registerHardwareIpc({ ipcMain, screen, window, loadState, saveState, inspections, payloadRoot, userData }) {
  const currentDisplay = createDisplayReader(screen);
  const catalog = neuralModels.HARDWARE_PROFILES;

  ipcMain.handle('enhanced-set-profile', (_event, profileId) => {
    if (typeof profileId !== 'string' || !Object.hasOwn(catalog, profileId)) {
      return { ok: false, message: '不支持的硬件档位' };
    }
    try {
      const state = loadState();
      state.hardwareProfile = profileId;
      if (!saveState(state)) throw Error('Could not save hardware profile');
      return { ok: true, hardwareProfile: profileId, profileInfo: catalog[profileId], hardwareProfiles: catalog };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('enhanced-hardware', async (_event, forceRefresh) => {
    try {
      const refresh = forceRefresh === true;
      const [hardware, display] = await Promise.all([
        detectHardwareEnvironment(refresh),
        currentDisplay(window(), refresh).catch(() => null)
      ]);
      if (refresh) inspections().setHardware(hardware);
      const selection = selectHardwareProfile({ defaultProfile: loadState().hardwareProfile, gpu: hardware.gpu });
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
      const { id } = selectHardwareProfile({ requestedProfile, defaultProfile: loadState().hardwareProfile, gpu });
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
