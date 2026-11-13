'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { RULES } = require('../src/art-cache');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/YQAAAAASUVORK5CYII=', 'base64');
const NOW = Date.UTC(2026, 10, 13, 12);
const keyFor = dir => crypto.createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-artwork-ipc-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return { root, game:path.join(root, 'Game'), state:path.join(root, 'library.json') };
}
function saveImage(file, marker = '') {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, Buffer.concat([PNG, Buffer.from(marker)]));
  return file;
}
function hit(appid = 101) {
  return { appid, coverUrl:`fixture:${appid}:cover`, heroUrl:`fixture:${appid}:hero`, heroFallbackUrl:`fixture:${appid}:header` };
}
function seedCache(f, record) {
  fs.writeFileSync(f.state, JSON.stringify({ art:{ [keyFor(f.game)]:record } }));
}
function savedRecord(f, game = f.game) {
  return JSON.parse(fs.readFileSync(f.state, 'utf8')).art?.[keyFor(game)];
}
function artFiles(root) {
  const folder = path.join(root, 'art');
  return fs.existsSync(folder) ? fs.readdirSync(folder) : [];
}
function load(root, artwork, options = {}) {
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main), handlers = new Map();
  const electron = {
    app:{ setAppUserModelId() {}, whenReady:() => ({ then() {} }), on() {}, getPath:() => root },
    ipcMain:{ handle:(name, callback) => handlers.set(name, callback) }, shell:{}
  };
  const host = Object.create(process);
  host.on = () => host;
  const overrides = {
    electron,
    './src/steamart':artwork,
    './src/core/game-inspection':{ GameInspection:class {
      async run(task) {
        assert.equal(task, 'discover');
        return { roots:[], games:options.games || [] };
      }
    } }
  };
  // The required cache module runs outside the VM. Use the same clock for
  // both writes and expiry checks so this fixture also works after its date.
  const cache = realRequire('./src/art-cache');
  overrides['./src/art-cache'] = { ...cache,
    reusable:(record, onDisk) => cache.reusable(record, onDisk, options.clock?.now ?? NOW),
    reusableImage:(record, kind, onDisk) => cache.reusableImage(record, kind, onDisk, options.clock?.now ?? NOW)
  };
  if (options.fs) overrides['./src/core/preview-fs'] = { ...realRequire('./src/core/preview-fs'), fs:options.fs };
  class Clock extends Date { static now() { return options.clock?.now ?? NOW; } }
  const context = vm.createContext({
    require:name => overrides[name] || realRequire(name), __dirname:path.dirname(main),
    process:host, Buffer, console, Date:Clock, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename:main });
  return (name, ...args) => handlers.get(name)({}, ...args);
}

for (const kind of ['cover','tile']) {
  for (const replacementId of [101,202]) {
    test(`a failed artwork index save preserves the published ${kind} for ${replacementId === 101 ? 'repair' : 'a replacement game'}`, async t => {
      const f = fixture(t), patchedFs = Object.create(fs);
      let refuseIndex = false, downloads = 0;
      patchedFs.renameSync = (from,to) => {
        if (refuseIndex && to === f.state) throw Error('fixture index save failure');
        return fs.renameSync(from,to);
      };
      const call = load(f.root, {
        look:async(name,id)=>hit(id),tileUrls:(name,id)=>[`fixture:${id}:tile`],
        download:async(url,dest)=>saveImage(dest,url+':download-'+(++downloads))
      }, {fs:patchedFs});
      const first = await call('art-fetch',f.game,'First Game',101,kind);
      const published = fileURLToPath(first[kind]), before = fs.readFileSync(published);
      const index = fs.readFileSync(f.state,'utf8');
      refuseIndex = true;
      const result = await call('art-fetch',f.game,replacementId === 101 ? 'First Game' : 'Replacement Game',replacementId,kind,{invalidUrl:first[kind]});
      assert.deepEqual(fs.readFileSync(published),before,'an index that failed to change must still refer to the original image bytes');
      assert.equal(fs.readFileSync(f.state,'utf8'),index);
      if (replacementId === 101) assert.equal(result[kind],first[kind]);
      else assert.ok(!result[kind],'an unpublished image must not be returned as the active cache');
      const reopened = load(f.root,{look:()=>assert.fail('the published cache must remain reusable')});
      assert.equal((await reopened('art-fetch',f.game,'First Game',101,kind))[kind],first[kind]);
    });
  }
}

