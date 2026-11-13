'use strict';
const jsonc = require('jsonc-parser');
const fail = message => Object.assign(new Error(message), {code:'errEncoreConfig'});
const DEFAULTS = Object.freeze({mfgMode:'off', neuralMode:'off', neuralModelId:'310.8.SF-v2',
  upscaling:'off', motion:'game', nrResolution:'custom', nrScale:75, nrPasses:1,
  nrPass1Placement:'inherit', nrPass2Placement:'inherit', nrPass3Placement:'inherit', nrPass4Placement:'inherit',
  dlssRenderScale:'game', dlssCustomScale:67});
const PASS_KEYS = ['nrPass1Placement','nrPass2Placement','nrPass3Placement','nrPass4Placement'];
const PLACEMENTS = ['inherit','before-sr','after-sr','present'];
const SR_SCALES = ['game','dlaa','ultra','quality','balanced','performance','ultra-performance','custom'];
function capabilities(version = '2.3.0') {
  if (version && typeof version === 'object') return version;
  const newer = /^2\.(?:[4-9]|[1-9]\d+)\./.test(String(version));
  return {nrPassPlacement:newer,dlssCustomScale:true,dlssCustomScaleMin:newer ? 33 : 50};
}
function document(text) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw fail('Encore 配置超过读取上限。');
  const errors = [], tree = jsonc.parseTree(text.replace(/^\uFEFF/, ' '), errors, {allowTrailingComma:true});
  if (errors.length || tree?.type !== 'object') throw fail('Encore 配置格式无效，已保留原文件。');
  function visit(node, depth=0) {
    if (depth > 32) throw fail('Encore 配置层级过深。');
    if (node.type === 'object') {
      const keys = node.children.map(p => p.children[0].value);
      if (new Set(keys).size !== keys.length) throw fail('Encore 配置包含重复字段，已保留原文件。');
    }
    for (const child of node.children || []) visit(child, depth+1);
  }
  visit(tree);
  const value = jsonc.getNodeValue(tree);
  if (value.configVersion != null && value.configVersion !== 4) throw fail('此 Encore 配置协议尚未适配，请保留原配置。');
  return value;
}
function read(text) {
  const value = document(text), nr = value.neuralRendering?.core || {}, fg = value.frameGeneration || {}, sr = value.dlssSuperResolution || {};
  // With added FG, Encore's default/game mode means X2. A fixed multiplier
  // omitted by a hand-edited or compact JSONC uses the upstream default X4.
  const fgMode = fg.mode ?? 'game';
  return { ...DEFAULTS, mfgMode:fg.frameGenerationWithoutGameFg === true
    ? ['game','dlss-fg',undefined].includes(value.renderingEngines?.frameGenerationEngine)
      ? fgMode === 'game' ? 'x2' : fgMode === 'fixed' ? 'x'+(fg.multiplier ?? 4) : 'unsupported'
      : 'unsupported' : 'off',
    neuralMode:nr.nrEnabled === true ? 'latest_compatible' : 'off',
    upscaling:sr.dlssWithoutGameDlss === true ? sr.dlssWithoutGameDlssEngine || 'dlss' : 'off',
    motion:sr.presentOpticalFlow || 'game', nrResolution:nr.nrResolution || 'render', nrScale:nr.nrResolutionScale ?? 67,
    nrPasses:nr.nrPasses || 1,
    ...Object.fromEntries(PASS_KEYS.map(key => [key,nr[key] ?? DEFAULTS[key]])),
    dlssRenderScale:sr.dlssRenderScale ?? DEFAULTS.dlssRenderScale,
    dlssCustomScale:sr.dlssCustomScale ?? DEFAULTS.dlssCustomScale };
}
function validate(settings, version = '2.3.0', baseline) {
  if (!settings || !['off','x2','x3','x4','x5','x6'].includes(settings.mfgMode) ||
      !['off','latest_compatible','legacy'].includes(settings.neuralMode) ||
      !['off','dlss'].includes(settings.upscaling) ||
      !['game','encore','shader','quality','fast'].includes(settings.motion) ||
      (settings.neuralMode !== 'off' && (
        !['render','output','quality','balanced','performance','ultra-performance','custom'].includes(settings.nrResolution) ||
        !Number.isInteger(settings.nrScale) || settings.nrScale < 33 || settings.nrScale > 100 ||
        !Number.isInteger(settings.nrPasses) || settings.nrPasses < 1 || settings.nrPasses > 4)))
    throw fail('Encore 参数包含尚未适配的值，请重新选择。');
  const caps = capabilities(version);
  const enablingNr = baseline?.neuralMode === 'off' && settings.neuralMode !== 'off';
  for (const key of PASS_KEYS) {
    if (settings[key] === undefined || (baseline && settings[key] === baseline[key] && !enablingNr)) continue;
    if (!PLACEMENTS.includes(settings[key])) throw fail('Encore 神经渲染处理位置无效。');
    if (!caps.nrPassPlacement && settings[key] !== 'inherit') throw fail('逐遍神经渲染处理位置需要 Encore 2.4.0 或更新版本。');
    if (!caps.nrPassPlacement && baseline && settings[key] !== baseline[key])
      throw fail('当前 Encore 不支持修改逐遍神经渲染处理位置，请先选择支持的版本。');
  }
  if (settings.dlssRenderScale !== undefined && (!baseline || settings.dlssRenderScale !== baseline.dlssRenderScale) &&
      !SR_SCALES.includes(settings.dlssRenderScale)) throw fail('Encore DLSS 渲染比例无效。');
  const enablingCustomSr = settings.dlssRenderScale === 'custom' && baseline?.dlssRenderScale !== 'custom';
  if (settings.dlssCustomScale !== undefined && (!baseline || settings.dlssCustomScale !== baseline.dlssCustomScale || enablingCustomSr) &&
      (!Number.isInteger(settings.dlssCustomScale) || settings.dlssCustomScale < (caps.dlssCustomScaleMin ?? 50) || settings.dlssCustomScale > 100))
    throw fail(`当前 Encore 的 DLSS 自定义渲染比例范围为 ${caps.dlssCustomScaleMin ?? 50}–100%。`);
  return settings;
}
function configure(text, settings, hasNativeDlss, version = '2.3.0') {
  if (!settings) validate(settings,version);
  const original = document(text), nr = settings.neuralMode !== 'off', fg = settings.mfgMode !== 'off';
  const baseline = read(text);
  validate(settings,version,baseline);
  for (const key of ['frameGeneration','neuralRendering','dlssSuperResolution','renderingEngines','smoothMotion']) {
    if (original[key] !== undefined && (!original[key] || typeof original[key] !== 'object' || Array.isArray(original[key])))
      throw fail('Encore 配置字段类型不兼容，已保留原文件。');
  }
  const core = original.neuralRendering?.core;
  if (core !== undefined && (!core || typeof core !== 'object' || Array.isArray(core))) throw fail('Encore 神经渲染字段类型不兼容，已保留原文件。');
  if (hasNativeDlss && settings.upscaling !== 'off') throw fail('游戏已有原生 DLSS 超分，请使用游戏内的超分设置。');
  const patches = [
    [['configVersion'],4],
    [['frameGeneration','frameGenerationWithoutGameFg'],fg],
    [['neuralRendering','core','nrEnabled'],nr],
    [['neuralRendering','core','nrWithoutGameDlss'],nr && !hasNativeDlss],
    [['dlssSuperResolution','dlssWithoutGameDlss'],settings.upscaling !== 'off'],
    [['dlssSuperResolution','presentOpticalFlow'],settings.motion],
  ];
  if (fg) patches.push([['renderingEngines','frameGenerationEngine'],'dlss-fg'],
    [['frameGeneration','mode'],'fixed'], [['frameGeneration','multiplier'],Number(settings.mfgMode.slice(1))],
    [['smoothMotion','smoothMotionEnabled'],false]);
  if (settings.upscaling !== 'off') patches.push([['dlssSuperResolution','dlssWithoutGameDlssEngine'],'dlss']);
  if (nr) patches.push([['neuralRendering','core','nrPasses'],settings.nrPasses],
    [['neuralRendering','core','nrResolution'],settings.nrResolution], [['neuralRendering','core','nrResolutionScale'],settings.nrScale]);
  // These controls were added after existing profiles. Merely showing their
  // defaults must not insert fields, reset menu tuning, or migrate an engine.
  for (const key of PASS_KEYS) if (settings[key] !== undefined && settings[key] !== baseline[key])
    patches.push([['neuralRendering','core',key],settings[key]]);
  for (const key of ['dlssRenderScale','dlssCustomScale']) if (settings[key] !== undefined && settings[key] !== baseline[key]) {
    if (!hasNativeDlss && (key !== 'dlssRenderScale' || settings[key] !== 'game'))
      throw fail('DLSS 渲染比例覆盖需要游戏已有原生 DLSS 超分。');
    patches.push([['dlssSuperResolution',key],settings[key]]);
  }
  // Defaults belong to fresh fields only. Do not reset menu edits, appearance,
  // placement, learned pacing, exposure, or unknown future/private keys.
  if (original.neuralRendering?.core?.nrPlacement === undefined) patches.push([['neuralRendering','core','nrPlacement'],'after-sr']);
  if (original.frameGeneration?.flipMeteringBypass === undefined) patches.push([['frameGeneration','flipMeteringBypass'],'auto']);
  if (original.dlssSuperResolution?.dlssWithoutGameDlssOutput === undefined) patches.push([['dlssSuperResolution','dlssWithoutGameDlssOutput'],'game']);
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  let out = bom ? text.slice(1) : text;
  try {
    for (const [key,value] of patches) out = jsonc.applyEdits(out, jsonc.modify(out,key,value,{formattingOptions:{insertSpaces:true,tabSize:2,eol:text.includes('\r\n')?'\r\n':'\n'}}));
  } catch { throw fail('Encore 配置字段类型不兼容，已保留原文件。'); }
  document(out);
  return bom + out;
}
module.exports = {DEFAULTS, PASS_KEYS, PLACEMENTS, SR_SCALES, capabilities, document, read, validate, configure};
