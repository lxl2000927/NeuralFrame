'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { digest } = require('./component-library');
const { downloadAsset } = require('./asset-download');

function releaseAsset(release, name, repository) {
  const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
  const matches = release.assets?.filter(asset => asset.name === name && asset.browser_download_url === url);
  if (matches?.length !== 1) throw Error('发布中缺少匹配的文件：' + name);
  return matches[0];
}

async function resolve(release, {repository, platform, fetchImpl}) {
  const version = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  if (!version || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('软件发布版本或仓库无效');
  const kind = platform === 'windows-portable' ? 'Portable' : 'Setup';
  const name = `NeuralFrame-${version}-${kind}-x64.exe`;
  const asset = releaseAsset(release, name, repository);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 512 * 1024 ** 2)
    throw Error('更新文件大小无效');
  let checksum = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest)?.[1];
  if (!checksum && !asset.digest) {
    const sums = releaseAsset(release, 'SHA256SUMS.txt', repository);
    if (!Number.isSafeInteger(sums.size) || sums.size <= 0 || sums.size > 65536) throw Error('发布校验清单大小无效');
    const response = await fetchImpl(sums.browser_download_url, {signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw Error('无法读取发布校验清单');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > sums.size) throw Error('发布校验清单大小无效');
      chunks.push(chunk);
    }
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
      .map(line => /^([a-f0-9]{64})\s+\*?(\S+)$/i.exec(line.trim())).filter(match => match?.[2] === name);
    if (size === sums.size && lines.length === 1) checksum = lines[0][1];
  }
  if (!checksum) throw Error('更新文件缺少有效的 SHA-256 校验值');
  return {name, size:asset.size, url:asset.browser_download_url, sha256:checksum.toLowerCase()};
}

async function isStaged(asset, directory) {
  const file = path.join(directory, asset.name);
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() && stat.size === asset.size && await digest(file) === asset.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function download(asset, directory, {fetchImpl, onProgress, cacheRoot = directory}) {
  await fs.mkdir(directory, {recursive:true});
  if (await isStaged(asset, directory)) return;
  const partial = path.join(directory, '.' + randomUUID() + '.part');
  try {
    await downloadAsset(asset, {
      cacheRoot, destination:partial, fetcher:fetchImpl, signal:AbortSignal.timeout(30 * 60 * 1000),
      onProgress:received => onProgress({phase:'download', received, total:asset.size}),
    });
    await fs.rename(partial, path.join(directory, asset.name));
    onProgress({phase:'verified', received:asset.size, total:asset.size});
  } finally {
    await fs.rm(partial, {force:true});
  }
}

module.exports = { resolve, isStaged, download };
