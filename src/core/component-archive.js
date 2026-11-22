'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFINITIONS, requiredPackageFiles } = require('./component-definitions');
const { safe, digest, fail } = require('./component-library');

const MAX_ENTRIES = 4096;
const MAX_UNPACKED_BYTES = 1024 ** 3;

async function unpack(archive, destination, signal) {
  const paths = new Set();
  let bytes = 0;
  await require('extract-zip')(archive, {
    dir: destination,
    onEntry(entry) {
      signal?.throwIfAborted();
      const relative = entry.fileName.replace(/\/$/, '');
      safe(destination, relative);
      const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (fileType === 0xa000) throw fail('组件压缩包不能包含符号链接');
      const key = relative.toLowerCase();
      if (paths.has(key)) throw fail('组件压缩包包含重复路径');
      paths.add(key);
      bytes += entry.uncompressedSize;
      if (paths.size > MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES) throw fail('组件解压大小超过限制');
    },
  });
}

function filesIn(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.relative(root, path.join(directory, entry.name));
      const file = safe(root, relative);
      if (entry.isSymbolicLink()) throw fail('不能导入符号链接');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  visit(root);
  return files;
}

async function mapFiles(root, component) {
  const definition = DEFINITIONS[component];
  const files = filesIn(root);
  if (component === 'optiscaler') {
    if (!files.some(file => /^OptiScaler\.dll$/i.test(path.basename(file)))) throw fail('未找到 OptiScaler.dll');
    return Object.fromEntries(files
      .filter(file => /\.(dll|ini|txt|md)$/i.test(file))
      .map(file => [path.relative(root, file), file]));
  }
  if (!definition?.files.length) throw fail('该组件需要通过配套包或组件发布记录入库');

  const byName = new Map();
  for (const file of files) {
    const key = path.basename(file).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(file);
  }
  const required = requiredPackageFiles(component, [...byName.keys()]);
  const result = {};
  for (const name of [...required, ...(definition.optionalFiles || [])]) {
    const matches = byName.get(name.toLowerCase());
    if (!matches) {
      if (required.includes(name)) throw fail('组件包缺少：' + name);
      continue;
    }
    if (matches.length > 1) {
      const firstHash = await digest(matches[0]);
      for (const duplicate of matches.slice(1)) {
        if (await digest(duplicate) !== firstHash) throw fail('组件包内存在多个不同版本：' + name);
      }
    }
    result[name] = matches[0];
  }
  return result;
}

module.exports = { unpack, mapFiles };
