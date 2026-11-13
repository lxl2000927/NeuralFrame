'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const art = require('../src/steamart');
const cache = require('../src/art-cache');
const vm = require('node:vm');

function controlledStore(fetcher) {
  let now = 10000;
  const timers = [];
  const module = {exports:{}};
  const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/steamart.js'),'utf8'), {
    require, module, Buffer, AbortSignal, fetch:(...args)=>fetcher(now,...args), Date:{now:()=>now},
    setTimeout:(fn,delay)=>timers.push({fn,at:now+delay}),
  },{filename:'steamart-controlled.js'});
  return {art:module.exports,flush,async advance(delta) {
    const until=now+delta;
    for (;;) {
      timers.sort((a,b)=>a.at-b.at);
      if (!timers.length || timers[0].at>until) break;
      const timer=timers.shift();now=timer.at;timer.fn();await flush();
    }
    now=until;await flush();
  }};
}

test('Chinese titles and empty names cannot select an unrelated first search result', () => {
  const rows = [{ id: 1, name: 'Another Game' }, { id: 2, name: '鸣潮', type: 'app' }];
  assert.equal(art.pick(rows, '鸣潮').id, 2);
  assert.equal(art.pick(rows, '未知游戏'), null);
  assert.equal(art.pick(rows, '???'), null);
  assert.equal(art.pick([{ name: '' }], 'A'), null);
});

test('Wuthering Waves uses its known Steam ID and the actual hashed store header', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /appdetails\?appids=3513350/);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ 3513350: { success: true, data: { name: 'Wuthering Waves', header_image: 'https://cdn.example/hashed/header.jpg' } } });
  });
  const result = await art.look('鸣潮');
  assert.equal(result.appid, 3513350);
  assert.equal(result.heroFallbackUrl, 'https://cdn.example/hashed/header.jpg');
});

test('Star Rail aliases use the official listing artwork without a wrong Steam match', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('should not search Steam'); });
  for (const title of ['崩坏：星穹铁道', 'Honkai: Star Rail', 'hkrpg_bilibili']) {
    const result = await art.look(title);
    assert.equal(result.appid, null);
    assert.match(result.heroUrl, /^https:\/\/cdn1\.epicgames\.com\//);
    assert.equal(result.source, 'https://store.epicgames.com/p/honkai-star-rail');
  }
});

test('home tiles prefer catalog banners and fall back to a landscape Steam capsule', () => {
  const [banner, fallback] = art.tileUrls('鸣潮', null);
  assert.match(banner, /^https:\/\/img\.nvidiagrid\.net\/apps\/[^/]+\/CN\/TV_BANNER_/);
  assert.match(fallback, /3513350\/capsule_616x353\.jpg$/);
  assert.match(art.tileUrls('Honkai: Star Rail', null)[0], /\/CN\/TV_BANNER_/);
  assert.deepEqual(art.tileUrls('鸣潮', '431960'), [
    'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/431960/capsule_616x353.jpg'
  ]);
  assert.deepEqual(art.tileUrls('Unlisted local game', null), []);
});

test('cache retries empty and deleted artwork while preserving existing images on upgrade', () => {
  const onDisk = value => value === 'good';
  const now = 100000000;
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: null, cover: null }, onDisk, now), true);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now - 600001 }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: 'deleted' }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now, hero: 'good' }, onDisk, now), true);
  assert.equal(cache.reusable({ rules: cache.RULES, fetchedAt: now - 86400001, hero: 'good' }, onDisk, now), false);
  assert.equal(cache.reusable({ rules: 4, cover: 'good' }, onDisk, now), false);
  assert.deepEqual(cache.usable({ rules: 4, cover: 'good', hero: 'deleted' }, onDisk), { cover: 'good', hero: null });
});

test('HTML returned with status 200 never replaces cached artwork', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enhanced-art-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cover.jpg');
  fs.writeFileSync(file, 'existing-art');
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>' + 'error'.repeat(1000)));
  await assert.rejects(art.download('https://cdn.example/art', file), /not supported artwork/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'existing-art');
});

test('oversized downloads are rejected before writing', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('small', { headers: { 'content-length': 32 * 1024 * 1024 } }));
  await assert.rejects(art.download('https://cdn.example/art', 'unused'), /too large/);
});

