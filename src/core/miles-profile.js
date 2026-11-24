'use strict';
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const journal = require('./file-journal');
const { active: preview } = require('./preview-fs');
const { isSteamMiles } = require('./steam-identity');
const valid = n => n === null || (Number.isInteger(n) && n >= 0 && n <= 15);
const same = (a,b) => path.relative(a,b) === '';

async function invoke(write, expected = null, next = null) {
  if (!valid(expected) || !valid(next) || process.platform !== 'win32') throw Error('无法访问 NVIDIA 游戏配置。');
  const shell = path.join(process.env.SystemRoot,process.arch==='ia32' ? 'Sysnative':'System32','WindowsPowerShell/v1.0/powershell.exe');
  // Read the embedded source through Node so packaged Electron ASARs work too.
  const source = fs.readFileSync(path.join(__dirname,'MilesDriverProfile.cs')).toString('base64');
  const code = "$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=[Text.Encoding]::UTF8\n" +
    "try { Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())))\n" +
    '[Console]::WriteLine([MilesDriverProfile]::Run('+(write?'$true':'$false')+','+(expected??-1)+','+(next??-1)+
    ")) } catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }";
  return new Promise((resolve,reject)=>{
    const child=execFile(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],
      {windowsHide:true,timeout:30000,maxBuffer:65536,encoding:'utf8'},(error,stdout,stderr)=>{
        const raw=stdout.trim().replace(/^\uFEFF/,'');
        if (error || !/^(?:-1|[0-9]|1[0-5])$/.test(raw)) return reject(Error('无法同步《迈尔斯》的 NVIDIA 游戏倍率。'+(stderr.trim() || error?.message || raw)));
        resolve(raw==='-1' ? null : Number(raw));
      });
    child.stdin.on('error',()=>{}); // execFile reports early exit through its callback
    child.stdin.end(source);
  });
}
const driver = {read:()=>invoke(false), replace:(before,next)=>invoke(true,before,next)};

function paths(base) {
  if (!base || !path.isAbsolute(base)) throw Error('无法定位游戏倍率恢复记录。');
  return {file:journal.safePath(base,'NeuralFrame/driver-profiles/miles-steam.json'),
    upstream:journal.safePath(base,'RTXFGManager/driver-profiles/miles-steam.json')};
}
function saved(file) {
  if (!fs.existsSync(file)) return null;
  const stat=fs.statSync(file);
  if (!stat.isFile() || stat.size>32768) throw Error('游戏倍率恢复记录无效。');
  const r=JSON.parse(fs.readFileSync(file,'utf8'));
  if (r?.schema!==1 || typeof r.gameDir!=='string' || !path.isAbsolute(r.gameDir) || typeof r.exe!=='string' ||
      !path.isAbsolute(r.exe) || path.basename(r.exe).toLowerCase()!=='milesmorales.exe' ||
      ![r.original,r.previous,r.applied].every(valid)) throw Error('游戏倍率恢复记录无效。');
  journal.safePath(r.gameDir,path.relative(r.gameDir,r.exe));
  return r;
}
async function plan(gameDir,exe,count,settings,loc) {
  const prior=saved(loc.file);
  if (prior && (!same(prior.gameDir,gameDir) || !same(prior.exe,exe))) {
    if (count!==null) throw Error('另一个《迈尔斯》游戏目录正在管理 NVIDIA 倍率。');
    return null;
  }
  if (count===null && !prior) return null;
  if (fs.existsSync(loc.upstream)) throw Error('RTXManager 仍在管理该游戏的 NVIDIA 倍率，请先在其中还原。');
  const current=await settings.read();
  if (!valid(current)) throw Error('现有驱动倍率超出支持范围。');
  const managed=prior && (current===prior.applied || current===prior.previous);
  if (count!==null && prior && !managed) throw Error('驱动倍率已被其他程序修改。请先选择跟随驱动默认。');
  if (!prior && count===current) return null;
  const next=count!==null ? count : managed ? prior.original : current;
  return {prior,current,next};
}
// A Windows named pipe provides a process-wide, crash-released lock across
// separate app instances and copies of the game. No stale lock file to break.
async function withLock(work) {
  const server=net.createServer(socket=>socket.destroy());
  const address=process.platform==='win32' ? '\\\\.\\pipe\\NeuralFrame-Miles-DRS-v1' : path.join(require('node:os').tmpdir(),'neuralframe-miles-drs.sock');
  await new Promise((resolve,reject)=>server.once('error',reject).listen(address,resolve)).catch(()=>{throw Error('游戏驱动倍率正在由另一个操作处理。');});
  try { return await work(); } finally { await new Promise(resolve=>server.close(resolve)); }
}
async function schedule(gameDir,exe,count,{settings=driver,base=process.env.ProgramData}={}) {
  if (count!==null && (!Number.isInteger(count) || count<1 || count>5 || !isSteamMiles(exe))) throw Error('Steam 游戏身份或倍率无效。');
  const loc=paths(base);
  const action=await plan(gameDir,exe,count,settings,loc);
  if (!action) return false;
  const format=n=>n===null ? '驱动默认' : String(n+1)+'×';
  if (preview()) {
    preview().externalSteps.push({file:'NVIDIA · MilesMorales.exe',args:[format(action.current),'→',format(action.next)]});
    return count!==null;
  }
  const commit=()=>withLock(async()=>{
    if (count!==null && !isSteamMiles(exe)) throw Error('Steam 游戏身份已变化，请重新扫描。');
    const verified=await plan(gameDir,exe,count,settings,paths(base));
    if (!verified || verified.current!==action.current || JSON.stringify(verified.prior)!==JSON.stringify(action.prior))
      throw Error('驱动配置在预览后发生了变化，请重新应用。');
    const {prior,current,next}=verified;
    if (count!==null) {
      const receipt={schema:1,exe:path.resolve(exe),gameDir:path.resolve(gameDir),original:prior ? prior.original : current,previous:current,applied:next};
      await journal.atomicJson(loc.file,receipt);
      if (current!==next) await settings.replace(current,next);
      if (receipt.previous!==next) await journal.atomicJson(loc.file,{...receipt,previous:next});
    } else {
      if (current!==next) await settings.replace(current,next);
      await fs.promises.unlink(loc.file);
    }
  });
  if (!journal.deferExternal(gameDir,'miles-driver-profile',commit)) await commit();
  return count!==null;
}
function owns(gameDir,base=process.env.ProgramData) {
  if (!base || !path.isAbsolute(base)) return false;
  // Restoring an unrelated game must also work if this title has a damaged
  // receipt. A manifest declaring Miles ownership goes through strict detach.
  try {
    const file=journal.safePath(base,'NeuralFrame/driver-profiles/miles-steam.json');
    const r=saved(file);
    return !!r && same(r.gameDir,gameDir);
  } catch { return false; }
}
async function detach(gameDir,options) {
  const r=saved(paths(options?.base || process.env.ProgramData).file);
  if (r && same(r.gameDir,gameDir)) await schedule(gameDir,r.exe,null,options);
}
module.exports={schedule,detach,owns,driver};
