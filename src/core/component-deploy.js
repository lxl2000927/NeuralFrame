'use strict';
const fs=require('./preview-fs').fs,path=require('path'),crypto=require('crypto');
const {AsyncLocalStorage}=require('async_hooks');
const context=new AsyncLocalStorage(),journal=require('./file-journal'),pe=require('./pe');
const {fail,safe}=require('./component-library');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
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
  const packages=await prepare(lib,selection),result=await context.run({lib,dir,packages},work);
  if(result?.ok===false)return result;
  // Installers can intentionally skip a same/newer bundled version. Explicit
  // library choices must still be honored, including a user-selected downgrade.
  // This pass only touches features the route left installed, never enables one.
  const applied=await applySelection(lib,dir,selection,{strict:false});
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
async function applySelection(lib,dir,selection,{strict=false}={}){
  const packages=await prepare(lib,selection),{scan,manifest,rows}=await targets(dir,packages);
  const missing=packages.filter(p=>!rows.some(r=>r.p.id===p.id));
  if(strict&&missing.length)throw fail('请先通过安装路线启用这些组件，再独立更新：'+missing.map(p=>p.component).join('、'));
  const changed=rows.filter(r=>digest(r.file)!==r.f.sha256);
  if(!changed.length)return{ok:true,changed:0,message:'已安装文件与所选版本一致。'};
  await require('./install-guards').assertGameClosed(dir,scan.chosen.path);
  return journal.transaction(dir,async()=>{
    const apply=require('./apply'),m=manifest||apply.beginManifest(dir,scan.chosen.path,scan.chosen.api||'dxgi');
    const revision={id:crypto.randomUUID(),at:new Date().toISOString(),files:[],previousSelection:m.componentSelection||{}};
    for(const [i,r] of changed.entries()){
      const rel=path.relative(dir,r.file),snapshot=`_DLSS5_Backup/component-revisions/${revision.id}/${i}.bin`,saved=journal.safePath(dir,snapshot);
      await journal.capture(dir,saved);await fs.promises.mkdir(path.dirname(saved),{recursive:true});await fs.promises.copyFile(r.file,saved);
      revision.files.push({rel,snapshot,sha256:digest(saved),after:r.f.sha256});
      await apply.copyTracked(m,dir,safe(lib.directory(r.p),r.f.rel),r.file,{kind:'component-library',newVersion:r.f.version});
    }
    m.componentHistory=[...(m.componentHistory||[]),revision];m.componentSelection=selection;
    await apply.saveActiveManifest(dir,m);return{ok:true,changed:changed.length,restartRequired:true};
  });
}
async function rollback(lib,dir,snapshotId){
  const manifest=require('./backend-manager').readManifest(dir),revision=manifest?.componentHistory?.at(-1);
  if(!revision||revision.id!==snapshotId)throw fail('回滚记录已变化，请刷新列表');
  for(const f of revision.files){
    if(!f.snapshot.startsWith(`_DLSS5_Backup/component-revisions/${revision.id}/`)||digest(journal.safePath(dir,f.snapshot))!==f.sha256)throw fail('上一版组件快照损坏或缺失');
    if(digest(journal.safePath(dir,f.rel))!==f.after)throw fail('游戏组件已被其他操作更改，不能覆盖；请先查看组件清单');
  }
  const exe=journal.safePath(dir,manifest.game.exe);await require('./install-guards').assertGameClosed(dir,exe);
  return journal.transaction(dir,async()=>{
    const apply=require('./apply');for(const f of revision.files)await apply.copyTracked(manifest,dir,journal.safePath(dir,f.snapshot),journal.safePath(dir,f.rel),{kind:'component-rollback'});
    manifest.componentHistory.pop();manifest.componentSelection=revision.previousSelection||{};await apply.saveActiveManifest(dir,manifest);
    return{ok:true,changed:revision.files.length,selection:manifest.componentSelection,restartRequired:true};
  });
}
module.exports={prepare,resolveSource,managed,applySelection,rollback};
