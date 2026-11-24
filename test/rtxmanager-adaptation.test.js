'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {writePe} = require('./fixtures/pe');
const {root:payloadDir} = require('./fixtures/payload');
const {scanGame} = require('../src/core/scan');
const {manifestIdentity,isSteamMiles} = require('../src/core/steam-identity');
const backend = require('../src/core/backend-manager');
const graphics = require('../src/core/optional-graphics');
const {requiredPacks} = require('../src/core/runtime-payload');
const {ComponentReview} = require('../src/core/component-review');
const {simulate} = require('../src/core/preview-fs');
const miles = require('../src/core/miles-profile');
const hash = f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stock = name=>path.join(payloadDir,'streamline',name);
function fixture(t,title='Miles') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-r3-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const apps=path.join(root,'steamapps'), gameDir=path.join(apps,'common',title);
  const exePath=writePe(path.join(gameDir,'MilesMorales.exe'),{text:'D3D12CreateDevice'});
  const acf=path.join(apps,'appmanifest_1817190.acf');
  fs.writeFileSync(acf,'"AppState"\n{\n"appid" "1817190"\n"installdir" "'+title+'"\n"name" "Miles"\n}');
  const state={value:null,writes:[]};
  const milesDriver={base:path.join(root,'machine'),settings:{
    read:async()=>state.value,replace:async(before,next)=>{assert.equal(state.value,before);state.writes.push(next);state.value=next;}
  }};
  const options={gameDir,exePath,api:'dxgi',apiLabel:'DirectX 12',bitness:64,gpuName:'NVIDIA GeForce RTX 3070',
    target:{hasNativeDlssFg:true},payloadDir,userDataDir:path.join(root,'profile'),route:'sm86-delta',milesDriver};
  return {root,apps,gameDir,exePath,acf,options,state,milesDriver,local:name=>path.join(gameDir,name)};
}

test('Steam discovery verifies the manifest identity and excludes both Nixxes reporters, including a historical deployment',async t=>{
  const f=fixture(t);
  const reporter=writePe(f.local('crs-handler.exe'),{text:'D3D11CreateDevice'});
  writePe(f.local('crs-video.exe'),{text:'D3D11CreateDevice'});
  assert.ok(isSteamMiles(f.exePath));
  assert.deepEqual((await scanGame(f.gameDir,reporter)).exeCandidates.map(e=>e.name),['MilesMorales.exe']);
  const apply=require('../src/core/apply'),old=apply.beginManifest(f.gameDir,reporter,'dxgi');
  fs.writeFileSync(f.local('old.txt'),'old deployment');old.added.push('old.txt');
  await apply.saveActiveManifest(f.gameDir,old);
  assert.equal((await scanGame(f.gameDir,reporter)).chosen.path,f.exePath);
  assert.ok(await backend.restore(f.gameDir));assert.ok(!fs.existsSync(f.local('old.txt')));
  const discover=()=>require('../src/library').steam({roots:[f.root]}).map(g=>g.id);
  assert.deepEqual(discover(),['1817190']);
  for (const invalid of ['123','0','-1','4294967296','1.5']) {
    const text='"appid" "'+invalid+'"\n"installdir" "Miles"';
    fs.writeFileSync(f.acf,text);
    assert.equal(isSteamMiles(f.exePath),false);
    assert.deepEqual(discover(),[]);
  }
  assert.equal(manifestIdentity('"appid" "1817190"\n"installdir" "../Miles"','appmanifest_1817190.acf'),null);
  assert.throws(()=>graphics.validateTarget({...f.options,target:{hasNativeDlssFg:true,steamMiles:true}}),/不匹配/);
});

test('R3 previews Miles-only DRS changes, preserves third-party edits and restores the original explicit setting',async t=>{
  const f=fixture(t), review=new ComponentReview(f.options.userDataDir);
  for (const name of ['sl.interposer.dll','sl.dlss_g.dll']) fs.copyFileSync(stock(name),f.local(name));
  const interposer=f.local('sl.interposer.dll'),original=hash(interposer);
  writePe(f.local('Other/Other.exe'),{text:'D3D12CreateDevice'});
  fs.copyFileSync(stock('sl.interposer.dll'),f.local('Other/sl.interposer.dll'));
  fs.copyFileSync(stock('sl.dlss_g.dll'),f.local('Other/sl.dlss_g.dll'));
  f.state.value=1;
  const request={kind:'enhanced',config:{route:'sm86-delta',graphics:{multiplier:6,nativeRuntimes:['streamline']}}};
  const apply=token=>review.run(f.gameDir,request,async()=>({ok:true,manifest:await backend.install({...f.options,graphics:request.config.graphics})}),token);
  const {preview}=await apply();
  assert.ok(preview.externalSteps.some(step=>step.file.includes('MilesMorales') && step.args.includes('6×')));
  assert.deepEqual(f.state.writes,[]);assert.ok(!fs.existsSync(f.local('version.dll')));
  assert.ok((await apply(preview.token)).ok);
  assert.equal(f.state.value,5);
  assert.equal(hash(interposer),hash(path.join(payloadDir,'enhanced/sm86-native-streamline/sl.interposer.dll')));
  assert.equal(hash(f.local('Other/sl.interposer.dll')),original);
  let record=backend.readManifest(f.gameDir);
  assert.equal(record.graphicsRoute.deltaCache,undefined);
  assert.equal(graphics.inspect(f.gameDir,record).providerVersion,'0.4.2+rtxfg.3');
  f.state.value=4; // player changed the title profile in the NVIDIA app
  await assert.rejects(backend.install({...f.options,graphics:{multiplier:3}}),/其他程序/);
  await backend.install({...f.options,graphics:{multiplier:1}});
  assert.equal(f.state.value,4);
  assert.equal(graphics.inspect(f.gameDir,backend.readManifest(f.gameDir)).multiplier,1);
  assert.equal(graphics.inspect(f.gameDir,backend.readManifest(f.gameDir)).driverDefault,true);
  await backend.install({...f.options,graphics:{multiplier:3}});
  assert.equal(f.state.value,2);
  fs.unlinkSync(f.acf); // restoring an owned profile must survive Steam uninstall
  assert.ok(await backend.restore(f.gameDir,undefined,undefined,{milesDriver:f.milesDriver}));
  assert.equal(f.state.value,4);
  assert.ok(!fs.existsSync(f.local('version.dll')));
  assert.equal(hash(interposer),original);
});

