'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const { finished } = require('node:stream/promises');
const publishFile = require('./publish-file');
const pe=require('./pe'),journal=require('./file-journal');
const {DEFINITIONS,builtins,requiredPackageFiles}=require('./component-definitions');
const {componentCompatibility,modelRequirements}=require('./component-compatibility');
const key=p=>path.resolve(p).toLowerCase();
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fail=m=>Object.assign(Error(m),{code:'errComponentLibrary'});
async function digest(file) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file);
  const closed = finished(input, { cleanup: true });
  input.on('data', chunk => hash.update(chunk));
  await closed;
  return hash.digest('hex');
}

function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw fail('组件记录损坏：'+path.basename(file));}}
function safe(root,rel){if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).some(p=>!p||p==='..'||p==='.'||/[:<>"|?*]/.test(p)))throw fail('无效的组件路径');return journal.safePath(root,rel);}
function directoryBytes(directory) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) total += directoryBytes(file);
      else if (entry.isFile()) total += fs.lstatSync(file).size;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return total;
}
function installedPackageReferences(manifest) {
  const refs = [];
  for (const selection of [manifest.componentSelection,...(manifest.componentHistory || []).map(entry=>entry.previousSelection)]) {
    for (const [component,id] of Object.entries(selection || {})) refs.push({component,id});
  }
  if (manifest.route === 'encore' || (!manifest.route && manifest.mfg?.backend === 'encore')) {
    const engine = manifest.encore || {};
    const bin = path.posix.dirname(String(manifest.game?.exe || '').replace(/\\/g,'/'));
    const proxy = path.posix.join(bin,engine.proxy || 'version.dll').toLowerCase();
    const file = Object.entries(engine.files || {}).find(([rel])=>rel.replace(/\\/g,'/').toLowerCase()===proxy);
    refs.push({component:'encore',id:engine.packageId || manifest.encorePackageId,sha:file?.[1]});
  }
  if (manifest.route === 'wuwa-proxy' || (!manifest.route && manifest.mfg?.backend === 'wuwa-proxy')) {
    const loader = manifest.mfgLoader || {};
    refs.push({component:'mfg-universal',id:loader.packageId || manifest.mfg?.packageId || manifest.mfgPackageId,sha:loader.sha256 || manifest.mfg?.sha256});
  }
  if (manifest.neuralRendering?.sha256) refs.push({component:'dlss-nr',sha:manifest.neuralRendering.sha256});
  return refs;
}
class ComponentLibrary {
  constructor(userData,{payloadDir,overlayDir,gameDirectories=()=>[]}={}){this.userData=userData;this.root=path.join(userData,'component-library-v1');this.payloadDir=payloadDir;this.overlayDir=overlayDir;this.gameDirectories=gameDirectories;this.manifestRefs=new Map();this.initialized=false;this.ready=null;}
  catalog(){const data=read(path.join(this.root,'catalog.json'),{schema:1,packages:[]});if(data.schema!==1||!Array.isArray(data.packages))throw fail('不支持的组件目录格式');return data;}
  async init(){if(this.initialized)return;if(this.ready)return this.ready;this.ready=(async()=>{
    const marker=path.join(this.root,'seed.json'),seed=read(marker,{});
    this.warnings=[];
    const candidates=this.payloadDir?builtins(this.payloadDir,this.overlayDir):[];
    const adapted = new Map(this.catalog().packages.filter(p => p.trustedAdapter).map(p => [p.id, p]));
    // Only seed on explicit library use. An app update appends new snapshots;
    // it never overwrites existing packages or game selections.
    for (const spec of candidates) {
      const key = spec.component + spec.version;
      const stamp = hash(JSON.stringify(Object.entries(spec.files).map(([name, file]) => {
        const stat = fs.statSync(file);
        return [name, file, stat.size, stat.mtimeMs];
      })));
      // Older seed records only held the stamp, even if a manual import had
      // won deduplication. Reconcile those records once against the actual bytes.
      const cached = adapted.get(seed[key]?.id);
      // The runtime view and library snapshot are separate copies. An intact
      // runtime cache must not conceal a deleted or changed library file.
      // Remember verified metadata so normal startup does not rehash every DLL.
      const localStamp = cached && this.cacheStamp(cached);
      if (seed[key]?.stamp === stamp && localStamp && seed[key].localStamp === localStamp) continue;
      let installed;
      try { installed = await this.importPackage(spec); }
      catch (error) {
        if (!error.noticeMismatch) throw error;
        this.warnings.push(error.message); continue;
      }
      seed[key] = { stamp, id: installed.id, localStamp: this.cacheStamp(installed) };
    }
    await this.importLegacyModels();
    await journal.atomicJson(marker,seed);this.initialized=true;
  })();try{await this.ready;}finally{this.ready=null;}}
  async importLegacyModels() {
    let rows;
    try {
      rows = read(path.join(this.userData, 'neural-models', 'index.json'), []);
      if (!Array.isArray(rows)) throw fail('index.json');
    } catch {
      this.warnings.push('旧模型索引无法读取，可从原 DLL 重新导入。');
      return;
    }
    for (const row of rows) {
      if (typeof row?.filePath !== 'string' || !path.isAbsolute(row.filePath)) {
        if (!this.warnings.includes('旧模型索引含无效路径。')) this.warnings.push('旧模型索引含无效路径。');
        continue;
      }
      try {
        await this.importPackage({component:'dlss-nr', version:row.version, files:{'nvngx_dlssnr.dll':row.filePath}, source:'从旧模型库迁入'});
      } catch {
        this.warnings.push('旧模型未迁入：' + row.filePath);
      }
    }
  }
  package(id){if(!/^[a-f0-9]{64}$/.test(String(id)))throw fail('无效的组件版本');const p=this.catalog().packages.find(p=>p.id===id);if(!p||!DEFINITIONS[p.component])throw fail('组件版本不存在');return p;}
  directory(p){return safe(path.join(this.root,'packages'),p.id);}
  cacheStamp(p){
    try {
      return hash(JSON.stringify(p.files.map(f => {
        const stat = fs.lstatSync(safe(this.directory(p), f.rel));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== f.size) throw fail('组件缓存已变化');
        return [f.rel, f.sha256, stat.size, stat.mtimeMs, stat.ctimeMs];
      })));
    } catch { return null; }
  }
  async verify(p){for(const f of p.files){const file=safe(this.directory(p),f.rel);if(!fs.existsSync(file)||await digest(file)!==f.sha256)throw fail('组件文件已变化或缺失，请重新下载：'+f.rel);}return p;}
  compatibility(p){return componentCompatibility(p);}
  importPackage(spec, signal){
    // First-use seeding can overlap a manual import already in flight. Each
    // publication reads and replaces the catalog, so keep these writes ordered.
    const pending = (this.importPending || Promise.resolve()).then(() => this.importOnePackage(spec, signal));
    this.importPending = pending.catch(() => {});
    return pending;
  }
  async importOnePackage(spec, signal){
    signal?.throwIfAborted();
    const def=DEFINITIONS[spec.component];if(!def)throw fail('未知组件');
    if(!spec.files||!Object.keys(spec.files).length||Object.keys(spec.files).length>200)throw fail('无效的组件清单');
    const expected=requiredPackageFiles(spec.component,Object.keys(spec.files));
    if(expected.length&&expected.some(n=>!spec.files[n]))throw fail('组件包不完整，缺少配套文件');
    if(expected.length&&Object.keys(spec.files).some(n=>!expected.includes(n)&&!def.optionalFiles?.includes(n)))throw fail('组件包含未声明文件');
    const entries=[];
    for(const [rel,file] of Object.entries(spec.files).sort(([a],[b])=>a.localeCompare(b))){safe(this.root,rel);const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>512*1024*1024)throw fail('无效或过大的组件文件');
      const binary=/\.(dll|asi|addon32|addon64|exe)$/i.test(rel);
      const bits=pe.getBitness(file,{dllOnly:binary&&!/\.exe$/i.test(rel)});
      if(binary&&!bits)throw fail('不是有效的 Windows 二进制：'+rel);
      if(binary&&/32|winmm/i.test(rel)&&bits!==32)throw fail('需要 32 位组件：'+rel);
      if(binary&&!/32|winmm/i.test(rel)&&bits!==64)throw fail('需要 64 位组件：'+rel);
      if(spec.component==='dlss-nr'&&!require('./neural-models').inspectNeuralModelBinary(file).valid)throw fail('不是有效的神经渲染模型');
      if(spec.component==='dlss-fg'&&!require('./mfg-manager').inspectDlssgBinary(file).valid)throw fail('不是有效的 NVIDIA 帧生成运行库');
      if(spec.component==='dlss-sr'&&require('./neural-models').identifyNgxBuffer(fs.readFileSync(file)).kind!=='dlss_sr')throw fail('不是有效的 DLSS 超分运行库');
      entries.push({rel,sha256:await digest(file),size:st.size,version:binary?pe.getFileVersion(file):null,bitness:bits||null});
    }
    const describeEngine=spec.component==='encore' ? files=>require('./engine-packages').describe('encore',{files}) : null;
    const assessed=describeEngine?.(entries);
    if (assessed?.noticeMismatch) throw Object.assign(fail(assessed.reason),{noticeMismatch:true});
    // Adding the upstream notice to an existing engine does not create a
    // second engine identity or invalidate saved game package selections.
    const identityEntries=entries.filter(f=>!def.optionalFiles?.includes(f.rel));
    const id=hash(JSON.stringify([spec.component,identityEntries.map(f=>[f.rel,f.sha256])])),catalog=this.catalog();
    const existing=catalog.packages.find(p=>p.id===id);
    let updated = existing && !existing.trustedAdapter && spec.trustedAdapter === true
      ? { ...existing, trustedAdapter: true, version: String(spec.version || existing.version).slice(0,100), source: String(spec.source || '已适配组件缓存').slice(0,200) }
      : null;
    if(existing){
      if (spec.archiveSha256 && spec.archiveSha256 !== existing.archiveSha256 &&
          !existing.releaseArchives?.some(a => a.sha256 === spec.archiveSha256)) {
        const archive = {sha256:spec.archiveSha256, releaseUrl:spec.releaseUrl || null};
        updated = {...(updated || existing), releaseArchives:[...(existing.releaseArchives || []), archive]};
      }
      let valid = !describeEngine?.(existing.files).noticeMismatch;
      try { await this.verify(existing); } catch { valid = false; }
      if(entries.some(f=>def.optionalFiles?.includes(f.rel)&&!existing.files.some(old=>old.rel===f.rel&&old.sha256===f.sha256)))valid=false;
      signal?.throwIfAborted();
      if (valid) {
        if (!updated) return existing;
        // The catalog is the publication point. If it fails, seeding retries
        // on the next read, without copying or duplicating identical binaries.
        await journal.atomicJson(safe(this.directory(existing), 'package.json'), updated);
        catalog.packages[catalog.packages.indexOf(existing)] = updated;
        await journal.atomicJson(path.join(this.root, 'catalog.json'), catalog);
        return updated;
      }
    }
    const retained=[];
    for (const file of existing?.files || []) {
      if (!def.optionalFiles?.includes(file.rel) || entries.some(f=>f.rel===file.rel) || describeEngine?.([...entries,file]).noticeMismatch) continue;
      const previous=safe(this.directory(existing),file.rel);
      if (fs.existsSync(previous) && await digest(previous)===file.sha256) retained.push(file);
    }
    const temp=path.join(this.root,'staging',crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
    try{for(const f of entries){const dest=safe(temp,f.rel);await fs.promises.mkdir(path.dirname(dest),{recursive:true});await fs.promises.copyFile(spec.files[f.rel],dest);if(await digest(dest)!==f.sha256)throw fail('复制期间组件发生变化');}
      const p=existing?{...(updated || existing),files:[...entries,...retained]}:{id,component:spec.component,version:String(spec.version||entries[0]?.version||'手动导入').slice(0,100),files:entries,source:String(spec.source||'手动导入').slice(0,200),releaseUrl:spec.releaseUrl||null,archiveSha256:spec.archiveSha256||null,at:new Date().toISOString(),trustedAdapter:spec.trustedAdapter===true};
      await journal.atomicJson(path.join(temp,'package.json'),p);
      const dest=this.directory(p);await fs.promises.mkdir(path.dirname(dest),{recursive:true});
      // Publication cannot be interrupted once the first file has been committed.
      signal?.throwIfAborted();
      if(fs.existsSync(dest)){
        for(const f of entries){const target=safe(dest,f.rel);await fs.promises.mkdir(path.dirname(target),{recursive:true});await publishFile(safe(temp,f.rel),target);}
        await publishFile(path.join(temp,'package.json'),safe(dest,'package.json'));
      }else await fs.promises.rename(temp,dest);
      if(existing)catalog.packages[catalog.packages.indexOf(existing)]=p;else catalog.packages.push(p);
      await journal.atomicJson(path.join(this.root,'catalog.json'),catalog);return p;
    }finally{await fs.promises.rm(temp,{recursive:true,force:true});}
  }
  profileFile(dir){if(typeof dir!=='string'||!path.isAbsolute(dir)||!fs.existsSync(dir))throw fail('无效的游戏目录');return path.join(this.root,'games',hash(key(dir))+'.json');}
  profile(dir){const p=read(this.profileFile(dir),{schema:1,dir:path.resolve(dir),selected:{},history:[]});if(p.schema!==1||key(p.dir)!==key(dir)||!p.selected||!Array.isArray(p.history))throw fail('游戏组件选择记录损坏');return p;}
  async select(dir,selection){if(!selection||typeof selection!=='object'||Array.isArray(selection))throw fail('无效的版本选择');const clean={};for(const [component,id] of Object.entries(selection)){if(!id)continue;const p=this.package(id);if(p.component!==component||!this.compatibility(p).ready)throw fail('所选版本尚未适配：'+(DEFINITIONS[component]?.name||component));await this.verify(p);clean[component]=id;}
    const profile=this.profile(dir);profile.selected=clean;await journal.atomicJson(this.profileFile(dir),profile);
    const catalog=this.catalog(),used=new Set(Object.values(clean));let changed=false;
    for(const p of catalog.packages)if(used.has(p.id)){p.lastUsedAt=new Date().toISOString();changed=true;}
    if(changed)await journal.atomicJson(path.join(this.root,'catalog.json'),catalog);
    return {ok:true};}
  referencedPackages(packages) {
    const known = new Set(packages.map(p => p.id)), referenced = new Set(), uncertain = new Set();
    const dirs = new Set();
    const directory = path.join(this.root, 'games');
    let files;
    try { files = fs.readdirSync(directory, {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') files=[]; else throw error; }
    const collect = value => {
      if (typeof value === 'string') { if (known.has(value)) referenced.add(value); return; }
      if (!value || typeof value !== 'object') return;
      for (const child of Object.values(value)) collect(child);
    };
    for (const file of files) {
      if (!file.isFile() || !/^[a-f0-9]{64}\.json$/i.test(file.name)) continue;
      try {
        const profile=JSON.parse(fs.readFileSync(path.join(directory,file.name),'utf8'));
        collect(profile);
        if (typeof profile.dir==='string' && path.isAbsolute(profile.dir)) dirs.add(profile.dir);
      }
      catch {
        // Damaged evidence must fail closed: keep every package rather than
        // guessing which game selection or rollback record still references it.
        return {referenced,uncertain:known};
      }
    }
    const engineFile = {encore:'rtx-encore.dll','mfg-universal':'mfgunlocker.dll','dlss-nr':'nvngx_dlssnr.dll'};
    if (!packages.length) return {referenced,uncertain};
    const byIdentity=new Map(),byDigest=new Map();
    for (const p of packages) {
      byIdentity.set(p.component+':'+p.id,p.id);
      const file=p.files.find(f=>f.rel.toLowerCase()===engineFile[p.component]);
      if (file) byDigest.set(p.component+':'+file.sha256,p.id);
    }
    const mark=(refs,destination)=>{
      for (const ref of refs) {
        const id=byIdentity.get(ref.component+':'+ref.id) || byDigest.get(ref.component+':'+ref.sha);
        if (id) destination.add(id);
      }
    };
    let unreadableGames=false;
    try { for (const dir of this.gameDirectories()) if (typeof dir==='string' && path.isAbsolute(dir)) dirs.add(dir); }
    catch { unreadableGames=true; }
    const volumes=new Map();
    for (const dir of dirs) {
      const file=path.join(require('./apply').backupRoot(dir),'manifest.json');
      try {
        const stat=fs.lstatSync(file,{throwIfNoEntry:false});
        let stored=this.manifestRefs.get(file);
        if (!stat) {
          if (!stored) {
            // On first startup a missing receipt on a disconnected drive says
            // nothing about its packages. Probe each volume once per cleanup.
            const volume=path.parse(dir).root;
            if (!volumes.has(volume)) volumes.set(volume,!!fs.statSync(volume,{throwIfNoEntry:false}));
            if (!volumes.get(volume)) unreadableGames=true;
            continue;
          }
          if (!fs.statSync(dir,{throwIfNoEntry:false})) mark(stored.refs,uncertain);
          else this.manifestRefs.delete(file);
          continue;
        }
        const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
        if (!stored || stored.stamp!==stamp) {
          const manifest=require('./backend-manager').readManifest(dir);
          if (!manifest) { this.manifestRefs.delete(file); continue; }
          stored={stamp,refs:installedPackageReferences(manifest)};
          if (this.manifestRefs.size>=512) this.manifestRefs.delete(this.manifestRefs.keys().next().value);
          this.manifestRefs.set(file,stored);
        }
        mark(stored.refs,referenced);
      } catch {
        // Unreadable receipts can also contain component selections needed for rollback.
        unreadableGames=true;
      }
    }
    return {referenced,uncertain:unreadableGames ? known : uncertain};
  }
  cacheInfo() {
    const packages = this.catalog().packages, {referenced,uncertain} = this.referencedPackages(packages);
    const rows = packages.map(p => {
      const size = p.files.reduce((sum, file) => sum + (file.size || 0), 0);
      const selected = referenced.has(p.id), bundled = p.trustedAdapter === true;
      const redownloadable = !!(p.archiveSha256 || p.releaseArchives?.length);
      return {id:p.id, component:p.component, version:p.version, source:p.source, at:p.at || null,lastUsedAt:p.lastUsedAt || null,
        size, selected, bundled, redownloadable,
        removable:!selected && !bundled && redownloadable && !uncertain.has(p.id),
        protectedReason:selected ? '游戏选择或历史记录正在引用' : bundled ? '随软件维护的内置适配组件' : uncertain.has(p.id) ? '部分游戏安装或版本选择记录无法读取' : redownloadable ? '' : '手动导入组件需要原文件才能恢复'};
    });
    const partialBytes = directoryBytes(path.join(this.root, 'partial-downloads')) +
      directoryBytes(path.join(this.root, 'downloads')) + directoryBytes(path.join(this.root, 'staging'));
    return {packages:rows, totalBytes:rows.reduce((sum, row) => sum + row.size, partialBytes),
      removableBytes:rows.filter(row => row.removable).reduce((sum, row) => sum + row.size, 0) + partialBytes,
      partialBytes};
  }
  async cleanCache({component='',olderThanDays=0}={}) {
    const cutoff=Number(olderThanDays)>0?Date.now()-Number(olderThanDays)*86400000:0;
    const before = this.cacheInfo(), removed = before.packages.filter(row => row.removable &&
      (!component || row.component===component) && (!cutoff || Date.parse(row.lastUsedAt || row.at || 0) < cutoff));
    const includeTemporary=!component&&!cutoff;
    const trash = path.join(this.root, 'cleanup-' + crypto.randomUUID());
    await fs.promises.mkdir(trash, {recursive:true});
    const moved = [];
    let committed = false;
    try {
      for (const row of removed) {
        const p = this.package(row.id), source = this.directory(p);
        if (!fs.existsSync(source)) continue;
        await fs.promises.rename(source, path.join(trash, row.id));
        moved.push({id:row.id, source});
      }
      const catalog = this.catalog();
      catalog.packages = catalog.packages.filter(p => !removed.some(row => row.id === p.id));
      await journal.atomicJson(path.join(this.root, 'catalog.json'), catalog);
      committed = true;
    } catch (error) {
      if (!committed) for (const row of moved.reverse()) {
        if (fs.existsSync(path.join(trash, row.id))) await fs.promises.rename(path.join(trash, row.id), row.source);
      }
      throw error;
    }
    let warning = '';
    try {
      const directories=[trash];if(includeTemporary)directories.push(path.join(this.root,'partial-downloads'),path.join(this.root,'downloads'),path.join(this.root,'staging'));
      await Promise.all(directories.map(directory => fs.promises.rm(directory, {recursive:true,force:true})));
    } catch { warning = '组件记录已更新，部分临时文件稍后重试清理。'; }
    return {ok:true, removedPackages:removed.length, removedBytes:removed.reduce((sum,row)=>sum+row.size,0)+(includeTemporary?before.partialBytes:0),
      warning, cache:this.cacheInfo()};
  }
  async list(dir){await this.init();const packages=this.catalog().packages.map(p=>({...p,compatibility:this.compatibility(p),engine:['encore','mfg-universal'].includes(p.component)?require('./engine-packages').describe(p.component,p):undefined,modelRequirements:modelRequirements(p),present:p.files.every(f=>{
    try {
      const stat = fs.statSync(safe(this.directory(p),f.rel));
      return stat.isFile() && (f.size == null || stat.size === f.size);
    } catch { return false; }
  })}));
    return {ok:true,root:this.root,definitions:DEFINITIONS,packages,warnings:this.warnings||[],profile:dir?this.profile(dir):null,cache:this.cacheInfo()};}
  async apply(dir,selection,options){return require('./component-deploy').applySelection(this,dir,selection,options);}
  async rollback(dir,snapshotId){return require('./component-deploy').rollback(this,dir,snapshotId);}
}
module.exports={ComponentLibrary,digest,read,safe,hash,fail};
