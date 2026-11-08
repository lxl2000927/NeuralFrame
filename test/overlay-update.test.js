'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOverlayLibrary } = require('../src/overlays');
const gameOverlay = require('../src/game-overlay');

// realpathSync only answers for a directory that exists, and the library
// resolves install targets the same way.
function realDir(...parts) {
  const dir = path.join(...parts);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

// readNative only reads the DOS and COFF headers, so a handful of fields is a
// complete binary as far as the library is concerned. `filler` makes two
// otherwise identical builds hash differently, which is what an update looks
// like from here.
function minimalPe(file, { dll, filler }) {
  const buf = Buffer.alloc(512, filler);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x00004550, 0x80);
  buf.writeUInt16LE(0x8664, 0x84);
  buf.writeUInt16LE(dll ? 0x2022 : 0x0022, 0x96);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

function upgradeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-overlay-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = realDir(root, 'game');
  const exe = minimalPe(path.join(gameDir, 'Game.exe'), { dll:false, filler:1 });
  const libraryFor = filler => createOverlayLibrary(path.join(root, 'library'),
    minimalPe(path.join(root, String(filler), 'overlay.addon64'), { dll:true, filler }));
  const oldLibrary = libraryFor(2), library = libraryFor(3);
  const old = oldLibrary.install('builtin', exe);
  const target = { path:exe, bitness:64, api:'dxgi', apiLabel:'DirectX 12' };
  const manifest = { route:'native', added:[path.basename(old.file)] };
  const plan = gameOverlay.prepare({library,target,route:'native'});
  return {root,gameDir,exe,oldLibrary,library,old,target,manifest,plan};
}

test('planning is read-only; replacing an overlay retires only that game’s previous build', async t => {
  const f = upgradeFixture(t);
  const otherExe = minimalPe(path.join(f.root, 'other', 'Other.exe'), {dll:false, filler:1});
  const other = f.oldLibrary.install('builtin', otherExe);
  assert.ok(fs.existsSync(f.old.file));
  assert.equal(f.plan.previous.length, 1);
  const result = await gameOverlay.attach({...f,saveManifest: async () => {}});
  assert.equal(fs.existsSync(f.old.file), false);
  assert.deepEqual(f.manifest.added,[path.basename(result.file)]);
  assert.ok(fs.existsSync(other.file));
  assert.deepEqual(f.library.list().installations.map(r => r.id).sort(), [result.id,other.id].sort());
  const unchanged = gameOverlay.prepare({library:f.library,target:f.target,route:'native'});
  assert.equal(unchanged.alreadyPresent, true);
  assert.equal(unchanged.previous.length, 0);
});

test('overlay update rolls back game files, inventory and manifest on a failed save', async t => {
  const f = upgradeFixture(t), original = fs.readFileSync(f.old.file);
  const manifestFile = path.join(realDir(f.gameDir, '_DLSS5_Backup'), 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(f.manifest));
  await assert.rejects(gameOverlay.attach({...f,saveManifest:async (_,next) => {
    fs.writeFileSync(manifestFile, JSON.stringify(next));
    throw Error('simulated failure');
  }}), /simulated failure/);
  assert.deepEqual(fs.readFileSync(f.old.file), original);
  assert.equal(fs.existsSync(f.plan.file), false);
  assert.deepEqual(f.library.list().installations.map(r=>r.id), [f.old.id]);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile)), f.manifest);
  assert.deepEqual(f.manifest.added, [path.basename(f.old.file)]);
});

test('the change preview simulates the complete overlay upgrade without changing the test game or catalog', async t => {
  const f = upgradeFixture(t), preview = require('../src/core/preview-fs');
  await preview.simulate(async () => {
    const plan = gameOverlay.prepare({library:f.library,target:f.target,route:'native'});
    const updated = await gameOverlay.attach({...f,plan,manifest:structuredClone(f.manifest),saveManifest:async()=>{}});
    assert.deepEqual(f.library.list().installations.map(r=>r.id), [updated.id]);
    assert.ok(preview.fs.existsSync(plan.file));
    assert.equal(preview.fs.existsSync(f.old.file), false);
  });
  assert.ok(fs.existsSync(f.old.file));
  assert.equal(fs.existsSync(f.plan.file), false);
  assert.deepEqual(f.library.list().installations.map(r=>r.id), [f.old.id]);
});

test('modification after preview is detected without removing the replaced file', async t => {
  const f = upgradeFixture(t);
  fs.appendFileSync(f.old.file, 'user change');
  await assert.rejects(gameOverlay.attach({...f,saveManifest:async()=>{}}), /modified/);
  assert.ok(fs.readFileSync(f.old.file).includes(Buffer.from('user change')));
  assert.equal(fs.existsSync(f.plan.file), false);
  assert.deepEqual(f.library.list().installations.map(r=>r.id), [f.old.id]);
});

test('a backend switch removing F8 after preflight still tracks the newly installed file', async t => {
  const f = upgradeFixture(t);
  const plan = gameOverlay.prepare({ library: f.oldLibrary, target: f.target, route: 'native' });
  assert.equal(plan.alreadyPresent, true);
  fs.unlinkSync(plan.file);
  const manifest = { route: 'native', added: [] };
  await gameOverlay.attach({ ...f, library: f.oldLibrary, manifest, plan, saveManifest: async () => {} });
  assert.ok(fs.existsSync(plan.file));
  assert.deepEqual(manifest.added, [path.relative(f.gameDir, plan.file)]);
  assert.deepEqual(f.oldLibrary.list().installations.map(r => r.id), [f.old.id]);
});

test('a deleted copy can be reinstalled and a deleted game can release its installation record', t => {
  const f = upgradeFixture(t);
  fs.unlinkSync(f.old.file);
  assert.equal(f.oldLibrary.install('builtin', f.exe).id, f.old.id);
  assert.ok(fs.existsSync(f.old.file));
  fs.rmSync(f.gameDir, {recursive:true});
  f.library.uninstall(f.old.id);
  assert.deepEqual(f.library.list().installations, []);
});

test('a protected Xbox executable uses the architecture found by the game scanner', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlss5-overlay-xbox-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const gameDir = realDir(root, 'XboxGame', 'Content');
  const exe = path.join(gameDir, 'Game.exe');
  fs.writeFileSync(exe, 'encrypted executable placeholder');
  const build = minimalPe(path.join(root, 'build', 'overlay.addon64'), { dll: true, filler: 2 });
  const library = createOverlayLibrary(path.join(root, 'library'), build);
  const target = { path: exe, bitness: 64, api: 'dxgi', apiLabel: 'DirectX 12' };
  const plan = gameOverlay.prepare({ library, target, route: 'native' });
  const manifest = { added: [] };

  assert.throws(() => library.install('builtin', exe), /Invalid Windows PE binary/);
  const installed = await gameOverlay.attach({
    library, target, gameDir, manifest, plan,
    saveManifest: async () => {}
  });

  assert.equal(fs.existsSync(installed.file), true);
  assert.deepEqual(manifest.added, [path.basename(installed.file)]);
  assert.equal(manifest.labOverlay.architecture, 64);
});
