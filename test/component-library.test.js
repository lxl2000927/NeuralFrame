'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {writePe,writeNr}=require('./fixtures/pe');
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
test('overlapping imports retain both package records and recover after a failed import', async t => {
  const f = fixture(t);
  const [first, second] = await Promise.all([f.add(f.a), f.add(f.b)]);
  assert.deepEqual(new Set(f.library.catalog().packages.map(p => p.id)), new Set([first.id, second.id]));
  await assert.rejects(f.add(path.join(f.source, 'missing.dll')));
  assert.equal((await f.add(f.a)).id, first.id);
  assert.equal(f.library.catalog().packages.length, 2);
});
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

test('damaged release cache preserves installed packages and can be rebuilt by checking updates', async t => {
  const f = fixture(t), pack = await f.add(f.a);
  await f.library.select(f.game, {'dlss-sr':pack.id});
  const catalog = f.library.catalog(), profile = f.library.profile(f.game);
  let requests = 0;
  const updater = new ComponentUpdates(f.library, {fetcher:async () => {
    requests++;
    return Response.json([]);
  }});
  for (const damaged of ['{', 'null', '{"sourcesVersion":2}',
    '{"sourcesVersion":2,"candidates":[null],"errors":[]}',
    '{"candidates":[],"errors":[null]}',
    '{"candidates":[],"errors":[],"etags":[]}']) {
    fs.writeFileSync(updater.cache, damaged);
    const before = requests, status = updater.status();
    assert.deepEqual(status.candidates, []);
    assert.ok(status.errors.some(error => /缓存损坏/.test(error.message)));
    assert.equal(requests, before, 'viewing the library does not trigger network recovery');
    assert.equal(fs.readFileSync(updater.cache, 'utf8'), damaged, 'viewing does not overwrite the damaged evidence');
    const recovered = await updater.check();
    assert.equal(recovered.ok, true);
    assert.deepEqual(recovered.errors, []);
    assert.ok(requests > before, 'damaged metadata never keeps a stale check throttle');
    assert.equal(JSON.parse(fs.readFileSync(updater.cache, 'utf8')).sourcesVersion, 3);
    assert.deepEqual(f.library.catalog(), catalog);
    assert.deepEqual(f.library.profile(f.game), profile);
    assert.deepEqual(fs.readFileSync(path.join(f.game, 'nvngx_dlss.dll')), fs.readFileSync(f.a));
  }
});

test('an unreadable release cache is not silently treated as recoverable content damage', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.library.root, {recursive:true});
  const updater = new ComponentUpdates(f.library, {fetcher:() => assert.fail('unexpected network request')});
  assert.deepEqual(updater.status().errors, [], 'a missing cache is a normal initial state');
  fs.mkdirSync(updater.cache);
  assert.throws(() => updater.status(), /组件.*缓存|组件记录损坏/);
  await assert.rejects(updater.check(), /组件.*缓存|组件记录损坏/);
  assert.equal(fs.statSync(updater.cache).isDirectory(), true);
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

