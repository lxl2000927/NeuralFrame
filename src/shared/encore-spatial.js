'use strict';
const engines = ['mwsr','nis','fsr1'];
const defaults = {spatialSharpness:30,spatialAa:'off',spatialAaPlacement:'before',spatialAaQuality:'high'};
const fields = {
  spatialSharpness:v => Number.isInteger(v) && v >= 0 && v <= 100,
  spatialAa:v => ['off','smaa','fxaa'].includes(v),
  spatialAaPlacement:v => ['before','after'].includes(v),
  spatialAaQuality:v => ['low','medium','high','ultra'].includes(v),
};
function spatialOnly(settings) {
  return engines.includes(settings?.upscaling) && settings.mfgMode === 'off' && settings.neuralMode === 'off';
}
function settingsIssue(settings, supported, baseline, switching = false) {
  const selecting = engines.includes(settings.upscaling) && (settings.upscaling !== baseline?.upscaling || switching);
  if (selecting && !supported) return '空间超分参数需要已适配的 Encore 2.5.0。';
  for (const [key,valid] of Object.entries(fields)) {
    const change = settings[key] !== undefined && settings[key] !== (baseline?.[key] ?? defaults[key]);
    if (change && !supported) return '空间超分参数需要已适配的 Encore 2.5.0。';
    if ((change || selecting) && !valid(settings[key] === undefined ? baseline?.[key] ?? defaults[key] : settings[key]))
      return 'Encore 空间超分的锐化或抗锯齿参数无效。';
  }
  return null;
}
module.exports = {engines,defaults,fields,settingsIssue,spatialOnly};
