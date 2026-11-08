'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const preview = require('./preview-fs');
const { fs } = preview;

// NTFS hard links share bytes and the read-only attribute. Replace just this
// directory entry, without chmod/unlink on the linked original. A locked
// destination leaves the original intact. Ordinary files use the original
// in-place write path.
async function isLinked(dest) {
  if (preview.active()) return false;
  try {
    const stat = await fs.promises.lstat(dest);
    if (stat.isSymbolicLink()) throw Object.assign(new Error('errUnsafeTarget'), { code: 'errUnsafeTarget' });
    return stat.isFile() && stat.nlink > 1;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function makeWritable(file) {
  if (await isLinked(file)) return false;
  await fs.promises.chmod(file, 0o666);
  return true;
}

async function replaceLinked(dest, materialize) {
  if (!await isLinked(dest)) return materialize(dest, false);
  const temporary = path.join(path.dirname(dest), '.neuralframe-' + randomUUID() + '.tmp');
  await materialize(temporary, true);
  try { await fs.promises.rename(temporary, dest); }
  catch (error) {
    await fs.promises.chmod(temporary, 0o666).catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

function copyFile(src, dest, { writable = false, clearReadOnly = false } = {}) {
  return replaceLinked(dest, async (file, exclusive) => {
    if (clearReadOnly && !exclusive) await fs.promises.chmod(file, 0o666).catch(() => {});
    await fs.promises.copyFile(src, file, exclusive ? fs.constants.COPYFILE_EXCL : 0);
    if (writable) await fs.promises.chmod(file, 0o666).catch(() => {});
  });
}

function writeText(dest, text) {
  return replaceLinked(dest, async (file, exclusive) => {
    if (!exclusive) {
      await fs.promises.chmod(file, 0o666).catch(() => {});
      await fs.promises.writeFile(file, text, 'utf8');
      return;
    }
    const handle = await fs.promises.open(file, 'wx');
    try {
      try { await handle.writeFile(text, 'utf8'); }
      finally { await handle.close(); }
    } catch (error) {
      await fs.promises.unlink(file).catch(() => {});
      throw error;
    }
  });
}

module.exports = { copyFile, writeText, makeWritable };
