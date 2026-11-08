'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const { finished } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const pe=require('./pe'),journal=require('./file-journal');
const {DEFINITIONS,builtins}=require('./component-definitions');
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

async function publishFile(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.promises.rename(source, destination);
    } catch (error) {
      // A Windows scanner can briefly hold a DLL even after our own read handle closes.
      if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error.code) || attempt >= 4) throw error;
      await delay(40 * (attempt + 1));
    }
  }
}
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw fail('组件记录损坏：'+path.basename(file));}}
function safe(root,rel){if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).some(p=>!p||p==='..'||p==='.'||/[:<>"|?*]/.test(p)))throw fail('无效的组件路径');return journal.safePath(root,rel);}
class ComponentLibrary {
  constructor(userData,{payloadDir,overlayDir}={}){this.userData=userData;this.root=path.join(userData,'component-library-v1');this.payloadDir=payloadDir;this.overlayDir=overlayDir;this.initialized=false;this.ready=null;}
  catalog(){const data=read(path.join(this.root,'catalog.json'),{schema:1,packages:[]});if(data.schema!==1||!Array.isArray(data.packages))throw fail('不支持的组件目录格式');return data;}
  async init(){if(this.initialized)return;if(this.ready)return this.ready;this.ready=(async()=>{
    const marker=path.join(this.root,'seed.json'),seed=read(marker,{});
    const candidates=this.payloadDir?builtins(this.payloadDir,this.overlayDir):[];
    const adaptedIds = new Set(this.catalog().packages.filter(p => p.trustedAdapter).map(p => p.id));
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
      if (seed[key]?.stamp === stamp && adaptedIds.has(seed[key].id)) continue;
      const installed = await this.importPackage(spec);
      seed[key] = { stamp, id: installed.id };
    }
    this.warnings=[];
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
  async verify(p){for(const f of p.files){const file=safe(this.directory(p),f.rel);if(!fs.existsSync(file)||await digest(file)!==f.sha256)throw fail('组件文件已变化或缺失，请重新下载：'+f.rel);}return p;}
  compatibility(p){const def=DEFINITIONS[p.component];if(def?.pinned)return {ready:false,label:'随汉化适配层维护',reason:'保留现有中文面板；不单独替换这个适配层。'};
    if(def?.managedRoute||['feeder','reshade','preloader','optiscaler'].includes(p.component))return {ready:false,label:'由安装路线成组管理',reason:'包含配套宿主、图层或加载链。可单独下载入库，应用仍使用现有安装路线的已适配组合。'};
    if(p.trustedAdapter||['dlss-sr','dlss-nr'].includes(p.component))return {ready:true,label:'可选择',reason:p.component==='dlss-nr'?'应用前还会检查实际 GPU 架构。':'文件校验通过，游戏内效果仍需验证。'};
    return {ready:false,label:'已入库 · 等待适配',reason:'此版本尚未验证现有汉化面板、配置协议或组件依赖；可以下载保留，暂不替换游戏中的组件。'};}
  async importPackage(spec, signal){
    signal?.throwIfAborted();
    const def=DEFINITIONS[spec.component];if(!def)throw fail('未知组件');
    if(!spec.files||!Object.keys(spec.files).length||Object.keys(spec.files).length>200)throw fail('无效的组件清单');
    const expected=def.files;
    if(expected.length&&expected.some(n=>!spec.files[n]))throw fail('组件包不完整，缺少配套文件');
    if(expected.length&&Object.keys(spec.files).some(n=>!expected.includes(n)))throw fail('组件包含未声明文件');
    const entries=[];
    for(const [rel,file] of Object.entries(spec.files).sort(([a],[b])=>a.localeCompare(b))){safe(this.root,rel);const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>512*1024*1024)throw fail('无效或过大的组件文件');
      const bits=pe.getBitness(file),binary=/\.(dll|asi|addon32|addon64|exe)$/i.test(rel);
      if(binary&&!bits)throw fail('不是有效的 Windows 二进制：'+rel);
      if(binary&&/32|winmm/i.test(rel)&&bits!==32)throw fail('需要 32 位组件：'+rel);
      if(binary&&!/32|winmm/i.test(rel)&&bits!==64)throw fail('需要 64 位组件：'+rel);
      if(spec.component==='dlss-nr'&&!require('./neural-models').inspectNeuralModelBinary(file).valid)throw fail('不是有效的神经渲染模型');
      if(spec.component==='dlss-fg'&&!require('./mfg-manager').inspectDlssgBinary(file).valid)throw fail('不是有效的 NVIDIA 帧生成运行库');
      if(spec.component==='dlss-sr'&&require('./neural-models').identifyNgxBuffer(fs.readFileSync(file)).kind!=='dlss_sr')throw fail('不是有效的 DLSS 超分运行库');
      entries.push({rel,sha256:await digest(file),size:st.size,version:binary?pe.getFileVersion(file):null,bitness:bits||null});
    }
    const id=hash(JSON.stringify([spec.component,entries.map(f=>[f.rel,f.sha256])])),catalog=this.catalog();
    const existing=catalog.packages.find(p=>p.id===id);
    const promoted = existing && !existing.trustedAdapter && spec.trustedAdapter === true
      ? { ...existing, trustedAdapter: true, version: String(spec.version || existing.version).slice(0,100), source: String(spec.source || '已适配组件缓存').slice(0,200) }
      : null;
    if(existing){
      let valid = true;
      try { await this.verify(existing); } catch { valid = false; }
      signal?.throwIfAborted();
      if (valid) {
        if (!promoted) return existing;
        // The catalog is the publication point. If it fails, seeding retries
        // on the next read, without copying or duplicating identical binaries.
        await journal.atomicJson(safe(this.directory(existing), 'package.json'), promoted);
        catalog.packages[catalog.packages.indexOf(existing)] = promoted;
        await journal.atomicJson(path.join(this.root, 'catalog.json'), catalog);
        return promoted;
      }
    }
    const temp=path.join(this.root,'staging',crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
    try{for(const f of entries){const dest=safe(temp,f.rel);await fs.promises.mkdir(path.dirname(dest),{recursive:true});await fs.promises.copyFile(spec.files[f.rel],dest);if(await digest(dest)!==f.sha256)throw fail('复制期间组件发生变化');}
      const p=existing?{...(promoted || existing),files:entries}:{id,component:spec.component,version:String(spec.version||entries[0]?.version||'手动导入').slice(0,100),files:entries,source:String(spec.source||'手动导入').slice(0,200),releaseUrl:spec.releaseUrl||null,archiveSha256:spec.archiveSha256||null,at:new Date().toISOString(),trustedAdapter:spec.trustedAdapter===true};
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
    const profile=this.profile(dir);profile.selected=clean;await journal.atomicJson(this.profileFile(dir),profile);return {ok:true};}
  async list(dir){await this.init();const packages=this.catalog().packages.map(p=>({...p,compatibility:this.compatibility(p),present:p.files.every(f=>{
    try {
      const stat = fs.statSync(safe(this.directory(p),f.rel));
      return stat.isFile() && (f.size == null || stat.size === f.size);
    } catch { return false; }
  })}));
    return {ok:true,root:this.root,definitions:DEFINITIONS,packages,warnings:this.warnings||[],profile:dir?this.profile(dir):null};}
  async apply(dir,selection,options){return require('./component-deploy').applySelection(this,dir,selection,options);}
  async rollback(dir,snapshotId){return require('./component-deploy').rollback(this,dir,snapshotId);}
}
module.exports={ComponentLibrary,digest,read,safe,hash,fail};
