'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DEFINITIONS,PROVIDERS,RANKFTW_NR_SFV2,RANKFTW_NR_310916}=require('./component-definitions');
const {safe,hash,digest,fail}=require('./component-library');
const {componentCompatibility,modelRequirements}=require('./component-compatibility');
const {downloadAsset,sweepPartials}=require('./asset-download');
const journal=require('./file-journal');
const MB=1024*1024;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MODEL_PROVIDER = 'smartergamers-nr';
const MODEL_NAME = 'nvngx_dlssnr.dll';
const pinnedModels = [RANKFTW_NR_SFV2, RANKFTW_NR_310916];
const MODEL_REPO = PROVIDERS[MODEL_PROVIDER].repo;
const providersByRepo = new Map();
for (const [provider, {repo}] of Object.entries(PROVIDERS)) {
  if (!providersByRepo.has(repo)) providersByRepo.set(repo, []);
  providersByRepo.get(repo).push(provider);
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validIndex(index) {
  return record(index) && Array.isArray(index.candidates) && index.candidates.every(candidate =>
    record(candidate) && typeof candidate.id === 'string' && typeof candidate.provider === 'string' &&
    ['component', 'name', 'tag', 'url', 'sha256'].every(key => candidate[key] == null || typeof candidate[key] === 'string')) &&
    Array.isArray(index.errors) && index.errors.every(error =>
      record(error) && typeof error.provider === 'string' && typeof error.message === 'string') &&
    (index.etags === undefined || record(index.etags) && Object.values(index.etags).every(value => typeof value === 'string'));
}
function emptyIndex(damaged = false) {
  return {sourcesVersion:3, checkedAt:null, nextCheckAt:0, candidates:[], etags:{},
    errors:damaged ? [{provider:'cache', message:'组件更新缓存损坏，请检查更新重建版本列表。'}] : []};
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
function componentFor(provider) {
  return Object.keys(DEFINITIONS).find(id => DEFINITIONS[id].online === provider || DEFINITIONS[id].additionalOnline?.includes(provider));
}
function taggedModelPath(tag) {
  if (typeof tag !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(tag) ||
      tag.split('/').some(part => part === '.' || part === '..')) return null;
  return `${MODEL_REPO}/refs/tags/${tag}/resources/payload/streamline/${MODEL_NAME}`;
}
function validDownloadUrl(candidate, provider) {
  if (allowedAsset(candidate.url,provider.repo)) return true;
  const tagged = candidate.provider === MODEL_PROVIDER && candidate.name === MODEL_NAME && taggedModelPath(candidate.tag);
  return !!tagged && candidate.url === 'https://media.githubusercontent.com/media/' + tagged;
}
function candidates(releases,provider) {
  const def = PROVIDERS[provider], component = componentFor(provider), out = [];
  for (const release of releases.filter(stable)) {
    for (const asset of release.assets || []) {
      if (!def.asset.test(asset.name) || !allowedAsset(asset.browser_download_url,def.repo)) continue;
      const sha = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1].toLowerCase();
      out.push({
        id:hash(JSON.stringify([provider,release.id,asset.id,asset.digest])),
        component,provider,repo:def.repo,tag:release.tag_name,name:asset.name,url:asset.browser_download_url,
        releaseUrl:`https://github.com/${def.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`,
        size:asset.size,sha256:sha || null,publishedAt:release.published_at,
        downloadable:!!sha && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 512 * MB
      });
    }
  }
  return out.slice(0,12);
}
async function taggedModel(release, fetcher) {
  const tagged = taggedModelPath(release.tag_name);
  if (!tagged) throw fail('不支持的版本标签');
  const response = await fetcher('https://raw.githubusercontent.com/' + tagged, {signal:AbortSignal.timeout(15000)});
  if (!response.ok) {
    await response.body?.cancel();
    throw fail('模型指针返回 HTTP ' + response.status);
  }
  const pointer = (await bounded(response, 1024)).toString().trimEnd();
  const match = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize (\d+)$/.exec(pointer);
  if (!match) throw fail('无效的 Git LFS 模型指针');
  const [,sha256,length] = match, size = Number(length);
  if (!Number.isSafeInteger(size) || size < 1 || size > 512*MB) throw fail('模型文件大小超出范围');
  return {
    id:hash(JSON.stringify([MODEL_PROVIDER,release.id,MODEL_NAME,sha256])),component:'dlss-nr',provider:MODEL_PROVIDER,
    repo:MODEL_REPO,tag:release.tag_name,name:MODEL_NAME,url:'https://media.githubusercontent.com/media/' + tagged,
    releaseUrl:`https://github.com/${MODEL_REPO}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    publishedAt:release.published_at,sha256,size,downloadable:true
  };
}
async function smarterGamersModels(releases, fetcher, previous, errors) {
  const stableReleases = releases.filter(stable).slice(0,12);
  const results = await Promise.allSettled(stableReleases.map(async release => {
    const assets = candidates([release], MODEL_PROVIDER);
    return assets.some(c => c.downloadable) ? assets : [await taggedModel(release,fetcher)];
  }));
  const failed = [];
  const items = results.flatMap((result,i) => {
    if (result.status === 'fulfilled') return result.value;
    const tag = stableReleases[i].tag_name;
    failed.push(tag + ' · ' + result.reason.message);
    return previous.filter(c => c.tag === tag).map(c => ({...c, stale:true}));
  });
  if (failed.length) errors.push({provider:MODEL_PROVIDER, message:failed.join(' / ')});
  return items;
}
function pinnedModelFor(candidate) {
  return pinnedModels.find(p => candidate.provider === p.provider && candidate.url === p.url && candidate.sha256 === p.sha256);
}
function findCachedPackage(packages, candidate, pinned) {
  if (!candidate.sha256) return null;
  if (pinned) return packages.find(p => p.component === 'dlss-nr' &&
    p.files.some(f => f.rel === MODEL_NAME && f.sha256 === pinned.modelSha256));
  const directFile = /\.(dll|addon64|addon32)$/i.test(candidate.name);
  return packages.find(p => p.component === candidate.component && (p.archiveSha256 === candidate.sha256 ||
    p.releaseArchives?.some(a => a.sha256 === candidate.sha256) ||
    (directFile && p.files.length === 1 && p.files.some(f => f.rel.toLowerCase() === candidate.name.toLowerCase() && f.sha256 === candidate.sha256))));
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
  for(const name of def.optionalFiles || []){const matches=all.filter(f=>path.basename(f).toLowerCase()===name.toLowerCase());if(!matches.length)continue;
    const hashes=await Promise.all(matches.map(digest));if(new Set(hashes).size!==1)throw fail('组件包内存在多个不同版本：'+name);files[name]=matches[0];}
  return files;
}
class ComponentUpdates{
  constructor(library,{fetcher=globalThis.fetch,onProgress=()=>{}}={}){this.lib=library;this.fetcher=fetcher;this.onProgress=onProgress;this.cache=path.join(library.root,'updates.json');this.busy=false;this.controller=null;}
  cancel(){this.controller?.abort();return{ok:true};}
  readIndex(){
    let text;
    try { text = fs.readFileSync(this.cache, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return emptyIndex();
      throw fail('无法读取组件更新缓存：' + path.basename(this.cache));
    }
    let index;
    try { index = JSON.parse(text); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return emptyIndex(true);
    }
    // This is replaceable release metadata, not the installed package catalog.
    // Keep viewing read-only; the next explicit check rebuilds the damaged cache.
    if (!validIndex(index)) return emptyIndex(true);
    if (index.sourcesVersion === 3) return index;
    // A cached Enhanced release must not appear or delay the first check after upgrading.
    return {...index, nextCheckAt:index.errors.some(e => e.message === 'GitHub 请求已限流') ? index.nextCheckAt : 0,
      candidates:index.candidates.filter(c => Object.hasOwn(PROVIDERS,c.provider)),
      errors:index.errors.filter(e => Object.hasOwn(PROVIDERS,e.provider)),
      etags:Object.fromEntries(Object.entries(index.etags || {}).filter(([repo]) => providersByRepo.has(repo)))};
  }
  withLocalModels(index) {
    const packages = this.lib.catalog().packages;
    const {MODEL_DATABASE} = require('./neural-models');
    const runtimePacks = require('./runtime-catalog.json').packs;
    return {...index, candidates:index.candidates.map(c => {
      const pinned = pinnedModelFor(c);
      const cached = findCachedPackage(packages,c,pinned);
      const compatibility = componentCompatibility(cached || c);
      const engine = ['encore','mfg-universal'].includes(c.component) ? require('./engine-packages').describe(c.component,cached || c) : undefined;
      const dllHash = c.name?.toLowerCase() === MODEL_NAME ? c.sha256 :
        pinned?.modelSha256 || cached?.files.find(file => file.rel === MODEL_NAME)?.sha256;
      const direct = DEFINITIONS[c.component]?.files;
      const fingerprints = cached?.files || (dllHash ? [{rel:MODEL_NAME,sha256:dllHash}] :
        direct?.length === 1 && direct[0].toLowerCase() === c.name?.toLowerCase() && c.sha256 ? [{rel:direct[0],sha256:c.sha256}] : []);
      const paired = runtimePacks.find(pack=>pack.component===c.component &&
        (fingerprints.length ? fingerprints.every(f=>pack.files.some(file=>path.basename(file.path).toLowerCase()===f.rel.toLowerCase() && file.sha256===f.sha256)) :
          !!c.sha256 && pack.sha256===c.sha256));
      const metadata = {cachedPackageId:cached?.id, compatibility, engine, pairedPackId:paired?.id};
      if (c.component !== 'dlss-nr') return {...c, ...metadata};
      const catalogModelId = dllHash ? MODEL_DATABASE.find(model => model.sha256 === dllHash)?.id : undefined;
      return {...c, ...metadata, downloadId:pinned?.id, catalogModelId,
        modelRequirements:modelRequirements({...c,dllSha256:dllHash})};
    })};
  }
  status(){return this.withLocalModels(this.readIndex());}
  async check() {
    if (this.pendingCheck) return this.pendingCheck;
    if (this.busy) throw fail('组件更新正在进行');
    const old = this.readIndex();
    const nextCheckAt = old.nextCheckAt ?? (Date.parse(old.checkedAt) + CHECK_INTERVAL_MS);
    if (Date.now() < nextCheckAt) return {ok:true, ...this.withLocalModels(old), nextCheckAt, cached:true};
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
        const headers = {Accept:'application/vnd.github+json', 'User-Agent':'NeuralFrame-Component-Library'};
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
        const errorCount = errors.length;
        if (repo === MODEL_REPO) items.push(...await smarterGamersModels(releases, this.fetcher, previous, errors));
        else items.push(...providers.flatMap(provider => candidates(releases, provider)));
        const tag = response.headers.get('etag');
        if (tag && errors.length === errorCount) etags[repo] = tag;
        else delete etags[repo];
      } catch (error) {
        for (const provider of providers) errors.push({provider, message:error.message});
        items.push(...previous.map(item => ({...item, stale:true})));
      }
    }
    const now = Date.now();
    const result = {sourcesVersion:3, checkedAt:new Date(now).toISOString(), nextCheckAt:Math.max(now + CHECK_INTERVAL_MS, limitedUntil), candidates:items, errors};
    await journal.atomicJson(this.cache, {...result, etags});
    return {ok:true, ...this.withLocalModels(result)};
  }
  async download(id){if(this.busy)throw fail('组件更新正在进行');this.busy=true;this.controller=new AbortController();let temp;
    await sweepPartials(this.lib.root).catch(()=>{});
    try{const c=pinnedModels.find(p=>p.id===id) || this.readIndex().candidates.find(c=>c.id===id),provider=c&&PROVIDERS[c.provider];
      if(!c||!provider||componentFor(c.provider)!==c.component||!c.downloadable||!validDownloadUrl(c,provider)||!provider.asset.test(c.name)||!/^([a-f0-9]{64})$/.test(c.sha256))throw fail('下载记录无效或缺少 SHA-256，请重新检查更新');
      this.onProgress({stage:'prepare',name:c.name,loaded:0,total:c.size});
      const pinned = pinnedModelFor(c);
      const cached = findCachedPackage(this.lib.catalog().packages, c, pinned);
      if (cached) {
        this.onProgress({stage:'verify',name:c.name,loaded:0,total:c.size});
        const verified = await this.lib.verify(cached).catch(() => null);
        this.controller.signal.throwIfAborted();
        if (verified) return {ok:true,package:verified,compatibility:this.lib.compatibility(verified)};
      }
      if (c.stale) throw fail('下载记录无效或缺少 SHA-256，请重新检查更新');
      temp=safe(this.lib.root,'downloads/'+crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
      const archive=safe(temp,c.name);
      try {
        await downloadAsset(c, {
          cacheRoot:this.lib.root, destination:archive, fetcher:this.fetcher, signal:this.controller.signal,
          purgeOnAbort:true,
          onProgress:loaded=>this.onProgress({stage:'download',name:c.name,loaded,total:c.size})
        });
      } catch (cause) { throw fail(cause.message); }
      this.onProgress({stage:'verify',name:c.name,loaded:c.size,total:c.size});
      const signal = this.controller.signal;
      signal.throwIfAborted();
      const modelRelease = c.provider === MODEL_PROVIDER;
      let files;
      if (/\.zip$/i.test(c.name)) {
        const dest=safe(temp,'unpacked');
        await fs.promises.mkdir(dest);
        await unpack(archive,dest,signal);
        files=await mapFiles(dest,c.component);
      } else files = {[modelRelease ? MODEL_NAME : c.name]:archive};
      if (pinned && require('./neural-models').inspectNeuralModelBinary(files[MODEL_NAME]).sha256 !== pinned.modelSha256) {
        throw fail('RankFTW 发布包内的模型 DLL 指纹不匹配');
      }
      const p=await this.lib.importPackage({component:c.component,version:modelRelease || pinned ? undefined : c.tag,files,source:provider.repo,releaseUrl:c.releaseUrl,archiveSha256:c.sha256,trustedAdapter:false},signal);
      return{ok:true,package:p,compatibility:this.lib.compatibility(p)};
    }catch(e){
      if(this.controller.signal.aborted)return{ok:false,cancelled:true,message:'下载已取消，未修改游戏文件'};
      throw e;
    }
    finally{this.controller=null;try{if(temp)await fs.promises.rm(safe(this.lib.root,path.relative(this.lib.root,temp)),{recursive:true,force:true});}finally{this.busy=false;}}
  }
}
module.exports={ComponentUpdates,candidates,stable,allowedAsset,unpack,mapFiles};
