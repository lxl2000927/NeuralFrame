'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const MAX_METADATA=64*1024;
function selectAsset(release,arch=process.arch){
  const assets=Array.isArray(release?.assets)?release.assets:[];
  const wanted=arch==='arm64'?['arm64','aarch64']:arch==='x64'?['x86_64','amd64','x64']:[arch];
  const other=['arm64','aarch64','x86_64','amd64','x64','armv7l','ia32'].filter(token=>!wanted.includes(token));
  const candidates=assets.filter(asset=>{
    const name=String(asset?.name||'').toLowerCase();
    return name.endsWith('.appimage')&&!other.some(token=>name.includes(token))&&(wanted.some(token=>name.includes(token))||(arch==='x64'&&assets.filter(item=>String(item?.name||'').toLowerCase().endsWith('.appimage')).length===1));
  });
  if(candidates.length!==1)throw Error('发布中没有与当前 Linux 架构唯一匹配的 AppImage');
  const asset=candidates[0],size=Number(asset.size);
  if(!/^[\w .()+-]+\.AppImage$/i.test(asset.name)||!Number.isSafeInteger(size)||size<=0)throw Error('AppImage 文件名或大小无效');
  return{name:asset.name,size,url:asset.browser_download_url,metadataUrl:null,sha512:null};
}
function parseMetadata(text,assetName){
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_METADATA)throw Error('Linux 更新元数据过大或无效');
  const clean=value=>String(value||'').trim().replace(/^['"]|['"]$/g,'');
  const blocks=text.split(/\r?\n\s*-\s+url:\s*/).slice(1).map(block=>block.split(/\r?\n\s*-\s+url:\s*/)[0]);
  let selected=blocks.find(block=>clean(block.split(/\r?\n/,1)[0])===assetName);
  if(!blocks.length&&new RegExp(`^path:\\s*["']?${assetName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["']?\\s*$`,'mi').test(text))selected=text;
  if(!selected)throw Error('Linux 更新元数据未描述所选 AppImage');
  const sha512=clean(/(?:^|\n)\s*sha512:\s*([^\r\n]+)/.exec(selected)?.[1]);
  const size=Number(clean(/(?:^|\n)\s*size:\s*([^\r\n]+)/.exec(selected)?.[1]));
  if(!/^[A-Za-z0-9+/]{86}==$/.test(sha512)||!Number.isSafeInteger(size)||size<=0)throw Error('AppImage 缺少有效的 SHA-512 或大小');
  return{sha512,size};
}
async function resolve(release,{repository,arch=process.arch,fetchImpl}={}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('更新仓库无效');
  const asset=selectAsset(release,arch);
  const prefix=`https://github.com/${repository}/releases/download/`;
  if(typeof asset.url!=='string'||!asset.url.startsWith(prefix))throw Error('AppImage 不在当前项目的固定发布通道');
  const suffix = arch === 'x64' ? '' : '-' + (arch === 'armv7l' ? 'arm' : arch);
  const name = `latest-linux${suffix}.yml`;
  const metadata=release.assets.find(item=>item?.name===name) ||
    release.assets.find(item=>item?.name==='latest-linux.yml');
  if(!metadata||typeof metadata.browser_download_url!=='string'||!metadata.browser_download_url.startsWith(prefix))throw Error(`发布缺少 ${name} 校验元数据`);
  const response=await fetchImpl(metadata.browser_download_url,{headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error(`无法读取 Linux 更新元数据（${response.status}）`);
  const verified=parseMetadata(await response.text(),asset.name);
  if(verified.size!==asset.size)throw Error('AppImage 大小与发布元数据不一致');
  return{...asset,...verified,metadataUrl:metadata.browser_download_url};
}
async function hashFile(file){
  const hash=crypto.createHash('sha512');let size=0;
  const stream=fs.createReadStream(file);
  for await(const chunk of stream){size+=chunk.length;hash.update(chunk);}
  return{size,sha512:hash.digest('base64')};
}
function stagedPath(asset, currentImage) {
  return path.join(path.dirname(path.resolve(currentImage)), '.neuralframe-update', asset.name + '.verified');
}
async function isStaged(asset, currentImage) {
  const file = stagedPath(asset, currentImage);
  try {
    const info = await fs.promises.stat(file);
    if (!info.isFile() || info.size !== asset.size) return false;
    return (await hashFile(file)).sha512 === asset.sha512;
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return false;
    throw error;
  }
}
async function download(asset,currentImage,{fetchImpl,onProgress=()=>{},signal}={}){
  const current=path.resolve(currentImage),directory=path.join(path.dirname(current),'.neuralframe-update');
  await fs.promises.mkdir(directory,{recursive:true});
  const staged=stagedPath(asset,current),partial=staged+'.part';
  await fs.promises.rm(partial,{force:true});
  const response=await fetchImpl(asset.url,{headers:{Accept:'application/octet-stream'},signal});
  if(!response.ok)throw Error(`AppImage 下载失败（${response.status}）`);
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>0&&length!==asset.size)throw Error('下载服务器返回了不同的 AppImage 大小');
  if(!response.body?.getReader)throw Error('更新通道不支持流式下载');
  const reader=response.body.getReader(),hash=crypto.createHash('sha512');let received=0, output;
  try{
    output=await fs.promises.open(partial,'wx',0o755);
    while(true){
      const{done,value}=await reader.read();if(done)break;
      const chunk=Buffer.from(value);received+=chunk.length;
      if(received>asset.size)throw Error('AppImage 超出发布大小，已停止下载');
      await output.writeFile(chunk);
      hash.update(chunk);
      onProgress({phase:'download',received,total:asset.size});
    }
    if(received!==asset.size||hash.digest('base64')!==asset.sha512)throw Error('AppImage 大小或 SHA-512 校验失败');
    await output.close(); output=undefined;
    await fs.promises.chmod(partial,0o755);await fs.promises.rename(partial,staged);
    onProgress({phase:'verified',received,total:asset.size});return{staged};
  }catch(error){
    void reader.cancel(error).catch(()=>{});
    if(output)await output.close().catch(()=>{});
    await fs.promises.rm(partial,{force:true}).catch(()=>{});
    throw error;
  }finally{reader.releaseLock();}
}
async function syncPath(file) {
  if (process.platform !== 'linux') return;
  const handle = await fs.promises.open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

// User-data profiles and AppImages in the same directory share the staging directory.
// An OS-owned socket releases the reservation even if the active process is killed.
async function withImageLock(currentImage, work) {
  const directory = await fs.promises.realpath(path.dirname(path.resolve(currentImage)));
  const id = crypto.createHash('sha256').update(directory).digest('hex').slice(0, 32);
  const name = 'neuralframe-appimage-' + id;
  const endpoint = process.platform === 'linux' ? '\0' + name
    : process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(os.tmpdir(), name + '.sock');
  const reservation = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    reservation.once('error', error => reject(error.code === 'EADDRINUSE' ? Error('软件更新操作正在进行') : error));
    reservation.listen(endpoint, resolve);
  });
  try { return await work(); }
  finally { await new Promise(resolve => reservation.close(resolve)); }
}

async function snapshot(current, pending) {
  // Publish only a complete snapshot, including on filesystems without hard links.
  try {
    await fs.promises.link(current, pending);
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EXDEV', 'ENOTSUP', 'EMLINK', 'ENOSYS'].includes(error.code)) throw error;
    const temporary = pending + '.copy';
    try {
      await fs.promises.copyFile(current, temporary);
      await syncPath(temporary);
      await fs.promises.rename(temporary, pending);
    } finally {
      await fs.promises.rm(temporary, {force:true});
    }
  }
}

async function recoverInterrupted(currentImage) {
  const current = path.resolve(currentImage);
  const previous = current + '.previous';
  // Recover installations made by versions that moved the launcher out of the way.
  if (!fs.existsSync(current) && fs.existsSync(previous)) await fs.promises.rename(previous, current);
  for (const destination of [previous, current + '.rejected']) {
    const pending = destination + '.pending';
    if (fs.existsSync(pending + '.copy')) await fs.promises.unlink(pending + '.copy');
    if (!fs.existsSync(pending)) continue;
    const before = await fs.promises.stat(pending, {bigint:true});
    const now = await fs.promises.stat(current, {bigint:true});
    const sameInode = before.ino !== 0n && before.ino === now.ino && before.dev === now.dev;
    const unchanged = sameInode || (before.size === now.size && (await hashFile(pending)).sha512 === (await hashFile(current)).sha512);
    if (unchanged) await fs.promises.unlink(pending);
    else await fs.promises.rename(pending, destination);
    await syncPath(path.dirname(current));
  }
}

async function replaceImage(source, current, destination) {
  const directory = path.dirname(current);
  const pending = destination + '.pending';
  await fs.promises.chmod(source, 0o755);
  await syncPath(source);
  await snapshot(current, pending);
  await syncPath(directory);
  // The public launcher always refers to the complete old image or the complete new image.
  // The old backup also remains available if the replacement fails.
  try {
    await fs.promises.rename(source, current);
  } catch (error) {
    await fs.promises.rm(pending, {force:true});
    throw error;
  }
  try {
    await syncPath(directory);
    await fs.promises.rename(pending, destination);
    await syncPath(directory);
  } catch (error) {
    // The launcher has switched. A retry must restart that image, not install it over its own backup.
    error.appImageSwitched = true;
    throw error;
  }
}

async function apply(asset, currentImage, stagedImage) {
  const current = path.resolve(currentImage);
  const staged = stagedPath(asset, current);
  if (path.resolve(stagedImage) !== staged) throw Error('更新暂存位置无效');
  await recoverInterrupted(current);
  if (!await isStaged(asset, current)) {
    const error = Error('暂存 AppImage 校验失败，请重新下载更新');
    error.code = 'INVALID_STAGED';
    throw error;
  }
  const backup = current + '.previous';
  await replaceImage(staged, current, backup);
  return {backup};
}
async function rollback(currentImage) {
  const current = path.resolve(currentImage);
  await recoverInterrupted(current);
  const backup = current + '.previous';
  if (!fs.statSync(backup, {throwIfNoEntry:false})?.isFile()) throw Error('没有可恢复的上一版本');
  const rejected = current + '.rejected';
  await replaceImage(backup, current, rejected);
  return {rejected};
}
module.exports = {
  selectAsset, parseMetadata, resolve, hashFile, stagedPath, isStaged,
  download: (asset, current, options) => withImageLock(current, () => download(asset, current, options)),
  apply: (asset, current, staged) => withImageLock(current, () => apply(asset, current, staged)),
  rollback: current => withImageLock(current, () => rollback(current)),
  recoverInterrupted: current => withImageLock(current, () => recoverInterrupted(current)),
};
