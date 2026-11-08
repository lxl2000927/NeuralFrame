'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {RuntimeStatus,parseEvents,parseMfgStatus,logEvents,moduleState,readTail,FRESH_MS}=require('../src/core/runtime-status');
const now=Date.parse('2026-11-05T12:00:30Z');
const proc={pid:77,exe:path.resolve('game/Game.exe'),startedAt:new Date(now-20000).toISOString(),processBirth:'134067000000000001',modules:[],moduleError:null};
const e=(line,at=now)=>({line,at,file:'ReShade.log'});
const status=(s,at=now)=>({file:'RTXMFG-Universal.status.json',text:JSON.stringify({pid:77,...s}),mtime:at,size:100});
test('successful interval counters, not enable flags or Evaluate calls, prove NR work',()=>{
  assert.equal(parseEvents([e('NR runtime loaded'),e('DLSSNR EvaluateFeature 18 failed')],now).nr.state,'initialized');
  assert.equal(parseEvents([e('DLSS5 enabled=1')],now).nr,null);
  assert.equal(parseEvents([e('NR-VERDICT state=ENGAGED evals=900')],now).nr.state,'observed');
  assert.equal(parseEvents([e('telemetry t=2s nr[evals=42 cpu_us_avg=1]')],now).nr.state,'active');
  assert.equal(parseEvents([e('telemetry t=2s nr[evals=42]'),e('telemetry t=3s nr[evals=0]',now+1)],now+1).nr.state,'idle');
  assert.equal(parseEvents([e('feature 18 create failed with 0xbad00001')],now).nr.state,'error');
  assert.equal(parseEvents([e('feature 18 create failed with 0xbad00001'),e('telemetry nr[evals=3]',now+1)],now+1).nr.state,'active');
});
test('MFG requests and estimated FPS never establish generation',()=>{
  const r=parseEvents([e('effective multiplier: 4x'),e('Effective request: 4x'),e('Blackwell kernels: Active'),e('Estimated output FPS: 200')],now);
  assert.equal(r.mfg,null);assert.equal(r.requested,4);
  const real=parseEvents([e('mfgunlock: slDLSSGGetState reports 3 frame(s) actually presented since its previous call.')],now).mfg;
  assert.equal(real.providerPresentations,3);assert.equal(real.state,'active');assert.equal(real.appliedMultiplier,undefined);
  assert.equal(parseEvents([e('DLSS-G state sample: frames presented since prior query=1 (maximum generated per real frame=5, status=0)')],now).mfg.state,'idle');
});
test('past observations expire and last error or off supersedes a success',()=>{
  assert.equal(parseEvents([e('telemetry nr[evals=50]',now-FRESH_MS-1)],now).nr.state,'stale');
  assert.equal(parseEvents([e('telemetry nr[evals=50]'),e('NR_LAB_READBACK Enable DLSS Neural Rendering=0.0000',now+1)],now+1).nr.state,'off');
  assert.equal(parseEvents([e('mfgunlock: slDLSSGGetState reports 3 frame(s)'),e('mfgunlock: slDLSSGGetState runtime status is 0x1',now+1)],now+1).mfg.state,'error');
});
test('RTXMFG real schema: exact session, sampled output, pending request, errors and restart',()=>{
  const good={processBirth:proc.processBirth,getStateSeen:true,getStateResult:0,dlssgStatus:0,stateSampleAgeMs:100,actualFramesPresented:3,appliedMultiplier:3,multiplier:4,pending:true};
  const r=parseMfgStatus(status(good),proc,now);
  assert.equal(r.state,'active');assert.equal(r.appliedMultiplier,3);assert.equal(r.requestedMultiplier,4);assert.equal(r.pending,true);
  assert.equal(parseMfgStatus(status({...good,pid:78}),proc,now),null);
  assert.equal(parseMfgStatus(status({...good,processBirth:'134067000000000002'}),proc,now),null);
  assert.equal(parseMfgStatus(status(good,now-FRESH_MS-1),proc,now),null);
  assert.equal(parseMfgStatus(status({...good,stateSampleAgeMs:20000},now-15000),proc,now).state,'waiting');
  assert.equal(parseMfgStatus(status({...good,getStateResult:1}),proc,now).state,'error');
  assert.equal(parseMfgStatus(status({...good,restartRequired:true}),proc,now).state,'restart');
  assert.equal(parseMfgStatus(status({...good,applied:true,appliedFrameGenerationOn:false}),proc,now).state,'off');
  assert.equal(parseMfgStatus(status({...good,getStateSeen:false,actualFramesPresented:4}),proc,now).state,'waiting');
});
test('logs must belong to this launch: old file writes cannot revive historical clock lines',()=>{
  const line=new Date(now).toTimeString().slice(0,8)+' [INFO] telemetry nr[evals=5]\n';
  const old={file:'ReShade.log',text:line,head:'old unrelated header',mtime:now,birth:now-86400000,size:Buffer.byteLength(line),offset:0};
  assert.equal(logEvents(old,proc,now).length,0);
  assert.equal(logEvents({...old,birth:now-15000},proc,now).length,1);
  assert.equal(logEvents({...old,birth:now-15000,mtime:now-60000},proc,now).length,0);
  const startup=new Date(now-18000).toTimeString().slice(0,8)+' [INFO] Initializing ReShade';
  assert.equal(logEvents({...old,head:startup},proc,now).length,0);
  assert.equal(logEvents({...old,head:startup+'\n'},proc,now).length,1);
  const prefix='prior session complete line\n';
  assert.equal(logEvents({...old,text:prefix+line,size:Buffer.byteLength(prefix+line)},proc,now,{size:Buffer.byteLength(prefix),baseline:Buffer.byteLength(prefix)}).length,1,'append exactly one complete line');
});

