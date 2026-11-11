'use strict';
// Pinned route dependencies are separate from optional upstream version updates.
// Browsing/status reads never download. Only explicit preparation writes cache;
// existing transaction previews and version locks remain responsible for games.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { digest, safe } = require('./component-library');
const { downloadAsset, sweepPartials } = require('./asset-download');
const { unpack, allowedAsset } = require('./component-updates');
const catalog = require('./runtime-catalog.json');
const error = message => Object.assign(new Error(message), {code:'errRuntimeComponents'});
const nonempty = value => value !== undefined && value !== 'off';

function requiredPacks({kind, config = {}, route, mfgRoute, target = {}, scan = {}, customModel = false, reuseProxy = false} = {}) {
  if (kind === 'restore') return [];
  const ids = new Set();
  if (route === 'wuwa-proxy') {
    if (!reuseProxy) ids.add('mfg-universal');
    if (nonempty(config.neuralMode) && !customModel) ids.add('nr-3108');
    return [...ids];
  }
  const modern = config.runtimeStack === 'oct2026-310.9.16' || (!config.runtimeStack && config.hardwareProfile === 'rtx50_desktop');
  const stack = modern ? 'modern' : 'baseline';
  const nr = kind === 'install' || nonempty(config.neuralMode);
  const mfg = kind === 'enhanced' && nonempty(config.mfgMode) && target.bitness !== 32 && ['dxgi','vulkan'].includes(target.api || 'dxgi') && !['DirectX 10','DirectX 11'].includes(target.apiLabel);
  if(nr || mfg) ids.add('localization');
  if (nr) {
    if (!customModel) ids.add('nr-3108');
    if (route !== 'optiscaler') { ids.add('sr-'+stack); ids.add('sl-'+stack); ids.add('renodx-nr'); ids.add('reshade'); }
    if (route === 'feeder' || route === 'renodx') {
      ids.add('feeder'); ids.add('fg-'+stack);
      // Feeder's initial host bootstrap uses scanSource's baseline directory;
      // the selected newer stack is applied by the model installer afterwards.
      ids.add('sr-baseline'); ids.add('sl-baseline'); ids.add('fg-baseline');
    }
    if (route === 'renodx') ids.add('renodx-multipass');
    if (route !== 'optiscaler' && (scan.dlssFiles || []).some(f => /nvngx_dlssd\.dll$/i.test(f.name || f.path || ''))) ids.add('rr-baseline');
    // Native route deployments also carry the matching FG provider when the
    // game already uses it; NR-only games don't need that extra download.
    if (kind === 'install' && route !== 'optiscaler' && (scan.dlssFiles || []).some(f => /nvngx_dlssg\.dll$/i.test(f.name || f.path || ''))) ids.add('fg-'+stack);
  }
  if (mfg) {
    const opti = config.backend === 'mfg-unlocker-asi' || (config.backend !== 'renodx-mfgunlock' && (mfgRoute || route) === 'optiscaler');
    ids.add(opti ? 'mfg-universal' : 'mfg-renodx');
    // Adding RenoDX can change the auto backend in an existing OptiScaler-INI
    // setup. Keep both small unlockers available for that mixed transition.
    if(opti && nr && route !== 'optiscaler')ids.add('mfg-renodx');
    ids.add('fg-modern'); // The adapted unlocker currently deploys 310.9.16.
    if (!opti) ids.add('reshade');
  }
  return [...ids];
}