test('a replacement Steam ID in the same directory cannot reuse any old artwork or a stale renderer request', async t => {
  const f = fixture(t), downloads = [], games = [{launcher:'Steam',id:101,dir:f.game,name:'First Game'}];
  const call = load(f.root, {
    look:async (name,id) => hit(id), tileUrls:(name,id) => [`fixture:${id}:tile`],
    download:async (url,dest) => { downloads.push(url); return saveImage(dest,url); }
  }, {games});
  for (const kind of ['cover','hero','tile']) await call('art-fetch',f.game,'First Game',101,kind);
  games[0] = {...games[0],id:202,name:'Replacement Game'};
  const replacement = (await call('library'))[0];
  assert.equal(replacement.poster,null); assert.equal(replacement.hero,null); assert.equal(replacement.tile,null);
  assert.equal((await call('art-fetch',f.game,'First Game',101,'cover')).cover,undefined);
  for (const kind of ['cover','hero','tile']) {
    const image = await call('art-fetch',f.game,'Replacement Game',202,kind);
    assert.ok(fs.readFileSync(fileURLToPath(image[kind])).includes(Buffer.from(`fixture:202:${kind}`)));
  }
  assert.equal(savedRecord(f).sourceIdentity,'steam:202');
  assert.equal(downloads.length,6);
});

for (const kind of ['cover','tile']) {
  test(`an older identity completing last cannot overwrite the replacement ${kind}`, async t => {
    const f = fixture(t), entered = deferred(), release = deferred();
    const call = load(f.root, {
      look:async (name,id) => hit(id), tileUrls:(name,id) => [`fixture:${id}:tile`],
      download:async (url,dest) => {
        if (url.includes(':101:')) { entered.resolve(); await release.promise; }
        return saveImage(dest,url);
      }
    });
    const old = call('art-fetch',f.game,'First Game',101,kind); await entered.promise;
    const current = await call('art-fetch',f.game,'Replacement Game',202,kind);
    release.resolve(); assert.equal((await old)[kind],undefined);
    assert.equal(savedRecord(f).sourceIdentity,'steam:202');
    assert.equal(savedRecord(f)[kind],current[kind]);
    assert.ok(fs.readFileSync(fileURLToPath(current[kind])).includes(Buffer.from(`fixture:202:${kind}`)));
    assert.equal(artFiles(f.root).length,1);
  });
}

test('library rediscovery invalidates an old download even before replacement artwork is requested', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  const games = [{launcher:'Steam',id:101,dir:f.game,name:'First Game'}];
  const call = load(f.root, {
    look:async (name,id) => hit(id),
    download:async (url,dest) => { entered.resolve(); await release.promise; return saveImage(dest,url); }
  }, {games});
  await call('library');
  const old = call('art-fetch',f.game,'First Game',101,'cover'); await entered.promise;
  games[0] = {...games[0],id:202,name:'Replacement Game'};
  await call('library'); release.resolve();
  assert.equal((await old).cover,undefined); assert.equal(fs.existsSync(f.state),false);
  assert.deepEqual(artFiles(f.root),[]);
});

test('name identities retain the original request and do not inherit a previous game search result', async t => {
  const f = fixture(t), lookups = [];
  const call = load(f.root, {
    look:async (name,id) => { lookups.push([name,id]); return {...hit(name.includes('First') ? 101 : 202),name:'Store canonical title'}; },
    download:async (url,dest) => saveImage(dest,url)
  });
  await call('art-fetch',f.game,'First Game',null,'cover');
  assert.equal(savedRecord(f).sourceIdentity,'name:first game');
  await call('art-fetch',f.game,'Replacement Game',null,'cover');
  assert.deepEqual(lookups,[['First Game',undefined],['Replacement Game',undefined]]);
  assert.equal(savedRecord(f).sourceIdentity,'name:replacement game');
  assert.equal(savedRecord(f).appid,202);
});

