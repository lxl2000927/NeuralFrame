'use strict';
const path = require('node:path'), crypto = require('node:crypto');
const {fs} = require('./preview-fs');
const journal = require('./file-journal'), apply = require('./apply'), pe = require('./pe');
const configFile = require('./encore-config'), routes = require('../shared/install-routes');
const catalog = require('./runtime-catalog.json');
const engines = require('./engine-packages');
const VERSION = '2.4.1', CONFIG = 'rtx-encore.jsonc';
const FG_FILES = ['nvngx_dlssg.dll','sl.interposer.dll','sl.common.dll','sl.dlss_g.dll','sl.reflex.dll','sl.pcl.dll'];
const PROXIES = ['version.dll','dinput8.dll','winmm.dll','dxgi.dll'];
const fail = message => Object.assign(new Error(message), {code:'errEncore'});
const key = value => path.resolve(value).toLowerCase();
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function readConfig(file) {
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw fail('Encore 配置超过读取上限。');
  return fs.readFileSync(file,'utf8');
}
function sourceFile(payloadDir, packId, suffix) {
  const file = catalog.packs.find(p => p.id === packId)?.files.find(f => f.path.endsWith('/'+suffix));
  if (!file) throw fail('Encore 配套清单缺少文件：'+suffix);
  const source = journal.safePath(payloadDir,file.path);
  if (!fs.existsSync(source) || fs.statSync(source).size !== file.size || digest(source) !== file.sha256)
    throw fail('Encore 配套组件缺失或指纹不匹配，请重新准备：'+suffix);
  return {source,sha256:file.sha256};
}
function target(scan, selected) {
  const chosen = selected || scan.chosen;
  return {...chosen, hasNativeFg:chosen?.hasNativeFg ?? routes.nativeFgPresent(scan)};
}
function assertTarget(gameDir, scan, selected, gpuName) {
  const chosen = target(scan,selected);
  if (require('./wuthering-waves').gameRoot(gameDir,chosen?.path)) throw fail('鸣潮继续使用独立加载路线，不切换 Encore。');
  const reason = routes.encoreReason(chosen);
  if (reason) throw fail(reason);
  if (gpuName != null && !/\bRTX\s*(?:20|30|40|50)\d{2}(?:\b|(?=Ti\b|Super\b|D\b))/i.test(gpuName))
    throw fail('Encore 首批适配需要识别到 NVIDIA RTX 20 / 30 / 40 / 50 显卡。');
  return chosen;
}
function installedEngine(gameDir, manifest) {
  const proxy = manifest?.encore?.proxy;
  if (manifest?.route !== 'encore' || !PROXIES.includes(proxy)) return null;
  const filePath = journal.safePath(gameDir,path.join(path.dirname(manifest.game.exe),proxy));
  const rel = path.relative(gameDir,filePath), sha256 = manifest.encore.files?.[rel];
  const identified = engines.describe('encore',{sha256});
  return {...identified,filePath,sha256,packageId:manifest.encore.packageId ?? null,
    version:identified.version || manifest.encore.version || null};
}
function inspect(gameDir, scan, manifest) {
  const chosen = target(scan), reason = routes.encoreReason({...chosen,
    launcherProtected:!!require('./wuthering-waves').gameRoot(gameDir,chosen?.path)});
  const recommended = engines.recommended('encore');
  const out = {available:!reason, reason, version:recommended.version, engine:recommended,
    recommendedVersion:recommended.version, capabilities:recommended.capabilities,
    exePath:chosen?.path || null, installed:false, settings:{...configFile.DEFAULTS},
    hasNativeDlss:chosen?.hasNativeDlss ?? routes.nativeDlssPresent(scan)};
  if (manifest?.route !== 'encore' || !chosen?.path ||
      key(journal.safePath(gameDir,manifest.game?.exe)) !== key(chosen.path)) return out;
  out.installed = true;
  out.proxy = manifest.encore?.proxy;
  const installed = installedEngine(gameDir,manifest);
  out.engine = installed ? {...installed} : {verified:false,compatible:false,version:manifest.encore?.version || null};
  // Resolve capabilities from known deployed bytes, never a version label in
  // a manifest or an imported filename. Status is not a claim of in-game use.
  if (installed) {
    try {
      out.engine.verified = !!installed.verified && fs.existsSync(installed.filePath) && fs.statSync(installed.filePath).isFile() && digest(installed.filePath) === installed.sha256;
    } catch { out.engine.verified = false; }
    delete out.engine.filePath;
    if (!out.engine.verified) out.engine.reason = 'Encore 加载器缺失或已被修改，请重新预览安装。';
  }
  out.version = out.engine.version;
  out.capabilities = out.engine.verified ? out.engine.capabilities : {};
  const files = Object.keys(manifest.encore?.files || {});
  out.filesPresent = files.length > 0 && files.every(rel => fs.existsSync(journal.safePath(gameDir,rel)));
  try {
    const file = journal.safePath(gameDir,path.relative(gameDir,path.join(path.dirname(chosen.path),CONFIG)));
    out.settings = {...configFile.read(readConfig(file)),
      neuralModelId:manifest.neuralRendering?.modelId || configFile.DEFAULTS.neuralModelId};
  } catch (error) { out.error = error.message; }
  return out;
}
function assertOwnedFiles(gameDir, manifest) {
  if (manifest?.route !== 'encore') return;
  // Config is intentionally editable in-game. Immutable deployed files must
  // still belong to this installation before a restore or switch deletes them.
  const owned = manifest.encore?.files;
  if (!owned || typeof owned !== 'object' || Array.isArray(owned)) throw fail('Encore 文件归属记录无效，已保留现有文件。');
  for (const [rel, expected] of Object.entries(owned)) {
    const file = journal.safePath(gameDir,rel);
    if (path.basename(file).toLowerCase() === CONFIG || !fs.existsSync(file)) continue;
    if (!/^[a-f0-9]{64}$/.test(expected) || !fs.statSync(file).isFile() || digest(file) !== expected)
      throw fail('Encore 文件在部署后已被其他操作修改，已停止还原并保留该文件：'+rel+'。请先在原工具中处理该文件。');
  }
}
async function install(options, log = () => {}) {
  const {gameDir, exePath, api, payloadDir, encoreSettings:settings, model, gpuName} = options;
  if (!settings) configFile.validate(settings);
  const scan = options.scan || await require('./scan').scanGame(gameDir);
  const selected = scan.exeCandidates.find(e => key(e.path) === key(exePath));
  if (!selected) throw fail('Encore 目标程序已不在扫描列表中。');
  const chosen = assertTarget(gameDir,scan,{...selected,api,apiLabel:options.apiLabel || selected.apiLabel},gpuName);
  const bin = path.dirname(exePath), recorded = require('./backend-manager').readManifest(gameDir);
  // The backend transaction can keep the old manifest while its previous
  // executable's files have already been restored. They are not this target's
  // installed engine or owned destinations.
  const previous = recorded?.game?.exe && recorded.game.api === api &&
    key(journal.safePath(gameDir,recorded.game.exe)) === key(exePath) ? recorded : null;
  let engine;
  if (options.encorePackageId === undefined && previous?.route === 'encore') {
    assertOwnedFiles(gameDir,previous);
    engine = installedEngine(gameDir,previous);
    if (!engine?.verified || !engine.compatible || !fs.existsSync(engine.filePath))
      throw fail('无法保留当前 Encore 加载器，请在游戏页明确选择推荐版本或已入库版本后重新预览。');
    engine.retained = true;
  } else engine = await engines.resolve({component:'encore',packageId:options.encorePackageId,
    userDataDir:options.userDataDir,payloadDir});
  const owned = previous?.route === 'encore' ? previous.encore?.files || {} : {};
  const full = name => journal.safePath(gameDir,path.relative(gameDir,path.join(bin,name)));
  const ownedFile = file => Object.entries(owned).find(([rel]) => key(journal.safePath(gameDir,rel)) === key(file));
  const check = file => {
    if (!fs.existsSync(file)) return;
    const record = ownedFile(file);
    if (!record || (path.basename(file) !== CONFIG && digest(file) !== record[1]))
      throw fail('Encore 不覆盖来源未知或已被修改的文件：'+path.relative(gameDir,file)+'。请先在原工具中还原。');
  };
  const ownProxy = previous?.route === 'encore' && previous.encore?.proxy;
  if (ownProxy && !PROXIES.includes(ownProxy)) throw fail('Encore 加载器记录无效。');
  const proxy = ownProxy || PROXIES.find(name => !fs.existsSync(full(name)));
  if (!proxy) throw fail('Encore 可用加载文件均被占用，请保留现有插件。');
  // Refuse a second unknown Encore/FG engine instead of loading two hooks.
  for (const folder of [bin,path.join(bin,'plugins'),path.join(bin,'scripts')]) {
    if (!fs.existsSync(folder)) continue;
    journal.safePath(gameDir,path.relative(gameDir,path.join(folder,'.encore-conflict-check')));
    for (const name of fs.readdirSync(folder)) {
      const file = journal.safePath(gameDir,path.relative(gameDir,path.join(folder,name)));
      if (folder === bin && /^(?:RTXMFG-Universal\.json|OptiScaler\.ini|dlss5-feed\.cfg)$/i.test(name))
        throw fail('发现其他渲染后端的配置，请先在原工具中还原：'+name);
      if (!/\.(dll|asi|addon64)$/i.test(name) || ownedFile(file) || !fs.statSync(file).isFile()) continue;
      if (/^(?:rtx-encore|RTX-Unlocker|DLSSG-Transfusion|MFGUnlocker|renodx-(?:mfgunlock|dlss)|dlss5-feed)/i.test(name) ||
          pe.versionMentions(file,'RTX Encore'))
        throw fail('发现其他工具的渲染或补帧加载器，请先在原工具中还原：'+path.relative(bin,file));
    }
  }
  const items = [
    ...FG_FILES.map(name => ({...sourceFile(payloadDir,name.startsWith('nvngx')?'fg-modern':'sl-modern',name),name})),
    {...sourceFile(payloadDir,'sl-modern','THIRD_PARTY_NOTICES.md'),name:'NeuralFrame-Streamline-NOTICES.md'},
    {...sourceFile(payloadDir,'sl-modern','nvngx_dlss.license.txt'),name:'NeuralFrame-NVIDIA-LICENSE.txt'},
    {...sourceFile(payloadDir,'sl-modern','reflex.license.txt'),name:'NeuralFrame-Reflex-LICENSE.txt'},
  ];
  if (!engine.retained) items.unshift({source:engine.filePath,sha256:engine.sha256,name:proxy});
  const notice = full('RTX-Encore-NOTICES.md');
  if (engine.noticePath) items.push({source:engine.noticePath,sha256:digest(engine.noticePath),name:'RTX-Encore-NOTICES.md'});
  else if (!ownedFile(notice) || !fs.existsSync(notice)) {
    try { items.push({...sourceFile(payloadDir,'encore','THIRD-PARTY-NOTICES.md'),name:'RTX-Encore-NOTICES.md'}); }
    catch { throw Object.assign(fail('请先准备 Encore 配套组件以补齐原版许可说明。'),{code:'errRuntimeComponents',dependencies:['runtime:encore']}); }
  }
  if (settings.upscaling === 'dlss') items.push({...sourceFile(payloadDir,'sr-modern','nvngx_dlss.dll'),name:'nvngx_dlss.dll'});
  if (settings.neuralMode !== 'off') {
    if (!model?.filePath || !model.sha256 || digest(model.filePath) !== model.sha256) throw fail('Encore 神经模型未就绪或文件已变化，请重新预览。');
    if (!/^310\.(?:8\.0|9\.16)(?:\.0)?$/.test(model.version || '')) throw fail('当前 Encore 适配支持 310.8.0 / 310.9.16 神经模型。');
    items.push({source:model.filePath,sha256:model.sha256,name:'nvngx_dlssnr.dll'});
  }
  for (const item of items) check(full(item.name));
  const file = full(CONFIG); check(file);
  const profileText = options.profile?.[path.relative(gameDir,file)];
  const text = fs.existsSync(file) ? readConfig(file) : profileText || '{\n  // RTX Encore settings managed by NeuralFrame. Other fields are preserved.\n}\n';
  const hasNativeDlss = chosen.hasNativeDlss ?? routes.nativeDlssPresent(scan);
  const priorEngine = installedEngine(gameDir,previous);
  if (!engine.retained && priorEngine?.verified) {
    if (settings.neuralMode !== 'off' && priorEngine.capabilities.nrPassPlacement && !engine.capabilities.nrPassPlacement &&
        configFile.PASS_KEYS.some(key => settings[key] !== undefined && settings[key] !== 'inherit'))
      throw fail('所选 Encore 版本不支持当前逐遍处理位置。请保留当前版本，或先将逐遍位置改为继承全局。');
    if (settings.dlssRenderScale === 'custom' && settings.dlssCustomScale < engine.capabilities.dlssCustomScaleMin)
      throw fail(`所选 Encore 版本的 DLSS 自定义渲染比例最低为 ${engine.capabilities.dlssCustomScaleMin}%，请先调整比例。`);
  }
  const configured = configFile.configure(text,settings,hasNativeDlss,engine.capabilities);
  const manifest = apply.beginManifest(gameDir,exePath,api);
  manifest.route = 'encore';
  const files = {...owned};
  for (const item of items) {
    const dest = full(item.name);
    await apply.copyTracked(manifest,gameDir,item.source,dest,{kind:item.name===proxy?'proxy':'runtime',newVersion:item.name===proxy?engine.version:undefined});
    if (digest(dest) !== item.sha256) throw fail('Encore 配套文件与预览不一致：'+item.name);
    files[path.relative(gameDir,dest)] = item.sha256;
  }
  await apply.writeTracked(manifest,gameDir,file,configured,{kind:'config'});
  files[path.relative(gameDir,file)] = digest(file);
  manifest.encore = {version:engine.version,packageId:engine.packageId ?? null,
    recommended:!!engine.recommended,capabilities:engine.capabilities,proxy,files,updatedAt:new Date().toISOString()};
  manifest.neuralRendering = {...manifest.neuralRendering,mode:settings.neuralMode,
    ...(model ? {modelId:model.modelId || model.id,sha256:model.sha256,modelVersion:model.version} : {})};
  manifest.mfg = {backend:'encore',mode:settings.mfgMode,multiplier:settings.mfgMode==='off'?1:Number(settings.mfgMode.slice(1))};
  await apply.saveActiveManifest(gameDir,manifest);
  log({code:'encoreConfigured',params:{version:engine.version,file:proxy}});
  return manifest;
}
function checkPreview(gameDir, rows, kind) {
  if (!['component-update','component-rollback'].includes(kind)) return;
  const manifest = require('./backend-manager').readManifest(gameDir);
  if (manifest?.route !== 'encore') return;
  for (const row of rows) {
    if (row.scope !== 'game' || row.action === 'keep') continue;
    const expected = manifest.encore?.files?.[row.rel];
    if (expected && /\.(dll|asi)$/i.test(row.rel) && row.after?.sha256 !== expected)
      throw fail('Encore 配套组件由安装路线统一管理，请通过画质与补帧页修改：'+row.rel);
  }
}
module.exports = {VERSION,CONFIG,FG_FILES,PROXIES,sourceFile,assertTarget,assertOwnedFiles,installedEngine,inspect,install,checkPreview};
