'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {writePe}=require('./fixtures/pe');
const {ComponentLibrary,digest,hash,safe}=require('../src/core/component-library');
const {ComponentUpdates,candidates,allowedAsset,unpack,mapFiles}=require('../src/core/component-updates');
const {ComponentReview}=require('../src/core/component-review');
const journal=require('../src/core/file-journal'),apply=require('../src/core/apply'),backends=require('../src/core/backend-manager');
const deploy=require('../src/core/component-deploy');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'unified-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const game=path.join(root,'game'),source=path.join(root,'source'),userData=path.join(root,'profile');fs.mkdirSync(game);fs.mkdirSync(source);
  const exe=path.join(game,'Game.exe');writePe(exe,{bitness:64,text:'D3D12CreateDevice'});
  const dll=(name,v)=>{const f=path.join(source,name);writePe(f,{bitness:64,version:[v,0,0,0],text:'nvngx_dlss.pdb'});return f;};
  const a=dll('a.dll',2),b=dll('b.dll',3);fs.copyFileSync(a,path.join(game,'nvngx_dlss.dll'));
  const library=new ComponentLibrary(userData),review=new ComponentReview(userData);
  const add=file=>library.importPackage({component:'dlss-sr',files:{'nvngx_dlss.dll':file}});
  return{root,game,exe,source,userData,library,review,a,b,add};
}
test('damaged 2.3.0 model index does not hide existing components or modify the source index', async t => {
  const f = fixture(t);
  const pack = await f.add(f.a);
  const dir = path.join(f.library.userData, 'neural-models');
  fs.mkdirSync(dir, {recursive:true});
  const index = path.join(dir, 'index.json');
  for (const data of ['{', JSON.stringify([null, {filePath:path.join(dir, 'missing.dll')}])]) {
    fs.writeFileSync(index, data);
    const library = new ComponentLibrary(f.library.userData);
    const view = await library.list();
    assert.equal(view.packages[0].id, pack.id);
    assert.ok(view.warnings.length);
    assert.equal(fs.readFileSync(index, 'utf8'), data);
  }
});
test('rollback retains a default version choice made after the preceding file update', async t => {
  const f = fixture(t);
  const first = await f.add(f.a), second = await f.add(f.b);
  await f.library.apply(f.game, {'dlss-sr': second.id}, {strict:true});
  await f.library.select(f.game, {});
  await f.library.apply(f.game, {'dlss-sr': first.id}, {
    strict:true, previousSelection:f.library.profile(f.game).selected,
  });
  const revision = backends.readManifest(f.game).componentHistory.at(-1);
  const result = await f.library.rollback(f.game, revision.id);
  assert.deepEqual(result.selection, {});
  assert.deepEqual(fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll')), fs.readFileSync(f.b));
});

test('rollback releases only consumed snapshots, preserving older revisions and unrelated files', async t => {
  const f = fixture(t);
  const original = await f.add(f.a), next = await f.add(f.b);
  await f.library.apply(f.game, {'dlss-sr':next.id});
  await f.library.apply(f.game, {'dlss-sr':original.id});
  const [older,latest] = backends.readManifest(f.game).componentHistory;
  const snapshot = path.join(f.game, latest.files[0].snapshot);
  const keep = path.join(path.dirname(snapshot), 'notes.txt');
  fs.writeFileSync(keep, 'user note');
  const rollback = () => f.library.rollback(f.game,latest.id);
  const manifestFile = path.join(f.game, '_DLSS5_Backup', 'manifest.json');
  const intactManifest = fs.readFileSync(manifestFile);
  const damaged = JSON.parse(intactManifest);
  damaged.componentHistory.at(-1).files[0].snapshot = latest.files[0].snapshot.replace('/0.bin', '/../' + latest.id + '/0.bin');
  fs.writeFileSync(manifestFile, JSON.stringify(damaged));
  await assert.rejects(rollback(), /上一版组件快照损坏或缺失/);
  assert.ok(fs.existsSync(snapshot));
  fs.writeFileSync(manifestFile, intactManifest);
  const request = {kind:'component-rollback',id:latest.id};
  const {preview} = await f.review.run(f.game,request,rollback);
  assert.equal(fs.existsSync(snapshot), true);
  const save = t.mock.method(apply, 'saveActiveManifest', async () => { throw Error('interrupted manifest write'); });
  await assert.rejects(rollback(), /interrupted manifest write/);
  save.mock.restore();
  assert.ok(fs.existsSync(snapshot));
  assert.equal(backends.readManifest(f.game).componentHistory.at(-1).id, latest.id);
  assert.deepEqual(fs.readFileSync(path.join(f.game,'nvngx_dlss.dll')), fs.readFileSync(f.a));
  await f.review.run(f.game,request,rollback,preview.token);
  assert.equal(fs.existsSync(snapshot), false);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'user note');
  assert.ok(fs.existsSync(path.join(f.game,older.files[0].snapshot)));
  await f.library.rollback(f.game, older.id);
  assert.equal(fs.existsSync(path.dirname(path.join(f.game,older.files[0].snapshot))), false);
  assert.deepEqual(fs.readFileSync(path.join(f.game,'nvngx_dlss.dll')), fs.readFileSync(f.a));
});
test('content-addressed versions persist, deduplicate, isolate per-game selection and reject wrong roles',async t=>{const f=fixture(t),p=await f.add(f.a),q=await f.add(f.b);assert.notEqual(p.id,q.id);assert.equal((await f.add(f.a)).id,p.id);assert.equal(f.library.catalog().packages.length,2);
  await f.library.select(f.game,{'dlss-sr':q.id});const reload=new ComponentLibrary(f.userData);assert.equal(reload.profile(f.game).selected['dlss-sr'],q.id);
  const another=path.join(f.root,'game2');fs.mkdirSync(another);assert.deepEqual(reload.profile(another).selected,{});
  await assert.rejects(f.library.select(f.game,{'mfg-universal':q.id}));
  await assert.rejects(f.library.importPackage({component:'dlss-nr',files:{'nvngx_dlssnr.dll':f.a}}),/神经/);
  assert.throws(()=>safe(f.root,'../escape'),/路径/);
});
test('future plugin can enter library but cannot displace Chinese adapter',async t=>{const f=fixture(t),p=await f.library.importPackage({component:'mfg-renodx',version:'1.8.2',files:{'renodx-mfgunlock.addon64':f.b}});assert.equal(f.library.compatibility(p).ready,false);await assert.rejects(f.library.select(f.game,{'mfg-renodx':p.id}),/尚未适配/);});