test('legacy cache migrates its identity without a download while contradictory IDs and orphan tiles do not', async t => {
  const f = fixture(t), old = saveImage(path.join(f.root,'art','old-cover.png'));
  seedCache(f,{rules:RULES,appid:101,cover:pathToFileURL(old).href,fetchedAt:NOW});
  const orphan = saveImage(path.join(f.root,'art',keyFor(f.game)+'-tile.jpg'),'old orphan');
  let downloads = 0;
  const call = load(f.root, {
    look:async (name,id) => hit(id), tileUrls:(name,id) => [`fixture:${id}:tile`],
    download:async (url,dest) => { downloads++; return saveImage(dest,url); }
  });
  assert.equal((await call('art-fetch',f.game,'First Game',101,'cover')).cover,pathToFileURL(old).href);
  assert.equal(downloads,0); assert.equal(savedRecord(f).sourceIdentity,'steam:101');
  await call('art-fetch',f.game,'Replacement Game',202,'cover');
  const tile = await call('art-fetch',f.game,'Replacement Game',202,'tile');
  assert.equal(downloads,2); assert.notEqual(fileURLToPath(tile.tile),orphan);
  assert.ok(fs.readFileSync(orphan).includes(Buffer.from('old orphan')),'unowned old cache files are not replaced');
  assert.ok(fs.readFileSync(fileURLToPath(tile.tile)).includes(Buffer.from('fixture:202:tile')));
  const legacy = fixture(t);
  seedCache(legacy,{rules:RULES,appid:101,cover:pathToFileURL(old).href,fetchedAt:NOW});
  const next = load(legacy.root,{look:async(name,id)=>hit(id),download:async(url,dest)=>saveImage(dest,url)});
  const result = await next('art-fetch',legacy.game,'Replacement Game',202,'cover');
  assert.equal(result.appid,202); assert.notEqual(fileURLToPath(result.cover),old);
});

test('replacing a game identity preserves a custom directory poster', async t => {
  const f = fixture(t), custom = saveImage(path.join(f.root,'posters','custom.png'));
  const old = saveImage(path.join(f.root,'art','old.png'));
  fs.writeFileSync(f.state,JSON.stringify({posters:{[keyFor(f.game)]:custom},art:{[keyFor(f.game)]:{
    rules:RULES,appid:101,sourceIdentity:'steam:101',cover:pathToFileURL(old).href
  }}}));
  const call = load(f.root,{}, {games:[{launcher:'Steam',id:202,dir:f.game,name:'Replacement Game'}]});
  const game = (await call('library'))[0];
  assert.equal(game.poster.custom,true); assert.equal(fileURLToPath(game.poster.url),custom);
  assert.equal(game.hero,null); assert.equal(game.tile,null);
});

for (const kind of ['cover','tile']) {
  test(`explicit ${kind} retry bypasses only a negative cache and preserves failed replacement bytes`, async t => {
    const f = fixture(t); let downloads = 0, fail = true;
    const call = load(f.root,{
      look:async(name,id)=>hit(id),tileUrls:(name,id)=>[`fixture:${id}:tile`],
      download:async(url,dest)=>{downloads++;if(fail)throw Error('offline');return saveImage(dest,url);}
    });
    await call('art-fetch',f.game,'Game',101,kind);
    await call('art-fetch',f.game,'Game',101,kind);
    assert.equal(downloads,1); fail = false;
    const ready = await call('art-fetch',f.game,'Game',101,kind,{retry:true});
    assert.equal(downloads,2); assert.match(ready[kind],/\?v=/);
    assert.ok(fs.existsSync(fileURLToPath(ready[kind])),'versioned image URLs still resolve to local cache files');
    await call('art-fetch',f.game,'Game',101,kind,{retry:true});
    await call('art-fetch',f.game,'Game',101,kind,{invalidUrl:'file:///unrelated.png'});
    await call('art-fetch',f.game,'Game',101,kind,null);
    await call('art-fetch',f.game,'Game',101,kind,'invalid options');
    assert.equal(downloads,2,'positive files and unrelated bad URLs do not trigger repair');
    const before = fs.readFileSync(fileURLToPath(ready[kind])); fail = true;
    const failed = await call('art-fetch',f.game,'Game',101,kind,{invalidUrl:ready[kind]});
    assert.equal(downloads,3); assert.equal(failed[kind],ready[kind]);
    assert.equal(savedRecord(f)[kind],ready[kind]);
    assert.deepEqual(fs.readFileSync(fileURLToPath(ready[kind])),before);
  });
}

