'use strict';
// Minimal PE reader: import table + version resource.
// Used to tell a game executable apart from a launcher, to pick the right
// ReShade API, and to show which DLSS version a file actually is.
const fs = require('./preview-fs').fs;
const scanCache = require('./scan-cache');
const path = require('node:path');

function readAt(fd, size, pos) {
  const buf = Buffer.alloc(size);
  const n = fs.readSync(fd, buf, 0, size, pos);
  return n === size ? buf : buf.subarray(0, n);
}

// Parses just enough of the headers to map RVAs onto file offsets.
function readHeaders(fd) {
  const dos = readAt(fd, 0x40, 0);
  if (dos.length < 0x40 || dos.readUInt16LE(0) !== 0x5a4d) return null;
  const peOff = dos.readUInt32LE(0x3c);
  const coff = readAt(fd, 24, peOff);
  if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null;

  const numSections = coff.readUInt16LE(6);
  const optSize = coff.readUInt16LE(20);
  const optOff = peOff + 24;
  const opt = readAt(fd, optSize, optOff);
  if (opt.length < 2) return null;
  const magic = opt.readUInt16LE(0);
  if (magic !== 0x10b && magic !== 0x20b) return null;
  const is64 = magic === 0x20b;
  const ddOff = is64 ? 112 : 96;

  const dirs = [];
  for (let i = 0; i < 16; i++) {
    const o = ddOff + i * 8;
    if (o + 8 > opt.length) break;
    dirs.push({ rva: opt.readUInt32LE(o), size: opt.readUInt32LE(o + 4) });
  }

  const secTable = readAt(fd, numSections * 40, optOff + optSize);
  const sections = [];
  for (let i = 0; i < numSections; i++) {
    const o = i * 40;
    if (o + 40 > secTable.length) break;
    sections.push({
      virtualSize: secTable.readUInt32LE(o + 8),
      virtualAddress: secTable.readUInt32LE(o + 12),
      rawSize: secTable.readUInt32LE(o + 16),
      rawOffset: secTable.readUInt32LE(o + 20)
    });
  }
  return { is64, machine: coff.readUInt16LE(4), dll: (coff.readUInt16LE(22) & 0x2000) !== 0, dirs, sections };
}

function rvaToOffset(h, rva, rawBytes = 0) {
  for (const s of h.sections) {
    const distance = rva - s.virtualAddress;
    if (distance < 0 || distance >= Math.max(s.virtualSize, s.rawSize)) continue;
    if (rawBytes && distance + rawBytes > s.rawSize) continue;
    return s.rawOffset + distance;
  }
  return null;
}

function readCString(fd, pos) {
  const buf = readAt(fd, 256, pos);
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString('latin1');
}

