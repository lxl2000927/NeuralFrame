'use strict';
// A release label never grants installation support. These fingerprints refer
// to upstream originals whose configuration contracts have been reviewed.
const fs = require('node:fs');
const path = require('node:path');
const pe = require('./pe');
const NOTICE = Object.freeze({name:'THIRD-PARTY-NOTICES.md', size:27855,
  sha256:'6263f24f369203089e617aad6be05f0c1103891e4f928d0da66da51ba1dc3939'});
const MFG_LICENSE = Object.freeze({name:'MFG-Unlocker-LICENSE.txt',size:1071,
  sha256:'433da96087fd9b91afd44c6350ca92da53167c9636a0a71e428f71036d8c372f'});
const ENGINES = Object.freeze({
  'mfg-universal':Object.freeze({name:'MFGUnlocker.dll', marker:'MFGUnlocker', notice:MFG_LICENSE, noticePack:'mfg-license', versions:Object.freeze([
    {version:'1.7.1', size:7389696, sha256:'5a389e6cad23b2b607e1dc224e9e86ee32d6ef46f0557b6c6f8137feadf0aa74',
      archiveSha256:'c85cb2a9e74f39be744fada4a1a75d72c606f73315114f334ad7755a3a13005d', recommended:true,
      capabilities:{neuralStrengths:true, neuralPresets:true, dx11NeuralRendering:true, diagnosticLogging:true}},
    {version:'1.7.0', size:14445568, sha256:'e6b6e6b70a6ed3af839c9647a32fc22660ae6b2d655062c5c072246c91fc10c7',
      archiveSha256:'5bd19d03288e1ece1d0bb2030ac072b36758045028da192044dcaad73fd901dd', recommended:false,
      capabilities:{neuralStrengths:true, neuralPresets:false, dx11NeuralRendering:false, diagnosticLogging:false}}
  ])}),
  encore:Object.freeze({name:'rtx-encore.dll', marker:'RTX Encore', notice:NOTICE, versions:Object.freeze([
    {version:'2.5.0', size:47319040, sha256:'58fff4489e2222cb263e17142613693869acec458e0fa0b7ab260482fbf8c762',
      archiveSha256:'249a22ff63bbbeedc29d1509c1f7bb21570e18cf09a1ae3eeba775855beacbda', recommended:true,
      notice:Object.freeze({name:NOTICE.name,size:29109,sha256:'57ce4dda7399aa824025afa6eee08a13dd77151ef11680728764a38a207758c1'}),
      capabilities:{nrPassPlacement:true, dlssCustomScale:true, dlssCustomScaleMin:33, spatialUpscaling:true}},
    {version:'2.4.2', size:46874112, sha256:'13ab03f79d56743c5c2f4481c91adde549ddb57e2e8b1003ca864d6b5be83c82',
      archiveSha256:'faea3e52dd2dbf2f1ea181a18bb4c7f604a12313292581014e9c6b525e0aa70d', recommended:false,
      capabilities:{nrPassPlacement:true, dlssCustomScale:true, dlssCustomScaleMin:33}},
    {version:'2.4.1', size:46694400, sha256:'9a6dcc15058919618959edfa4510f5ffb913f4facf265c99ca3c49bc49c170c2',
      archiveSha256:'e5383604a9289c70c8a47e73e4c22503c9e5834d9ed0058dc4754b3d79409202', recommended:false,
      capabilities:{nrPassPlacement:true, dlssCustomScale:true, dlssCustomScaleMin:33}},
    {version:'2.3.0', size:46168064, sha256:'b668a747e5eba576b544e4c6a790ce9c2d52b80389fe4f6ec999b6020f612471',
      archiveSha256:'6891cd827ec9dbadf2c4b2d14ab883e6e3e5b0c6a7914ea22cc9d55be79d64c6', recommended:false,
      capabilities:{nrPassPlacement:false, dlssCustomScale:true, dlssCustomScaleMin:50}}
  ])})
});
for (const engine of Object.values(ENGINES)) for (const version of engine.versions) {
  Object.freeze(version.capabilities); Object.freeze(version);
}
const fail = message => Object.assign(new Error(message), {code:'errComponentLibrary'});
function info(component, version) {
  return version ? {...version, component, verified:true, compatible:true,
    label:version.recommended ? '推荐版本 · 游戏页可选' : '已适配历史版本 · 游戏页可选',
    reason:'文件指纹与已适配原版一致；由游戏安装路线应用。', capabilities:{...version.capabilities}}
    : {component, verified:false, compatible:false, recommended:false, capabilities:{},
      label:'等待适配', reason:'此文件指纹尚未验证配置协议和加载链；可下载保留，暂不能应用。'};
}
function identify(component, sha256) {
  return info(component, ENGINES[component]?.versions.find(v=>v.sha256===sha256));
}
function recommended(component) {
  return info(component, ENGINES[component]?.versions.find(v=>v.recommended));
}
function describe(component, pkg = {}) {
  const engine = ENGINES[component];
  if (!engine || pkg.component && pkg.component !== component) return info(component);
  // Once actual file fingerprints exist, an archive association cannot hide a
  // different or damaged DLL. Archive identity is only a pre-download hint.
  if (Array.isArray(pkg.files)) {
    const files = pkg.files.filter(f=>path.basename(f.rel || f.path || '').toLowerCase()===engine.name.toLowerCase());
    if (files.length !== 1 || files[0].bitness && files[0].bitness !== 64) return info(component);
    const version = engine.versions.find(v=>v.sha256===files[0].sha256 && (files[0].size == null || v.size===files[0].size));
    const notice = version?.notice || engine.notice;
    if (version && notice && pkg.files.some(f=>path.basename(f.rel || f.path || '').toLowerCase()===notice.name.toLowerCase() &&
        (f.sha256 !== notice.sha256 || (f.size != null && f.size !== notice.size)))) {
      return {...info(component),version:version.version,noticeMismatch:true,label:'配套声明与引擎版本不符',
        reason:'请重新导入与引擎版本匹配的原版第三方声明。'};
    }
    return info(component, version);
  }
  return info(component, engine.versions.find(v=>v.sha256===pkg.sha256 ||
    v.archiveSha256===(pkg.archiveSha256 || pkg.sha256)));
}
async function checkedFile(file, expected) {
  const {digest} = require('./component-library');
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size || await digest(file) !== expected.sha256)
    throw fail('引擎组件文件已变化，请重新下载：' + path.basename(file));
  return file;
}
function legacyEncoreNotice() {
  return checkedFile(path.resolve(__dirname,'../../assets/licenses/RTX-Encore-2.3-2.4-NOTICES.md'),NOTICE);
}
async function resolve({component, packageId, userDataDir, payloadDir} = {}) {
  const engine = ENGINES[component];
  if (!engine) throw fail('未知的引擎组件');
  const {ComponentLibrary, safe} = require('./component-library');
  let filePath, metadata, noticePath;
  if (packageId) {
    if (!userDataDir) throw fail('无法读取引擎组件库');
    const library = new ComponentLibrary(userDataDir), pkg = library.package(packageId);
    metadata = describe(component, pkg);
    if (pkg.component !== component || !metadata.compatible) throw fail('所选引擎版本尚未适配，请选择推荐版本或其他已验证版本。');
    await library.verify(pkg);
    const entry = pkg.files.find(f=>f.rel.toLowerCase()===engine.name.toLowerCase());
    if (!entry) throw fail('引擎组件路径不正确');
    filePath = safe(library.directory(pkg), entry.rel);
    const expected = metadata.notice || engine.notice;
    const notice = expected && pkg.files.find(f=>f.rel===expected.name);
    if (notice) noticePath = await checkedFile(safe(library.directory(pkg),notice.rel),expected);
  } else {
    metadata = recommended(component);
    const pack = require('./runtime-catalog.json').packs.find(p=>p.id===component);
    const file = pack?.files.find(f=>path.basename(f.path)===engine.name);
    if (!file || file.sha256 !== metadata.sha256) throw fail('推荐引擎组件清单不一致');
    if (!payloadDir) throw fail('缺少配套组件缓存目录');
    filePath = safe(payloadDir, file.path);
  }
  try {
    await checkedFile(filePath, metadata);
  } catch (error) {
    if (packageId) throw error;
    throw Object.assign(fail('请先准备推荐引擎组件。'), {code:'errRuntimeComponents', dependencies:['runtime:'+component]});
  }
  if (pe.getBitness(filePath) !== 64 || !pe.findMarkers(filePath,[engine.marker]).has(engine.marker))
    throw fail('引擎组件角色或架构不匹配：' + engine.name);
  const expectedNotice = metadata.notice || engine.notice;
  if (!noticePath && component === 'encore' && expectedNotice === NOTICE)
    noticePath = await legacyEncoreNotice();
  if (!noticePath && expectedNotice && payloadDir) {
    const pack = require('./runtime-catalog.json').packs.find(p=>p.id===(engine.noticePack || component));
    const file = pack?.files.find(f=>path.basename(f.path)===expectedNotice.name && f.sha256===expectedNotice.sha256);
    if (file) try { noticePath = await checkedFile(safe(payloadDir,file.path),expectedNotice); } catch { /* Caller prepares notices if needed. */ }
  }
  return {...metadata, filePath, packageId:packageId || null, noticePath};
}
module.exports = {describe, identify, recommended, resolve, legacyEncoreNotice};
