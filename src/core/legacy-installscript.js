'use strict';
// Adapted from Enhanced 2.3.1. Parse vendor values, never execute installers.
// Both source hives use a game-specific HKCU\Software\NeuralFrame\Legacy
// namespace. The file manifest owns cleanup; real vendor settings stay intact.

const fs = require('./preview-fs').fs;
const path = require('path');
const crypto = require('crypto');
const journal = require('./file-journal');
const defaultRunner = require('./vulkan-layer').defaultRunner;
const fail = message => Object.assign(new Error(message), { code: 'errLegacyRegistry' });
const namespace = gameDir => 'HKCU\\Software\\NeuralFrame\\Legacy\\' + crypto.createHash('sha256').update(path.resolve(gameDir).toLowerCase()).digest('hex').slice(0, 32);
async function run(args, runner) {
  const preview = require('./preview-fs').active();
  if (preview && args[0] !== 'query') {
    preview.externalSteps.push({ file: 'reg.exe', args });
    return { code: 0, stdout: '' };
  }
  return runner('reg.exe', args);
}

function tokenizeVdf(text) {
  const tokens = [];
  const src = String(text || '').replace(/^\uFEFF/, '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '{' || ch === '}') {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === '"') {
      let val = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          if (next === '"' || next === '\\') { val += next; i += 2; continue; }
          if (next === 'n') { val += '\n'; i += 2; continue; }
          if (next === 't') { val += '\t'; i += 2; continue; }
        }
        val += src[i++];
      }
      if (src[i] === '"') i++;
      tokens.push(val);
      continue;
    }
    let bare = '';
    while (i < src.length && !/[\s{}"]/.test(src[i])) bare += src[i++];
    if (bare) tokens.push(bare);
  }
  return tokens;
}

function parseVdfTree(text) {
  const tokens = tokenizeVdf(text);
  let pos = 0;
  function readObject(depth = 0) {
    if (depth > 32) throw fail('安装脚本嵌套过深');
    const obj = Object.create(null);
    while (pos < tokens.length) {
      const tok = tokens[pos++];
      if (tok === '}') break;
      if (tok === '{') continue;
      const key = tok;
      if (tokens[pos] === '{') {
        pos++;
        const child = readObject(depth + 1);
        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          Object.assign(obj[key], child);
        } else {
          obj[key] = child;
        }
      } else if (pos < tokens.length && tokens[pos] !== '}') {
        obj[key] = tokens[pos++];
      }
    }
    return obj;
  }
  return readObject();
}

function expandInstallVars(value, gameDir) {
  const cleanDir = String(gameDir || '').replace(/[\\/]+$/, '');
  return String(value ?? '')
    .replace(/%INSTALLDIR%/gi, cleanDir)
    .replace(/%ROOTDRIVE%/gi, cleanDir.slice(0, 2));
}