test('seeding reconciles a previously imported MFG package by content and preserves that trust across restarts', async t => {
  const f = fixture(t);
  const component = 'mfg-renodx', name = 'renodx-mfgunlock.addon64';
  const manual = { component, version: 'manual', files: { [name]: f.b } };
  const imported = await f.library.importPackage(manual);
  const other = await f.library.importPackage({ ...manual, files: { [name]: f.a } });
  assert.equal(f.library.compatibility(imported).ready, false);
  const payloadDir = path.join(f.root, 'payload');
  const addon = path.join(payloadDir, 'enhanced', 'mfg', name);
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  fs.copyFileSync(f.b, addon);
  const stat = fs.statSync(addon);
  await journal.atomicJson(path.join(f.library.root, 'seed.json'), {
    [component + '1.5.5']: hash(JSON.stringify([[name, addon, stat.size, stat.mtimeMs]]))
  });
  const seeded = new ComponentLibrary(f.userData, { payloadDir });
  await seeded.init();
  const record = seeded.package(imported.id);
  assert.equal(record.version, '1.5.5');
  assert.equal(seeded.compatibility(record).ready, true);
  assert.equal(seeded.compatibility(seeded.package(other.id)).ready, false);
  const disk = JSON.parse(fs.readFileSync(path.join(seeded.directory(record), 'package.json'), 'utf8'));
  assert.deepEqual(disk, record);
  const fresh = new ComponentLibrary(f.userData, { payloadDir });
  assert.deepEqual(await fresh.importPackage(manual), record);
  assert.equal((await fresh.list()).packages.length, 2);
  await fresh.select(f.game, { [component]: record.id });
});
test('preview is read-only, confirmed updates can roll back exactly and original restore survives',async t=>{const f=fixture(t),p=await f.add(f.b),selection={'dlss-sr':p.id},work=()=>f.library.apply(f.game,selection,{strict:true}),request={kind:'component-update',selection};
  const before=fs.readFileSync(path.join(f.game,'nvngx_dlss.dll'));const plan=(await f.review.run(f.game,request,work)).preview;
  assert.equal(plan.rows.find(r=>r.rel==='nvngx_dlss.dll').action,'replace');assert.deepEqual(fs.readFileSync(path.join(f.game,'nvngx_dlss.dll')),before);assert.equal(fs.existsSync(path.join(f.game,'_DLSS5_Backup')),false);
  await f.review.run(f.game,request,work,plan.token);assert.equal(await digest(path.join(f.game,'nvngx_dlss.dll')),p.files[0].sha256);
  const revision=backends.readManifest(f.game).componentHistory.at(-1),undo=()=>f.library.rollback(f.game,revision.id),req={kind:'component-rollback',id:revision.id};
  const preview=(await f.review.run(f.game,req,undo)).preview;await f.review.run(f.game,req,undo,preview.token);assert.deepEqual(fs.readFileSync(path.join(f.game,'nvngx_dlss.dll')),before);
  const next=(await f.review.run(f.game,request,work)).preview;await f.review.run(f.game,request,work,next.token);await backends.restore(f.game);assert.deepEqual(fs.readFileSync(path.join(f.game,'nvngx_dlss.dll')),before);
});
test('locks and library corruption block writes; preview detects game drift',async t=>{const f=fixture(t),p=await f.add(f.b),selection={'dlss-sr':p.id},work=()=>f.library.apply(f.game,selection,{strict:true}),req={kind:'component-update',selection};
  await f.review.setLock(f.game,true);const plan=(await f.review.run(f.game,req,work)).preview;assert.ok(plan.conflicts.length);await assert.rejects(f.review.run(f.game,req,work,plan.token),{code:'errVersionLocked'});
  await f.review.setLock(f.game,false);const next=(await f.review.run(f.game,req,work)).preview;fs.appendFileSync(path.join(f.game,'nvngx_dlss.dll'),'changed');await assert.rejects(f.review.run(f.game,req,work,next.token),{code:'errPreviewChanged'});
  fs.appendFileSync(path.join(f.library.directory(p),'nvngx_dlss.dll'),'tampered');await assert.rejects(work(),/文件已变化/);
  let busy = process.platform === 'win32';
  const target = path.join(f.library.directory(p), 'nvngx_dlss.dll');
  const rename = fs.promises.rename.bind(fs.promises);
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (busy && to === target) {
      busy = false;
      throw Object.assign(new Error('Temporary sharing violation'), {code:'EPERM'});
    }
    return rename(from, to);
  });
  assert.equal((await f.add(f.b)).id,p.id);await f.library.verify(p);assert.equal(f.library.catalog().packages.length,1,'redownload repairs without duplicating the version');
  assert.equal(busy, false);
});
test('normal installer tracked writes retain selected version and leave unrelated files alone',async t=>{const f=fixture(t),p=await f.add(f.b),selection={'dlss-sr':p.id};
  await deploy.managed(f.library,f.game,selection,()=>journal.transaction(f.game,async()=>{const m=apply.beginManifest(f.game,f.exe,'dxgi');await apply.copyTracked(m,f.game,f.a,path.join(f.game,'nvngx_dlss.dll'));await apply.copyTracked(m,f.game,f.a,path.join(f.game,'other.dll'));}));
  assert.equal(await digest(path.join(f.game,'nvngx_dlss.dll')),p.files[0].sha256);assert.equal(await digest(path.join(f.game,'other.dll')),await digest(f.a));assert.equal(deploy.resolveSource(f.game,f.a,path.join(f.game,'nvngx_dlss.dll')),f.a);
});
test('missing feature does not silently install a disabled plugin',async t=>{const f=fixture(t),p=await f.library.importPackage({component:'mfg-renodx',files:{'renodx-mfgunlock.addon64':f.b},trustedAdapter:true});await assert.rejects(f.library.apply(f.game,{'mfg-renodx':p.id},{strict:true}),/先通过安装路线/);});
test('saved selection is applied even when normal installer skips an equal or newer runtime',async t=>{const f=fixture(t),p=await f.add(f.a);fs.copyFileSync(f.b,path.join(f.game,'nvngx_dlss.dll'));const result=await deploy.managed(f.library,f.game,{'dlss-sr':p.id},async()=>({ok:true,skipped:true}));assert.equal(result.componentUpdate.changed,1);assert.equal(await digest(path.join(f.game,'nvngx_dlss.dll')),p.files[0].sha256);});
test('release parsing requires fixed upstream HTTPS URL, stable version and SHA-256',()=>{const release={id:1,tag_name:'1.8.2',assets:[{id:2,name:'renodx-mfgunlock.addon64',digest:'sha256:'+'a'.repeat(64),size:100,url:'x',browser_download_url:'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/download/1.8.2/renodx-mfgunlock.addon64'}]};
  assert.equal(candidates([release],'mfg')[0].downloadable,true);assert.equal(candidates([{...release,tag_name:'1.9.0-beta.1'}],'mfg').length,0);assert.equal(candidates([{...release,assets:[{...release.assets[0],digest:null}]}],'mfg')[0].downloadable,false);assert.equal(allowedAsset('https://evil.test/a','a/b'),false);
});
test('online download verifies bytes, stays separate from game, and cleans failed downloads',async t=>{const f=fixture(t),bytes=fs.readFileSync(f.b),url='https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/download/1.8.2/renodx-mfgunlock.addon64',item={id:'one',provider:'mfg',component:'mfg-renodx',name:'renodx-mfgunlock.addon64',tag:'1.8.2',url,size:bytes.length,sha256:hash(bytes),downloadable:true};
  const updater=new ComponentUpdates(f.library,{fetcher:async()=>new Response(bytes)});await journal.atomicJson(updater.cache,{candidates:[item],errors:[]});const result=await updater.download('one');assert.equal(result.compatibility.ready,false);assert.equal(fs.existsSync(path.join(f.game,'renodx-mfgunlock.addon64')),false);
  await journal.atomicJson(updater.cache,{candidates:[{...item,sha256:'0'.repeat(64)}],errors:[]});await assert.rejects(updater.download('one'),/SHA-256/);assert.deepEqual(fs.readdirSync(path.join(f.library.root,'downloads')),[]);
});
test('offline check preserves old candidate with stale indicator, never claims success per source',async t=>{const f=fixture(t),updater=new ComponentUpdates(f.library,{fetcher:async()=>{throw Error('offline');}});await journal.atomicJson(updater.cache,{candidates:[{id:'old',provider:'mfg'}],errors:[]});const result=await updater.check();assert.ok(result.errors.length);assert.equal(result.candidates[0].stale,true);});