test('a reported old bad URL cannot invalidate a successfully repaired image', async t => {
  const f = fixture(t), old = saveImage(path.join(f.root,'art','old.png'));
  const oldUrl = pathToFileURL(old).href; let downloads = 0;
  seedCache(f,{rules:RULES,sourceIdentity:'steam:101',appid:101,cover:oldUrl,fetchedAt:NOW});
  const call = load(f.root,{look:async(name,id)=>hit(id),download:async(url,dest)=>{downloads++;return saveImage(dest,'repaired');}});
  const fixed = await call('art-fetch',f.game,'Game',101,'cover',{invalidUrl:oldUrl});
  assert.notEqual(fixed.cover,oldUrl); assert.equal(downloads,1);
  const stale = await call('art-fetch',f.game,'Game',101,'cover',{invalidUrl:oldUrl});
  assert.equal(stale.cover,fixed.cover); assert.equal(downloads,1);
});

test('cover IPC deduplicates concurrent requests without waiting for hero or store details', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  const lookups = [], downloads = [];
  const call = load(f.root, {
    look:async (name, appid, options) => {
      lookups.push(options);
      assert.equal(options.details, false, 'portrait lookup must skip store metadata');
      return hit(appid);
    },
    heroFallbackUrl:() => { assert.fail('a cover must not request hero metadata'); },
    download:async (url, dest) => {
      downloads.push(url);
      assert.equal(url, 'fixture:101:cover', 'cover requests must not download a banner');
      entered.resolve();
      await release.promise;
      return saveImage(dest);
    }
  });
  const first = call('art-fetch', f.game, 'Game', 101, 'cover');
  await entered.promise;
  const second = call('art-fetch', f.game, 'Game', 101, 'cover');
  release.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(lookups.length, 1);
  assert.equal(downloads.length, 1);
  assert.equal(a.cover, b.cover);
  assert.ok(fs.existsSync(fileURLToPath(a.cover)));
  assert.equal(a.hero, null);
});

for (const firstKind of ['cover', 'hero']) {
  test(`independent cover and hero completions merge the cache when ${firstKind} finishes first`, async t => {
    const f = fixture(t), gates = { cover:deferred(), hero:deferred() };
    const entered = { cover:deferred(), hero:deferred() };
    let searches = 0;
    const call = load(f.root, {
      look:async () => { searches++; return hit(); },
      download:async (url, dest) => {
        const kind = url.endsWith(':cover') ? 'cover' : 'hero';
        entered[kind].resolve();
        await gates[kind].promise;
        return saveImage(dest, kind);
      }
    });
    const jobs = Object.fromEntries(['cover', 'hero'].map(kind => [kind, call('art-fetch', f.game, 'Game', 101, kind)]));
    await Promise.all(Object.values(entered).map(gate => gate.promise));
    assert.equal(searches, 1, 'concurrent image requests should share the fast lookup');
    await call('set-lang', 'en');
    gates[firstKind].resolve();
    const first = await jobs[firstKind];
    assert.ok(first[firstKind]);
    assert.ok(savedRecord(f)[firstKind]);
    const secondKind = firstKind === 'cover' ? 'hero' : 'cover';
    gates[secondKind].resolve();
    await jobs[secondKind];
    const record = savedRecord(f);
    assert.ok(record.cover && record.hero);
    assert.ok(fs.existsSync(fileURLToPath(record.cover)) && fs.existsSync(fileURLToPath(record.hero)));
    assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).lang, 'en');
    assert.equal(artFiles(f.root).filter(name => name.endsWith('.tmp')).length, 0);
  });
}

