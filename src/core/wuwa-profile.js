'use strict';

// MFG Unlocker 1.7.0: dlss5_settings.h / dlss5_policy.h. Values are NOT the
// RenoDX INI enums (notably UI correction Off=1, After SR=2, edge-aware=3).
// Only controls with a documented equivalent are translated. RenoDX's workset
// pool, exposure governor and Ada/QualityGuard patches have no proxy setting.
function neuralSettings(profileId) {
  const profile = require('./neural-models').getHardwareProfileInfo(profileId);
  return {
    dlss5DefaultsVersion: 3,
    dlss5HookStage: 2,
    dlss5ResolutionScale: Math.round(profile.nrResolutionScale * 100),
    dlss5ResolutionScaleAuto: false,
    dlss5PassCount: profile.nrPasses,
    dlss5UpsampleFilter: 3,
    dlss5CharacterMask: false,
    dlss5UiCorrection: 1,
    dlss5OverallIntensity: 1,
    dlss5Model: 0,
    dlss5Preset: 0,
    dlss5StructureIntensity: 1,
    dlss5ToneIntensity: 1,
    dlss5CharacterIntensity: -1,
    dlss5ColorStrength: 1,
    dlss5BlendStrength: 1,
    dlss5Boost: false,
    dlss5AdaptiveExposure: false,
    dlss5CompareSplitView: false,
    dlss5DebugView: 0,
  };
}

function mfgSettings(mode) {
  // Dynamic ignores the fixed multiplier in upstream BuildAdjustedOptions.
  // Never label its output as a fixed multiplier or a user-selected ceiling.
  return {
    followGame: false,
    mode: mode === 'dynamic' ? 'dynamic' : 'fixed',
    multiplier: /^x[2-6]$/.test(mode) ? Number(mode.slice(1)) : 1,
    ...(mode === 'dynamic' ? { dynamicTargetFrameRate: 0, dynamicExperimental56: false } : {}),
  };
}

module.exports = { neuralSettings, mfgSettings };