test('update checks coalesce, survive restart and revalidate each repository independently', async t => {
  const {library} = fixture(t);
  let now = Date.UTC(2026, 1, 1), phase = 'first';
  t.mock.method(Date, 'now', () => now);
  const calls = [];
  const mirror = 'RankFTW/rhi-repo';
  const repoCount = new Set(Object.values(require('../src/core/component-definitions').PROVIDERS).map(p => p.repo)).size;
  const fetcher = async (url, {headers}) => {
    const repo = new URL(url).pathname.slice('/repos/'.length, -'/releases'.length);
    calls.push(repo);
    if (phase !== 'first') assert.equal(headers['If-None-Match'], '"' + repo + '"');
    if (phase === 'offline' && repo === mirror) throw Error('offline');
    if (phase !== 'first' && phase !== 'changed') return new Response(null, {status:304});
    const names = repo === mirror && phase !== 'changed' ? ['nvngx_dlssnr_1.zip', 'nvngx_dlss_1.zip'] : [];
    const assets = names.map((name, id) => ({id, name, size:1, digest:'sha256:' + 'a'.repeat(64),
      browser_download_url:`https://github.com/${repo}/releases/download/v1/${name}`}));
    return Response.json([{id:1, tag_name:'v1', assets}], {headers:{etag:'"' + repo + '"'}});
  };
  const updater = new ComponentUpdates(library, {fetcher});
  const [first, parallel] = await Promise.all([updater.check(), updater.check()]);
  assert.deepEqual(first, parallel);
  assert.deepEqual(first.candidates.map(c => c.provider).sort(), ['rhi-nr','rhi-sr']);
  assert.equal(calls.length, repoCount);
  const reopened = new ComponentUpdates(library, {fetcher});
  now += 299999;
  assert.equal((await reopened.check()).cached, true);
  assert.equal(calls.length, repoCount);
  now++;
  phase = 'offline';
  const offline = await reopened.check();
  assert.ok(offline.errors.some(e => e.provider === 'rhi-sr'));
  assert.ok(offline.candidates.every(c => c.stale));
  now += 300000;
  phase = 'recovered';
  const recovered = await reopened.check();
  assert.equal(recovered.errors.length, 0);
  assert.deepEqual(recovered.candidates.map(c => c.id), first.candidates.map(c => c.id));
  assert.ok(recovered.candidates.every(c => !c.stale));
  now += 300000;
  phase = 'changed';
  assert.deepEqual((await reopened.check()).candidates, []);
  assert.equal(calls.length, 4 * repoCount);
});