function normalizeSoftwareSubkey(fullKeyPath) {
  const clean = String(fullKeyPath || '').trim().replace(/^\[|\]$/g, '').replace(/\//g, '\\');
  const m = clean.match(/^(HKEY_LOCAL_MACHINE|HKLM|HKEY_CURRENT_USER|HKCU)\\SOFTWARE\\(?:WOW6432Node\\)?(.+)$/i);
  if (!m) return null;
  const hive = /^(HKEY_LOCAL_MACHINE|HKLM)$/i.test(m[1]) ? 'HKLM' : 'HKCU';
  const rest = m[2].replace(/\\+$/, '');
  if (!rest || rest.length > 240 || /[\x00-\x1f]/.test(rest) || rest.split('\\').some(p => !p || p === '.' || p === '..') || /^(Microsoft|Classes|Policies|RegisteredApplications|NeuralFrame)(?:\\|$)/i.test(rest)) return null;
  return { hive, subkey: rest };
}

function findCaseInsensitiveKey(obj, name) {
  if (!obj || typeof obj !== 'object') return null;
  const lower = name.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return null;
}

function collectValuesFromTypedBlock(block, type, gameDir, outValues) {
  if (!block || typeof block !== 'object') return;
  // 先读取默认语言分支（如 english）作为兜底，再由顶层显式键值覆盖
  const preferredLang = findCaseInsensitiveKey(block, 'english') || findCaseInsensitiveKey(block, 'schinese');
  if (preferredLang && typeof preferredLang === 'object') {
    for (const [k, v] of Object.entries(preferredLang)) {
      if (typeof v === 'string') {
        outValues.push({ name: k, type, data: expandInstallVars(v, gameDir) });
      }
    }
  }
  for (const [k, v] of Object.entries(block)) {
    if (typeof v === 'string') {
      const expanded = expandInstallVars(v, gameDir);
      const existing = outValues.findIndex((item) => item.name.toLowerCase() === k.toLowerCase());
      if (existing >= 0) outValues[existing] = { name: k, type, data: expanded };
      else outValues.push({ name: k, type, data: expanded });
    }
  }
}

function collectRegFilesFromTree(node, gameDir, found = []) {
  if (!node || typeof node !== 'object') return found;
  for (const v of Object.values(node)) {
    if (typeof v === 'string') {
      const expanded = expandInstallVars(v, gameDir);
      const matches = expanded.match(/[A-Za-z]:\\[^"<>|*?\r\n]+\.reg/gi) || [];
      for (const m of matches) found.push(m);
    } else if (v && typeof v === 'object') {
      collectRegFilesFromTree(v, gameDir, found);
    }
  }
  return found;
}

function parseVdfRegistry(vdfText, gameDir) {
  const tree = parseVdfTree(vdfText);
  const root = findCaseInsensitiveKey(tree, 'InstallScript') || tree;
  const regNode = findCaseInsensitiveKey(root, 'Registry');
  const entries = [];

  if (regNode && typeof regNode === 'object') {
    for (const [rawKeyPath, keyBody] of Object.entries(regNode)) {
      const norm = normalizeSoftwareSubkey(rawKeyPath);
      if (!norm || !keyBody || typeof keyBody !== 'object') continue;
      const values = [];
      collectValuesFromTypedBlock(findCaseInsensitiveKey(keyBody, 'string'), 'REG_SZ', gameDir, values);
      collectValuesFromTypedBlock(findCaseInsensitiveKey(keyBody, 'dword'), 'REG_DWORD', gameDir, values);
      entries.push({ hive: norm.hive, subkey: norm.subkey, values });
    }
  }

  const regFiles = [...new Set(collectRegFilesFromTree(findCaseInsensitiveKey(root, 'Run Process'), gameDir))];
  return { entries, regFiles };
}

function readRegText(filePath) {
  if (fs.statSync(filePath).size > 1024 * 1024) throw fail('安装脚本超过读取上限');
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

function unescapeRegString(str) {
  return String(str || '').replace(/\\(["\\])/g, '$1');
}

function parseRegFile(regText, gameDir) {
  const lines = String(regText || '').split(/\r?\n/);
  const entries = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;
    while (line.endsWith('\\') && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].trim();
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const rawKey = line.slice(1, -1).trim();
      if (rawKey.startsWith('-')) { current = null; continue; }
      const norm = normalizeSoftwareSubkey(rawKey);
      if (norm) {
        current = { hive: norm.hive, subkey: norm.subkey, values: [] };
        entries.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;

    let name = null;
    let rest = null;
    if (line.startsWith('@=')) {
      name = '(Default)';
      rest = line.slice(2).trim();
    } else {
      const m = line.match(/^"((?:[^"\\]|\\.)*)"\s*=\s*(.*)$/);
      if (m) {
        name = unescapeRegString(m[1]);
        rest = m[2].trim();
      }
    }
    if (name === null || rest === null) continue;

    if (rest.startsWith('"') && rest.endsWith('"')) {
      const val = expandInstallVars(unescapeRegString(rest.slice(1, -1)), gameDir);
      current.values.push({ name, type: 'REG_SZ', data: val });
    } else if (/^dword:[0-9a-fA-F]+$/i.test(rest)) {
      const num = String(parseInt(rest.slice(6), 16) >>> 0);
      current.values.push({ name, type: 'REG_DWORD', data: num });
    }
  }
  return entries;
}

function findInstallScriptFiles(gameDir, exeDir) {
  const dirs = [...new Set([gameDir, exeDir].filter(Boolean).map((d) => path.resolve(d)))];
  const files = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const name of names) {
      if (/^(?:installscript|[\w.-]+_install)\.vdf$/i.test(name)) {
        files.push(journal.safePath(gameDir, path.relative(gameDir, path.join(d, name))));
      }
    }
  }
  return files;
}

function collectInstallRegistry(gameDir, exeDir) {
  const vdfFiles = findInstallScriptFiles(gameDir, exeDir);
  if (!vdfFiles.length) return [];

  const allEntries = [];
  for (const vdfFile of vdfFiles) {
    let text = '';
    try { text = readRegText(vdfFile); } catch { continue; }
    const { entries, regFiles } = parseVdfRegistry(text, gameDir);
    allEntries.push(...entries);
    for (const regFile of regFiles) {
      // Only read references inside this game. Never execute Run Process or
      // import an arbitrary .reg file; only the parsed vendor values are used.
      const safeFile = journal.safePath(gameDir, path.relative(gameDir, regFile));
      if (!fs.existsSync(safeFile)) continue;
      try {
        allEntries.push(...parseRegFile(readRegText(safeFile), gameDir));
      } catch {}
    }
  }

  const values = new Map();
  for (const entry of allEntries) for (const value of entry.values) {
    if (value.name.length > 256 || /[\0\r\n]/.test(value.name) || String(value.data).length > 8192 || /\0/.test(String(value.data))) continue;
    if (value.type === 'REG_DWORD' && !/^(?:0x[\da-f]+|\d+)$/i.test(String(value.data))) continue;
    values.set(`${entry.hive}\\${entry.subkey}\\${value.name}`.toLowerCase(), { hive: entry.hive, subkey: entry.subkey, ...value });
    if (values.size > 512) throw fail('安装脚本包含过多注册表项');
  }
  return [...values.values()];
}

function checkOwned(info, gameDir) {
  if (!info) return null;
  if (info.version !== 1 || info.owned !== true || info.key !== namespace(gameDir)) {
    throw Object.assign(fail('兼容注册表归属与游戏目录不匹配'), { code: 'errUnsafeTarget' });
  }
  return info;
}

async function prepare(gameDir, exeDir, previous, runner = defaultRunner) {
  checkOwned(previous, gameDir);
  const values = collectInstallRegistry(gameDir, exeDir);
  if (!values.length) return { info: previous || null, commit: null };
  const info = { version: 1, owned: true, key: namespace(gameDir) };
  // A deterministic, app-private namespace keeps games and real vendor keys
  // separate. The manifest is persisted before any external commit.
  const existing = await runner('reg.exe', ['query', info.key, '/reg:32']);
  if (!previous && existing.code === 0) throw fail('已有未登记的兼容注册表，请先恢复原始文件');
  return { info, commit: async () => {
    for (const value of values) {
      const key = `${info.key}\\${value.hive}\\${value.subkey}`;
      const name = value.name === '(Default)' || !value.name ? ['/ve'] : ['/v', value.name];
      const current = await runner('reg.exe', ['query', key, ...name, '/reg:32']);
      if (current.code === 0) continue; // Retain changes the game/user made.
      const result = await run(['add', key, ...name, '/t', value.type, '/d', String(value.data), '/f', '/reg:32'], runner);
      if (result.code !== 0) throw fail('兼容注册表准备失败，可通过恢复原始文件清理后重试');
    }
  } };
}

async function detach(info, gameDir, runner = defaultRunner) {
  if (!checkOwned(info, gameDir)) return;
  const result = await run(['delete', info.key, '/f', '/reg:32'], runner);
  if (result.code !== 0 && !await registryKeyAbsent(info.key, runner))
    throw fail('兼容注册表清理失败，请重新尝试恢复');
}

async function registryKeyAbsent(key, runner) {
  // reg.exe uses exit code 1 for both missing keys and access denial. Only an
  // accessible parent that does not list the child proves cleanup succeeded.
  const normalize = value => value.trim().replace(/^HKEY_CURRENT_USER/i, 'HKCU').toLowerCase();
  let child;
  for (let current = key; current; current = current.includes('\\') ? current.slice(0, current.lastIndexOf('\\')) : '') {
    const result = await runner('reg.exe', ['query', current, '/reg:32']);
    if (result.code === 0) return !!child && !String(result.stdout || '').split(/\r?\n/).some(line => normalize(line) === normalize(child));
    child = current;
  }
  return false;
}

module.exports = {
  parseVdfRegistry,
  parseRegFile,
  findInstallScriptFiles,
  collectInstallRegistry, namespace, prepare, detach, checkOwned
};