test('failed cover retries cool down across restart without suppressing an unrequested hero', async t => {
  const f = fixture(t), clock = { now:NOW };
  let searches = 0, downloads = 0, offline = true;
  const artwork = {
    look:async () => { searches++; return hit(); },
    download:async (url, dest) => {
      downloads++;
      if (offline && url.endsWith(':cover')) throw Error('fixture offline');
      return saveImage(dest);
    }
  };
  let call = load(f.root, artwork, { clock });
  assert.equal((await call('art-fetch', f.game, 'Game', 101, 'cover')).cover, null);
  await call('art-fetch', f.game, 'Game', 101, 'cover');
  assert.equal(searches, 1);
  assert.equal(downloads, 1);
  call = load(f.root, artwork, { clock });
  await call('art-fetch', f.game, 'Game', 101, 'cover');
  assert.equal(searches, 1, 'failed attempts must survive restarting the main process');
  assert.ok((await call('art-fetch', f.game, 'Game', 101, 'hero')).hero, 'a cover miss is not a hero attempt');
  assert.equal(searches, 2);
  clock.now += 10 * 60 * 1000 + 1;
  offline = false;
  assert.ok((await call('art-fetch', f.game, 'Game', 101, 'cover')).cover);
  assert.equal(searches, 3);
  assert.ok(savedRecord(f).hero, 'a successful retry must retain the banner');
});

test('a late cover failure cannot discard a concurrent successful hero or its retry state', async t => {
  const f = fixture(t), clock = { now:NOW }, entered = deferred(), release = deferred();
  let searches = 0;
  const artwork = {
    look:async () => { searches++; return hit(); },
    download:async (url, dest) => {
      if (url.endsWith(':cover')) {
        entered.resolve();
        await release.promise;
        throw Error('fixture portrait unavailable');
      }
      return saveImage(dest);
    }
  };
  const call = load(f.root, artwork, { clock });
  const cover = call('art-fetch', f.game, 'Game', 101, 'cover');
  await entered.promise;
  const hero = await call('art-fetch', f.game, 'Game', 101, 'hero');
  release.resolve();
  const result = await cover;
  assert.equal(result.hero, hero.hero);
  assert.equal(savedRecord(f).hero, hero.hero);
  assert.equal(savedRecord(f).cover, null);
  const callsBeforeRestart = searches;
  const restarted = load(f.root, artwork, { clock });
  await restarted('art-fetch', f.game, 'Game', 101, 'cover');
  assert.equal((await restarted('art-fetch', f.game, 'Game', 101, 'hero')).hero, hero.hero);
  assert.equal(searches, callsBeforeRestart, 'restart must retain both the miss cooldown and the usable banner');
});

test('existing cover and hero need no network after restart; a deleted image retries immediately', async t => {
  const f = fixture(t), cover = saveImage(path.join(f.root, 'art', 'existing-cover.png'));
  const hero = saveImage(path.join(f.root, 'art', 'existing-hero.png'));
  seedCache(f, { rules:RULES, cover:pathToFileURL(cover).href, hero:pathToFileURL(hero).href, fetchedAt:NOW });
  let searches = 0, downloads = 0;
  const artwork = { look:async () => { searches++; return hit(); }, download:async (url, dest) => { downloads++; return saveImage(dest); } };
  const call = load(f.root, artwork);
  assert.equal((await call('art-fetch', f.game, 'Game', 101, 'cover')).cover, pathToFileURL(cover).href);
  assert.equal((await call('art-fetch', f.game, 'Game', 101, 'hero')).hero, pathToFileURL(hero).href);
  assert.equal(searches, 0);
  assert.equal(downloads, 0);
  fs.unlinkSync(cover);
  assert.ok((await call('art-fetch', f.game, 'Game', 101, 'cover')).cover);
  assert.equal(searches, 1);
  assert.equal(downloads, 1);
  assert.equal(savedRecord(f).hero, pathToFileURL(hero).href);
});

