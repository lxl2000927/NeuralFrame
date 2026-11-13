import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtworkQueue } from '../ui/src/artworkQueue.ts';

const game = id => ({ dir: `D:\\QA\\${id}`, name: `Game ${id}`, appid: String(id) });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('artwork queue caps concurrency and lets a newly visible target overtake pending work', async () => {
  const calls = [], resolvers = [];
  let active = 0, peak = 0;
  const queue = createArtworkQueue((target, kind) => {
    calls.push([target.name, kind]); peak = Math.max(peak, ++active);
    return new Promise(resolve => resolvers.push(value => { active--; resolve(value); }));
  }, 2);
  const cancel = Array.from({length: 10}, (_, i) => queue.request(game(i), 'cover', 1));
  await tick(); assert.equal(calls.length, 2);
  queue.request(game(159), 'hero', 4);
  resolvers.shift()({ cover: 'first' }); await tick();
  assert.deepEqual(calls[2], ['Game 159', 'hero']);
  cancel.forEach(release => release());
  while (resolvers.length) resolvers.shift()({});
  await tick(); assert.equal(calls.length, 3); assert.equal(peak, 2);
});

test('duplicate views share requests and only subscribers for the same game are notified', async () => {
  let requests = 0, release;
  const queue = createArtworkQueue(() => { requests++; return new Promise(resolve => { release = resolve; }); });
  const first = queue.record(game(1)), other = queue.record(game(2));
  let changes = 0, otherChanges = 0;
  first.subscribe(() => changes++); other.subscribe(() => otherChanges++);
  queue.request(game(1), 'cover', 2); queue.request({...game(1),dir:game(1).dir.toLowerCase()}, 'cover', 2);
  await tick(); assert.equal(requests, 1);
  release({ cover: 'cached-cover' }); await tick();
  assert.equal(first.getSnapshot().cover, 'cached-cover'); assert.equal(changes, 1); assert.equal(otherChanges, 0);
  queue.request(game(1), 'cover', 2); await tick(); assert.equal(requests, 1);
});

test('a detached queued image is not downloaded, and later visibility can request it', async () => {
  const calls = [];
  const queue = createArtworkQueue(async target => { calls.push(target.name); return {}; });
  queue.request(game(1), 'cover', 1)();
  await tick(); assert.deepEqual(calls, []);
  queue.request(game(1), 'cover', 2); await tick(); assert.deepEqual(calls, ['Game 1']);
});

test('detaching an old view cannot cancel the replacement request after a queued retry', async () => {
  const calls = [];
  const queue = createArtworkQueue(async target => { calls.push(target.name); return {cover:'recovered'}; });
  const releaseOld = queue.request(game(1), 'cover', 1);
  queue.resetMissing();
  queue.request(game(1), 'cover', 2);
  // Another mounted view has already requested the current retry epoch when
  // a previous view (for example a filtered-out card) finishes detaching.
  releaseOld();
  await tick();
  assert.deepEqual(calls, ['Game 1']);
  assert.equal(queue.record(game(1)).getSnapshot().cover, 'recovered');
});

test('missing and rejected artwork settle once without an automatic retry loop', async () => {
  const calls = [];
  const queue = createArtworkQueue(async (_target, kind) => { calls.push(kind); if (kind === 'cover') throw Error('offline'); return {hero:'fallback'}; });
  queue.request(game(1), 'cover', 2); await tick();
  assert.equal(queue.record(game(1)).getSnapshot().settled.cover, true);
  queue.request(game(1), 'cover', 2); queue.request(game(1), 'hero', 2); await tick();
  assert.deepEqual(calls, ['cover', 'hero']);
  assert.equal(queue.record(game(1)).getSnapshot().hero, 'fallback');
});

test('a replacement title in the same directory cannot inherit the previous title artwork', async () => {
  const queue = createArtworkQueue(async target => ({cover:target.name}));
  queue.request(game(1), 'cover', 2); await tick();
  const replacement = {...game(1),name:'Replacement',appid:'new'};
  assert.equal(queue.record(replacement).getSnapshot().cover, undefined);
  queue.request(replacement, 'cover', 2); await tick();
  assert.equal(queue.record(game(1)).getSnapshot().cover, 'Game 1');
  assert.equal(queue.record(replacement).getSnapshot().cover, 'Replacement');
});

