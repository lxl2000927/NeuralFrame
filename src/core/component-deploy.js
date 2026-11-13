'use strict';
const fs=require('./preview-fs').fs,path=require('path'),crypto=require('crypto');
const {AsyncLocalStorage}=require('async_hooks');
const context=new AsyncLocalStorage(),journal=require('./file-journal'),pe=require('./pe');
const {fail,safe}=require('./component-library');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function executableStamp(file) {
  try {
    const stat = fs.lstatSync(file);
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.isFile(), stat.isSymbolicLink()].join(':');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}
function resolveManagedSelection(lib, selected, request) {
  if ((request.requestedRoute === 'encore' || request.route === 'encore' || request.config?.route === 'encore') && Object.keys(selected).some(id => id !== 'dlss-nr'))
    throw fail('Encore 使用固定配套运行库，请先在组件与版本中清除其他组件的版本覆盖；原选择不会自动删除。');
  if (request.kind !== 'enhanced' || !selected['dlss-nr']) return { selection: selected, request };
  // The graphics installer owns its model, including every deep copy and the
  // manifest identity. Never let the generic component pass overwrite it later.
  const { 'dlss-nr': packageId, ...selection } = selected;
  const config = request.config || {};
  if (!config.neuralMode || config.neuralMode === 'off') return { selection, request };

  const models = require('./neural-models');
  const pkg = lib.package(packageId);
  const file = pkg.files.find(entry => entry.rel === 'nvngx_dlssnr.dll');
  if (pkg.component !== 'dlss-nr' || !file) throw fail('所选组件不包含神经渲染模型');
  const info = models.inspectNeuralModelBinary(safe(lib.directory(pkg), file.rel));
  if (!info.valid || info.sha256 !== file.sha256) throw fail('组件库中的神经渲染模型已变化或缺失，请重新导入');
  const id = models.normalizeModelId(config.neuralModelId);
  const matches = id ? models.matchesModelId(info, id) : config.neuralMode !== 'legacy' || info.knownModel?.role === 'legacy';
  if (!matches) {
    throw fail(`档位选择的神经模型（${id || config.neuralMode}）与此游戏在组件库中选择的模型（${info.modelId}）不同。请将两处设为同一模型，或在组件库清除此游戏的模型选择。`);
  }
  return {
    selection,
    request: { ...request, config: { ...config, neuralModelId: info.modelId, neuralModelSha256: info.sha256 } }
  };
}
function claimGraphicsModel(dir, config) {
  const owner = context.getStore();
  if (!owner || !same(owner.dir, dir) || !owner.selected['dlss-nr']) return config;
  const resolved = resolveManagedSelection(owner.lib, owner.selected, {kind:'enhanced',config});
  owner.packages = owner.packages.filter(pkg => pkg.component !== 'dlss-nr');
  owner.remaining = resolved.selection;
  return resolved.request.config;
}
async function prepare(lib,selection){
  const packages=[];
  for(const [component,id] of Object.entries(selection||{})){
    const p=lib.package(id);if(p.component!==component||!lib.compatibility(p).ready)throw fail('所选组件尚未适配');
    await lib.verify(p);
    if(component==='dlss-fg'&&!/^310\.9\.(0|1|16)\.0$/.test(p.files[0].version||''))throw fail('当前 MFG 适配层不支持这个帧生成运行库');
    if(component==='dlss-nr'){
      const models=require('./neural-models'),info=models.inspectNeuralModelBinary(safe(lib.directory(p),p.files[0].rel));
      const rows=await require('./install-guards').gpuInfo();
      if(!rows?.some(g=>models.evaluateModelGpuCompatibility(info,g.name,null).compatible))throw fail('神经模型与当前 GPU 架构不匹配，或无法读取显卡信息');
    }
    packages.push(p);
  }
  return packages;
}
function match(p,filename){const name=path.basename(filename).toLowerCase();return p.files.find(f=>f.rel.toLowerCase()===name||(p.component==='mfg-universal'&&name==='mfgunlocker.asi'));}
// Only the install call that owns this async context sees the selected versions.
// Configuration writes and the localized/F8 adapters keep their existing sources.
function resolveSource(gameDir,src,dest){const c=context.getStore();if(!c||!same(c.dir,gameDir)||/[_]DLSS5_Backup[\\/]/i.test(dest))return src;
  for(const p of c.packages){const f=match(p,dest);if(f&&pe.getBitness(src)===f.bitness)return safe(c.lib.directory(p),f.rel);}return src;
}
async function managed(lib,dir,selection,work){
  const owner = {lib, dir, packages:await prepare(lib,selection), selected:selection || {}, remaining:selection};
  const result = await context.run(owner,work);
  if(result?.ok===false)return result;
  // Installers can intentionally skip a same/newer bundled version. Explicit
  // library choices must still be honored, including a user-selected downgrade.
  // This pass only touches features the route left installed, never enables one.
  const applied=Object.keys(owner.remaining || {}).length
    ? await applySelection(lib,dir,owner.remaining,{strict:false}) : {ok:true,changed:0};
  return result&&typeof result==='object'?{...result,componentUpdate:applied}:result;
}
async function targets(dir,packages){
  const {scanGame}=require('./scan'),scan=await scanGame(dir),manifest=require('./backend-manager').readManifest(dir);
  if(!scan.chosen)throw fail('未找到游戏主程序');
  const files=new Set((scan.dlssFiles||[]).map(f=>f.path));
  for(const rel of [...(manifest?.added||[]),...(manifest?.replaced||[]).map(f=>f.rel)])files.add(journal.safePath(dir,rel));
  const base=path.dirname(scan.chosen.path);
  for(const folder of [base,path.join(base,'host64'),path.join(base,'OptiScaler/plugins')])if(fs.existsSync(folder))for(const name of fs.readdirSync(folder)){
    const file=path.join(folder,name);if(packages.some(p=>match(p,file)))files.add(journal.safePath(dir,path.relative(dir,file)));
  }
  const rows=[];
  for(const file of files)if(fs.existsSync(file)&&fs.statSync(file).isFile())for(const p of packages){const f=match(p,file);if(f&&pe.getBitness(file)===f.bitness)rows.push({file,p,f});}
  return{scan,manifest,rows};
}
function updateModelIdentity(dir, manifest, paths) {
  if (!manifest.neuralRendering || manifest.neuralRendering.mode === 'off') return false;
  const models = paths.filter(file => path.basename(file).toLowerCase() === 'nvngx_dlssnr.dll');
  if (!models.length) return false;
  const exe = journal.safePath(dir, manifest.game.exe);
  const exeDir = path.dirname(exe);
  const candidates = [pe.getBitness(exe) === 32 ? path.join(exeDir, 'host64', 'nvngx_dlssnr.dll') : null,
    path.join(exeDir, 'nvngx_dlssnr.dll'), ...models];
  const model = candidates.filter(Boolean).map(file => journal.safePath(dir, path.relative(dir, file))).find(file => fs.existsSync(file));
  const info = require('./neural-models').inspectNeuralModelBinary(model);
  const identity = {
    modelId: info.valid ? info.modelId : null, modelVersion: info.valid ? info.version : null,
    sha256: info.sha256 || null, architectures: info.architectures || []
  };
  const changed = Object.entries(identity).some(([key,value]) =>
    JSON.stringify(manifest.neuralRendering[key]) !== JSON.stringify(value));
  if (changed) Object.assign(manifest.neuralRendering, identity);
  return changed;
}
async function applySelection(lib,dir,selection,{strict=false,previousSelection}={}){
  const packages=await prepare(lib,selection),{scan,manifest,rows}=await targets(dir,packages);
  const missing=packages.filter(p=>!rows.some(r=>r.p.id===p.id));
  if(strict&&missing.length)throw fail('请先通过安装路线启用这些组件，再独立更新：'+missing.map(p=>p.component).join('、'));
  const exeBefore=executableStamp(scan.chosen.path),manifestBefore=JSON.stringify(manifest),observed=rows.map(r=>({...r,beforeHash:digest(r.file)}));
  const changed=observed.filter(r=>r.beforeHash!==r.f.sha256);
  const verifyInputs=()=>{
    if(executableStamp(scan.chosen.path)!==exeBefore)throw fail('游戏主程序已变化，请重新预览');
    if(JSON.stringify(require('./backend-manager').readManifest(dir))!==manifestBefore)throw fail('组件安装记录已变化，请重新预览');
    for(const r of observed)if(!fs.existsSync(r.file)||digest(r.file)!==r.beforeHash)throw fail('游戏组件已被其他操作更改，请重新预览');
    for(const r of changed){const source=safe(lib.directory(r.p),r.f.rel);if(!fs.existsSync(source)||digest(source)!==r.f.sha256)throw fail('组件文件已变化或缺失，请重新下载：'+r.f.rel);}
  };
  if(!changed.length){
    if (manifest && updateModelIdentity(dir, manifest, rows.map(row => row.file))) {
      await require('./install-guards').assertGameClosed(dir,scan.chosen.path);
      verifyInputs();
      await journal.transaction(dir, () => require('./apply').saveActiveManifest(dir,manifest));
    }
    return{ok:true,changed:0,message:'已安装文件与所选版本一致。'};
  }
  await require('./install-guards').assertGameClosed(dir,scan.chosen.path);
  // The process check is asynchronous; none of its preflight inputs may drift
  // before committing the already-reviewed component replacement.
  verifyInputs();
  return journal.transaction(dir,async()=>{
    const apply=require('./apply'),m=manifest||apply.beginManifest(dir,scan.chosen.path,scan.chosen.api||'dxgi');
    if (!manifest) m.componentOnlySince = m.date;
    const historyManifest = { date: m.date, game: m.game, route: 'component-library', replaced: [] };
    const revision={id:crypto.randomUUID(),at:new Date().toISOString(),files:[],previousSelection:previousSelection ?? m.componentSelection ?? {}};
    for(const [i,r] of changed.entries()){
      const rel=path.relative(dir,r.file),snapshot=`_DLSS5_Backup/component-revisions/${revision.id}/${i}.bin`,saved=journal.safePath(dir,snapshot);
      await journal.capture(dir,saved);await fs.promises.mkdir(path.dirname(saved),{recursive:true});await fs.promises.copyFile(r.file,saved);
      const beforeHash = digest(saved);
      revision.files.push({rel,snapshot,sha256:beforeHash,after:r.f.sha256});
      historyManifest.replaced.push({ rel, oldVersion: pe.getFileVersion(saved), newVersion: r.f.version, beforeHash, afterHash: r.f.sha256 });
      await apply.copyTracked(m,dir,safe(lib.directory(r.p),r.f.rel),r.file,{kind:'component-library',newVersion:r.f.version});
      if(digest(r.file)!==r.f.sha256)throw fail('复制期间组件发生变化，请重新下载：'+r.f.rel);
    }
    updateModelIdentity(dir, m, changed.map(row => row.file));
    m.componentHistory=[...(m.componentHistory||[]),revision];m.componentSelection=selection;
    await apply.saveActiveManifest(dir,m);return{ok:true,changed:changed.length,restartRequired:true,historyManifest};
  });
}
async function rollback(lib,dir,snapshotId){
  const manifest=require('./backend-manager').readManifest(dir),revision=manifest?.componentHistory?.at(-1);
  if(!revision||revision.id!==snapshotId)throw fail('回滚记录已变化，请刷新列表');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(revision.id) || !Array.isArray(revision.files) || !revision.files.length) throw fail('上一版组件快照损坏或缺失');
  const folder = `_DLSS5_Backup/component-revisions/${revision.id}`;
  const exe=journal.safePath(dir,manifest.game.exe),exeBefore=executableStamp(exe);
  await require('./install-guards').assertGameClosed(dir,exe);
  // Process enumeration can take time. Validate the rollback inputs after it
  // completes, so an external edit during that wait cannot be overwritten.
  if (executableStamp(exe) !== exeBefore) throw fail('游戏主程序已变化，请重新预览');
  if (JSON.stringify(require('./backend-manager').readManifest(dir)) !== JSON.stringify(manifest)) throw fail('回滚记录已变化，请刷新列表');
  for(const [i,f] of revision.files.entries()){
    if(!f || f.snapshot !== folder + '/' + i + '.bin') throw fail('上一版组件快照损坏或缺失');
    const saved = journal.safePath(dir, f.snapshot), target = journal.safePath(dir, f.rel);
    if(!fs.existsSync(saved) || digest(saved)!==f.sha256)throw fail('上一版组件快照损坏或缺失');
    if(!fs.existsSync(target) || digest(target)!==f.after)throw fail('游戏组件已被其他操作更改，不能覆盖；请先查看组件清单');
  }
  const result = await journal.transaction(dir,async()=>{
    const apply = require('./apply');
    const historyManifest = { date: manifest.date, game: manifest.game, route: 'component-library', replaced: [] };
    for (const f of revision.files) {
      const saved = journal.safePath(dir, f.snapshot), target = journal.safePath(dir, f.rel);
      const oldVersion = pe.getFileVersion(target), newVersion = pe.getFileVersion(saved);
      historyManifest.replaced.push({ rel: f.rel, oldVersion, newVersion, beforeHash: f.after, afterHash: f.sha256 });
      await apply.copyTracked(manifest, dir, saved, target, { kind: 'component-rollback', newVersion });
      if(digest(target)!==f.sha256)throw fail('复制期间回滚快照发生变化，已停止回滚');
      await journal.capture(dir, saved);
      await fs.promises.unlink(saved);
    }
    updateModelIdentity(dir, manifest, revision.files.map(row => journal.safePath(dir, row.rel)));
    manifest.componentHistory.pop();manifest.componentSelection=revision.previousSelection||{};await apply.saveActiveManifest(dir,manifest);
    return{ok:true,changed:revision.files.length,selection:manifest.componentSelection,restartRequired:true,historyManifest};
  });
  // Remove only an empty revision folder. User files and other revisions stay in place.
  try { await fs.promises.rmdir(journal.safePath(dir, folder)); } catch { /* An unused directory can remain. */ }
  return result;
}
module.exports={prepare,resolveSource,resolveManagedSelection,claimGraphicsModel,managed,applySelection,rollback};