test('the legacy artwork IPC still returns both images and optional store metadata', async t => {
  const f = fixture(t), downloads = [];
  const call = load(f.root, {
    look:async (name, appid, options) => {
      assert.notEqual(options?.details, false);
      return { ...hit(appid), genres:['Adventure'], description:'Fixture description' };
    },
    download:async (url, dest) => { downloads.push(url); return saveImage(dest); }
  });
  const result = await call('art-fetch', f.game, 'Game', 101);
  assert.ok(result.cover && result.hero);
  assert.deepEqual(Array.from(result.genres), ['Adventure']);
  assert.equal(result.description, 'Fixture description');
  assert.deepEqual(downloads.sort(), ['fixture:101:cover', 'fixture:101:hero']);
});

test('legacy artwork completes a cover-only cache once and reuses the full result after restart', async t => {
  const f = fixture(t), downloads = [], lookups = [];
  const artwork = {
    look:async (name, appid, options) => {
      const details = options?.details !== false;
      lookups.push(details);
      return details ? { ...hit(appid), genres:['Adventure'], description:'Fixture description' } : hit(appid);
    },
    download:async (url, dest) => { downloads.push(url); return saveImage(dest); }
  };
  const call = load(f.root, artwork);
  const partial = await call('art-fetch', f.game, 'Game', 101, 'cover');
  assert.ok(partial.cover);
  assert.equal(partial.hero, null);
  assert.equal(partial.description, undefined);
  const full = await call('art-fetch', f.game, 'Game', 101);
  assert.equal(full.cover, partial.cover, 'completing metadata must reuse the downloaded cover');
  assert.ok(full.hero);
  assert.deepEqual(Array.from(full.genres), ['Adventure']);
  assert.equal(full.description, 'Fixture description');
  assert.deepEqual(lookups, [false, true]);
  assert.deepEqual(downloads, ['fixture:101:cover', 'fixture:101:hero']);
  const restarted = load(f.root, artwork);
  const cached = await restarted('art-fetch', f.game, 'Game', 101);
  assert.equal(cached.cover, full.cover);
  assert.equal(cached.hero, full.hero);
  assert.equal(cached.description, full.description);
  assert.deepEqual(lookups, [false, true], 'completed metadata must remain cached across restart');
  assert.deepEqual(downloads, ['fixture:101:cover', 'fixture:101:hero']);
});

test('hero store fallback runs only after both fixed artwork URLs fail', async t => {
  const f = fixture(t), requests = [];
  const call = load(f.root, {
    look:async () => hit(),
    heroFallbackUrl:async appid => { requests.push(`details:${appid}`); return 'fixture:store-hero'; },
    download:async (url, dest) => {
      requests.push(url);
      if (url !== 'fixture:store-hero') throw Error('fixture missing');
      return saveImage(dest);
    }
  });
  assert.ok((await call('art-fetch', f.game, 'Game', 101, 'hero')).hero);
  assert.deepEqual(requests, ['fixture:101:hero', 'fixture:101:header', 'details:101', 'fixture:store-hero']);
});

for (const reset of ['reset-library', 'reset']) {
  test(`${reset} prevents an in-flight cover from republishing its index or overwriting old artwork`, async t => {
    const f = fixture(t), entered = deferred(), release = deferred();
    const oldFile = saveImage(path.join(f.root, 'art', keyFor(f.game) + '-cover.jpg'), 'old');
    const before = fs.readFileSync(oldFile);
    const call = load(f.root, {
      look:async () => hit(),
      download:async (url, dest) => {
        saveImage(dest, 'partial');
        entered.resolve();
        await release.promise;
        return saveImage(dest, 'new');
      }
    });
    const pending = call('art-fetch', f.game, 'Game', 101, 'cover');
    await entered.promise;
    await call(reset);
    await call('set-lang', 'en');
    release.resolve();
    const result = await pending;
    assert.ok(!result.cover, 'a reset request must not return discarded image URLs');
    assert.equal(savedRecord(f), undefined);
    assert.deepEqual(fs.readFileSync(oldFile), before);
    assert.deepEqual(artFiles(f.root), [path.basename(oldFile)]);
  });
}

