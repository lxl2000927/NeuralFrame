'use strict';

const SCHEMA = 'neuralframe-game-preset';
const VERSION = 1;
const classicRoutes = ['native','feeder','renodx','optiscaler'];
const componentRoutes = ['anr','anr-addon','sm86','sm86-delta','xemfg','xemfg-optiscaler','optifg'];
const supportedRoutes = new Set([...classicRoutes,...componentRoutes,'encore','wuwa-proxy','streamline']);
const PRIVATE_KEYS = new Set(['dir','directory','exePath','path','file','filePath','token','activity','logs','diagnosticLogging']);
function fail(message) { throw Error(message); }
function clean(value, depth = 0) {
  if (depth > 12) fail('预设嵌套层级过深');
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('预设包含无效数字'); return value; }
  if (typeof value === 'string') { if (value.length > 4096) fail('预设文本过长'); return value; }
  if (Array.isArray(value)) { if (value.length > 256) fail('预设列表过长'); return value.map(item => item === undefined ? null : clean(item, depth + 1)); }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('预设只能包含普通 JSON 数据');
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('预设包含无效字段');
    if (PRIVATE_KEYS.has(key)) continue;
    if (item === undefined) continue;
    result[key] = clean(item, depth + 1);
  }
  return result;
}
function assertSafe(value, depth = 0) {
  if (depth > 12 || !value || typeof value !== 'object') return;
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) fail('预设只能包含普通 JSON 数据');
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) fail(`预设包含不允许导出的字段：${key}`);
    assertSafe(item, depth + 1);
  }
}
function text(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label}无效`);
  return value.trim();
}
const oneOf = (...values) => value => values.includes(value);
const number = (min,max,integer=false) => value => Number.isFinite(value) && value>=min && value<=max && (!integer || Number.isInteger(value));
const bool = value => typeof value==='boolean';
const id = value => typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value);
const packageId = value => value==='' || id(value);
const neuralMode = oneOf('off','legacy','latest_compatible');
const mfgMode = oneOf('off','x2','x3','x4','x5','x6','dynamic','follow');
const draftFields = {neuralMode,mfgMode,neuralModelId:id,hardwareProfile:oneOf('rtx40_laptop','rtx40_desktop','rtx50_desktop'),
  runtimeStack:oneOf('baseline-310.9.1','oct2026-310.9.16'),hdrCompatibility:bool};
const placement = oneOf('inherit','before-sr','after-sr','present');
const encoreFields = {neuralMode,neuralModelId:id,mfgMode:oneOf('off','x2','x3','x4','x5','x6'),upscaling:oneOf('off','dlss','mwsr','nis','fsr1'),
  spatialSharpness:number(0,100,true),spatialAa:oneOf('off','smaa','fxaa'),spatialAaPlacement:oneOf('before','after'),spatialAaQuality:oneOf('low','medium','high','ultra'),
  motion:oneOf('game','encore','shader','quality','fast'),nrResolution:oneOf('render','output','quality','balanced','performance','ultra-performance','custom'),
  nrScale:number(33,100,true),nrPasses:number(1,4,true),nrPass1Placement:placement,nrPass2Placement:placement,nrPass3Placement:placement,nrPass4Placement:placement,
  dlssRenderScale:oneOf('game','dlaa','ultra','quality','balanced','performance','ultra-performance','custom'),dlssCustomScale:number(33,100,true)};
const advancedFields = {model:number(0,2,true),structure:number(0,2),tone:number(0,2),character:number(-1,2),characterMask:bool};
function record(value) { return value && typeof value==='object' && !Array.isArray(value); }
function checked(key,value,validate) {
  if (!validate(value)) fail('预设参数无效：'+key);
  return value;
}
function fields(key,value,schema) {
  checked(key,value,record);
  const result = {};
  for (const [name,validate] of Object.entries(schema)) {
    if (Object.hasOwn(value,name)) result[name]=checked(key+'.'+name,value[name],validate);
  }
  return result;
}
function settings(route,value, imported = false) {
  if (!supportedRoutes.has(route)) fail('此预设的配置路线尚不受支持');
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('预设参数为空');
  if (imported) assertSafe(value);
  const result = {};
  const source = clean(value);
  if (JSON.stringify(source).length > 128*1024) fail('预设超过 128 KB 限制');
  // Version 1 used to store draft fields for inactive routes alongside the
  // selected engine. Keep only parameters owned by the selected route.
  if (classicRoutes.includes(route) || route==='streamline' || route==='wuwa-proxy') {
    if (source.draft !== undefined) result.draft=fields('draft',source.draft,draftFields);
    if (source.resetNeuralTuning !== undefined) result.resetNeuralTuning=checked('resetNeuralTuning',source.resetNeuralTuning,bool);
    if (route==='wuwa-proxy' || route==='streamline') {
      if (source.mfgAdvanced !== undefined) result.mfgAdvanced=fields('mfgAdvanced',source.mfgAdvanced,advancedFields);
      if (source.mfgPackageId !== undefined) result.mfgPackageId=checked('mfgPackageId',source.mfgPackageId,packageId);
    }
  } else if (route==='encore') {
    if (source.encore !== undefined) result.encore=fields('encore',source.encore,encoreFields);
    if (source.encorePackageId !== undefined) result.encorePackageId=checked('encorePackageId',source.encorePackageId,packageId);
  } else if (source.graphics !== undefined && !['optifg','xemfg-optiscaler'].includes(route)) {
    const graphicsFields = {multiplier:number(route==='sm86-delta' ? 1 : 2,6,true)};
    if (route.startsWith('anr')) graphicsFields.sceneCut=bool;
    if (route==='anr') graphicsFields.neural=bool;
    if (route==='xemfg') graphicsFields.xeMode=oneOf('auto','compatibility');
    if (route.startsWith('sm86')) {
      graphicsFields.engine=oneOf('DLSS','XeSS');
      graphicsFields.nativeRuntimes=value=>Array.isArray(value) && new Set(value).size===value.length &&
        value.every(oneOf('sr','rr','fg','streamline'));
    }
    result.graphics=fields('graphics',source.graphics,graphicsFields);
    if (result.graphics.engine==='XeSS' && result.graphics.multiplier>4) fail('预设参数无效：graphics.multiplier');
  }
  if (source.components !== undefined) {
    checked('components',source.components,record);
    result.components={};
    for (const [component,selection] of Object.entries(source.components)) {
      checked('components',component,id);
      result.components[component]=checked('components.'+component,selection,packageId);
    }
    if (source.componentsComplete !== undefined) result.componentsComplete=checked('componentsComplete',source.componentsComplete,bool);
  }
  return result;
}
function presetMatches(preset,route,gameName) {
  if (preset.route===route) return true;
  if (preset.route!=='streamline') return false;
  const dedicated=Object.hasOwn(preset.settings,'mfgPackageId') || Object.keys(preset.settings.mfgAdvanced || {}).length>0 ||
    ['follow','dynamic','x5','x6'].includes(preset.settings.draft?.mfgMode);
  if (route==='wuwa-proxy') return dedicated && preset.gameName===gameName;
  return classicRoutes.includes(route) && !dedicated;
}
function createPreset(input) {
  const route=text(input.route, '配置路线',64);
  return {
    schema:SCHEMA, version:VERSION,
    name:text(input.name, '预设名称', 80),
    gameName:text(input.gameName, '游戏名称', 160),
    route,
    createdAt:input.createdAt || new Date().toISOString(),
    settings:settings(route,input.settings),
  };
}
function parsePreset(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 160 * 1024) fail('预设文件超过大小限制');
  let value;
  try { value = JSON.parse(encoded); } catch { fail('预设文件不是有效 JSON'); }
  if (!value || value.schema !== SCHEMA || value.version !== VERSION) fail('预设格式或版本不受支持');
  const route=text(value.route,'配置路线',64);
  return {
    schema:SCHEMA, version:VERSION,
    name:text(value.name, '预设名称', 80), gameName:text(value.gameName, '游戏名称', 160),
    route, createdAt:text(value.createdAt, '创建时间', 40),
    settings:settings(route,value.settings, true),
  };
}
module.exports = {SCHEMA, VERSION, createPreset, parsePreset, presetMatches};
