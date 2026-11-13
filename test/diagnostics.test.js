'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const diagnostics = require('../src/core/diagnostics');

// Every report worth answering has needed the same files, asked for one at a
// time: the game's dlss5-feed.log, its ReShade.log, the install manifest, and
// which driver the person is on. This gathers them into one attachable file.
function game(t, files = {}) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostics-'));
  t.after(() => fs.rmSync(gameDir, { recursive: true, force: true }));
  const exeDir = path.join(gameDir, 'bin');
  fs.mkdirSync(path.join(exeDir, 'host64'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(gameDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return { gameDir, exeDir };
}

test('the logs a report needs are found and named', (t) => {
  const { gameDir, exeDir } = game(t, {
    'bin/dlss5-feed.log': 'feature ready: 3840x2160 DLAA',
    'bin/ReShade.log': 'Initializing crosire’s ReShade',
    'bin/host64/dlss5-feed-host.log': 'host started',
    '_DLSS5_Backup/manifest.json': '{"version":1,"route":"feeder"}'
  });

  const found = diagnostics.sources({ gameDir, exeDir });
  const labels = found.map(item => item.label);
  assert.ok(labels.includes('game: dlss5-feed.log'));
  assert.ok(labels.includes('game: ReShade.log'));
  assert.ok(labels.includes(`game: ${path.join('host64', 'dlss5-feed-host.log')}`));
  assert.ok(labels.includes('install manifest'));
});

test('every file found is in the report, with what the caller knew', (t) => {
  const { gameDir, exeDir } = game(t, {
    'bin/dlss5-feed.log': 'NGX feature 18 -> the query itself failed 0xBAD0000C',
    'bin/ReShade.log': 'loaded from bin\\\\dxgi.dll'
  });

  const { text, sources } = diagnostics.report({
    gameDir, exeDir,
    facts: { app: '2.2.3', gpu: 'NVIDIA GeForce RTX 5090 - 616.64', empty: null }
  });

  assert.equal(sources.length, 2);
  assert.match(text, /app: 2\.2\.3/);
  assert.match(text, /gpu: NVIDIA GeForce RTX 5090 - 616\.64/);
  assert.doesNotMatch(text, /empty/, 'a fact the caller did not have is left out, not printed as null');
  assert.match(text, /0xBAD0000C/, 'the feeder log is carried in full');
  assert.match(text, /dxgi\.dll/, 'so is the ReShade log');
});

test('standalone MFG and OptiScaler diagnostics include their fixed local evidence without unrelated files', t => {
  const {gameDir,exeDir} = game(t, {
    'bin/RTXMFG-Universal.log':'STANDALONE-LOG',
    'bin/RTXMFG-Universal.status.json':'{"pid":87,"dlss5State":2}',
    'bin/OptiScaler.log':'x'.repeat(diagnostics.TAIL_BYTES * 2) + 'OPTISCALER-TAIL',
    'bin/another-game.status.json':'NOT-SELECTED',
    'bin/RTXMFG-Universal.dmp':'NO-MEMORY-DUMP',
  });
  const listed = diagnostics.sources({gameDir,exeDir});
  assert.deepEqual(listed.map(item=>path.basename(item.file)).sort(),
    ['OptiScaler.log','RTXMFG-Universal.log','RTXMFG-Universal.status.json']);
  const {text,sources} = diagnostics.report({gameDir,exeDir});
  assert.deepEqual(sources,listed);
  assert.match(text,/STANDALONE-LOG/);
  assert.match(text,/"dlss5State":2/);
  assert.match(text,/OPTISCALER-TAIL/);
  assert.match(text,/bytes are omitted/);
  assert.doesNotMatch(text,/NOT-SELECTED|NO-MEMORY-DUMP/);
  assert.ok(Buffer.byteLength(text)<diagnostics.TAIL_BYTES+4096);
});

// A ReShade log from a long session runs to megabytes and the useful part is
// the end - where the crash is.
test('a huge log is cut from the front, and says where it was cut', (t) => {
  const big = 'x'.repeat(diagnostics.TAIL_BYTES * 3) + 'THE-END-OF-THE-FILE';
  const { gameDir, exeDir } = game(t, { 'bin/ReShade.log': big });

  const { text } = diagnostics.report({ gameDir, exeDir });
  assert.match(text, /THE-END-OF-THE-FILE/, 'the end is kept');
  assert.match(text, /the first \d+ bytes are omitted/);
  assert.ok(text.length < big.length / 2, 'the report is a fraction of the log it read');
});

for (const mutation of ['grow', 'truncate']) {
  test(`a log that can ${mutation} during export stays bounded and contains only bytes actually read`, t => {
    const initial = mutation === 'grow' ? 'original log' : 'x'.repeat(diagnostics.TAIL_BYTES * 2);
    const {gameDir, exeDir} = game(t, {'bin/ReShade.log':initial});
    const file = path.join(exeDir, 'ReShade.log');
    let changed = false;
    const mutate = stat => {
      if (!changed) {
        changed = true;
        if (mutation === 'grow') fs.appendFileSync(file, 'y'.repeat(diagnostics.TAIL_BYTES * 4));
        else fs.truncateSync(file, 0);
      }
      return stat;
    };
    // A live logger can change after either path-based or descriptor-based
    // sizing. Exercise the same boundary without timing-dependent threads.
    const stat = fs.statSync, fstat = fs.fstatSync;
    t.mock.method(fs, 'statSync', function(target, ...args) {
      const value = stat.call(this, target, ...args);
      return target === file ? mutate(value) : value;
    });
    t.mock.method(fs, 'fstatSync', function(...args) { return mutate(fstat.apply(this,args)); });
    const {text} = diagnostics.report({gameDir, exeDir});
    assert.equal(changed,true,'the fixture changed the log after its size was read');
    assert.ok(Buffer.byteLength(text) < diagnostics.TAIL_BYTES + 2048,'a growing log cannot bypass the export cap');
    assert.ok(!text.includes('\0'),'a rotated or truncated log must not export unread buffer padding');
  });
}

test('a game with no logs yet says so instead of producing an empty file', (t) => {
  const { gameDir, exeDir } = game(t);
  const { text, sources } = diagnostics.report({ gameDir, exeDir });
  assert.deepEqual(sources, []);
  assert.match(text, /No log files were found/);
  assert.match(text, /Run the install once, launch the game/);
});

// Nothing may be collected that the person is not shown first.
test('what would be gathered can be listed without reading any of it', (t) => {
  const { gameDir, exeDir } = game(t, { 'bin/dlss5-feed.log': 'secret-looking content' });
  const found = diagnostics.sources({ gameDir, exeDir });
  assert.equal(found.length, 1);
  assert.equal(found[0].bytes, 'secret-looking content'.length);
  assert.ok(!JSON.stringify(found).includes('secret-looking'), 'the listing carries paths and sizes, not contents');
});
test('Encore reports retain the latest session and exception logs with bounded tails, but no dumps or unrelated files', t => {
  const files={'bin/rtx-encore.jsonc':'{"configVersion":4}', 'bin/rtx-encore-logs/rtx-encore-status.json':'{"pid":12}'};
  for(let i=1;i<=5;i++) {
    files[`bin/rtx-encore-logs/rtx-encore-12-${i}.log`]=`session ${i}`;
    files[`bin/rtx-encore-logs/rtx-encore-12-${i}.crash.log`]=`exception ${i}`;
  }
  files['bin/rtx-encore-logs/rtx-encore-12-6.crash.log']='x'.repeat(diagnostics.TAIL_BYTES*2)+'CRASH-TAIL';
  files['bin/rtx-encore-logs/rtx-encore-12-6.dump1.dmp']='excluded memory';
  files['bin/rtx-encore-logs/other-program.log']='excluded unrelated';
  const {gameDir,exeDir}=game(t,files);
  for(const name of Object.keys(files)) {
    const n=Number(/12-(\d+)/.exec(name)?.[1] || 0);
    fs.utimesSync(path.join(gameDir,name),1000+n,1000+n);
  }
  const {text,sources}=diagnostics.report({gameDir,exeDir});
  assert.equal(sources.length,8);assert.ok(sources.some(s=>s.file.endsWith('12-3.log')));
  assert.ok(!sources.some(s=>s.file.endsWith('12-2.log')));assert.ok(!sources.some(s=>s.file.endsWith('12-3.crash.log')));
  assert.match(text,/session 5/);assert.match(text,/exception 5/);assert.match(text,/CRASH-TAIL/);assert.match(text,/bytes are omitted/);
  assert.doesNotMatch(text,/excluded memory|excluded unrelated/);
  assert.equal(diagnostics.sources({gameDir:exeDir,exeDir}).length,8,'same root is never listed twice');
});
test('Encore export does not traverse a linked log folder', t => {
  const {gameDir,exeDir}=game(t,{'outside/rtx-encore-status.json':'outside status','outside/rtx-encore-1-1.log':'outside log'});
  fs.symlinkSync(path.join(gameDir,'outside'),path.join(exeDir,'rtx-encore-logs'),process.platform==='win32'?'junction':'dir');
  assert.deepEqual(diagnostics.sources({gameDir,exeDir}),[]);
});

test('export keeps the confirmed source boundary when new or rotated logs appear', t => {
  const files = {'bin/ReShade.log':'CONFIRMED-RESHade'};
  for (let i=1;i<=3;i++) files[`bin/rtx-encore-logs/rtx-encore-17-${i}.log`]=`CONFIRMED-SESSION-${i}`;
  const {gameDir,exeDir}=game(t,files);
  const folder=path.join(exeDir,'rtx-encore-logs');
  for (let i=1;i<=3;i++) fs.utimesSync(path.join(folder,`rtx-encore-17-${i}.log`),1000+i,1000+i);
  const approvedSources=diagnostics.sources({gameDir,exeDir});
  fs.writeFileSync(path.join(folder,'rtx-encore-17-4.log'),'UNCONFIRMED-SESSION');
  fs.utimesSync(path.join(folder,'rtx-encore-17-4.log'),1004,1004);
  fs.writeFileSync(path.join(exeDir,'OptiScaler.log'),'UNCONFIRMED-OPTISCALER');
  const {text,sources}=diagnostics.report({gameDir,exeDir,approvedSources});
  assert.deepEqual(sources.map(item=>path.basename(item.file)).sort(),
    ['ReShade.log','rtx-encore-17-2.log','rtx-encore-17-3.log']);
  assert.match(text,/CONFIRMED-RESHade/);
  assert.match(text,/CONFIRMED-SESSION-3/);
  assert.doesNotMatch(text,/UNCONFIRMED-/);
  assert.ok(diagnostics.report({gameDir,exeDir}).text.includes('UNCONFIRMED-SESSION'),
    'callers without a confirmation snapshot keep the existing enumeration behavior');
  assert.deepEqual(diagnostics.report({gameDir,exeDir,approvedSources:[]}).sources,[],
    'an explicitly confirmed empty list never expands later');
});

test('confirmed log sources are checked again after removal or linked-directory replacement', t => {
  const {gameDir,exeDir}=game(t,{
    'bin/ReShade.log':'CONFIRMED',
    'bin/rtx-encore-logs/rtx-encore-17-1.log':'CONFIRMED-SESSION',
    'outside/rtx-encore-17-1.log':'UNRELATED-DATA',
  });
  const approvedSources=diagnostics.sources({gameDir,exeDir});
  fs.unlinkSync(path.join(exeDir,'ReShade.log'));
  fs.renameSync(path.join(exeDir,'rtx-encore-logs'),path.join(exeDir,'old-logs'));
  fs.symlinkSync(path.join(gameDir,'outside'),path.join(exeDir,'rtx-encore-logs'),process.platform==='win32'?'junction':'dir');
  const {text,sources}=diagnostics.report({gameDir,exeDir,approvedSources});
  assert.deepEqual(sources,[]);
  assert.doesNotMatch(text,/UNRELATED-DATA/);
});
