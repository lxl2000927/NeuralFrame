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

const profileFields = ['dlss5HookStage', 'dlss5ResolutionScale', 'dlss5ResolutionScaleAuto',
  'dlss5PassCount', 'dlss5UpsampleFilter', 'dlss5UiCorrection'];
const advancedFields = Object.freeze({
  model: { key: 'dlss5Model', min: 0, max: 2, integer: true },
  structure: { key: 'dlss5StructureIntensity', min: 0, max: 2 },
  tone: { key: 'dlss5ToneIntensity', min: 0, max: 2 },
  characterMask: { key: 'dlss5CharacterMask', boolean: true },
  character: { key: 'dlss5CharacterIntensity', min: -1, max: 2 },
  diagnosticLogging: { boolean: true },
});

function configureNeural(settings, profileId, { previousProfile, reset = false } = {}) {
  const defaults = neuralSettings(profileId);
  // A repeated Apply is not a factory reset of the in-game tuning panel.
  // A deliberate profile change only owns its performance/routing controls.
  for (const [key, value] of Object.entries(defaults)) {
    if (reset || settings[key] === undefined ||
        (previousProfile !== profileId && profileFields.includes(key))) settings[key] = value;
  }
  return settings;
}

function validateAdvanced(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('独立加载高级设置格式无效。');
  for (const [name, input] of Object.entries(value)) {
    const field = advancedFields[name];
    if (!field || (field.boolean ? typeof input !== 'boolean' :
      typeof input !== 'number' || !Number.isFinite(input) || input < field.min || input > field.max ||
      (field.integer && !Number.isInteger(input)))) throw Error('独立加载高级设置无效：' + name);
  }
  return value;
}

function configureAdvanced(settings, value) {
  for (const [name, input] of Object.entries(validateAdvanced(value))) {
    const key = advancedFields[name].key;
    if (key) settings[key] = input;
  }
}

function inspectAdvanced(settings, diagnosticLogging) {
  // Absent external control keys use the upstream defaults, not our preset.
  const defaults = { ...neuralSettings('rtx40_laptop'), dlss5CharacterMask: true };
  return Object.fromEntries(Object.entries(advancedFields).map(([name, field]) =>
    [name, field.key ? settings[field.key] ?? defaults[field.key] : diagnosticLogging]));
}

module.exports = { neuralSettings, mfgSettings, configureNeural, validateAdvanced, configureAdvanced, inspectAdvanced };
