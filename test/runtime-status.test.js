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
  assert.equal(logEvents({...old,head:startup},proc,now).length,1);
  const prefix='prior session complete line\n';
  assert.equal(logEvents({...old,text:prefix+line,size:Buffer.byteLength(prefix+line)},proc,now,{size:Buffer.byteLength(prefix),mtime:now-1000,complete:true}).length,1,'append exactly one complete line');
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
  assert.equal(parseMfgStatus({...status({}),text:'{"pid":77'},proc,now),null);
});
