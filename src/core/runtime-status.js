'use strict';
// Read-only, bounded probes. Configuration, module presence and successful
// rendering are separate facts. No DLL injection, GPU polling or game writes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFile} = require('child_process');
const FRESH_MS = 30000, MAX_LOG = 256 * 1024;
const key = p => path.resolve(p).toLowerCase();
const ms = value => new Date(value).getTime();
const state = (code, label, detail, extra = {}) => ({state:code,label,detail,...extra});
const logs = ['ReShade.log','dlss5-feed.log','dlss5-feed-host.log','OptiScaler.log','RTXMFG-Universal.log'];
function queryProcesses(executables) {
  if (process.platform !== 'win32') return Promise.resolve({processes:[],unsupported:true});
  return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
    // PowerShell cannot open files inside app.asar. Electron reads the fixed
    // bundled script; only the script (never a game path) is encoded as code.
    ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(fs.readFileSync(path.join(__dirname,'runtime-processes.ps1'),'utf8'),'utf16le').toString('base64')],
    {windowsHide:true,timeout:8000,maxBuffer:2*1024*1024,encoding:'utf8',env:{...process.env,ENHANCED_RUNTIME_QUERY:JSON.stringify({executables})}},
    (error, stdout) => { if (error) return reject(error); try { resolve(JSON.parse(stdout.replace(/^\uFEFF/,''))); } catch (e) { reject(e); } }));
}
function readTail(file) {
  let fd;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    fd = fs.openSync(file,'r');
    const n = Math.min(stat.size,MAX_LOG); let offset = stat.size-n;
    const buf=Buffer.alloc(n);fs.readSync(fd,buf,0,n,offset);
    // Never parse a truncated first line or a partly-written last JSON object.
    let text=buf.toString('utf8'); if(offset) { const cut=buf.indexOf(10)+1; text=buf.subarray(cut).toString('utf8');offset+=cut; }
    const head=Buffer.alloc(Math.min(stat.size,4096));fs.readSync(fd,head,0,head.length,0);
    return {file,text,head:head.toString('utf8'),size:stat.size,mtime:stat.mtimeMs,birth:stat.birthtimeMs,offset};
  } catch { return null; } finally { if(fd!==undefined)fs.closeSync(fd); }
}
function lineTime(line, fileTime) {
  const date = line.match(/\b(20\d\d-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)\b/);
  if(date) return ms(date[1]);
  const clock=line.match(/^\[?(\d\d):(\d\d):(\d\d)(?:[.:](\d{1,3}))?/);
  if(!clock) return null;
  const d=new Date(fileTime);d.setHours(+clock[1],+clock[2],+clock[3],+(clock[4]||'0').padEnd(3,'0'));
  if(d.getTime()>fileTime+2000)d.setDate(d.getDate()-1);
  return d.getTime();
}
function logEvents(log, proc, now, previous) {
  const start=ms(proc.startedAt);
  if(log.mtime<start-2000 || log.mtime>now+2000) return [];
  // Clock-only logs need a current startup marker or a new file. Otherwise
  // accept only bytes observed being appended during this exact PID session.
  const init=log.head.split(/\r?\n/).find(s=>/Initializing.*ReShade|ReShade.*initialized|RTXMFG build=/i.test(s));
  const initTime=init?lineTime(init,log.mtime):null;
  const session=log.birth>=start-2000 || (initTime!==null && initTime>=start-2000);
  let text=log.text;
  let delta=false;
  if(!session && previous && previous.size<log.size && previous.mtime<log.mtime && previous.size>=log.offset) {
    // Byte offsets, not JS string indexes (logs may contain Chinese).
    text=Buffer.from(log.text).subarray(previous.size-log.offset).toString('utf8');
    if(!previous.complete)text=text.slice(text.indexOf('\n')+1);delta=true;
  }
  return text.split(/\r?\n/).flatMap(line=>{
    if(!line.trim())return [];
    const dated=/\b20\d\d-\d\d-\d\d[T ]\d\d:/.test(line);
    if(!session && !delta && !dated) return [];
    const at=lineTime(line,log.mtime) ?? (delta?log.mtime:null);
    if(at===null || at<start-2000 || at>now+2000) return [];
    return [{line,at,file:log.file}];
  });
}
function parseEvents(events, now) {
  let nr=null,mfg=null,requested=null;
  const evidence=[];
  const note=(event,kind,code,label,detail,extra={})=>{
    const value=state(code,label,detail,{at:event.at,source:event.file,evidence:event.line.slice(0,700),...extra});
    if(kind==='nr')nr=value;else mfg=value;
    evidence.push({...value,feature:kind});
  };
  for(const e of [...events].sort((a,b)=>a.at-b.at)) {
    const s=e.line;
    // This is the plugin's successful-evaluation counter for the interval,
    // not the number of intercepted calls and not its saved enable switch.
    const evals=s.match(/telemetry\b.*\bnr\[evals=(\d+)/i);
    if(evals) note(e,'nr',+evals[1]>0?'active':'idle',+evals[1]>0?'正在执行神经渲染':'当前采样未执行',`本次遥测窗口成功执行 ${evals[1]} 帧。`,{evaluatedFrames:+evals[1]});
    else if(/NR-VERDICT\b/.test(s)) {
      const v=s.match(/\bstate=([A-Z_]+)/)?.[1];
      if(v==='ENGAGED') note(e,'nr','observed','本次运行已生效','插件报告 ENGAGED；当前是否持续执行，以新的成功帧遥测为准。');
      else if(v) note(e,'nr',/OFF|DISABLED/.test(v)?'off':'idle',/OFF|DISABLED/.test(v)?'神经渲染已关闭':'尚未进入神经渲染',`插件状态：${v}。`);
    }
    else if(/(?:DLSSNR|DLSS5|Neural|feature\s*18|NR).*?(?:0xbad00001|not supported|unsupported GPU)|Failed to load nvngx_dlssnr/i.test(s)) note(e,'nr','error','神经渲染加载失败',/0xbad00001/i.test(s)?'NGX 返回 0xBAD00001：GPU 或提供程序不受支持。':'插件报告神经运行库不支持或加载失败。');
    else if(/NR_LAB_READBACK Enable DLSS Neural Rendering=0(?:\.0+)?\b/.test(s)) note(e,'nr','off','神经渲染已关闭','原始插件回读的开关为关闭。');
    else if(/DLSSNR.*initialized|CreateFeature.*18.*succeeded|NR runtime loaded/i.test(s)) note(e,'nr','initialized','神经运行库已初始化','尚未收到成功执行帧的证据。');
    // These are provider counts, not an "effective request" or a configured multiplier.
    const frames=s.match(/mfgunlock: slDLSSGGetState reports\s+(\d+)\s+frame/i) || s.match(/DLSS-G state sample: frames presented since prior query=(\d+)/i);
    if(frames) note(e,'mfg',+frames[1]>=2?'active':'idle',+frames[1]>=2?`提供程序已呈现 ${frames[1]} 帧`:'当前未观察到补帧',`DLSS-G 在两次状态查询之间报告 ${frames[1]} 帧；这不是显示器实测帧率，也不单独证明固定倍率。`,{providerPresentations:+frames[1]});
    if(frames && /status=[1-9]\d*/i.test(s))note(e,'mfg','error','帧生成报告错误','该呈现采样同时带有非零运行状态。');
    if(/mfgunlock: slDLSSGGetState runtime status is 0x[1-9a-f]/i.test(s)) note(e,'mfg','error','帧生成报告错误','DLSS-G 返回非零运行状态，请查看原始证据。');
    const req=s.match(/(?:ForceMultiplier|requested multiplier|Effective request)\s*[:=]\s*(\d+)x?/i);
    if(req) requested=+req[1];
  }
  for(const item of [nr,mfg])if(item && now-item.at>FRESH_MS) {
    item.lastState=item.state;item.state='stale';item.label='本次记录已过期';
    item.detail='插件有本次启动的记录，但超过 30 秒没有新状态；不能据此确认当前仍在生效。';
  }
  return {nr,mfg,requested,evidence:evidence.slice(-12)};
}
function parseMfgStatus(log, proc, now) {
  if(!log || log.size>MAX_LOG || log.mtime<ms(proc.startedAt) || now-log.mtime>FRESH_MS || log.mtime>now+2000)return null;
  let s;try{s=JSON.parse(log.text);}catch{return null;}
  if(Number(s.pid)!==proc.pid)return null;
  const birth=log.text.match(/"processBirth"\s*:\s*"?(\d+)/)?.[1];
  if(birth && proc.processBirth && birth!==proc.processBirth)return null;
  const extra={at:log.mtime,source:log.file,requestedMultiplier:Number(s.multiplier)||null,appliedMultiplier:Number(s.appliedMultiplier)||null,pending:s.pending===true,
    evidence:`PID=${s.pid}; getStateResult=${s.getStateResult}; dlssgStatus=${s.dlssgStatus}; actualFramesPresented=${s.actualFramesPresented}; stateSampleAgeMs=${s.stateSampleAgeMs}`};
  if(s.restartRequired || s.streamlineRebuildRequired)return state('restart','需要重启游戏','插件明确报告重建或重启请求。',extra);
  if(s.getStateSeen && (s.getStateResult!==0 || s.dlssgStatus!==0))return state('error','帧生成报告错误','DLSS-G 状态调用或运行状态返回错误。',extra);
  if(s.applied===true && s.appliedFrameGenerationOn===false)return state('off','帧生成已关闭','插件确认当前应用的帧生成开关为关闭。',extra);
  if(s.getStateSeen===true && s.getStateResult===0 && s.dlssgStatus===0 && Number.isFinite(s.stateSampleAgeMs) && s.stateSampleAgeMs+now-log.mtime<=FRESH_MS && s.stateSampleAgeMs>=0) {
    const count=Number(s.actualFramesPresented);
    extra.providerPresentations=count;
    // Applied multiplier is the accepted request. Keep separate from provider output.
    if(s.fpsSampleAgeMs+now-log.mtime<=FRESH_MS && s.fpsSampleWindowMs>0) {
      extra.sourceFps=s.realFpsMilli/1000;extra.reportedOutputFps=s.dlssFpsMilli/1000;
    }
    return state(count>=2?'active':'idle',count>=2?`帧生成生效 · 提供程序 ${count} 帧`:'当前未观察到补帧',`已应用请求 ${s.appliedMultiplier || '—'}×；提供程序呈现 ${count} 帧${s.pending?'，新倍率请求仍在等待应用':''}。`,extra);
  }
  return state('waiting','插件在线，等待输出采样','已读到当前游戏的状态文件；尚无新鲜、成功的 DLSS-G 输出状态。',extra);
}
function moduleState(runtime, file) {
  if(!/\.(dll|addon32|addon64|asi|exe)$/i.test(file))return state('resource','配置 / 资源','此类文件不作为进程模块加载。');
  const modules=runtime.modules||[];
  if(modules.some(m=>key(m.path)===key(file)))return state('loaded','已加载','在当前游戏进程的模块表中找到同一路径。');
  if(modules.some(m=>m.name.toLowerCase()===path.basename(file).toLowerCase()))return state('other_path','从其他路径加载','当前进程使用了同名文件的另一份副本；展开运行时证据查看路径。');
  if(runtime.processState==='stopped')return state('stopped','游戏未运行','没有匹配到游戏进程。');
  if(runtime.processState!=='running' || runtime.process?.moduleError)return state('unreadable','无法读取模块','进程权限受限、无法匹配或模块枚举失败。');
  return state('not_loaded','模块表未发现','当前模块表未发现此文件；手动映射模块可能不在系统模块表中。');
}
class RuntimeStatus {
  constructor({scanGame,query=queryProcesses,clock=Date.now,temp=os.tmpdir()}={}) {
    this.scan=scanGame || require('./scan').scanGame;this.query=query;this.clock=clock;this.temp=temp;
    this.history=new Map();this.cache=new Map();this.scans=new Map();this.inflight=new Map();
  }
  inspect(dir) {
    if(typeof dir!=='string' || !path.isAbsolute(dir))return Promise.reject(Error('无效的游戏目录'));
    const k=key(dir),cached=this.cache.get(k),now=this.clock();
    if(cached && now-cached.checkedAt<2500)return Promise.resolve(cached);
    if(this.inflight.has(k))return this.inflight.get(k);
    const promise=this.probe(dir).then(result=>{this.cache.set(k,result);if(this.cache.size>32)this.cache.delete(this.cache.keys().next().value);return result;}).finally(()=>this.inflight.delete(k));
    this.inflight.set(k,promise);return promise;
  }
  async probe(dir) {
    let scan=this.scans.get(key(dir));
    if(!scan || this.clock()-scan.at>30000){scan={value:await this.scan(dir),at:this.clock()};this.scans.set(key(dir),scan);if(this.scans.size>32)this.scans.delete(this.scans.keys().next().value);}
    const candidates=[scan.value.chosen,...(scan.value.exeCandidates||[])].filter(Boolean).filter(x=>!/(?:crash|launcher|unins|helper|dlss5-feed-host)/i.test(path.basename(x.path)));
    const executables=[...new Set(candidates.map(x=>x.path))];
    if(!executables.length)return this.empty('unreadable','未定位游戏可执行文件','请检查所选游戏目录或手动指定实际游戏 EXE；启动器不用于判断游戏运行状态。');
    let answer;try{answer=await this.query(executables);}catch{return this.empty('unreadable','进程检测失败','进程查询超时或被系统拒绝；可稍后刷新。');}
    const now=this.clock(),found=(answer.processes||[]).filter(p=>executables.some(e=>key(e)===key(p.exe)));
    if(answer.unsupported)return this.empty('unreadable','系统暂不支持','当前检测仅支持 Windows 游戏进程。');
    if(!found.length)return this.empty(answer.unreadable?.length?'unreadable':'stopped',answer.unreadable?.length?'无法确认游戏进程':'游戏未运行',answer.unreadable?.length?'发现同名进程，但系统不允许读取路径；请让管理器与游戏使用相同权限后刷新。':'启动此游戏并进入实际场景，再点击检测。');
    if(found.length>1)return this.empty('ambiguous','检测到多个游戏进程','同一游戏有多个实例；关闭多余实例后刷新，避免混用不同进程的证据。');
    const proc=found[0],modules=proc.modules||[],session=`${proc.pid}:${proc.startedAt}:${key(proc.exe)}`;
    const folders=[path.dirname(proc.exe),dir,path.join(path.dirname(proc.exe),'host64')];
    const files=new Map();for(const folder of folders)for(const name of [...logs,'RTXMFG-Universal.status.json'])files.set(key(path.join(folder,name)),path.join(folder,name));
    // RTXMFG 1.7 may publish diagnostics in per-executable temporary folders.
    // Only status files with the exact PID (and process birth when provided)
    // are accepted. No recursive disk scan and no arbitrary log paths followed.
    try{let budget=60;for(const entry of fs.readdirSync(this.temp,{withFileTypes:true})){if(!/^RTXMFG/i.test(entry.name)||--budget<0)continue;const p=path.join(this.temp,entry.name);if(entry.isFile() && /status\.json$/i.test(entry.name))files.set(key(p),p);else if(entry.isDirectory())for(const n of fs.readdirSync(p).slice(0,60))if(/status\.json$/i.test(n))files.set(key(path.join(p,n)),path.join(p,n));}}catch{}
    const events=[],warnings=[],statuses=[];
    for(const file of files.values()) {
      const log=readTail(file);if(!log)continue;
      if(/status\.json$/i.test(file)){const status=parseMfgStatus(log,proc,now);if(status)statuses.push(status);else warnings.push(`${path.basename(file)}：旧状态、不同进程或缺少有效会话信息，已忽略。`);continue;}
      const hk=session+'|'+key(file),prev=this.history.get(hk);
      const fresh=logEvents(log,proc,now,prev);
      const retained=log.size>=(prev?.size||0)?(prev?.events||[]):[];
      const combined=[...new Map([...retained,...fresh].filter(e=>/telemetry.*nr\[|NR-VERDICT|0xbad00001|not supported|unsupported GPU|Failed to load nvngx_dlssnr|NR_LAB_READBACK|initialized|CreateFeature.*18|NR runtime loaded|slDLSSGGetState|DLSS-G state sample|ForceMultiplier|requested multiplier|Effective request/i.test(e.line)).map(e=>[`${e.at}:${e.line}`,e])).values()].slice(-40);
      events.push(...combined);this.history.set(hk,{size:log.size,mtime:log.mtime,complete:log.text.endsWith('\n'),events:combined});
      if(log.mtime<ms(proc.startedAt))warnings.push(`${path.basename(file)}：早于本次启动，已忽略。`);
    }
    while(this.history.size>150)this.history.delete(this.history.keys().next().value);
    const parsed=parseEvents(events,now),has=regex=>modules.some(m=>regex.test(m.name));
    const fallback=(loaded)=>proc.moduleError?state('unreadable','模块读取受限','游戏进程存在，但系统不允许枚举模块；请使用相同权限运行管理器与游戏。'):loaded?state('loaded','已加载，等待运行证据','模块已进入游戏；当前插件尚未提供可确认成功执行的新遥测。进入实际场景后刷新；仅加载 DLL 不代表生效。'):state('not_loaded','未发现运行模块','系统模块表未发现对应运行库 / 插件。检查是否安装到实际游戏 EXE 目录；手动映射的插件需以日志为准。');
    const mfg=statuses.sort((a,b)=>b.at-a.at)[0] || parsed.mfg || fallback(has(/nvngx_dlssg|renodx-mfg|MFGUnlock/i));
    const nr=parsed.nr || fallback(has(/nvngx_dlssnr|renodx-dlss|dlss5-feed/i));
    return {ok:true,checkedAt:now,processState:'running',process:proc,modules,nr,mfg,warnings:[...new Set(warnings)].slice(0,8),evidence:parsed.evidence,requestedMultiplier:mfg.requestedMultiplier||parsed.requested};
  }
  empty(code,label,detail){return{ok:true,checkedAt:this.clock(),processState:code,process:null,modules:[],nr:state(code,label,detail),mfg:state(code,label,detail),warnings:[],evidence:[]};}
}
module.exports={RuntimeStatus,queryProcesses,parseEvents,parseMfgStatus,logEvents,moduleState,readTail,FRESH_MS};
