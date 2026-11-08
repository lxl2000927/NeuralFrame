'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HistoryStore, knownFolders, fromManifests } = require('../src/core/history');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'profile', 'history.jsonl');
  return { root, file, store: new HistoryStore(file) };
}
const manifest = (date = '2026-09-01T18:00:00.000Z', route = 'feeder') => ({
  version: 1, date, route, game: { exe: 'bin/Game.exe', api: 'dxgi' }, replaced: [{ rel: 'dxgi.dll' }], added: ['nvngx_dlss.dll']
});
function backup(dir, name, data) {
  fs.mkdirSync(path.join(dir, '_DLSS5_Backup'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_DLSS5_Backup', name), typeof data === 'string' ? data : JSON.stringify(data));
}

test('history imports discovered/recent/nested games and a selected game root without a drive scan', t => {
  const { root, store, file } = fixture(t);
  const dirs = ['discovered', 'recent', 'root-game', 'cached/deep/game', 'library/child'].map(rel => path.join(root, rel));
  dirs.forEach(dir => backup(dir, 'manifest.json', manifest()));
  const state = { manual: [dirs[1]], recents: [{ dir: dirs[1] }], folders: [dirs[2], path.join(root, 'library')], scans: { a: { dir: dirs[3] } } };
  const known = knownFolders(state, [{ dir: dirs[0], name: 'Game title' }, { dir: dirs[1] }]);
  const rows = store.list(known);
  assert.equal(rows.length, 5);
  assert.equal(rows.find(row => row.dir === dirs[0]).name, 'Game title');
  assert.equal(store.list(known).length, 5, 'opening History twice does not duplicate imported backups');
  assert.equal(new HistoryStore(file).list().length, 5, 'independent of library reset/removal and app restart');
});

test('history reads old and timestamped restore archives and sorts by restore time', t => {
  const { root, store } = fixture(t);
  const game = path.join(root, 'game');
  backup(game, 'manifest.json', manifest());
  backup(game, 'manifest.json.done', manifest('2026-08-30T12:00:00.000Z'));
  const restoredAt = Date.parse('2026-09-02T12:00:00.000Z');
  backup(game, `manifest.json.done-${restoredAt}`, manifest('2026-08-31T12:00:00.000Z'));
  backup(game, 'manifest.json.tmp', manifest());
  const rows = store.list([{ dir: game }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, new Date(restoredAt).toISOString());
  assert.equal(rows[0].action, 'restore');
  assert.equal(rows[0].undone, true);
});

test('repeat installs and backend switches retain each successful operation without snapshot duplicates', t => {
  const { root, store, file } = fixture(t);
  const game = path.join(root, 'game');
  for (const route of ['native', 'native', 'feeder', 'optiscaler']) store.record(game, manifest(undefined, route), 'install');
  store.record(game, manifest(undefined, 'optiscaler'), 'restore');
  backup(game, `manifest.json.done-${Date.now()}`, manifest(undefined, 'optiscaler'));
  assert.equal(store.list([{ dir: game }]).length, 5);
  assert.equal(new HistoryStore(file).list().length, 5);
  assert.equal(store.list().filter(row => row.action === 'install').length, 4);
});

test('bad backups and unfinished switches cannot blank other history', t => {
  const { root, store } = fixture(t);
  const broken = path.join(root, 'broken');
  const good = path.join(root, 'good');
  const pending = path.join(root, 'pending');
  backup(broken, 'manifest.json', '{partial');
  backup(broken, 'manifest.json.done-99999999999999999999', manifest());
  backup(good, 'manifest.json', manifest());
  backup(pending, 'manifest.json', manifest());
  backup(pending, 'pending-switch.json', '{}');
  assert.equal(store.list([broken, good, pending, path.join(root, 'absent')].map(dir => ({ dir }))).length, 1);
  assert.deepEqual(fromManifests([{ dir: pending }]), []);
});

test('a truncated audit write preserves earlier rows and accepts future operations', t => {
  const { root, store, file } = fixture(t);
  store.record(root, manifest(), 'install');
  fs.appendFileSync(file, '{"id":"partial');
  store.record(root, manifest(), 'restore');
  assert.equal(new HistoryStore(file).list().length, 2);
});

test('failed history writes retain copyable rows and can retry without duplicates', t => {
  const { root, store, file } = fixture(t);
  const append = store.append;
  store.append = () => { throw new Error('disk full'); };
  assert.throws(() => store.record(root, manifest(), 'install'), /disk full/);
  const warnings = [];
  assert.equal(store.list([], error => warnings.push(error.message)).length, 1);
  assert.equal(warnings.length, 1);
  store.append = append;
  assert.equal(store.list().length, 1);
  assert.equal(store.list().length, 1);
  assert.equal(new HistoryStore(file).list().length, 1);
});

test('clearing history survives reopen, leaves backup files intact, and records future operations', t => {
  const { root, store, file } = fixture(t);
  const game = path.join(root, 'game');
  backup(game, 'manifest.json', manifest());
  const original = fs.readFileSync(path.join(game, '_DLSS5_Backup', 'manifest.json'));
  const savedDll = path.join(game, '_DLSS5_Backup', 'original.dll');
  fs.writeFileSync(savedDll, 'untouched backup');
  store.record(game, manifest(), 'install');
  assert.equal(store.list([{ dir: game }]).length, 1);
  store.clear();
  assert.deepEqual(store.list([{ dir: game }]), []);
  const reopened = new HistoryStore(file);
  assert.deepEqual(reopened.list([{ dir: game }]), []);
  assert.deepEqual(fs.readFileSync(path.join(game, '_DLSS5_Backup', 'manifest.json')), original);
  assert.equal(fs.readFileSync(savedDll, 'utf8'), 'untouched backup');
  reopened.record(game, manifest(), 'restore');
  assert.equal(reopened.list([{ dir: game }]).length, 1);
  assert.equal(new HistoryStore(file).list()[0].action, 'restore');
});

test('a failed clear keeps persisted and pending history and removes the temporary file', t => {
  const { root, store, file } = fixture(t);
  store.record(root, manifest(), 'install');
  const original = fs.readFileSync(file);
  const append = store.append;
  store.append = () => { throw Error('full'); };
  assert.throws(() => store.record(root, manifest(), 'restore'));
  store.append = append;
  const rename = t.mock.method(fs, 'renameSync', () => { throw Error('denied'); });
  assert.throws(() => store.clear(), /denied/);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(store.pending.size, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['history.jsonl']);
  rename.mock.restore();
  store.clear();
  assert.equal(store.pending.size, 0);
  assert.deepEqual(store.list(), []);
});

test('file details and applied configuration survive restart and distinguish restore from install', t => {
  const { root, store, file } = fixture(t);
  const data = {
    ...manifest(), hardwareProfile: 'rtx40_laptop',
    neuralRendering: { mode: 'latest_compatible', modelId: '310.8.SF-v2' },
    mfg: { mode: 'x3' },
    replaced: [{ rel: 'bin/nvngx_dlss.dll', oldVersion: '310.5.0.0', newVersion: '310.9.1.0' }],
    added: ['bin/renodx.addon64']
  };
  const installed = store.record(root, data, 'install');
  const restored = store.record(root, data, 'restore');
  const records = new HistoryStore(file).list();
  assert.deepEqual(records.find(r => r.id === installed.id).files, [
    { rel: 'bin/nvngx_dlss.dll', action: 'replace', before: '310.5.0.0', after: '310.9.1.0' },
    { rel: 'bin/renodx.addon64', action: 'add' }
  ]);
  assert.deepEqual(records.find(r => r.id === restored.id).files, [
    { rel: 'bin/nvngx_dlss.dll', action: 'restore', before: '310.9.1.0', after: '310.5.0.0' },
    { rel: 'bin/renodx.addon64', action: 'remove' }
  ]);
  assert.deepEqual(records[0].configuration, { hardwareProfile: 'rtx40_laptop', neuralMode: 'latest_compatible', neuralModelId: '310.8.SF-v2', mfgMode: 'x3' });
});

test('old counts-only audit records are retained without fabricated file details', t => {
  const { root, file } = fixture(t);
  const old = { id: 'old', dir: root, date: '2026-09-01T18:00:00.000Z', action: 'install', replaced: 2, added: 8 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(old) + '\n');
  assert.deepEqual(new HistoryStore(file).list(), [old]);
});

test('a damaged detail or JSON line cannot crash other entries and clearing dismisses the warning', t => {
  const { root, store, file } = fixture(t);
  const saved = store.record(root, manifest(), 'install');
  fs.appendFileSync(file, JSON.stringify({...saved, id:'bad-file', files:[null]}) + '\n{partial\n');
  const warnings = [];
  assert.deepEqual(store.list([], error => warnings.push(error.message)).map(row => row.id), [saved.id]);
  assert.equal(warnings.length, 1);
  store.clear();
  assert.deepEqual(store.list([], () => assert.fail('old warnings survived clear')), []);
});

test('history keeps independently applied stacks, HDR input policy and restore hash direction', t => {
  const { root, store } = fixture(t);
  const data = {...manifest(), neuralRendering:{runtimeStack:'baseline-310.9.1'},
    mfg:{mode:'x3', runtimeStack:'oct2026-310.9.16', backend:'renodx-mfgunlock', hdrCompatibility:false},
    replaced:[{rel:'provider.dll', beforeHash:'original', afterHash:'installed'}]};
  const restored = store.record(root, data, 'restore');
  assert.equal(restored.configuration.neuralRuntimeStack, 'baseline-310.9.1');
  assert.equal(restored.configuration.mfgRuntimeStack, 'oct2026-310.9.16');
  assert.equal(restored.configuration.qualityGuardMode, '0');
  assert.equal(restored.files[0].beforeHash, 'installed');
  assert.equal(restored.files[0].afterHash, 'original');
});