test('polling a live text stream waits for LF, while a complete status JSON needs no newline', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuralframe-telemetry-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=path.join(dir,'Game.exe'), log=path.join(dir,'ReShade.log');
  let time=Date.now();
  const game={...proc,exe,startedAt:new Date(time-5000).toISOString()};
  const reader=new RuntimeStatus({scanGame:async()=>({chosen:{path:exe}}),query:async()=>({processes:[game]}),clock:()=>time,temp:dir});
  const prefix=new Date(time).toISOString()+' 多帧 mfgunlock: slDLSSGGetState reports 3 frames';
  fs.writeFileSync(log,prefix);
  assert.equal((await reader.inspect(dir)).mfg.state,'not_loaded');
  fs.appendFileSync(log,' status=0x3\r'); time+=3000;
  assert.equal((await reader.inspect(dir)).mfg.state,'not_loaded');
  fs.appendFileSync(log,'\n'); time+=3000;
  const result=await reader.inspect(dir);
  assert.equal(result.mfg.state,'error');
  assert.equal(result.mfg.evidence,prefix+' status=0x3');
  assert.deepEqual(result.evidence.map(event=>event.state),['error']);
  const json=path.join(dir,'RTXMFG-Universal.status.json');
  fs.writeFileSync(json,JSON.stringify({pid:game.pid,processBirth:game.processBirth,getStateSeen:true,getStateResult:0,dlssgStatus:0,stateSampleAgeMs:0,actualFramesPresented:3}));
  fs.utimesSync(json,new Date(time),new Date(time)); time+=3000;
  assert.equal((await reader.inspect(dir)).mfg.state,'active');
});

test('a reused log can finish a new line across probes without inheriting an old partial line or rotating history', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuralframe-log-reuse-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=path.join(dir,'Game.exe'), log=path.join(dir,'ReShade.log');
  // Give the file an older birth time by starting the simulated process later.
  fs.writeFileSync(log,'old session\nold telemetry nr[evals=98]');
  let time=Date.now()+10000;
  const game={...proc,exe,startedAt:new Date(time-1000).toISOString()};
  const reader=new RuntimeStatus({scanGame:async()=>({chosen:{path:exe}}),query:async()=>({processes:[game]}),clock:()=>time,temp:dir});
  const poll=async()=>{time+=3000;fs.utimesSync(log,new Date(time),new Date(time));return (await reader.inspect(dir)).nr;};
  assert.equal((await poll()).state,'not_loaded');
  fs.appendFileSync(log,'\n当前游戏 telemetry nr[evals=23');
  assert.equal((await poll()).state,'not_loaded');
  fs.appendFileSync(log,']\r\n');
  assert.equal((await poll()).evaluatedFrames,23);
  // Same inode, rewritten and larger than it was at the previous poll.
  fs.writeFileSync(log,'replacement without evidence '.repeat(20)+'\n');
  assert.equal((await poll()).state,'not_loaded');
  fs.appendFileSync(log,'telemetry nr[evals=7]\n');
  assert.equal((await poll()).evaluatedFrames,7);
  fs.renameSync(log,path.join(dir,'previous.log'));
  fs.writeFileSync(log,'rotated without evidence '.repeat(30)+'\n');
  assert.equal((await poll()).state,'not_loaded');
});

