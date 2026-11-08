'use strict';

// Vulkan does not load a proxy DLL from the executable directory. ReShade is
// therefore registered as an implicit layer for the current Windows user.
// This follows the same HKCU layout used by ReShade and DLSS5-Autopilot and
// keeps a reference list so restoring one emulator cannot break another.
const fs = require('./preview-fs').fs;
const path = require('path');
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Khronos\\Vulkan\\ImplicitLayers';

function defaultRunner(file, args) {
  if (require('./preview-fs').active() && args[0] !== 'query') {
    require('./preview-fs').active().externalSteps?.push({ file, args });
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  }
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0), stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function readUsers(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'installs.json'), 'utf8'));
    if (!Array.isArray(data.games) || !data.games.every(item => typeof item === 'string' && path.isAbsolute(item))) {
      throw new Error('Invalid Vulkan layer ownership record');
    }
    return data.games;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeUsers(dir, games) {
  await require('./file-journal').atomicJson(path.join(dir, 'installs.json'), { version: 1, games });
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

const layerFiles = ['ReShade64.dll', 'ReShade64.json', 'ReShade32.dll', 'ReShade32.json', 'installs.json'];
function checkOwnedTarget(info, targetDir) {
  if (!info?.owned) return null;
  if (info.owned !== true || typeof targetDir !== 'string' || !path.isAbsolute(targetDir) ||
      typeof info.dir !== 'string' || !path.isAbsolute(info.dir) || !samePath(targetDir, info.dir) ||
      (info.manifest != null && (typeof info.manifest !== 'string' || !path.isAbsolute(info.manifest) ||
        !['ReShade64.json', 'ReShade32.json'].some(name => samePath(path.join(targetDir, name), info.manifest))))) {
    throw Object.assign(new Error('Vulkan layer directory does not match this application profile'), { code: 'errUnsafeTarget' });
  }
  const dir = path.resolve(targetDir);
  const {safePath} = require('./file-journal');
  for (const name of layerFiles) safePath(path.dirname(dir), path.join(path.basename(dir), name));
  return { ...info, dir };
}

async function existing(runner) {
  const result = await runner('reg.exe', ['query', KEY]);
  if (result.code !== 0) return null;
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(.+?\.json)\s+REG_DWORD\s+0x0\s*$/i);
    if (!match || !/reshade/i.test(match[1])) continue;
    if (fs.existsSync(match[1].trim())) return path.resolve(match[1].trim());
  }
  return null;
}

async function register(options) {
  const { sourceDir, targetDir, gameDir, bitness = 64, runner = defaultRunner } = options;
  const current = await existing(runner);
  const our64 = path.join(targetDir, 'ReShade64.json');
  const ours = current && samePath(current, our64);
  if (current && !ours) return { manifest: current, owned: false, global: true };

  const info = { manifest: our64, owned: true, global: true, dir: targetDir };
  const commit = () => installLayerFiles(sourceDir, targetDir, gameDir, bitness, runner);
  // Keep registry changes until every game-local stage and version override
  // succeeded. The game manifest records the shared-layer owner first.
  if (!require('./file-journal').deferExternal(gameDir, our64 + ':' + bitness, commit)) await commit();
  return info;
}

async function installLayerFiles(sourceDir, targetDir, gameDir, bitness, runner) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  // Record the owner before the first shared write, so Restore can retry a
  // registration interrupted after only one file or registry value.
  const games = readUsers(targetDir);
  if (!games.some(item => samePath(item, gameDir))) {
    games.push(path.resolve(gameDir));
    await writeUsers(targetDir, games);
  }
  const names = bitness === 32
    ? ['ReShade64.dll', 'ReShade64.json', 'ReShade32.dll', 'ReShade32.json']
    : ['ReShade64.dll', 'ReShade64.json'];
  for (const name of names) {
    await fs.promises.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
  }
  for (const manifestName of names.filter((name) => name.endsWith('.json'))) {
    const file = path.join(targetDir, manifestName);
    const data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    data.layer = data.layer || {};
    data.layer.library_path = `.\\${manifestName.replace(/\.json$/i, '.dll')}`;
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    const result = await runner('reg.exe', ['add', KEY, '/v', file, '/t', 'REG_DWORD', '/d', '0', '/f']);
    if (result.code !== 0) throw new Error(`Vulkan layer registration failed: ${result.stderr || result.stdout}`);
  }

}

async function detach(info, gameDir, runner = defaultRunner) {
  if (!info || !info.owned || !info.dir) return false;
  checkOwnedTarget(info, info.dir);
  const users = readUsers(info.dir);
  const games = users.filter((item) => !samePath(item, gameDir));
  if (games.length === users.length) return false;
  if (games.length) {
    await writeUsers(info.dir, games);
    return false;
  }

  for (const name of ['ReShade64.json', 'ReShade32.json']) {
    const file = path.join(info.dir, name);
    const result = await runner('reg.exe', ['delete', KEY, '/v', file, '/f']);
    if (result.code !== 0 && !await registryValueAbsent(runner, file)) {
      throw new Error(`Vulkan layer removal failed: ${result.stderr || result.stdout || file}`);
    }
  }
  // Keep the last owner's record until all registry and file changes succeed,
  // so a failed detach can retry while the application still knows its owner.
  for (const name of layerFiles) {
    try { await fs.promises.unlink(path.join(info.dir, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { await fs.promises.rmdir(info.dir); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  return true;
}

// reg.exe reports both "missing" and "access denied" with exit code 1.
// Query a readable parent to prove absence without parsing localized errors.
async function registryValueAbsent(runner, file) {
  let child;
  for (let key = KEY; key.includes('\\'); key = key.slice(0, key.lastIndexOf('\\'))) {
    const result = await runner('reg.exe', ['query', key]);
    if (result.code === 0) {
      const lines = result.stdout.split(/\r?\n/);
      if (child) return !lines.some(line => line.trim().replace(/^HKEY_CURRENT_USER/i, 'HKCU').toLowerCase() === child.toLowerCase());
      return !lines.some(line => {
        const value = /^\s*(.+?)\s+REG_\w+\b/i.exec(line);
        return value && samePath(value[1].trim(), file);
      });
    }
    child = key;
  }
  return false;
}

module.exports = { KEY, register, detach, checkOwnedTarget, existing, defaultRunner };