test('a failed driver commit can recover both the game files and a partially applied driver write',async t=>{
  const f=fixture(t);
  const replace=f.milesDriver.settings.replace;
  f.milesDriver.settings.replace=async(before,after)=>{
    await replace(before,after);
    throw Error('simulated verification interruption');
  };
  await assert.rejects(backend.install({...f.options,graphics:{multiplier:4}}));
  assert.equal(f.state.value,3);
  f.milesDriver.settings.replace=replace;
  assert.ok(await backend.restore(f.gameDir,undefined,undefined,{milesDriver:f.milesDriver}));
  assert.equal(f.state.value,null);
  assert.ok(!fs.existsSync(f.local('version.dll')));
  assert.ok(!miles.owns(f.gameDir,f.milesDriver.base));
});

test('one NVIDIA title profile cannot be claimed by a second copy and an already matching setting remains player-owned',async t=>{
  const a=fixture(t),b=fixture(t,'Second');
  const change=(f,count)=>miles.schedule(f.gameDir,f.exePath,count,a.milesDriver);
  a.state.value=2;
  assert.equal(await change(a,2),false);
  assert.ok(!miles.owns(a.gameDir,a.milesDriver.base));
  await change(a,5);
  await assert.rejects(change(b,3),/另一个/);
  await miles.detach(b.gameDir,a.milesDriver);
  assert.equal(a.state.value,5);
  const {state}=await simulate(()=>miles.detach(a.gameDir,a.milesDriver));
  assert.equal(state.externalSteps.length,1);assert.equal(a.state.value,5);
  await miles.detach(a.gameDir,a.milesDriver);
  assert.equal(a.state.value,2);
});

test('sm86 selects scoped stock NGX files and plug-ins independently and restores original bytes',async t=>{
  const f=fixture(t);
  const names=['nvngx_dlss.dll','nvngx_dlssd.dll','nvngx_dlssg.dll','sl.interposer.dll','sl.dlss_g.dll','sl.common.dll'];
  for (const name of names) fs.copyFileSync(stock(name),f.local(name));
  const originals=names.map(n=>hash(f.local(n)));
  const opts={...f.options,route:'sm86'};
  const kinds=['sr','rr','fg','streamline'];
  assert.deepEqual(new Set((await scanGame(f.gameDir,f.exePath)).chosen.sm86NativeKinds),new Set(kinds));
  assert.deepEqual(requiredPacks({route:'sm86',config:{}}),['sm86']);
  assert.deepEqual(requiredPacks({route:'sm86',config:{graphics:{nativeRuntimes:kinds}}}),['sm86','sm86-native-sr','rr-modern','sm86-native-fg','sm86-native-streamline']);
  const install=selection=>backend.install({...opts,graphics:{nativeRuntimes:selection}});
  const {result}=await simulate(()=>install(kinds));
  assert.equal(Object.keys(result.graphicsRoute.nativeFiles).length,8);
  assert.deepEqual(names.map(n=>hash(f.local(n))),originals);
  await install(kinds);
  assert.equal(hash(f.local('sl.interposer.dll')),originals[3]);
  assert.notEqual(hash(f.local('nvngx_dlssd.dll')),originals[1]);
  await install(['sr']);
  for (const name of ['sl.pcl.dll','sl.reflex.dll','RTXFG-Streamline-LICENSE.txt']) assert.ok(!fs.existsSync(f.local(name)));
  for (let i=1;i<names.length;i++) assert.equal(hash(f.local(names[i])),originals[i]);
  assert.notEqual(hash(f.local(names[0])),originals[0]);
  writePe(f.local('sl.unknown2.dll'));
  await assert.rejects(install(['sr','streamline']),/匹配组/);
  const foreign=f.local('.rtx-fg-runtimes/rr/ownership.json');
  fs.mkdirSync(path.dirname(foreign),{recursive:true});
  fs.writeFileSync(foreign,JSON.stringify({entries:[{path:f.local(names[1])}]}));
  await assert.rejects(install(['sr','rr']),/RTXManager/);
  assert.ok(await backend.restore(f.gameDir));
  assert.deepEqual(names.map(n=>hash(f.local(n))),originals);
  assert.ok(fs.existsSync(f.local('sl.unknown2.dll')));
});