class RuntimePayload {
  constructor(userData, {manifest = catalog, bundledRoot, legacyRoots = [], fetcher = globalThis.fetch, onProgress = () => {}} = {}) {
    this.userData = path.resolve(userData);
    this.root = path.join(this.userData,'component-library-v1','runtime');
    this.catalog = manifest; this.bundledRoot = bundledRoot; this.legacyRoots = legacyRoots;
    this.fetcher = fetcher; this.onProgress = onProgress; this.controller = null;
    this.proofs = new Map();
    if (manifest.schema !== 1 || !Array.isArray(manifest.packs)) throw error('无效的组件清单');
    this.packs = new Map(manifest.packs.map(p => [p.id,p]));
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(manifest.packs.map(p=>[p.id,p.contentId]))).digest('hex').slice(0,20);
    this.payloadDir = path.join(this.root,'views',fingerprint);
    for (const p of manifest.packs) {
      if (!/^[a-z0-9-]+$/.test(p.id) || !/^[a-f0-9]{64}$/.test(p.contentId) || !p.files?.length) throw error('无效的组件标识');
      for (const f of p.files) { safe(this.payloadDir,f.path); if (!/^[a-f0-9]{64}$/.test(f.sha256) || !(f.size > 0)) throw error('无效的组件文件'); }
      if (!p.bundled && (!allowedAsset(p.url,manifest.repository) || !/^[a-f0-9]{64}$/.test(p.sha256) || !(p.size > 0 && p.size <= 512*1024*1024))) throw error('组件下载地址或校验值无效');
    }
  }
  pack(id) { const p=this.packs.get(id); if (!p) throw error('未知的配套组件：'+id); return p; }
  directory(p) { return safe(this.root,'packs/'+p.contentId); }
  async valid(file, f) {
    try {
      const s=await fs.promises.lstat(file);
      if (!s.isFile() || s.isSymbolicLink() || s.size !== f.size) return false;
      const stamp=`${f.sha256}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      if (this.proofs.get(file)===stamp) return true;
      if (await digest(file)!==f.sha256) return false;
      this.proofs.set(file,stamp); return true;
    } catch { return false; }
  }
  async complete(base,p) { for(const f of p.files) if(!await this.valid(safe(base,f.path),f)) return false; return true; }
  list() {
    return [...this.packs.values()].filter(p=>!p.bundled).map(p=>({id:p.id,name:p.name,component:p.component,version:p.version,size:p.size,downloaded:p.files.every(f=>{try{const s=fs.lstatSync(safe(this.payloadDir,f.path));return s.isFile()&&!s.isSymbolicLink()&&s.size===f.size;}catch{return false;}})}));
  }
  async require(ids) {
    const missing=[];
    for(const id of new Set(ids)) { const p=this.pack(id); if(!await this.complete(this.payloadDir,p)) missing.push(p); }
    if(missing.length) throw Object.assign(error('首次使用需要准备配套组件；只写入管理器缓存，下载校验完成后再预览游戏文件变更。'),{
      dependencies:missing.map(p=>'runtime:'+p.id),
      downloads:missing.filter(p=>!p.bundled).map(p=>({name:p.name,size:p.size}))
    });
  }
  cancel() { this.controller?.abort(); return {ok:true}; }
  async localCandidates() {
    const index = new Map();
    // Existing component versions are reusable by fingerprint, never selected
    // merely because a file happens to have the same name.
    try {
      const root=path.join(this.userData,'component-library-v1');
      const old=JSON.parse(await fs.promises.readFile(path.join(root,'catalog.json'),'utf8'));
      for(const p of old.packages||[]) if(/^[a-f0-9]{64}$/.test(p.id)) for(const f of p.files||[]) if(/^[a-f0-9]{64}$/.test(f.sha256)) {
        try { index.set(f.sha256,safe(path.join(root,'packages',p.id),f.rel)); } catch { /* ignore invalid migration records */ }
      }
    } catch { /* An empty profile has no component catalogue. */ }
    try { const old=JSON.parse(await fs.promises.readFile(path.join(this.userData,'neural-models/index.json'),'utf8'));
      for(const f of old) if(/^[a-f0-9]{64}$/.test(f.sha256)&&path.isAbsolute(f.filePath||'')) index.set(f.sha256,f.filePath);
    } catch {}
    const original=this.packs.get('nr-3108')?.files.find(f=>/nvngx_dlssnr\.dll$/.test(f.path));
    if(original&&!index.has(original.sha256))index.set(original.sha256,path.join(this.userData,'neural-models/bundled-310.8.SF-v2.dll'));
    return index;
  }
  checkCancelled() { if(this.controller?.signal.aborted) throw error('组件下载已取消，游戏文件未修改。'); }
  async copy(source,dest) {
    await fs.promises.mkdir(path.dirname(dest),{recursive:true});
    // Never hard-link to a user-owned source: later changes to that source must
    // not silently alter a validated cache or an older game's rollback source.
    await fs.promises.copyFile(source,dest);
  }
  async obtain(p,index,temp,position={}) {
    const tag={id:p.id,name:p.name,index:position.index,count:position.count};
    let local=true;
    for(const f of p.files) {
      this.checkCancelled();
      const candidates=[index.get(f.sha256),...([this.bundledRoot,...this.legacyRoots].filter(Boolean).map(r=>safe(r,f.path)))].filter(Boolean);
      let found;
      for(const file of candidates) if(await this.valid(file,f)) {found=file;break;}
      if(!found) {local=false;break;}
      await this.copy(found,safe(temp,f.path));
    }
    if(local) return;
    if(p.bundled) throw error('中文适配组件不完整，请重新下载管理器。');
    const archive = safe(temp,'__archive.zip');
    try {
      await downloadAsset(p, {
        cacheRoot: this.root, destination: archive, fetcher: this.fetcher, signal: this.controller.signal,
        // Stopping a transfer is a decision, not an accident: no partial
        // ranges and no staging archive may outlive it.
        purgeOnAbort: true,
        onProgress: loaded => this.onProgress({stage:'download',...tag,loaded,total:p.size})
      });
    } catch (cause) { throw error(`无法下载 ${p.name}：${cause.message}`); }
    this.checkCancelled();this.onProgress({stage:'verify',...tag,loaded:p.size,total:p.size});
    const extracted=safe(temp,'__unpacked');await fs.promises.mkdir(extracted);await unpack(archive,extracted,this.controller.signal);
    if(!await this.complete(extracted,p))throw error('组件压缩包内容与固定清单不一致');
    for(const f of p.files) await this.copy(safe(extracted,f.path),safe(temp,f.path));
    await fs.promises.rm(archive,{force:true});await fs.promises.rm(extracted,{recursive:true,force:true});
  }
  async prepare(ids) {
    if(this.controller)throw error('组件准备正在进行');
    const packs=[...new Set(ids)].map(id=>this.pack(id));
    this.controller=new AbortController();
    try {
      await this.sweepStale();
      const index=await this.localCandidates();
      for(const [position,p] of packs.entries()) {
        const at={index:position+1,count:packs.length};
        this.checkCancelled();
        this.onProgress({stage:'verify',id:p.id,name:p.name,loaded:0,total:p.size||0,...at});
        const ready=await this.complete(this.payloadDir,p);
        this.checkCancelled();
        if(ready)continue;
        const stored=this.directory(p);
        if(!await this.complete(stored,p)) {
          const temp=safe(this.root,'staging/'+crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
          try {
            this.onProgress({stage:'prepare',id:p.id,name:p.name,loaded:0,total:p.size||0,...at});
            await this.obtain(p,index,temp,at);this.checkCancelled();
            if(!await this.complete(temp,p))throw error('组件缓存校验失败');
            await fs.promises.mkdir(stored,{recursive:true});
            for(const f of p.files) {const dest=safe(stored,f.path);await fs.promises.mkdir(path.dirname(dest),{recursive:true});await fs.promises.rename(safe(temp,f.path),dest);}
          } finally {await fs.promises.rm(temp,{recursive:true,force:true});}
        }
        for(const f of p.files) {
          const source=safe(stored,f.path),dest=safe(this.payloadDir,f.path);
          if(await this.valid(dest,f))continue;
          await fs.promises.mkdir(path.dirname(dest),{recursive:true});
          const pending=dest+'.'+crypto.randomUUID()+'.pending';
          try {try{await fs.promises.link(source,pending);}catch{await fs.promises.copyFile(source,pending);}await fs.promises.rename(pending,dest);}
          finally {await fs.promises.rm(pending,{force:true});}
        }
        this.onProgress({stage:'ready',id:p.id,name:p.name,loaded:p.size||0,total:p.size||0,...at});
      }
      return {ok:true};
    } catch(e) {
      // A cancellation is a normal outcome the caller reports in place, not a
      // failure that has to reach the person as an error string.
      if(this.controller.signal.aborted) return {ok:false,cancelled:true,message:'组件下载已取消，游戏文件未修改。'};
      throw e;
    }
    finally {
      this.controller=null;
      // The parent is only a container; leaving an empty one behind invites
      // the next crash to look like a leak.
      await fs.promises.rmdir(safe(this.root,'staging')).catch(()=>{});
    }
  }
  // staging/ only exists for the run that created it, and partial ranges are
  // reusable for a day. Anything older is the remains of a killed process.
  async sweepStale() {
    await fs.promises.rm(safe(this.root,'staging'),{recursive:true,force:true}).catch(()=>{});
    await sweepPartials(this.root).catch(()=>{});
  }
}
module.exports={RuntimePayload,requiredPacks};
