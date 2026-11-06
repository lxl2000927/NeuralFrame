'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {RuntimePayload,requiredPacks}=require('../src/core/runtime-payload');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-packs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const src=path.join(root,'bootstrap');fs.mkdirSync(src);const bytes=Buffer.from('verified runtime bytes'),file={path:'runtime/plugin.dll',size:bytes.length,sha256:sha(bytes)},p={id:'test',name:'Test',component:'test',version:'1',bundled:true,files:[file],contentId:sha('test')};fs.mkdirSync(path.join(src,'runtime'));fs.writeFileSync(path.join(src,file.path),bytes);return{root,src,bytes,p,manifest:{schema:1,repository:'owner/repo',packs:[p]}};}
test('MFG-only does not request neural model, SR or Streamline; off and restore need no packs',()=>{
 const ids=requiredPacks({kind:'enhanced',config:{mfgMode:'x4'},target:{api:'dxgi',apiLabel:'DirectX 12',bitness:64}});
 assert.deepEqual(ids,['localization','mfg-renodx','fg-modern','reshade']);
 assert.deepEqual(requiredPacks({kind:'enhanced',config:{mfgMode:'off',neuralMode:'off'}}),[]);
 assert.deepEqual(requiredPacks({kind:'restore'}),[]);
 assert.deepEqual(requiredPacks({kind:'enhanced',config:{mfgMode:'x3'},target:{bitness:32}}),[]);
});
test('route planner includes feeder bootstrap and supports custom model and OptiScaler',()=>{
 const ids=requiredPacks({kind:'enhanced',route:'feeder',config:{neuralMode:'latest_compatible',runtimeStack:'oct2026-310.9.16'},customModel:true});
 for(const id of ['sr-modern','sl-modern','feeder','sr-baseline','sl-baseline','fg-baseline','renodx-nr','reshade'])assert.ok(ids.includes(id),id);
 assert.ok(!ids.includes('nr-3108'));
 assert.ok(requiredPacks({kind:'enhanced',route:'optiscaler',config:{mfgMode:'x3'}}).includes('mfg-universal'));
 const mixed=requiredPacks({kind:'enhanced',route:'native',mfgRoute:'optiscaler',config:{mfgMode:'x3',neuralMode:'latest_compatible'}});
 assert.ok(mixed.includes('mfg-universal')&&mixed.includes('mfg-renodx')&&mixed.includes('renodx-nr'));
 assert.deepEqual(requiredPacks({kind:'install',route:'optiscaler'}),['localization','nr-3108']);
});
test('status and missing-dependency inspection never create cache or fetch',async t=>{const f=fixture(t);let fetches=0;const r=new RuntimePayload(path.join(f.root,'profile'),{manifest:f.manifest,bundledRoot:f.src,fetcher:()=>{fetches++;throw Error('unexpected');}});r.list();await assert.rejects(r.require(['test']),e=>e.dependencies[0]==='runtime:test');assert.equal(fetches,0);assert.equal(fs.existsSync(r.root),false);});
test('prepare is explicit, cache survives application restart and uses no network',async t=>{const f=fixture(t),options={manifest:f.manifest,bundledRoot:f.src,fetcher:()=>{throw Error('no network');}},r=new RuntimePayload(path.join(f.root,'profile'),options);await r.prepare(['test']);await r.require(['test']);fs.unlinkSync(path.join(f.src,f.p.files[0].path));const next=new RuntimePayload(r.userData,options);await next.prepare(['test']);await next.require(['test']);assert.equal(next.payloadDir,r.payloadDir);});
test('hash verification detects same-sized corruption and repairs from immutable store',async t=>{const f=fixture(t),r=new RuntimePayload(path.join(f.root,'profile'),{manifest:f.manifest,bundledRoot:f.src});await r.prepare(['test']);const file=path.join(r.payloadDir,f.p.files[0].path);fs.unlinkSync(file);fs.writeFileSync(file,Buffer.alloc(f.bytes.length,1));await assert.rejects(r.require(['test']));await r.prepare(['test']);assert.deepEqual(fs.readFileSync(file),f.bytes);});
test('legacy library is reused by hash with locally retained licenses',async t=>{const f=fixture(t),profile=path.join(f.root,'profile'),id=sha('old'),dir=path.join(profile,'component-library-v1/packages',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.dll'),f.bytes);fs.unlinkSync(path.join(f.src,f.p.files[0].path));fs.writeFileSync(path.join(profile,'component-library-v1/catalog.json'),JSON.stringify({packages:[{id,files:[{rel:'plugin.dll',sha256:sha(f.bytes)}]}]}));const r=new RuntimePayload(profile,{manifest:f.manifest,bundledRoot:f.src,fetcher:()=>{throw Error('must reuse');}});await r.prepare(['test']);await r.require(['test']);});
test('manifest rejects traversal and untrusted download URLs',t=>{const f=fixture(t);assert.throws(()=>new RuntimePayload(f.root,{manifest:{...f.manifest,packs:[{...f.p,files:[{...f.p.files[0],path:'../escape'}]}]}}));assert.throws(()=>new RuntimePayload(f.root,{manifest:{...f.manifest,packs:[{...f.p,bundled:false,url:'https://evil.example/file',size:10,sha256:sha('file')} ]}}));});
test('download mismatch and cancellation never activate files; staging is removed',async t=>{const f=fixture(t);const p={...f.p,bundled:false,url:'https://github.com/owner/repo/releases/download/1/a.zip',size:4,sha256:sha('good')},manifest={...f.manifest,packs:[p]};let r=new RuntimePayload(path.join(f.root,'bad'),{manifest,fetcher:async()=>new Response('bad!')});await assert.rejects(r.prepare(['test']),/SHA-256/);assert.equal(fs.existsSync(r.payloadDir),false);assert.deepEqual(fs.readdirSync(path.join(r.root,'staging')),[]);
 r=new RuntimePayload(path.join(f.root,'cancel'),{manifest,fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});setTimeout(()=>r.cancel(),10);})});await assert.rejects(r.prepare(['test']),/取消/);assert.equal(r.controller,null);assert.equal(fs.existsSync(r.payloadDir),false);assert.deepEqual(fs.readdirSync(path.join(r.root,'staging')),[]);
});
