'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const registry=require('../src/core/legacy-installscript');
const compiler=process.env.NEURALFRAME_ZIG;
test('native bridge is opt-in, virtualizes only the private registry, and keeps host affinity', {skip:process.platform!=='win32'||!compiler}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-native-probe-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'host64'));
  for(const [target,file] of [['x86-windows-gnu','probe.exe'],['x86_64-windows-gnu','host64/dlss5-feed-host64.exe']]) {
    execFileSync(compiler,['cc','-target',target,'-O1',path.join(__dirname,'fixtures/preloader-probe.c'),'-o',path.join(root,file)],{windowsHide:true,timeout:60000,stdio:'pipe'});
  }
  fs.copyFileSync(path.join(__dirname,'../dist/runtime-bootstrap/enhanced/zh-cn/winmm.dll'),path.join(root,'winmm.dll'));
  const run=()=>execFileSync(path.join(root,'probe.exe'),[],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000}).trim().split(/\r?\n/).map(line=>JSON.parse(line));
  const [off,offHost]=run();
  assert.equal(off.afterCpu,off.beforeCpu); assert.equal(off.afterMask,off.beforeMask); assert.equal(off.afterMemory,off.beforeMemory);
  assert.equal(offHost.hostMask,off.beforeMask);
  const key=registry.namespace(root);
  const reg=(args)=>execFileSync('reg.exe',args,{windowsHide:true,stdio:'pipe',timeout:10000});
  t.after(()=>{try{reg(['delete',key,'/f','/reg:32']);}catch{}});
  reg(['add',key+'\\HKLM\\NeuralFrameNativeProbe','/v','Value','/t','REG_DWORD','/d','231','/f','/reg:32']);
  fs.writeFileSync(path.join(root,'NeuralFrame-Legacy.ini'),'[Compatibility]\r\nCpuLimit=8\r\nLegacyMemory=1\r\nRegistryRoot='+key.slice(5)+'\r\n');
  const [on,onHost]=run();
  assert.equal(on.registryCode,0); assert.equal(on.registryValue,231);
  assert.ok(on.afterMemory<=512*1024*1024);
  assert.equal(on.afterCpu,Math.min(on.beforeCpu,8));
  assert.equal(onHost.hostMask,on.beforeMask,'Feeder host must not inherit the game CPU clamp');
});