test('explicit recovery retries missing resources without discarding successful artwork', async () => {
  const calls = [];
  let online = false;
  const queue = createArtworkQueue(async (_target, kind, options) => {
    calls.push({kind, options});
    if (kind === 'tile') return {tile:'cached-tile'};
    if (!online) throw Error('offline');
    return {cover:'recovered-cover'};
  });
  queue.request(game(1),'cover',2); queue.request(game(1),'tile',2); await tick();
  online = true; queue.resetMissing();
  queue.request(game(1),'cover',2); queue.request(game(1),'tile',2); await tick();
  assert.deepEqual(calls.map(call=>call.kind),['cover','tile','cover']);
  assert.deepEqual(calls[2].options,{retry:true});
  assert.equal(queue.record(game(1)).getSnapshot().tile,'cached-tile');
  assert.equal(queue.record(game(1)).getSnapshot().cover,'recovered-cover');
});

test('online recovery targets visible missing artwork rather than hidden views', async () => {
  const calls = [];
  const queue = createArtworkQueue(async target => { calls.push(target.name); return {}; });
  queue.request(game(1),'cover',2); queue.request(game(2),'cover',2); await tick();
  const visible = queue.record(game(1)).visible(2);
  queue.record(game(2)).visible(0);
  queue.resetMissing(true);
  queue.request(game(1),'cover',2); queue.request(game(2),'cover',2); await tick();
  assert.deepEqual(calls,['Game 1','Game 2','Game 1']); visible();
});

test('bad URLs are shared, repair once per round, and accept a new cache revision', async () => {
  const calls = [];
  let answer = 'broken.png';
  const queue = createArtworkQueue(async (_target, kind, options) => { calls.push(options); return {[kind]:answer}; });
  const record = queue.record(game(1));
  queue.request(game(1),'cover',2); await tick();
  queue.reportFailure(game(1),'cover','broken.png');
  assert.ok(record.getSnapshot().failed.includes('broken.png'));
  queue.request(game(1),'cover',2); await tick();
  queue.reportFailure(game(1),'cover','broken.png');queue.request(game(1),'cover',2);await tick();
  assert.equal(calls.length,2);assert.deepEqual(calls[1],{retry:true,invalidUrl:'broken.png'});
  queue.resetMissing();answer='broken.png?v=2';
  queue.request(game(1),'cover',2);await tick();
  assert.equal(record.getSnapshot().cover,'broken.png?v=2');
  assert.ok(!record.getSnapshot().failed.includes(record.getSnapshot().cover));
});

test('a custom image error is shared but never starts an automatic repair', async () => {
  let calls = 0;
  const queue = createArtworkQueue(async()=>{calls++;return{};});
  const record = queue.record(game(1));
  queue.reportFailure(game(1),'cover','custom.png',false);await tick();
  assert.deepEqual(record.getSnapshot().failed,['custom.png']);assert.equal(calls,0);
});

test('retrying an in-flight request ignores its stale result and keeps the concurrency slot', async () => {
  const resolvers = [], calls = [];
  const queue = createArtworkQueue((_target,_kind,options)=>{
    calls.push(options);return new Promise(resolve=>resolvers.push(resolve));
  },1);
  queue.request(game(1),'cover',2);await tick();
  queue.resetMissing();queue.request(game(1),'cover',2);await tick();assert.equal(calls.length,1);
  resolvers.shift()({cover:'stale'});await tick();assert.equal(queue.record(game(1)).getSnapshot().cover,undefined);
  queue.request(game(1),'cover',2);await tick();assert.equal(calls.length,2);assert.deepEqual(calls[1],{retry:true});
  resolvers.shift()({cover:'current'});await tick();assert.equal(queue.record(game(1)).getSnapshot().cover,'current');
});

test('a slow banner response cannot overwrite a separately repaired portrait', async () => {
  let releaseHero;
  const queue = createArtworkQueue(async (_target,kind,options)=>kind==='hero'
    ? new Promise(resolve=>{releaseHero=resolve;}) : {cover:options?.retry?'portrait?v=2':'portrait'});
  queue.request(game(1),'hero',2);queue.request(game(1),'cover',2);await tick();
  queue.reportFailure(game(1),'cover','portrait');queue.request(game(1),'cover',2);await tick();
  assert.equal(queue.record(game(1)).getSnapshot().cover,'portrait?v=2');
  releaseHero({hero:'banner',cover:'portrait'});await tick();
  assert.equal(queue.record(game(1)).getSnapshot().cover,'portrait?v=2');
  assert.equal(queue.record(game(1)).getSnapshot().hero,'banner');
});
