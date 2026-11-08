'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DEFINITIONS,PROVIDERS}=require('./component-definitions');
const {read,safe,hash,digest,fail}=require('./component-library');
const journal=require('./file-journal');
const MB=1024*1024;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const providersByRepo = new Map();
for (const [provider, {repo}] of Object.entries(PROVIDERS)) {
  if (!providersByRepo.has(repo)) providersByRepo.set(repo, []);
  providersByRepo.get(repo).push(provider);
}

function rateLimitDeadline(response, now) {
  const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
  const retry = response.headers.get('retry-after');
  if (!exhausted && response.status !== 429 && !(response.status === 403 && retry)) return 0;
  const reset = exhausted ? Number(response.headers.get('x-ratelimit-reset')) * 1000 : 0;
  const retryAt = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  return Math.max(now + CHECK_INTERVAL_MS, Number.isFinite(reset) ? reset : 0, Number.isFinite(retryAt) ? retryAt : 0);
}
function allowedAsset(url,repo){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='github.com'&&u.pathname.startsWith('/'+repo+'/releases/download/')&&!u.username&&!u.password;}catch{return false;}}
async function bounded(response,max){let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw fail('响应超过大小限制');parts.push(Buffer.from(chunk));}return Buffer.concat(parts);}
function stable(release){return !release.draft&&!release.prerelease&&!/(?:^|[-_.])(alpha|beta|rc|pre)(?:[-_.\d]|$)/i.test(release.tag_name);}
function candidates(releases,provider){const def=PROVIDERS[provider],component=Object.keys(DEFINITIONS).find(c=>DEFINITIONS[c].online===provider);const out=[];
  for(const r of releases.filter(stable))for(const a of r.assets||[])if(def.asset.test(a.name)&&allowedAsset(a.browser_download_url,def.repo)){
    const sha=/^sha256:([a-f0-9]{64})$/i.exec(a.digest||'')?.[1]?.toLowerCase();
    out.push({id:hash(JSON.stringify([provider,r.id,a.id,a.digest])),component,provider,repo:def.repo,tag:r.tag_name,name:a.name,url:a.browser_download_url,releaseUrl:`https://github.com/${def.repo}/releases/tag/${encodeURIComponent(r.tag_name)}`,size:a.size,sha256:sha||null,publishedAt:r.published_at,downloadable:!!sha&&a.size>0&&a.size<=512*MB});
  }return out.slice(0,12);
}
async function unpack(file,dest,signal){let count=0,total=0;const names=new Set();await require('extract-zip')(file,{dir:dest,onEntry:entry=>{
  signal?.throwIfAborted();
  const rel=entry.fileName.replace(/\/$/,'');safe(dest,rel);const mode=(entry.externalFileAttributes>>>16)&0xf000;
  if(mode===0xa000)throw fail('组件压缩包不能包含符号链接');
  const k=rel.toLowerCase();if(names.has(k))throw fail('组件压缩包包含重复路径');names.add(k);
  total+=entry.uncompressedSize;if(++count>4096||total>1024*MB)throw fail('组件解压大小超过限制');
}});}
function filesIn(root){const list=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=safe(root,path.relative(root,path.join(dir,e.name)));if(e.isSymbolicLink())throw fail('不能导入符号链接');if(e.isDirectory())walk(f);else if(e.isFile())list.push(f);}}walk(root);return list;}
async function mapFiles(root,component){const def=DEFINITIONS[component],all=filesIn(root),files={};
  if(!def.files.length){for(const f of all){if(/\.(dll|ini|txt|md)$/i.test(f))files[path.relative(root,f)]=f;}if(!all.some(f=>/^OptiScaler\.dll$/i.test(path.basename(f))))throw fail('未找到 OptiScaler.dll');return files;}
  for(const name of def.files){const matches=all.filter(f=>path.basename(f).toLowerCase()===name.toLowerCase());if(!matches.length)throw fail('组件包缺少：'+name);
    const hashes=await Promise.all(matches.map(digest));if(new Set(hashes).size!==1)throw fail('组件包内存在多个不同版本：'+name);files[name]=matches[0];}
  return files;
}
class ComponentUpdates{
  constructor(library,{fetcher=globalThis.fetch,onProgress=()=>{}}={}){this.lib=library;this.fetcher=fetcher;this.onProgress=onProgress;this.cache=path.join(library.root,'updates.json');this.busy=false;this.controller=null;}
  cancel(){this.controller?.abort();return{ok:true};}
  status(){return read(this.cache,{checkedAt:null,candidates:[],errors:[]});}
  async check() {
    if (this.pendingCheck) return this.pendingCheck;
    if (this.busy) throw fail('组件更新正在进行');
    const old = this.status();
    const nextCheckAt = old.nextCheckAt ?? (Date.parse(old.checkedAt) + CHECK_INTERVAL_MS);
    if (Date.now() < nextCheckAt) return {ok:true, ...old, nextCheckAt, cached:true};
    this.busy = true;
    this.pendingCheck = this.refreshReleases(old).finally(() => {
      this.pendingCheck = null;
      this.busy = false;
    });
    return this.pendingCheck;
  }

