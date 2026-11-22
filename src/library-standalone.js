'use strict';
// Recognise actual game binaries in bounded launcher folders. A launcher or
// an uninstall record alone must not turn an ordinary application into a game.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const container = /^(?:starward|hoyoplay|hoyo games|mihoyo|kuro(?: games)?|games?|wuthering waves(?: game)?|honkai[: ]*star rail(?: games?)?|star rail(?: games?)?|hkrpg_[a-z0-9_]+|鸣潮|崩坏[：:]?星穹铁道|米哈游)$/i;
const file = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function recognize(dir, launcher) {
  if (file(path.join(dir, 'StarRail.exe')) && file(path.join(dir, 'UnityPlayer.dll')))
    return {launcher:launcher || 'HoYoPlay / Starward', id:null, name:'崩坏：星穹铁道', dir:path.resolve(dir), poster:null};
  const client = path.join('Client', 'Binaries', 'Win64', 'Client-Win64-Shipping.exe');
  // Channel installs and user-renamed folders need not use Kuro's directory
  // name. Match both game executables, as the protected installer does.
  if (file(path.join(dir, 'Wuthering Waves Game', client)) ||
      ((/^Wuthering Waves Game$/i.test(path.basename(dir)) || file(path.join(dir, 'Wuthering Waves.exe'))) && file(path.join(dir, client))))
    return {launcher:launcher || 'Kuro Games', id:null, name:'鸣潮', dir:path.resolve(dir), poster:null};
  return null;
}
function fromRoots(roots) {
  const found = [], visited = new Set();
  function visit(root, depth, launcher) {
    const dir = path.resolve(root), key = dir.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    try { const s=fs.lstatSync(dir); if (!s.isDirectory() || s.isSymbolicLink()) return; } catch { return; }
    const game = recognize(dir, launcher);
    if (game) { found.push(game); return; }
    if (!depth) return;
    let entries; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
    for (const e of entries.slice(0,512)) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const child=path.join(dir,e.name), label=/^starward$/i.test(e.name)?'Starward':launcher;
      // Always check an immediate child's exact game markers, even when the
      // user renamed that folder. Only known launcher containers are descended.
      const direct=recognize(child,label);
      if (direct) { const k=path.resolve(child).toLowerCase();if(!visited.has(k)){visited.add(k);found.push(direct);} }
      else if (container.test(e.name)) visit(child,depth-1,label);
    }
  }
  for (const root of new Set(roots.filter(Boolean))) visit(root,4,null);
  return found;
}
function commandExecutable(value) {
  if (typeof value !== 'string') return null;
  // DisplayIcon may end in ",0"; uninstall commands may contain arguments.
  // Read the executable path only. Never execute an installer command.
  const match=value.trim().match(/^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|,|$)/i);
  const executable=match && (match[1]||match[2]);
  return executable && path.isAbsolute(executable) ? executable : null;
}
function commandDirectory(value) {
  const file = commandExecutable(value);
  return file ? path.dirname(file) : null;
}
// Read both Windows registry views in one process; reg.exe uses the active code page.
function uninstallRecords() {
  const query = String.raw`
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $base = 'Microsoft\Windows\CurrentVersion\Uninstall'
    $found = foreach ($hive in @([Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine)) {
      foreach ($prefix in @('SOFTWARE', 'SOFTWARE\WOW6432Node')) {
        $entries = $hive.OpenSubKey($prefix + '\' + $base)
        if (!$entries) { continue }
        try {
          foreach ($name in $entries.GetSubKeyNames()) {
            $app = $null
            try {
              $app = $entries.OpenSubKey($name)
              if (!$app) { continue }
              $publisher = [string]$app.GetValue('Publisher')
              if ($publisher -notmatch 'NetEase|网易' -and $name -notmatch 'Wuthering|Star.?Rail|Honkai|hkrpg|HoYoPlay|Starward|鸣潮|星穹') { continue }
              [pscustomobject]@{name=$name; title=$app.GetValue('DisplayName'); publisher=$publisher;
                url=$app.GetValue('URLInfoAbout'); location=$app.GetValue('InstallLocation');
                icon=$app.GetValue('DisplayIcon'); uninstall=$app.GetValue('UninstallString')}
            } catch [System.Security.SecurityException] { continue }
              catch [System.UnauthorizedAccessException] { continue }
            finally { if ($app) { $app.Dispose() } }
          }
        } finally { $entries.Dispose() }
      }
    }
    ConvertTo-Json -InputObject @($found) -Compress
  `;
  try {
    const json=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',query],
      {encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
    const records=JSON.parse(json);
    return Array.isArray(records) ? records : [];
  } catch { return []; }
}
const neteasePublishers = new Set(['netease','netease games','netease, inc.','netease games global',
  'netease (hangzhou) network co., ltd.','netease interactive entertainment pte. ltd.','网易','网易游戏',
  '杭州网易雷火科技有限公司','广州网易计算机系统有限公司','网易（杭州）网络有限公司','杭州网易雷火科技有限公司广州分公司']);
const neteaseSites = new Set(['yjwujian.cn','yysls.cn','16.163.com','n.163.com','xyq.163.com','qrsj.163.com','oncehuman.game']);
const neteaseTitles = new Set(['永劫无间','naraka: bladepoint','燕云十六声','where winds meet','逆水寒','梦幻西游','七日世界','once human']);
function neteaseTitle(record) {
  const title = String(record.title || '').trim();
  if (/^(?:Steam App|Uplay Install)\s+\d+$/i.test(record.name || '')) return null;
  if (!title || !neteasePublishers.has(String(record.publisher || '').trim().toLowerCase())) return null;
  if (neteaseTitles.has(title.toLowerCase())) return title;
  try {
    const site = new URL(record.url);
    if (['http:', 'https:'].includes(site.protocol) && neteaseSites.has(site.hostname.replace(/^www\./,''))) return title;
  } catch { /* Registrations may omit the optional product website. */ }
  return null;
}
module.exports={recognize,fromRoots,commandDirectory,commandExecutable,uninstallRecords,neteaseTitle};