test('preparing a paired cache again repairs missing, truncated and same-size damaged library files', async t => {
  const f = fixture(t), component = 'mfg-renodx', name = 'renodx-mfgunlock.addon64';
  const payloadDir = path.join(f.root, 'payload');
  const source = path.join(payloadDir, 'enhanced', 'mfg', name);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.copyFileSync(f.b, source);
  const library = new ComponentLibrary(f.userData, { payloadDir });
  await library.init();
  const record = library.catalog().packages[0];
  const target = path.join(library.directory(record), name);
  await library.select(f.game, { [component]: record.id });
  const profile = fs.readFileSync(library.profileFile(f.game));
  for (const damage of [
    () => fs.unlinkSync(target),
    () => fs.writeFileSync(target, 'truncated'),
    () => { const bytes = fs.readFileSync(target); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(target, bytes); },
  ]) {
    damage();
    await assert.rejects(library.verify(record), /组件文件已变化或缺失/);
    // component-prepare resets this flag after verifying the intact runtime payload.
    library.initialized = false;
    const listed = await library.list();
    assert.equal(listed.packages.length, 1);
    assert.equal(listed.packages[0].present, true);
    await library.verify(record);
    assert.deepEqual(fs.readFileSync(library.profileFile(f.game)), profile);
  }
  const reopened = new ComponentLibrary(f.userData, { payloadDir });
  t.mock.method(reopened, 'importPackage', () => { throw Error('unchanged cache must not be rehashed'); });
  await reopened.init();
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
  let requests = 0;
  updater.fetcher = async () => { requests++; return new Response(bytes); };
  assert.equal(updater.status().candidates[0].cachedPackageId, result.package.id);
  assert.equal((await updater.download('one')).package.id, result.package.id);
  assert.equal(requests, 0);
  fs.writeFileSync(path.join(f.library.directory(result.package), item.name), Buffer.alloc(bytes.length));
  await updater.download('one');
  assert.equal(requests, 1);
  await f.library.verify(result.package);
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
    return Response.json(repo === modelRepo ? [] : [{id:1, tag_name:'v1', assets}], {headers:{etag:'"' + repo + '"'}});
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
const modelRepo = 'SmarterGamers/SmarterGamers-DLSS5-Swapper';
const modelProvider = 'smartergamers-nr';
const modelFile = 'nvngx_dlssnr.dll';
function modelRelease(tag, names = []) {
  return {id:1, tag_name:tag, assets:names.map(([name,bytes],id) => ({
    id,name,size:bytes.length,digest:'sha256:' + hash(bytes),
    browser_download_url:`https://github.com/${modelRepo}/releases/download/${tag}/${name}`
  }))};
}
function lfsPointer(bytes) {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${hash(bytes)}\nsize ${bytes.length}\n`;
}
const lfsPath = tag => `${modelRepo}/refs/tags/${tag}/resources/payload/streamline/${modelFile}`;

test('SmarterGamers checks tagged LFS pointers, migrates the old update source and verifies the model on download', async t => {
  const f = fixture(t), tag = 'v2.3.0';
  const bytes = fs.readFileSync(writeNr(path.join(f.source,'nr.dll')));
  const release = modelRelease(tag,[['SmarterGamers.DLSS.5.Swapper.2.3.0.exe','exe'],['SmarterGamers.DLSS.5.Swapper.Setup.2.3.0.exe','setup']]);
  const pointer = 'https://raw.githubusercontent.com/' + lfsPath(tag);
  const media = 'https://media.githubusercontent.com/media/' + lfsPath(tag);
  let requests = 0, fetched = bytes;
  const updater = new ComponentUpdates(f.library,{fetcher:async url => {
    if (url === pointer) return new Response(lfsPointer(bytes));
    if (url === media) { requests++; return new Response(fetched); }
    assert.ok(url.startsWith('https://api.github.com/repos/'));
    return Response.json(url.includes(modelRepo) ? [release,{...release,tag_name:'v4-beta',prerelease:true}] : []);
  }});
  await journal.atomicJson(updater.cache,{nextCheckAt:Date.now()+60000,candidates:[{provider:'enhanced-nr',id:'old'}],errors:[]});
  assert.deepEqual(updater.status().candidates,[]);
  await assert.rejects(updater.download('old'),/下载记录无效/);
  const result = await updater.check();
  assert.deepEqual(result.errors,[]);
  assert.equal(requests,0);
  assert.equal(result.candidates.length,1);
  const [candidate] = result.candidates;
  assert.equal(candidate.url,media);
  assert.equal(candidate.sha256,hash(bytes));
  assert.equal(candidate.size,bytes.length);
  fetched = Buffer.alloc(bytes.length);
  await assert.rejects(updater.download(candidate.id),/SHA-256/);
  assert.equal(f.library.catalog().packages.length,0);
  fetched = bytes;
  const {package:imported} = await updater.download(candidate.id);
  assert.equal(imported.version,'310.9.16.0');
  assert.equal(imported.source,modelRepo);
  assert.equal(imported.releaseUrl,candidate.releaseUrl);
  await updater.download(candidate.id);
  assert.equal(requests,2);
  for (const url of [media.replace('refs/tags/'+tag,'main'),media.replace(modelRepo,'other/repo'),media+'?file=other']) {
    await journal.atomicJson(updater.cache,{...result,candidates:[{...candidate,url}]});
    await assert.rejects(updater.download(candidate.id),/下载记录无效/);
  }
  assert.equal(requests,2);
});

test('SF-v2 downloads from the two sources resolve to separate catalog entries and cached DLLs', () => {
  const {RANKFTW_NR_SFV2:rank} = require('../src/core/component-definitions');
  const {MODEL_DATABASE} = require('../src/core/neural-models');
  const smarter = MODEL_DATABASE.find(m => m.id === '310.8.SF-v2');
  const rankModel = MODEL_DATABASE.find(m => m.downloadId === rank.id);
  assert.equal(rankModel.version, '310.8.2.0');
  assert.notEqual(smarter.sha256, rankModel.sha256);
  const candidates = [
    {component:'dlss-nr',provider:'smartergamers-nr',name:modelFile,sha256:smarter.sha256},
    {...rank,id:'upstream-asset'}
  ];
  const packages = [];
  const updates = new ComponentUpdates({root:os.tmpdir(),catalog:()=>({packages})});
  const status = () => updates.withLocalModels({candidates}).candidates.map(c => [c.catalogModelId,c.cachedPackageId]);
  packages.push({id:'smarter',component:'dlss-nr',files:[{rel:modelFile,sha256:smarter.sha256}]});
  assert.deepEqual(status(), [[smarter.id,'smarter'],[rankModel.id,undefined]]);
  packages.push({id:'rank',component:'dlss-nr',files:[{rel:modelFile,sha256:rank.modelSha256}]});
  assert.deepEqual(status(), [[smarter.id,'smarter'],[rankModel.id,'rank']]);
});

test('SmarterGamers uses standalone release assets and deduplicates them against existing models', async t => {
  const f=fixture(t), bytes=fs.readFileSync(writeNr(path.join(f.source,'nr.dll')));
  const archive=zip([['model/nvngx_dlssnr.dll',bytes]]);
  const current=modelRelease('v3.0.0',[[modelFile,bytes]]);
  const next=modelRelease('v4.0.0',[['nvngx_dlssnr_new.zip',archive]]);
  let downloads=0;
  const updater=new ComponentUpdates(f.library,{fetcher:async url => {
    if (url === next.assets[0].browser_download_url) { downloads++; return new Response(archive); }
    assert.ok(url.startsWith('https://api.github.com/'));
    return Response.json(url.includes(modelRepo) ? [current,next] : []);
  }});
  const seeded=await f.library.importPackage({component:'dlss-nr',source:'existing',files:{[modelFile]:path.join(f.source,'nr.dll')}});
  const r=await updater.check();
  assert.deepEqual(r.errors,[]);
  assert.equal(r.candidates[0].cachedPackageId,seeded.id);
  for(const c of r.candidates) assert.equal((await updater.download(c.id)).package.id,seeded.id);
  const reopened=new ComponentUpdates(f.library,{fetcher:()=>assert.fail('unexpected download')});
  assert.ok(reopened.status().candidates.every(c=>c.cachedPackageId===seeded.id));
  assert.equal((await reopened.download(r.candidates[1].id)).package.id,seeded.id);
  assert.equal(downloads,1);
});

test('invalid tagged metadata leaves only that tag stale and retries even when the release list is unchanged', async t => {
  const f=fixture(t), bytes=Buffer.from('model');
  const releases=[modelRelease('v4'),modelRelease('v3')];
  let damaged=false, etag;
  const updater=new ComponentUpdates(f.library,{fetcher:async (url,{headers}) => {
    if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(damaged && url.includes('/v3/') ? 'not a pointer' : lfsPointer(bytes));
    if (!url.includes(modelRepo)) return Response.json([]);
    etag=headers['If-None-Match'];
    return Response.json(releases,{headers:{etag:'"stable"'}});
  }});
  const first=await updater.check();
  assert.deepEqual(first.errors,[]);
  const expire=()=>journal.atomicJson(updater.cache,{...updater.readIndex(),nextCheckAt:0});
  damaged=true;await expire();
  const partial=await updater.check();
  assert.equal(partial.errors.length,1);
  assert.match(partial.errors[0].message,/v3/);
  assert.ok(!partial.candidates[0].stale && partial.candidates[1].stale);
  assert.ok(!updater.readIndex().etags[modelRepo]);
  damaged=false;await expire();
  const recovered=await updater.check();
  assert.equal(etag,undefined);
  assert.deepEqual(recovered.errors,[]);
  assert.ok(recovered.candidates.every(c=>!c.stale));
});
test('archives reject traversal, symlinks, case collisions and conflicting component binaries',async t=>{const f=fixture(t);for(const [i,entries]of [[[['../escape.dll','x']]],[[['link.dll','x',0xa000]]],[[['A.dll','x'],['a.dll','x']]]].map((x,i)=>[i,x[0]])){
 const file=path.join(f.root,`bad${i}.zip`),dest=path.join(f.root,`out${i}`);fs.writeFileSync(file,zip(entries));fs.mkdirSync(dest);await assert.rejects(unpack(file,dest));}
 const file=path.join(f.root,'versions.zip'),dest=path.join(f.root,'unpack');fs.writeFileSync(file,zip([['one/MFGUnlocker.dll',fs.readFileSync(f.a)],['two/MFGUnlocker.dll',fs.readFileSync(f.b)]]));fs.mkdirSync(dest);await unpack(file,dest);await assert.rejects(mapFiles(dest,'mfg-universal'),/多个不同版本/);assert.equal(fs.existsSync(path.join(f.root,'escape.dll')),false);
});
test('cancel aborts a transfer without publishing a package or leaving partial files',async t=>{const f=fixture(t),updater=new ComponentUpdates(f.library,{fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});setTimeout(()=>updater.cancel(),10);})});
 await journal.atomicJson(updater.cache,{candidates:[{id:'x',provider:'mfg',component:'mfg-renodx',name:'renodx-mfgunlock.addon64',url:'https://github.com/mavismmg/MFGAdaUnlock-RenoDx/releases/download/1/file',size:100,sha256:'a'.repeat(64),downloadable:true}],errors:[]});
 // A cancellation is reported back as an outcome, so the window can close
 // quietly instead of surfacing an error the person did not cause.
 const cancelled=await updater.download('x');assert.equal(cancelled.cancelled,true);
 assert.equal(updater.busy,false);assert.equal(f.library.catalog().packages.length,0);assert.deepEqual(fs.readdirSync(path.join(f.library.root,'downloads')),[]);
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
  const cancelled = await updater.download(candidate.id);
  assert.equal(cancelled.cancelled, true);
  assert.equal(f.library.catalog().packages.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(f.library.root, 'downloads')), []);
});