  async refreshReleases(old) {
    const items = [], errors = [];
    const etags = {...old.etags};
    let limitedUntil = 0;
    for (const [repo, providers] of providersByRepo) {
      const previous = old.candidates.filter(item => providers.includes(item.provider));
      try {
        if (limitedUntil) throw fail('GitHub 请求已限流');
        const headers = {Accept:'application/vnd.github+json', 'User-Agent':'Enhanced-Component-Library'};
        if (etags[repo]) headers['If-None-Match'] = etags[repo];
        const response = await this.fetcher(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
          headers, signal:AbortSignal.timeout(30000)
        });
        limitedUntil = rateLimitDeadline(response, Date.now());
        if (response.status === 304 && etags[repo]) {
          items.push(...previous.map(item => ({...item, stale:false})));
          etags[repo] = response.headers.get('etag') || etags[repo];
          continue;
        }
        if (!response.ok) {
          // GitHub can report a secondary limit in a 403 body without Retry-After.
          if (!limitedUntil && response.status === 403 && response.body) {
            const detail = await bounded(response, 64 * 1024);
            if (/rate limit/i.test(detail.toString())) limitedUntil = Date.now() + CHECK_INTERVAL_MS;
          } else {
            await response.body?.cancel();
          }
          if (limitedUntil) throw fail('GitHub 请求已限流');
          throw fail('下载服务返回 HTTP ' + response.status);
        }
        const releases = JSON.parse((await bounded(response, 12 * MB)).toString());
        if (!Array.isArray(releases)) throw fail('版本列表格式错误');
        items.push(...providers.flatMap(provider => candidates(releases, provider)));
        const tag = response.headers.get('etag');
        if (tag) etags[repo] = tag;
        else delete etags[repo];
      } catch (error) {
        for (const provider of providers) errors.push({provider, message:error.message});
        items.push(...previous.map(item => ({...item, stale:true})));
      }
    }
    const now = Date.now();
    const result = {checkedAt:new Date(now).toISOString(), nextCheckAt:Math.max(now + CHECK_INTERVAL_MS, limitedUntil), candidates:items, errors};
    await journal.atomicJson(this.cache, {...result, etags});
    return {ok:true, ...result};
  }
  async download(id){if(this.busy)throw fail('组件更新正在进行');this.busy=true;this.controller=new AbortController();const timer=setTimeout(()=>this.controller?.abort(),600000);let temp;
    try{const c=this.status().candidates.find(c=>c.id===id),provider=c&&PROVIDERS[c.provider];
      if(!c||!provider||DEFINITIONS[c.component]?.online!==c.provider||!c.downloadable||!allowedAsset(c.url,provider.repo)||!provider.asset.test(c.name)||!/^([a-f0-9]{64})$/.test(c.sha256))throw fail('下载记录无效或缺少 SHA-256，请重新检查更新');
      temp=safe(this.lib.root,'downloads/'+crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
      this.onProgress({stage:'download',name:c.name,loaded:0,total:c.size});
      const response=await this.fetcher(c.url,{signal:this.controller.signal});if(!response.ok)throw fail('下载服务返回 HTTP '+response.status);
      const archive=safe(temp,c.name),handle=await fs.promises.open(archive,'wx');let size=0;const sha=crypto.createHash('sha256');
      let last=0;try{for await(const chunk of response.body){size+=chunk.length;if(size>c.size||size>512*MB)throw fail('下载文件大小不符');sha.update(chunk);await handle.writeFile(chunk);if(Date.now()-last>200){this.onProgress({stage:'download',name:c.name,loaded:size,total:c.size});last=Date.now();}}}finally{await handle.close();}
      if(size!==c.size||sha.digest('hex')!==c.sha256)throw fail('下载文件的 SHA-256 或大小不符，已取消入库');
      this.onProgress({stage:'verify',name:c.name,loaded:size,total:c.size});
      const signal = this.controller.signal;
      signal.throwIfAborted();
      let files;if(/\.zip$/i.test(c.name)){const dest=safe(temp,'unpacked');await fs.promises.mkdir(dest);await unpack(archive,dest,signal);files=await mapFiles(dest,c.component);}else files={[c.name]:archive};
      const p=await this.lib.importPackage({component:c.component,version:c.tag,files,source:provider.repo,releaseUrl:c.releaseUrl,archiveSha256:c.sha256,trustedAdapter:false},signal);
      return{ok:true,package:p,compatibility:this.lib.compatibility(p)};
    }catch(e){if(this.controller.signal.aborted)throw fail('下载已取消或超时，未修改游戏文件');throw e;}
    finally{clearTimeout(timer);this.controller=null;try{if(temp)await fs.promises.rm(safe(this.lib.root,path.relative(this.lib.root,temp)),{recursive:true,force:true});}finally{this.busy=false;}}
  }
}
module.exports={ComponentUpdates,candidates,stable,allowedAsset,unpack,mapFiles};
