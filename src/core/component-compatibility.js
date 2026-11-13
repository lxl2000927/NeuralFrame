'use strict';
const { DEFINITIONS } = require('./component-definitions');

// Acquisition and game application share this policy. A release label alone
// must never confer the trust of a bundled, fingerprint-pinned adapter.
function componentCompatibility(p) {
  const def = DEFINITIONS[p.component];
  if (['encore','mfg-universal'].includes(p.component)) {
    const engine = require('./engine-packages').describe(p.component,p);
    const hasDllIdentity = Array.isArray(p.files) && p.files.length > 0;
    // A ZIP checksum identifies a release asset, not the DLL inside it. An
    // unknown archive may still contain an already adapted DLL after import.
    const assessment = engine.compatible ? 'route' : hasDllIdentity ? 'unsupported' : 'verify';
    return {kind:engine.compatible ? 'route' : 'pending', ready:false, label:engine.label,
      assessment, reason:engine.compatible ? engine.reason : hasDllIdentity
        ? '此 DLL 尚未进入 NeuralFrame 的引擎支持目录，当前未提供对应部署与参数支持。'
        : '尚未取得可识别的 DLL 指纹；发布名称或压缩包版本不能确认应用支持。', engine};
  }
  if (def?.pinned || def?.internal) return {kind:'internal', ready:false, assessment:'internal', label:'随软件提供',
    reason:'此组件由 NeuralFrame 随软件维护，不能在组件库单独替换版本。'};
  if (def?.managedRoute || ['feeder','reshade','preloader','optiscaler'].includes(p.component)) return {
    kind:'route', ready:false, assessment:p.trustedAdapter ? 'route' : 'route-version', label:'由安装路线成组管理',
    reason:p.trustedAdapter ? '这是安装路线使用的配套组合，由游戏页统一部署所需宿主、运行库或加载器。'
      : '该组件需要成组安装；当前安装路线没有开放这个单独版本的替换入口。'
  };
  if (p.trustedAdapter || ['dlss-sr','dlss-nr'].includes(p.component)) return {
    kind:'selectable', ready:true, assessment:'supported', label:'可选择',
    reason:p.component === 'dlss-nr' ? '允许选择模型；应用前还会核对文件身份、实际 GPU 架构和游戏路线。'
      : '允许选择此组件；应用前仍需校验文件并检查游戏的功能支持。'
  };
  const directFile = /\.(?:dll|asi|addon32|addon64)$/i.test(p.name || '') && /^[a-f0-9]{64}$/i.test(p.sha256 || '');
  const identified = (Array.isArray(p.files) && p.files.length > 0) || directFile;
  return {kind:'pending', ready:false, assessment:identified ? 'unsupported' : 'verify', label:identified ? 'NeuralFrame 尚未接入' : '文件身份待确认',
    reason:identified ? '文件已有身份记录，但 NeuralFrame 尚未提供此版本的部署与参数支持。'
      : '目前只有发布包信息，需要取得文件指纹后再核对程序部署支持。'};
}

function modelRequirements(p) {
  if (p.component !== 'dlss-nr') return undefined;
  const {MODEL_DATABASE}=require('./neural-models');
  const sha=p.dllSha256 || p.files?.find(f=>/(?:^|[\\/])nvngx_dlssnr\.dll$/i.test(f.rel || f.path))?.sha256;
  let model=sha && MODEL_DATABASE.find(m=>m.sha256===sha);
  if (model) return {architectures:model.architectures, source:'fingerprint'};
  // Historical archive labels are hints only, not identity or trust evidence.
  // Do not use them to merge records or override a known-but-unrecognized DLL.
  if (!sha && p.provider === 'rhi-nr') {
    const id=p.tag === 'dlssnr-310.8.0' ? '310.8.0-stock' : p.tag?.replace(/^dlssnr-/, '');
    model=MODEL_DATABASE.find(m=>m.id===id);
    if(model) return {architectures:model.architectures, source:'catalog'};
  }
  return undefined;
}

module.exports = { componentCompatibility, modelRequirements };