// Inspect the named exports without loading a third-party graphics library.
function hasExports(file, names, moduleName) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const h = readHeaders(fd);
    const rva = h?.dirs[0]?.rva;
    if (!h?.dll || !rva) return false;
    const size = fs.fstatSync(fd).size;
    const offset = rvaToOffset(h, rva, 40);
    if (offset === null) return false;
    const header = readAt(fd, 40, offset);
    if (header.length !== 40) return false;
    if (moduleName) {
      const nameAt = rvaToOffset(h, header.readUInt32LE(12), moduleName.length + 1);
      if (nameAt === null || readCString(fd, nameAt).toLowerCase() !== moduleName.toLowerCase()) return false;
    }
    const count = header.readUInt32LE(24), functions = header.readUInt32LE(20);
    if (!count || count > 8192 || !functions || functions > 65536) return false;
    const table = rvaToOffset(h, header.readUInt32LE(32), count * 4);
    const ordinals = rvaToOffset(h, header.readUInt32LE(36), count * 2);
    const addresses = rvaToOffset(h, header.readUInt32LE(28), functions * 4);
    if (table === null || ordinals === null || addresses === null) return false;
    const pointers = readAt(fd, count * 4, table), indices = readAt(fd, count * 2, ordinals);
    const exports = readAt(fd, functions * 4, addresses);
    if (pointers.length !== count * 4 || indices.length !== count * 2 || exports.length !== functions * 4) return false;
    const missing = new Set(names);
    for (let i = 0; i < count; i++) {
      const nameAt = rvaToOffset(h, pointers.readUInt32LE(i * 4), 1);
      if (nameAt === null) continue;
      const name = readCString(fd, nameAt);
      if (!missing.has(name)) continue;
      const index = indices.readUInt16LE(i * 2);
      if (index >= functions) continue;
      const entryRva = exports.readUInt32LE(index * 4);
      const entry = rvaToOffset(h, entryRva, 1);
      if (!entryRva || entry === null || entry >= size) continue;
      // The export directory contains forwarder strings instead of function
      // code. An empty slot inside it is not a usable provider entry point.
      if (entryRva >= rva && entryRva < rva + h.dirs[0].size) {
        const remaining = Math.min(4096, rva + h.dirs[0].size - entryRva, size - entry);
        const bytes = readAt(fd, remaining, entry);
        const end = bytes.indexOf(0);
        if (end <= 0 || rvaToOffset(h, entryRva, end + 1) === null ||
            !/^[^\s.]+\.[^\s]+$/.test(bytes.subarray(0, end).toString('latin1'))) continue;
      }
      missing.delete(name);
      if (!missing.size) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readNameTable(fd, h, dirIndex, stride, nameFieldOffset) {
  const dir = h.dirs[dirIndex];
  if (!dir || !dir.rva) return [];
  const off = rvaToOffset(h, dir.rva);
  if (off === null) return [];
  const table = readAt(fd, Math.min(dir.size || 4096, 64 * 1024), off);
  const names = [];
  for (let o = 0; o + stride <= table.length; o += stride) {
    const nameRva = table.readUInt32LE(o + nameFieldOffset);
    if (nameRva === 0) break;
    const nameOff = rvaToOffset(h, nameRva);
    if (nameOff !== null) names.push(readCString(fd, nameOff).toLowerCase());
  }
  return names;
}

// Names of the DLLs the executable links against, lower-cased. Delay-loaded
// imports count too — plenty of games bind d3d12 that way.
function getImports(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const h = readHeaders(fd);
    if (!h) return [];
    const normal = readNameTable(fd, h, 1, 20, 12);
    const delayed = readNameTable(fd, h, 13, 32, 4);
    return [...new Set([...normal, ...delayed])];
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// Returns the executable architecture without loading or executing it. The
// optional-header magic is authoritative: PE32 is 32-bit and PE32+ is 64-bit.
function getBitness(file, { dllOnly = false, exeOnly = false } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const h = readHeaders(fd);
    if (!h || (dllOnly && !h.dll) || (exeOnly && h.dll)) return null;
    if ((dllOnly || exeOnly) && h.machine !== (h.is64 ? 0x8664 : 0x14c)) return null;
    return h.is64 ? 64 : 32;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// Which of the given ASCII markers appear anywhere in the file. A game that
// loads Direct3D with LoadLibrary has no import entry for it, but the DLL name
// and the entry point it asks for are still sitting there as plain strings.
function findMarkers(file, markers) {
  const cached = scanCache.probe(file, markers);
  if (cached?.found) return cached.found;
  const needles = [...new Set(markers)].map(text => ({ text, bytes: Buffer.from(text, 'latin1').toString('latin1') }));
  if (!needles.length) return new Set();
  const longest = Math.max(...needles.map(n => n.bytes.length));
  // Search the chunk once instead of scanning it again for each absent symbol.
  // Lookahead plus the explicit prefix check preserves overlapping markers.
  const pattern = new RegExp('(?=(' + needles.map(n => n.bytes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + '))', 'g');
  const found = new Set();
  let fd;
  let complete = false;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const chunkSize = Math.min(size, 4 * 1024 * 1024);
    const overlap = longest;
    const buf = Buffer.alloc(chunkSize + overlap);
    let pos = 0;
    let carry = 0;
    while (pos < size) {
      const read = fs.readSync(fd, buf, carry, chunkSize, pos);
      if (read <= 0) break;
      const view = buf.subarray(0, carry + read);
      if (needles.length === 1) {
        if (view.includes(needles[0].bytes, 0, 'latin1')) found.add(needles[0].text);
      } else {
        const text = view.toString('latin1');
        pattern.lastIndex = 0;
        for (let match; (match = pattern.exec(text)); pattern.lastIndex = match.index + 1) {
          for (const n of needles) {
            if (!found.has(n.text) && text.startsWith(n.bytes, match.index)) found.add(n.text);
          }
          if (found.size === needles.length) break;
        }
      }
      if (found.size === needles.length) break;
      carry = Math.min(overlap, view.length);
      view.subarray(view.length - carry).copy(buf, 0);
      pos += read;
    }
    complete = pos >= size || found.size === needles.length;
  } catch {
    /* unreadable file: report nothing rather than guessing */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  if (complete) scanCache.remember(file, cached, found);
  return found;
}

// The raw RT_VERSION resource blob, or null when the file has none.
function getVersionBlob(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const h = readHeaders(fd);
    if (!h || !h.dirs[2] || !h.dirs[2].rva) return null;
    const base = rvaToOffset(h, h.dirs[2].rva);
    if (base === null) return null;

    const entriesOf = (dirOff) => {
      const hdr = readAt(fd, 16, base + dirOff);
      if (hdr.length < 16) return [];
      const count = hdr.readUInt16LE(12) + hdr.readUInt16LE(14);
      const raw = readAt(fd, count * 8, base + dirOff + 16);
      const out = [];
      for (let i = 0; i < count; i++) {
        const o = i * 8;
        if (o + 8 > raw.length) break;
        out.push({ id: raw.readUInt32LE(o), offset: raw.readUInt32LE(o + 4) });
      }
      return out;
    };

    // type (16 = RT_VERSION) -> name -> language -> data entry
    const type = entriesOf(0).find((e) => (e.id & 0x7fffffff) === 16 && (e.offset & 0x80000000));
    if (!type) return null;
    const name = entriesOf(type.offset & 0x7fffffff)[0];
    if (!name || !(name.offset & 0x80000000)) return null;
    const lang = entriesOf(name.offset & 0x7fffffff)[0];
    if (!lang) return null;

    const data = readAt(fd, 16, base + lang.offset);
    if (data.length < 16) return null;
    const dataOff = rvaToOffset(h, data.readUInt32LE(0));
    const dataSize = data.readUInt32LE(4);
    if (dataOff === null || !dataSize) return null;
    return readAt(fd, Math.min(dataSize, 64 * 1024), dataOff);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// "310.8.0.0" style version, read from VS_FIXEDFILEINFO.
function getFileVersion(file) {
  const blob = getVersionBlob(file);
  if (!blob) return null;
  const sig = blob.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (sig !== -1 && sig + 24 <= blob.length) {
    const ms = blob.readUInt32LE(sig + 8);
    const ls = blob.readUInt32LE(sig + 12);
    const fixed = [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.');
    if (fixed !== '0.0.0.0') return fixed;
  }

  // A few vendor DLLs leave VS_FIXEDFILEINFO blank but still publish
  // FileVersion/ProductVersion in the resource string table. Read that value
  // instead of reporting that DLSS has no version at all.
  for (const key of ['FileVersion', 'ProductVersion']) {
    const needle = Buffer.from(key + '\0', 'utf16le');
    const keyAt = blob.indexOf(needle);
    if (keyAt === -1) continue;
    let valueAt = keyAt + needle.length;
    valueAt = (valueAt + 3) & ~3;
    let end = valueAt;
    while (end + 1 < blob.length && blob.readUInt16LE(end) !== 0) end += 2;
    const raw = blob.subarray(valueAt, end).toString('utf16le').trim();
    const match = raw.match(/\d+(?:\s*[.,]\s*\d+){1,3}/);
    if (match) return match[0].replace(/\s*[.,]\s*/g, '.');
  }
  return null;
}

// True when the version resource mentions the given text (UTF-16 strings).
function versionMentions(file, text) {
  const blob = getVersionBlob(file);
  if (!blob) return false;
  return blob.includes(Buffer.from(text, 'utf16le'));
}

const nvidiaFeatureNames = new Map([
  ['nvngx_dlss.dll','sr'], ['nvngx_dlssg.dll','fg'], ['nvngx_dlssd.dll','rr'],
  ['nvngx_dlssnr.dll','nr'], ['sl.dlss_g.dll','sl-fg']
]);
function nvidiaFeatureForName(name) {
  return nvidiaFeatureNames.get(path.win32.basename(name).toLowerCase());
}

// NGX feature libraries expose many of the same entry points. Reject a known
// contradictory product, but older releases need not have a version resource.
function matchesNvidiaFeature(file, feature) {
  const info = getVersionBlob(file)?.toString('utf16le');
  if (!info) return true;
  if (/Intel Corporation|AMD FidelityFX|Advanced Micro Devices|Microsoft Corporation|ReShade|OptiScaler/i.test(info)) return false;
  if (/SL\.DLSS_G PLUGIN/i.test(info)) return feature === 'sl-fg';
  if (/NVIDIA STREAMLINE|NGX Runtime Library/i.test(info)) return false;
  if (/NVIDIA DLSS[- ]G\b|DLSS Frame Generation/i.test(info)) return feature === 'fg';
  if (/NVIDIA DLSSNR\b|DLSS Neural Rendering/i.test(info)) return feature === 'nr';
  if (/DLSS Ray Reconstruction/i.test(info)) return feature === 'rr';
  if (/NVIDIA Deep Learning Super\s*Sampling|DLSS Super Resolution/i.test(info)) return feature === 'sr';
  return true;
}

function matchesUpscalerName(file, name) {
  const info = getVersionBlob(file)?.toString('utf16le');
  if (!info) return true;
  const intel = name.startsWith('libxess');
  if (/NVIDIA Corporation|Microsoft Corporation|ReShade|OptiScaler/i.test(info)) return false;
  if (/Intel Corporation|XeSS SDK|XeLL SDK/i.test(info)) {
    const original = /\b(libx(?:ess(?:_dx11|_fg)?|ell)\.dll)\0/i.exec(info);
    return intel && (!original || original[1].toLowerCase() === name);
  }
  if (/Advanced Micro Devices|AMD FidelityFX/i.test(info)) {
    if (intel) return false;
    if (/_vk\.dll$/.test(name) && /AMD FidelityFX \(DirectX\)|DX12 AMD FidelityFX Library/i.test(info)) return false;
    if (/_dx12\.dll$/.test(name) && /AMD FidelityFX \(Vulkan\)|VK AMD FidelityFX Library/i.test(info)) return false;
    if (/AMD FidelityFX Upscaler/i.test(info)) return /^amd_fidelityfx_upscaler_/.test(name);
    if (/AMD FidelityFX Frame Generation/i.test(info)) return /^amd_fidelityfx_framegeneration_/.test(name);
    if (/Loader Library/i.test(info)) return /^amd_fidelityfx_loader_/.test(name);
    if (/VK AMD FidelityFX Library/i.test(info)) return name === 'amd_fidelityfx_vk.dll';
  }
  return true;
}

module.exports = { getImports, hasExports, getBitness, getFileVersion, versionMentions, findMarkers, nvidiaFeatureForName, matchesNvidiaFeature, matchesUpscalerName };