test('GitHub quota or secondary limits pause remaining repositories and persist the retry time', async t => {
  let now = Date.UTC(2026, 1, 1);
  t.mock.method(Date, 'now', () => now);
  for (const [status, headers, message, delay] of [
    [429, {'retry-after':'900'}, '', 900000],
    [403, {'x-ratelimit-remaining':'0', 'x-ratelimit-reset':String(now / 1000 + 1200)}, '', 1200000],
    [403, {}, 'You have exceeded a secondary rate limit', 300000],
    [200, {'x-ratelimit-remaining':'0', 'x-ratelimit-reset':String(now / 1000 + 900)}, '[]', 900000]
  ]) {
    const {library} = fixture(t);
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(message, {status, headers}); };
    const updater = new ComponentUpdates(library, {fetcher});
    const result = await updater.check();
    assert.equal(calls, 1);
    assert.equal(result.nextCheckAt, now + delay);
    assert.ok(result.errors.some(e => e.message === 'GitHub 请求已限流'));
    assert.equal(result.errors.some(e => e.provider === 'mfg'), status !== 200);
    const restarted = new ComponentUpdates(library, {fetcher});
    assert.equal((await restarted.check()).cached, true);
    assert.equal(calls, 1);
  }
});
function zip(entries){const locals=[],central=[];let offset=0;for(const [name,bytes,mode=0]of entries){const n=Buffer.from(name),b=Buffer.from(bytes);let crc=0xffffffff;for(const byte of b){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);locals.push(h,n,b);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,n);offset+=h.length+n.length+b.length;}
 const body=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(body.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,body,end]);}