test('a rapid relaunch rejects records from the final second of the previous process', () => {
  const oldDate=new Date(now-400).toISOString();
  const text=oldDate+' telemetry nr[evals=99]\n';
  const log={file:'ReShade.log',text,head:text,mtime:now,birth:now-1500,size:Buffer.byteLength(text),offset:0};
  assert.deepEqual(logEvents(log,{...proc,startedAt:new Date(now-100).toISOString()},now),[]);
  assert.deepEqual(logEvents({...log,text:'2026-99-90T12:00:30Z telemetry nr[evals=1]\n'},proc,now),[]);
});

test('MFG diagnostics report hex errors and age frames by sample time', () => {
  for (const value of ['0x00000008', '004']) {
    assert.equal(parseEvents([e('DLSS-G state sample: frames presented since prior query=3, status=' + value)], now).mfg.state, 'error');
  }
  assert.equal(parseEvents([e('mfgunlock: slDLSSGGetState runtime status is 0x00000008')], now).mfg.state, 'error');
  const sample = {getStateSeen:true, getStateResult:0, dlssgStatus:0, stateSampleAgeMs:19500, actualFramesPresented:3};
  const result = parseMfgStatus(status({...sample, fpsSampleWindowMs:1000, fpsSampleAgeMs:0}), proc, now);
  assert.equal(result.state, 'active');
  assert.equal(result.at, now - 19500);
  assert.equal(result.sourceFps, undefined);
  for (const count of [null, '3', -1, 2.5])
    assert.equal(parseMfgStatus(status({...sample,actualFramesPresented:count}),proc,now).state,'waiting');
});
test('module paths distinguish selected DLL from another same-name copy; resource files are not modules',()=>{
  const file=path.resolve('a/nvngx_dlssnr.dll');const r={processState:'running',process:proc,modules:[{path:file,name:'nvngx_dlssnr.dll'}]};
  assert.equal(moduleState(r,file).state,'loaded');
  assert.equal(moduleState(r,path.resolve('b/nvngx_dlssnr.dll')).state,'other_path');
  assert.equal(moduleState(r,path.resolve('a/ReShade.ini')).state,'resource');
  assert.equal(moduleState({...r,modules:[],process:{...proc,moduleError:'denied'}},file).state,'unreadable');
  assert.equal(moduleState({...r,modules:[],processState:'stopped'},file).state,'stopped');
});
test('probe is read-only, session bound, coalesced, bounded and clears states after exit',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enhanced-runtime-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const exe=path.join(dir,'Game.exe');fs.writeFileSync(exe,'fixture');const log=path.join(dir,'ReShade.log');
  let time=Date.now(),queries=0,processes=[{...proc,exe,startedAt:new Date(time-5000).toISOString(),modules:[{name:'nvngx_dlssnr.dll',path:path.join(dir,'nvngx_dlssnr.dll')}]}];
  fs.writeFileSync(log,new Date(time).toISOString()+' telemetry nr[evals=55]\n');
  const before=fs.readFileSync(log),reader=new RuntimeStatus({scanGame:async()=>({chosen:{path:exe},exeCandidates:[]}),query:async()=>{queries++;await new Promise(r=>setTimeout(r,5));return{processes};},clock:()=>time,temp:dir});
  const [a,b]=await Promise.all([reader.inspect(dir),reader.inspect(dir)]);assert.equal(queries,1);assert.equal(a,b);assert.equal(a.nr.state,'active');
  time+=35000;assert.equal((await reader.inspect(dir)).nr.state,'stale');
  time+=3000;processes=[];assert.equal((await reader.inspect(dir)).nr.state,'stopped');
  time+=3000;processes=[{...proc,exe,startedAt:new Date(time).toISOString(),modules:[]}];assert.notEqual((await reader.inspect(dir)).nr.state,'active');
  assert.deepEqual(fs.readFileSync(log),before);assert.deepEqual(fs.readdirSync(dir).sort(),['Game.exe','ReShade.log']);
});
test('a pending status file cannot hide a newer provider result for the same game session', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfg-provider-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const time = Date.now(), exe = path.join(dir, 'Game.exe');
  const process = { ...proc, exe, startedAt: new Date(time - 5000).toISOString() };
  const statusFile = path.join(dir, 'RTXMFG-Universal.status.json');
  fs.writeFileSync(statusFile, JSON.stringify({pid:process.pid,processBirth:process.processBirth,pending:true}));
  fs.writeFileSync(path.join(dir, 'ReShade.log'), new Date(time).toISOString() +
    ' mfgunlock: slDLSSGGetState reports 3 frame(s) actually presented since its previous call.\n');
  const reader = new RuntimeStatus({
    scanGame: async () => ({chosen:{path:exe}}),
    query: async () => ({processes:[process]}),
    clock: () => time + 50,
    temp: dir
  });
  const result = await reader.inspect(dir);
  assert.equal(result.mfg.state, 'active');
  assert.equal(result.mfg.providerPresentations, 3);
});
test('shared logs cannot attribute work to the remaining instance after a second instance exits', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfg-overlap-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const exe = path.join(dir, 'Game.exe'), log = path.join(dir, 'ReShade.log');
  let time = Date.now();
  const first = {...proc, exe, startedAt:new Date(time - 60000).toISOString()};
  let answer = {processes:[first], unreadable:[{pid:80, name:'Game.exe'}]};
  const reader = new RuntimeStatus({scanGame:async()=>({chosen:{path:exe}}),query:async()=>answer,clock:()=>time,temp:dir});
  const record = () => fs.appendFileSync(log, new Date(time).toISOString() + ' telemetry nr[evals=12]\n');
  record();
  assert.equal((await reader.inspect(dir)).processState, 'ambiguous');
  time += 3000;
  answer = {processes:[first,{...first, pid:80}]};
  assert.equal((await reader.inspect(dir)).processState, 'ambiguous');
  record();
  time += 3000;
  answer = {processes:[first]};
  assert.equal((await reader.inspect(dir)).nr.state, 'not_loaded');
  time += 3000;
  record();
  assert.equal((await reader.inspect(dir)).nr.state, 'active');
});
test('output FPS independently expires and cannot come from before the matched process started', () => {
  const fields = {getStateSeen:true, getStateResult:0, dlssgStatus:0, stateSampleAgeMs:100, actualFramesPresented:3,
    fpsSampleWindowMs:1000, fpsSampleAgeMs:18000, realFpsMilli:50000, dlssFpsMilli:150000};
  const live = parseMfgStatus(status(fields), proc, now);
  assert.equal(live.at, now - 100);
  assert.equal(live.fpsAt, now - 18000);
  assert.equal(live.reportedOutputFps, 150);
  const older = parseMfgStatus(status({...fields,fpsSampleAgeMs:28000}), proc, now);
  assert.equal(older.state, 'active');
  assert.equal(older.reportedOutputFps, undefined);
});
test('ambiguous games, protected paths and query failures get actionable states',async()=>{
  const dir=path.resolve('game'),scanGame=async()=>({chosen:{path:proc.exe}});
  for(const [answer,expected] of [[{processes:[],unreadable:[{pid:1}]},'unreadable'],[{processes:[proc,{...proc,pid:78}]},'ambiguous'],[{processes:[]},'stopped']]){
    const d=new RuntimeStatus({scanGame,query:async()=>answer});assert.equal((await d.inspect(dir)).processState,expected);
  }
  const bad=new RuntimeStatus({scanGame,query:async()=>{throw Error('timeout')}});assert.equal((await bad.inspect(dir)).processState,'unreadable');
});
test('tail reading is capped and malformed status files cannot activate a feature',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'enhanced-runtime-tail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ReShade.log');fs.writeFileSync(file,'x'.repeat(300000)+'\nline\n');const r=readTail(file);assert.equal(r.text,'line\n');assert.ok(r.offset>0);
  fs.writeFileSync(file,'x'.repeat(300000)+'telemetry nr[evals=7]');
  const partial=readTail(file);
  assert.equal(partial.text,'');assert.equal(partial.offset,partial.size);
  assert.equal(parseMfgStatus({...status({}),text:'{"pid":77'},proc,now),null);
});
