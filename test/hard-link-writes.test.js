'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const apply = require('../src/core/apply');
const journal = require('../src/core/file-journal');
const preview = require('../src/core/preview-fs');
const replacement = require('../src/core/replace-file');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-hardlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game');
  fs.mkdirSync(game);
  const exe = path.join(game, 'Game.exe');
  fs.writeFileSync(exe, 'test');
  return { root, game, exe };
}

test('tracked INI and DLL writes replace only the selected hard links and preview stays read-only', async t => {
  const { root, game, exe } = fixture(t);
  const outside = path.join(root, 'external'), text = path.join(game, 'ReShade.ini'), dll = path.join(game, 'plugin.dll');
  const source = path.join(root, 'payload');
  fs.writeFileSync(outside, 'user original');
  const contents = Buffer.from([0, 0xfa, 0xbb, 0x12]);
  fs.writeFileSync(source, contents);
  fs.linkSync(outside, text);
  fs.linkSync(outside, dll);
  const change = () => journal.transaction(game, async () => {
    const manifest = apply.beginManifest(game, exe, 'dxgi');
    await apply.writeTracked(manifest, game, text, 'new INI');
    await apply.copyTracked(manifest, game, source, dll);
  });
  const plan = await preview.simulate(change);
  assert.equal(preview.bytes(plan.state.entries.get(text.toLowerCase())).toString(), 'new INI');
  assert.equal(fs.readFileSync(text, 'utf8'), 'user original');
  assert.equal(fs.statSync(outside).nlink, 3);
  await change();
  assert.equal(fs.readFileSync(outside, 'utf8'), 'user original');
  assert.equal(fs.readFileSync(text, 'utf8'), 'new INI');
  assert.deepEqual(fs.readFileSync(dll), contents);
  assert.equal(fs.statSync(outside).nlink, 1);
  await apply.restore(game);
  assert.equal(fs.readFileSync(text, 'utf8'), 'user original');
  assert.equal(fs.readFileSync(dll, 'utf8'), 'user original');
});

test('recovering a persisted file snapshot cannot overwrite the other link', async t => {
  const { root, game } = fixture(t);
  const folder = '_DLSS5_Backup/.transactions/abc-123';
  const snapshot = folder + '/0.bin';
  fs.mkdirSync(path.join(game, folder), { recursive: true });
  fs.writeFileSync(path.join(game, snapshot), 'before install');
  const outside = path.join(root, 'external'), target = path.join(game, 'runtime.dll');
  fs.writeFileSync(outside, 'neighbor');
  fs.linkSync(outside, target);
  fs.writeFileSync(journal.pendingPath(game), JSON.stringify({ version: 1, folder, dirs: [],
    files: [{ rel: 'runtime.dll', existed: true, snapshot }] }));
  assert.equal(await journal.recover(game), true);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'neighbor');
  assert.equal(fs.readFileSync(target, 'utf8'), 'before install');
  assert.equal(fs.statSync(outside).nlink, 1);
});

test('a busy hard-linked destination preserves both links and clears the staged copy', async t => {
  const { root, game } = fixture(t), target = path.join(game, 'ReShade.ini'), outside = path.join(root, 'external');
  fs.writeFileSync(outside, 'unchanged');
  fs.linkSync(outside, target);
  const rename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (src, dest) => {
    if (dest === target) throw Object.assign(new Error('sharing violation'), { code: 'EBUSY' });
    return rename(src, dest);
  });
  await assert.rejects(replacement.writeText(target, 'new'), { code: 'EBUSY' });
  assert.equal(fs.statSync(outside).nlink, 2);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  assert.deepEqual(fs.readdirSync(game).sort(), ['Game.exe', 'ReShade.ini']);
});

test('a pre-existing hard link in a journal snapshot slot is never overwritten or removed', async t => {
  const { root, game } = fixture(t), target = path.join(game, 'plugin.dll'), outside = path.join(root, 'user.txt');
  fs.writeFileSync(outside, 'external original');
  fs.writeFileSync(target, 'runtime');
  let slot;
  await assert.rejects(journal.transaction(game, async () => {
    const state = JSON.parse(fs.readFileSync(journal.pendingPath(game)));
    slot = path.join(game, state.folder, state.files.length + '.bin');
    fs.mkdirSync(path.dirname(slot), { recursive: true });
    fs.linkSync(outside, slot);
    await journal.capture(game, target);
  }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'external original');
  assert.equal(fs.readFileSync(slot, 'utf8'), 'external original');
  assert.equal(fs.readFileSync(target, 'utf8'), 'runtime');
  assert.ok(!fs.existsSync(journal.pendingPath(game)));
});