test('archives reject traversal, symlinks, case collisions and conflicting component binaries',async t=>{const f=fixture(t);for(const [i,entries]of [[[['../escape.dll','x']]],[[['link.dll','x',0xa000]]],[[['A.dll','x'],['a.dll','x']]]].map((x,i)=>[i,x[0]])){
 const file=path.join(f.root,`bad${i}.zip`),dest=path.join(f.root,`out${i}`);fs.writeFileSync(file,zip(entries));fs.mkdirSync(dest);await assert.rejects(unpack(file,dest));}
 const file=path.join(f.root,'versions.zip'),dest=path.join(f.root,'unpack');fs.writeFileSync(file,zip([['one/MFGUnlocker.dll',fs.readFileSync(f.a)],['two/MFGUnlocker.dll',fs.readFileSync(f.b)]]));fs.mkdirSync(dest);await unpack(file,dest);await assert.rejects(mapFiles(dest,'mfg-universal'),/多个不同版本/);assert.equal(fs.existsSync(path.join(f.root,'escape.dll')),false);
});
test('cancel aborts a transfer without publishing a package or leaving partial files',async t=>{const f=fixture(t),updater=new ComponentUpdates(f.library,{fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});setTimeout(()=>updater.cancel(),10);})});
 await journal.atomicJson(updater.cache,{candidates:[{id:'x',provider:'mfg',component:'mfg-renodx',name:'renodx-mfgunlock.addon64',url:'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/download/1/file',size:100,sha256:'a'.repeat(64),downloadable:true}],errors:[]});await assert.rejects(updater.download('x'),/已取消/);assert.equal(updater.busy,false);assert.equal(f.library.catalog().packages.length,0);assert.deepEqual(fs.readdirSync(path.join(f.library.root,'downloads')),[]);
});

test('cancel during verification leaves the optional download out of the catalogue', async t => {
  const f = fixture(t);
  const bytes = fs.readFileSync(f.b);
  const updater = new ComponentUpdates(f.library, {
    fetcher: async () => new Response(bytes),
    onProgress: event => { if (event.stage === 'verify') updater.cancel(); }
  });
  const candidate = { id: 'one', provider: 'mfg', component: 'mfg-renodx',
    name: 'renodx-mfgunlock.addon64', url: 'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/download/1/file',
    size: bytes.length, sha256: hash(bytes), downloadable: true };
  await journal.atomicJson(updater.cache, {candidates:[candidate], errors:[]});
  await assert.rejects(updater.download(candidate.id), /已取消/);
  assert.equal(f.library.catalog().packages.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(f.library.root, 'downloads')), []);
});