test('a new request after reset does not reuse an old pending request or get overwritten by it', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  let searches = 0, downloads = 0;
  const call = load(f.root, {
    look:async () => { searches++; return hit(); },
    download:async (url, dest) => {
      const sequence = ++downloads;
      if (sequence === 1) {
        entered.resolve();
        await release.promise;
      }
      return saveImage(dest, sequence === 1 ? 'discarded generation' : 'current generation');
    }
  });
  const oldRequest = call('art-fetch', f.game, 'Game', 101, 'cover');
  await entered.promise;
  await call('reset-library');
  const current = await call('art-fetch', f.game, 'Game', 101, 'cover');
  assert.equal(searches, 2, 'generation must be included in concurrent request deduplication');
  release.resolve();
  const old = await oldRequest;
  assert.ok(!old.cover);
  assert.equal(savedRecord(f).cover, current.cover);
  assert.ok(fs.readFileSync(fileURLToPath(current.cover)).includes(Buffer.from('current generation')));
  assert.equal(artFiles(f.root).length, 1);
});

test('two different games keep distinct image bytes, URLs and cache entries', async t => {
  const f = fixture(t), other = path.join(f.root, 'Other Game');
  const call = load(f.root, {
    look:async (name, appid) => hit(appid),
    download:async (url, dest) => saveImage(dest, url)
  });
  const [a, b] = await Promise.all([
    call('art-fetch', f.game, 'Game', 101, 'cover'),
    call('art-fetch', other, 'Other Game', 202, 'cover')
  ]);
  assert.notEqual(a.cover, b.cover);
  assert.ok(fs.readFileSync(fileURLToPath(a.cover)).includes(Buffer.from('fixture:101:cover')));
  assert.ok(fs.readFileSync(fileURLToPath(b.cover)).includes(Buffer.from('fixture:202:cover')));
  assert.equal(savedRecord(f).appid, 101);
  assert.equal(savedRecord(f, other).appid, 202);
});

for (const failure of ['download', 'publish']) {
  test(`a ${failure} failure leaves previous cover bytes and cache usable`, async t => {
    const f = fixture(t), oldFile = saveImage(path.join(f.root, 'art', keyFor(f.game) + '-cover.jpg'), 'old');
    const before = fs.readFileSync(oldFile), url = pathToFileURL(oldFile).href;
    seedCache(f, { rules:0, cover:url, hero:null, fetchedAt:0 });
    const patchedFs = Object.create(fs);
    patchedFs.renameSync = (from, to) => {
      if (failure === 'publish' && path.dirname(to) === path.join(f.root, 'art')) throw Error('fixture publish failure');
      return fs.renameSync(from, to);
    };
    const call = load(f.root, {
      look:async () => hit(),
      download:async (remote, dest) => {
        assert.notEqual(dest, oldFile, 'downloads must use a temporary path');
        saveImage(dest, 'incomplete replacement');
        if (failure === 'download') throw Error('fixture partial download');
        return dest;
      }
    }, { fs:patchedFs });
    const result = await call('art-fetch', f.game, 'Game', 101, 'cover');
    assert.equal(result.cover, url);
    assert.deepEqual(fs.readFileSync(oldFile), before);
    assert.equal(savedRecord(f).cover, url);
    assert.deepEqual(artFiles(f.root), [path.basename(oldFile)]);
  });
}

test('background cover and hero updates preserve a custom library poster', async t => {
  const f = fixture(t), custom = saveImage(path.join(f.root, 'posters', 'custom.png'), 'custom');
  fs.writeFileSync(f.state, JSON.stringify({ posters:{ [keyFor(f.game)]:custom } }));
  const call = load(f.root, { look:async () => hit(), download:async (url, dest) => saveImage(dest) }, {
    games:[{ launcher:'Steam', id:101, dir:f.game, name:'Game' }]
  });
  await Promise.all(['cover', 'hero'].map(kind => call('art-fetch', f.game, 'Game', 101, kind)));
  const games = await call('library');
  assert.equal(games.length, 1);
  assert.equal(games[0].poster.custom, true);
  assert.equal(fileURLToPath(games[0].poster.url), custom);
  assert.ok(fs.readFileSync(custom).includes(Buffer.from('custom')));
  assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).posters[keyFor(f.game)], custom);
});

