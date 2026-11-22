'use strict';
// Runs Windows-only helper programs (currently ReShade Setup) in the exact
// Steam Play prefix used by a game.  Copying DLLs itself is ordinary Linux IO;
// only the setup executable needs Proton.
const fs = require('./preview-fs').fs;
const path = require('path');
const { spawn } = require('child_process');

function protonCandidates(steamRoot, prefix) {
  const libraries = new Set([...require('../library').steamLibraries(steamRoot)].map(root => path.join(root, 'steamapps', 'common')));
  libraries.add(path.resolve(prefix, '../../..', 'common'));
  let configured = [];
  try { configured = fs.readFileSync(path.join(path.dirname(prefix), 'config_info'), 'utf8').trim().split(/\r?\n/); } catch {}
  const candidates = [];
  for (const library of libraries) {
    let names;
    try { names = fs.readdirSync(library); } catch { continue; }
    for (const name of names) {
      if (!/^Proton(?:\s|\d|[-_])/i.test(name)) continue;
      const dir = path.join(library, name);
      const file = path.join(dir, 'proton');
      if (!fs.existsSync(file)) continue;
      // Valve writes the selected tool's fonts and library paths on separate
      // lines. A single display name is also accepted for older prefixes.
      const preferred = configured.some(line => line === name || line.startsWith(dir + path.sep));
      candidates.push({file, preferred});
    }
  }
  return candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred)).map(item => item.file);
}

function contextForSteamGame(game) {
  if (process.platform !== 'linux' || !game || !game.steamRoot || !game.protonPrefix) return null;
  if (!fs.existsSync(game.protonPrefix)) return null;
  const proton = protonCandidates(game.steamRoot, game.protonPrefix)[0];
  return proton ? { proton, prefix: game.protonPrefix, steamRoot: game.steamRoot, appid: game.id } : null;
}

function createSetupRunner(context) {
  return (setupExe, args, log) => new Promise((resolve) => {
    log('runningSetup', { setup: path.basename(setupExe), args: args.slice(1).join(' ') });
    require('./preview-fs').external('外部 Proton 安装器无法生成完整文件预览。');
    const child = spawn(context.proton, ['run', setupExe, ...args], {
      cwd: path.dirname(args[0]),
      env: {
        ...process.env,
        WINEPREFIX: context.prefix,
        STEAM_COMPAT_DATA_PATH: path.dirname(context.prefix),
        STEAM_COMPAT_CLIENT_INSTALL_PATH: context.steamRoot,
        STEAM_COMPAT_APP_ID: context.appid
      }
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    const timeout = setTimeout(() => { try { child.kill(); } catch {} }, 120000);
    child.on('error', (error) => { clearTimeout(timeout); resolve({ code: -1, output: error.message }); });
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, output: output.trim() }); });
  });
}

module.exports = { protonCandidates, contextForSteamGame, createSetupRunner };