test('known-ID fast artwork lookup does not wait for store metadata already in flight', async () => {
  let release, calls=0;
  const controlled=controlledStore((_at,url)=>{
    assert.match(url,/appdetails/);calls++;
    return new Promise(resolve=>{release=resolve;});
  });
  const slow=controlled.art.look('ELDEN RING','1245620');await controlled.flush();assert.equal(calls,1);
  const fast=await controlled.art.look('ELDEN RING','1245620',{details:false});
  assert.equal(calls,1);assert.match(fast.coverUrl,/1245620\/library_600x900\.jpg$/);
  assert.match(fast.heroFallbackUrl,/1245620\/header\.jpg$/);assert.equal(fast.summary,null);
  const known=await controlled.art.look('鸣潮',null,{details:false});assert.equal(known.appid,3513350);assert.equal(calls,1);
  release(Response.json({1245620:{success:true,data:{name:'ELDEN RING',header_image:'https://cdn.example/hashed.jpg',short_description:'optional details'}}}));
  assert.equal((await slow).summary,'optional details','default callers still get full metadata');
});

test('unknown-title fast lookup only searches once and leaves the optional details API untouched', async () => {
  const urls=[];
  const controlled=controlledStore((_at,url)=>{
    urls.push(url);assert.match(url,/storesearch/);
    return Promise.resolve(Response.json({items:[{id:987,name:'Example Game',type:'app'}]}));
  });
  const result=await controlled.art.look('Example Game',null,{details:false});
  assert.equal(result.appid,987);assert.equal(urls.length,1);assert.match(result.heroUrl,/987\/library_hero\.jpg$/);
});

test('concurrent store requests start in separate 320ms slots rather than one simultaneous wakeup', async () => {
  const starts=[];
  const controlled=controlledStore((at,url)=>{
    starts.push(at);
    const query=new URL(url).searchParams.get('term');
    return Promise.resolve(Response.json({items:[{id:starts.length,name:query,type:'app'}]}));
  });
  const all=Promise.all(['First Game','Second Game','Third Game'].map(name=>controlled.art.look(name,null,{details:false})));
  await controlled.flush();assert.deepEqual(starts,[10000]);
  await controlled.advance(319);assert.deepEqual(starts,[10000]);
  await controlled.advance(1);assert.deepEqual(starts,[10000,10320]);
  await controlled.advance(320);assert.deepEqual(starts,[10000,10320,10640]);
  assert.equal((await all).length,3);
});

test('running details and lazy header fallback share one request, including failure and later retry', async () => {
  let calls=0,reject;
  const controlled=controlledStore((_at,url)=>{
    assert.match(url,/appdetails\?appids=42/);
    if (++calls===1) return new Promise((_resolve,fail)=>{reject=fail;});
    return Promise.resolve(Response.json({42:{success:true,data:{header_image:'https://cdn.example/real-hash/header.jpg'}}}));
  });
  const first=controlled.art.look('Example',42),second=controlled.art.look('Example','42'),header=controlled.art.heroFallbackUrl(42);
  await controlled.flush();assert.equal(calls,1);reject(Error('temporary network failure'));
  await Promise.all([first,second,header]);
  const retry=controlled.art.heroFallbackUrl(42);await controlled.flush();await controlled.advance(320);
  assert.equal(await retry,'https://cdn.example/real-hash/header.jpg');assert.equal(calls,2);
  assert.equal(await controlled.art.heroFallbackUrl(null),null);assert.equal(calls,2);
});

test('concurrent cleaned title searches share a request and a failed search remains retryable', async () => {
  let calls=0,reject;
  const controlled=controlledStore((_at,url)=>{
    assert.match(url,/storesearch/);
    if (++calls===1)return new Promise((_resolve,fail)=>{reject=fail;});
    return Promise.resolve(Response.json({items:[{id:55,name:'Example Game',type:'app'}]}));
  });
  const pending=Promise.allSettled([
    controlled.art.look('Example Game [FitGirl]',null,{details:false}),
    controlled.art.look('example_game',null,{details:false}),
  ]);
  await controlled.flush();assert.equal(calls,1);reject(Error('temporary search failure'));
  const failed=await pending;assert.equal(failed[0].status,'rejected');assert.equal(failed[1].status,'rejected');
  const retry=controlled.art.look('Example Game',null,{details:false});await controlled.flush();await controlled.advance(320);
  assert.equal((await retry).appid,55);assert.equal(calls,2);
});