test('home tile failure cooldown persists across restart and expires for a later retry', async t => {
  const f = fixture(t), clock = { now:NOW };
  let downloads = 0, offline = true;
  const artwork = {
    tileUrls:() => ['fixture:tile'],
    download:async (url, dest) => {
      downloads++;
      if (offline) throw Error('fixture offline');
      return saveImage(dest);
    }
  };
  let call = load(f.root, artwork, { clock });
  assert.ok(!(await call('art-fetch', f.game, 'Game', 101, 'tile')).tile);
  await call('art-fetch', f.game, 'Game', 101, 'tile');
  call = load(f.root, artwork, { clock });
  await call('art-fetch', f.game, 'Game', 101, 'tile');
  assert.equal(downloads, 1);
  clock.now += 10 * 60 * 1000 + 1;
  offline = false;
  const recovered = await call('art-fetch', f.game, 'Game', 101, 'tile');
  assert.ok(recovered.tile);
  assert.equal(downloads, 2);
  assert.equal(savedRecord(f).tile, recovered.tile);
  assert.equal((await call('art-fetch', f.game, 'Game', 101, 'tile')).tile, recovered.tile);
  assert.equal(downloads, 2, 'cached home tiles must not use the network');
});

test('reset during a tile download leaves no image or stale tile cache entry', async t => {
  const f = fixture(t), entered = deferred(), release = deferred();
  const call = load(f.root, {
    tileUrls:() => ['fixture:tile'],
    download:async (url, dest) => {
      saveImage(dest);
      entered.resolve();
      await release.promise;
      return dest;
    }
  });
  const pending = call('art-fetch', f.game, 'Game', 101, 'tile');
  await entered.promise;
  await call('reset-library');
  release.resolve();
  assert.ok(!(await pending).tile);
  assert.equal(savedRecord(f), undefined);
  assert.deepEqual(artFiles(f.root), []);
});

test('library IPC exposes discovered local Steam artwork without fetching remote images', async t => {
  const f = fixture(t);
  const cover = saveImage(path.join(f.root, 'steam-cache', 'portrait.png'));
  const tile = saveImage(path.join(f.root, 'steam-cache', 'landscape.png'));
  const hero = saveImage(path.join(f.root, 'steam-cache', 'hero.png'));
  const call = load(f.root, {
    look:() => { assert.fail('discovered local artwork must not require remote lookup'); },
    download:() => { assert.fail('discovered local artwork must not require downloading'); }
  }, {
    games:[{ launcher:'Steam', id:101, dir:f.game, name:'Game', poster:{file:cover,tall:true}, artwork:{tile,hero} }]
  });
  const games = await call('library');
  assert.equal(games.length, 1);
  assert.equal(games[0].poster.url, pathToFileURL(cover).href);
  assert.equal(games[0].tile, pathToFileURL(tile).href);
  assert.equal(games[0].hero, pathToFileURL(hero).href);
  assert.equal(fs.existsSync(f.state), false, 'displaying local artwork must not create a remote cache record');
  const oldWide = saveImage(path.join(f.root,'art','old-wide.png'));
  const before = JSON.stringify({art:{[keyFor(f.game)]:{hero:pathToFileURL(oldWide).href,rules:RULES}}});
  fs.writeFileSync(f.state,before);
  const cached = load(f.root, {}, {games:[{launcher:'Steam',id:101,dir:f.game,name:'Game',poster:{file:cover,tall:true}}]});
  const [reopened] = await cached('library');
  assert.equal(reopened.poster.url,pathToFileURL(cover).href,'a real local portrait wins over an old wide fallback');
  assert.equal(reopened.poster.tall,true);
  assert.equal(fs.readFileSync(f.state,'utf8'),before,'local portrait priority does not change the stored index');
});
