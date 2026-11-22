'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DEFINITIONS,PROVIDERS,RANKFTW_NR_SFV2,RANKFTW_NR_310916}=require('./component-definitions');
const {safe,hash,fail}=require('./component-library');
const {componentCompatibility,modelRequirements}=require('./component-compatibility');
const {allowedAsset,downloadWithSources}=require('./download-sources');
const {unpack,mapFiles}=require('./component-archive');
const {sweepPartials}=require('./asset-download');
const journal=require('./file-journal');
const MB=1024*1024;
const SOURCES_VERSION = 4;
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
    ['component', 'name', 'tag', 'version', 'url', 'sha256'].every(key => candidate[key] == null || typeof candidate[key] === 'string')) &&
    Array.isArray(index.errors) && index.errors.every(error =>
      record(error) && typeof error.provider === 'string' && typeof error.message === 'string') &&
    (index.etags === undefined || record(index.etags) && Object.values(index.etags).every(value => typeof value === 'string'));
}
function emptyIndex(damaged = false) {
  return {sourcesVersion:SOURCES_VERSION, checkedAt:null, nextCheckAt:0, candidates:[], etags:{},
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
async function bounded(response,max){let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw fail('响应超过大小限制');parts.push(Buffer.from(chunk));}return Buffer.concat(parts);}
function requestSignal(parent, timeout) {
  const limited = AbortSignal.timeout(timeout);
  return parent ? AbortSignal.any([parent, limited]) : limited;
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit, items.length)}, run));
  return results;
}
function stable(release){return !release.draft&&!release.prerelease&&!/(?:^|[-_.])(alpha|beta|rc|pre)(?:[-_.\d]|$)/i.test(release.tag_name);}
function componentFor(provider) {
  return Object.keys(DEFINITIONS).find(id => DEFINITIONS[id].online === provider || DEFINITIONS[id].additionalOnline?.includes(provider));
}
function validReleaseTag(tag) {
  return typeof tag === 'string' && /^[\w.-]+(?:\/[\w.-]+)*$/.test(tag) &&
    tag.split('/').every(part => part !== '.' && part !== '..');
}
function taggedModelPath(tag) {
  return validReleaseTag(tag) ? `${MODEL_REPO}/refs/tags/${tag}/resources/payload/streamline/${MODEL_NAME}` : null;
}
function validDownloadUrl(candidate, provider) {
  if (allowedAsset(candidate.url,provider.repo)) return true;
  const tagged = candidate.provider === MODEL_PROVIDER && candidate.name === MODEL_NAME && taggedModelPath(candidate.tag);
  return !!tagged && candidate.url === 'https://media.githubusercontent.com/media/' + tagged;
}
function candidates(releases,provider) {
  const def = PROVIDERS[provider], component = componentFor(provider), out = [];
  for (const release of releases) {
    if (release.draft || typeof release.tag_name !== 'string' || !release.tag_name) continue;
    if (def.releaseTag ? release.tag_name !== def.releaseTag : !def.includePrerelease && !stable(release)) continue;
    const releaseUrl = `https://github.com/${def.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`;
    if (def.recordTag?.test(release.tag_name) && Array.isArray(release.assets) && !release.assets.length) {
      out.push({id:hash(JSON.stringify([provider,release.tag_name])), component,provider,repo:def.repo,
        tag:release.tag_name,name:'',url:releaseUrl,releaseUrl,releaseOnly:true,prerelease:!!release.prerelease,size:0,sha256:null,downloadable:false,publishedAt:release.published_at});
    }
    for (const asset of release.assets || []) {
      const match = def.asset.exec(asset.name);
      if (!match || !allowedAsset(asset.browser_download_url,def.repo)) continue;
      let version;
      if (def.releaseTag) {
        version = match[1];
        if (match[2]) version += '+rtxfg.' + match[2];
        if (match[3]) version += '.hf' + match[3];
      } else if (component === 'anr' || component === 'anr-addon') {
        version = release.tag_name.replace(/^FG-V\./i,'');
      }
      const sha = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1].toLowerCase();
      out.push({
        id:hash(JSON.stringify([provider,release.id,asset.id,asset.digest])),
        component,provider,repo:def.repo,tag:release.tag_name,name:asset.name,url:asset.browser_download_url,
        releaseUrl,version,prerelease:!def.releaseTag && !!release.prerelease,
        size:asset.size,sha256:sha || null,publishedAt:def.releaseTag ? asset.created_at : release.published_at,
        downloadable:!!sha && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 512 * MB
      });
    }
  }
  return def.releaseTag ? out.sort((a,b)=>(b.publishedAt || '').localeCompare(a.publishedAt || '')) : out;
}
async function taggedModel(release, fetcher, allowContentsFallback = true, parentSignal) {
  const tagged = taggedModelPath(release.tag_name);
  if (!tagged) throw fail('不支持的版本标签');
  // Some networks can reach GitHub's API and LFS downloads but cannot resolve
  // the raw-content host. The Contents endpoint returns the same tagged pointer.
  let response;
  try {
    response = await fetcher('https://raw.githubusercontent.com/' + tagged, {signal:requestSignal(parentSignal, 15000)});
  } catch (error) {
    if (!allowContentsFallback) throw error;
  }
  let pointer;
  if (!response) {
    const url = `https://api.github.com/repos/${MODEL_REPO}/contents/resources/payload/streamline/${MODEL_NAME}?ref=${encodeURIComponent(release.tag_name)}`;
    response = await fetcher(url,{signal:requestSignal(parentSignal, 15000),headers:{Accept:'application/vnd.github+json'}});
    if (response.ok) {
      const file = JSON.parse((await bounded(response,16 * 1024)).toString());
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') throw fail('无效的 Git LFS 模型指针');
      pointer = Buffer.from(file.content,'base64').toString().trimEnd();
    }
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw fail('模型指针返回 HTTP ' + response.status);
  }
  if (pointer === undefined) pointer = (await bounded(response, 1024)).toString().trimEnd();
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

// The public latest-release page and its asset list are available independently
// of the REST history index. Only GitHub's published digest can admit a file.
async function publishedRelease(repo, providers, previous, fetcher, parentSignal) {
  const read = (url, options) => fetcher(url, {signal:requestSignal(parentSignal, 12000), ...options});
  const site = 'https://github.com/' + repo;
  const tagPrefix = site + '/releases/tag/';
  const fixedTag = PROVIDERS[providers[0]].releaseTag;
  const page = await read(fixedTag ? tagPrefix + fixedTag : site + '/releases/latest');
  if (!page.ok) { await page.body?.cancel(); throw fail('无法读取最新正式版'); }
  // Electron net.fetch follows the redirect but leaves Response.url empty.
  const head = (await bounded(page, 5 * MB)).toString().split('</head>',1)[0];
  const canonical = /<meta\b[^>]*\bproperty="og:url"[^>]*\bcontent="([^"]+)"/i.exec(head)?.[1];
  const pageUrl = canonical ? new URL(canonical, site).href : page.url;
  if (!pageUrl?.startsWith(tagPrefix)) throw fail('无法识别正式版标签');
  const tag = decodeURIComponent(pageUrl.slice(tagPrefix.length));
  if (!validReleaseTag(tag) || (fixedTag ? tag !== fixedTag : !stable({tag_name:tag}))) throw fail('无效的正式版标签');
  const response = await read(site + '/releases/expanded_assets/' + encodeURIComponent(tag));
  if (!response.ok) { await response.body?.cancel(); throw fail('无法读取发布文件'); }
  const html = (await bounded(response, 2 * MB)).toString();
  if (!/<li\b/i.test(html)) throw fail('无法识别发布文件列表');
  const assets = [];
  for (const [entry] of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const href = /<a\b[^>]*\bhref="([^"]+)"/i.exec(entry)?.[1];
    if (!href || !href.startsWith('/' + repo + '/releases/download/' + encodeURIComponent(tag) + '/')) continue;
    const name = decodeURIComponent(href.slice(href.lastIndexOf('/') + 1));
    if (!providers.some(key=>PROVIDERS[key].asset.test(name))) continue;
    const sha = /\bvalue="sha256:([a-f\d]{64})"/i.exec(entry)?.[1].toLowerCase();
    const url = 'https://github.com' + href;
    let size = previous.find(c=>c.url === url && sha && c.sha256 === sha)?.size;
    if (sha && !size) {
      const file = await read(url, {method:'HEAD', headers:{'Accept-Encoding':'identity'}});
      if (file.ok) size = Number(file.headers.get('content-length'));
    }
    assets.push({id:name, name, browser_download_url:url, size:size || 0, digest:sha && 'sha256:' + sha});
  }
  const release = {id:tag, tag_name:tag, assets};
  let found = providers.flatMap(key=>candidates([release],key));
  if (repo === MODEL_REPO && !found.some(c=>c.downloadable)) found = [await taggedModel(release,fetcher,false,parentSignal)];
  return found.map(c=>{
    const existing = previous.find(p=>p.url === c.url && p.sha256 === c.sha256);
    return existing ? {...c,id:existing.id,publishedAt:existing.publishedAt} : c;
  });
}
async function smarterGamersModels(releases, fetcher, previous, errors, parentSignal) {
  const stableReleases = releases.filter(stable).slice(0,12);
  const results = await Promise.allSettled(stableReleases.map(async release => {
    const assets = candidates([release], MODEL_PROVIDER);
    return assets.some(c => c.downloadable) ? assets : [await taggedModel(release,fetcher,true,parentSignal)];
  }));
  parentSignal?.throwIfAborted();
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
class ComponentUpdates{
  constructor(library,{fetcher=globalThis.fetch,onProgress=()=>{}}={}){this.lib=library;this.fetcher=fetcher;this.onProgress=onProgress;this.cache=path.join(library.root,'updates.json');this.busy=false;this.controller=null;this.checkController=null;this.discardOnAbort=false;}
  cancel({discard=false}={}){if(discard)this.discardOnAbort=true;this.controller?.abort();this.checkController?.abort();return{ok:true};}
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
    if (index.sourcesVersion === SOURCES_VERSION) return index;
    // Reparse the releases when provider rules change, even for unchanged GitHub ETags.
    return {...index, nextCheckAt:index.errors.some(e => e.message === 'GitHub 请求已限流') ? index.nextCheckAt : 0,
      candidates:index.candidates.filter(c => Object.hasOwn(PROVIDERS,c.provider)),
      errors:index.errors.filter(e => Object.hasOwn(PROVIDERS,e.provider)),
      etags:{}};
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
      const paired = runtimePacks.find(pack => pack.component === c.component && (
        (c.sha256 && pack.sha256 === c.sha256) ||
        (fingerprints.length && fingerprints.every(f => pack.files.some(file =>
          path.basename(file.path).toLowerCase() === f.rel.toLowerCase() && file.sha256 === f.sha256)))
      ));
      const metadata = {cachedPackageId:cached?.id, compatibility, engine, pairedPackId:paired?.id};
      if (c.component !== 'dlss-nr') return {...c, ...metadata};
      const catalogModelId = dllHash ? MODEL_DATABASE.find(model => model.sha256 === dllHash)?.id : undefined;
      return {...c, ...metadata, downloadId:pinned?.id, catalogModelId,
        modelRequirements:modelRequirements({...c,dllSha256:dllHash})};
    })};
  }
  status(){return this.withLocalModels(this.readIndex());}
  async check({published = false} = {}) {
    if (this.pendingCheck) return this.pendingCheck;
    if (this.busy) throw fail('组件更新正在进行');
    const old = this.readIndex();
    const nextCheckAt = old.nextCheckAt ?? (Date.parse(old.checkedAt) + CHECK_INTERVAL_MS);
    const throttled = Date.now() < nextCheckAt;
    const needsPublished = index => published && index.errors.some(e=>e.message === 'GitHub 请求已限流') &&
      !(Date.now() - Date.parse(index.publishedCheck?.at) < (index.publishedCheck?.checked ? CHECK_INTERVAL_MS : 60000));
    if (throttled && !needsPublished(old)) return {ok:true, ...this.withLocalModels(old), nextCheckAt, cached:true};
    this.busy = true;
    this.checkController = new AbortController();
    const signal = this.checkController.signal;
    this.pendingCheck = (async () => {
      if (!throttled) {
        const result = await this.refreshReleases(old, signal);
        if (!needsPublished(result)) return result;
      }
      const index = throttled ? old : this.readIndex();
      const limited = new Set(index.errors.filter(e=>e.message === 'GitHub 请求已限流').map(e=>e.provider));
      const repos = [...providersByRepo].filter(([,keys])=>keys.some(key=>limited.has(key)));
      const pages = await Promise.allSettled(repos.map(([repo,keys])=>publishedRelease(repo,keys,index.candidates,this.fetcher,signal)));
      signal.throwIfAborted();
      const fresh = pages.flatMap(result=>result.status === 'fulfilled' ? result.value : [])
        .filter(c=>c.downloadable || !index.candidates.some(p=>p.url === c.url && p.downloadable && (!c.sha256 || p.sha256 === c.sha256)));
      const urls = new Set(fresh.map(c=>c.url));
      const snapshot = {...index, candidates:[...fresh,...index.candidates.filter(c=>!urls.has(c.url))],
        publishedCheck:{at:new Date().toISOString(),checked:pages.filter(p=>p.status === 'fulfilled').length,total:pages.length}};
      await journal.atomicJson(this.cache,snapshot);
      return {ok:true,...this.withLocalModels(snapshot)};
    })().catch(error => {
      if (signal.aborted) return {ok:true,cancelled:true,cached:true,...this.withLocalModels(this.readIndex()),message:'已取消检查，保留上次结果。'};
      throw error;
    }).finally(() => {
      this.pendingCheck = null;
      this.checkController = null;
      this.busy = false;
    });
    return this.pendingCheck;
  }

  async refreshReleases(old, parentSignal) {
    const etags = {...old.etags};
    let limitedUntil = 0;
    let budgetCheckAt = 0;
    const results = await mapLimit([...providersByRepo], 3, async ([repo, providers]) => {
      const previous = old.candidates.filter(item => providers.includes(item.provider));
      const repoErrors = [];
      try {
        parentSignal?.throwIfAborted();
        if (limitedUntil) throw fail('GitHub 请求已限流');
        const headers = {Accept:'application/vnd.github+json', 'User-Agent':'NeuralFrame-Component-Library'};
        if (etags[repo]) headers['If-None-Match'] = etags[repo];
        const fixedTag = PROVIDERS[providers[0]].releaseTag;
        const endpoint = fixedTag ? '/releases/tags/' + encodeURIComponent(fixedTag) : '/releases?per_page=100';
        const response = await this.fetcher(`https://api.github.com/repos/${repo}${endpoint}`, {
          headers, signal:requestSignal(parentSignal, 30000)
        });
        let responseLimit = rateLimitDeadline(response, Date.now());
        limitedUntil = Math.max(limitedUntil, responseLimit);
        if (response.ok || response.status === 304) {
          const remaining = response.headers.get('x-ratelimit-remaining');
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          if (remaining !== null && /^\d+$/.test(remaining) && reset > Date.now()) {
            const rounds = Math.max(1, Math.floor(Number(remaining) / providersByRepo.size));
            budgetCheckAt = Math.max(budgetCheckAt, Date.now() + Math.ceil((reset - Date.now()) / rounds));
          }
        }
        if (response.status === 304 && etags[repo]) {
          etags[repo] = response.headers.get('etag') || etags[repo];
          return {items:previous.map(item => ({...item, stale:false})), errors:repoErrors};
        }
        if (!response.ok) {
          if (!responseLimit && response.status === 403 && response.body) {
            const detail = await bounded(response, 64 * 1024);
            if (/rate limit/i.test(detail.toString())) {
              responseLimit = Date.now() + CHECK_INTERVAL_MS;
              limitedUntil = Math.max(limitedUntil, responseLimit);
            }
          } else await response.body?.cancel();
          if (responseLimit) throw fail('GitHub 请求已限流');
          throw fail('下载服务返回 HTTP ' + response.status);
        }
        const listing = JSON.parse((await bounded(response, 12 * MB)).toString());
        const releases = fixedTag && listing?.tag_name === fixedTag ? [listing] : listing;
        if (!Array.isArray(releases)) throw fail('版本列表格式错误');
        const found = repo === MODEL_REPO
          ? await smarterGamersModels(releases, this.fetcher, previous, repoErrors, parentSignal)
          : providers.flatMap(provider => candidates(releases, provider));
        const tag = response.headers.get('etag');
        if (tag && !repoErrors.length) etags[repo] = tag;
        else delete etags[repo];
        return {items:found, errors:repoErrors};
      } catch (error) {
        parentSignal?.throwIfAborted();
        for (const provider of providers) repoErrors.push({provider, message:error.message});
        return {items:previous.map(item => ({...item, stale:true})), errors:repoErrors};
      }
    });
    parentSignal?.throwIfAborted();
    const items = results.flatMap(result => result.items);
    const errors = results.flatMap(result => result.errors);
    const now = Date.now();
    const result = {sourcesVersion:SOURCES_VERSION, checkedAt:new Date(now).toISOString(), nextCheckAt:Math.max(now + CHECK_INTERVAL_MS, limitedUntil, budgetCheckAt), candidates:items, errors};
    await journal.atomicJson(this.cache, {...result, etags});
    return {ok:true, ...this.withLocalModels(result)};
  }
  async download(id,{mirror='',priority='mirror'}={}){if(this.busy)throw fail('组件更新正在进行');this.busy=true;this.controller=new AbortController();let temp;
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
      if (!Number.isSafeInteger(c.size) || c.size <= 0 || c.size > 512 * MB) throw fail('组件文件大小超出范围');
      temp=safe(this.lib.root,'downloads/'+crypto.randomUUID());await fs.promises.mkdir(temp,{recursive:true});
      const archive=safe(temp,c.name);
      try {
        await downloadWithSources(c, {
          cacheRoot:this.lib.root, destination:archive, fetcher:this.fetcher, signal:this.controller.signal, mirror, priority,
          purgeOnAbort:()=>this.discardOnAbort,
          onProgress:(loaded,source,sourceReason,connections)=>this.onProgress({stage:'download',name:c.name,loaded,total:c.size,source,sourceReason,connections})
        });
      } catch (cause) { throw fail(cause.message); }
      this.onProgress({stage:'verify',name:c.name,loaded:c.size,total:c.size});
      const signal = this.controller.signal;
      signal.throwIfAborted();
      const modelRelease = c.provider === MODEL_PROVIDER;
      let files;
      if (/\.zip$/i.test(c.name) && !provider.keepArchive) {
        const dest=safe(temp,'unpacked');
        await fs.promises.mkdir(dest);
        await unpack(archive,dest,signal);
        files=await mapFiles(dest,c.component);
      } else files = {[modelRelease ? MODEL_NAME : c.name]:archive};
      if (pinned && require('./neural-models').inspectNeuralModelBinary(files[MODEL_NAME]).sha256 !== pinned.modelSha256) {
        throw fail('RankFTW 发布包内的模型 DLL 指纹不匹配');
      }
      const p=await this.lib.importPackage({component:c.component,version:modelRelease || pinned ? undefined : c.version || c.tag,files,source:provider.repo,releaseUrl:c.releaseUrl,archiveSha256:c.sha256,trustedAdapter:false},signal);
      return{ok:true,package:p,compatibility:this.lib.compatibility(p)};
    }catch(e){
      if(this.controller.signal.aborted)return{ok:false,cancelled:true,discarded:this.discardOnAbort,message:this.discardOnAbort?'下载已取消，临时分段已清理，未修改游戏文件':'下载已暂停，已保留进度；再次下载将继续，未修改游戏文件'};
      throw e;
    }
    finally{this.controller=null;try{if(temp)await fs.promises.rm(safe(this.lib.root,path.relative(this.lib.root,temp)),{recursive:true,force:true});}finally{this.busy=false;this.discardOnAbort=false;}}
  }
}
module.exports={ComponentUpdates,candidates,stable,allowedAsset,unpack,mapFiles};
