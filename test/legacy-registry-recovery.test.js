'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const registry = require('../src/core/legacy-installscript');
const apply = require('../src/core/apply');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-registry-recovery-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return {dir, info:{version:1, owned:true, key:registry.namespace(dir)}};
}

test('failed registry deletion needs proof of absence instead of treating access denial as missing', async t => {
  const {dir, info} = fixture(t), parent = info.key.slice(0, info.key.lastIndexOf('\\'));
  const unavailable = async () => ({code:1, stdout:'', stderr:'access denied'});
  await assert.rejects(registry.detach(info, dir, unavailable), {code:'errLegacyRegistry'});
  const listed = async (_file, args) => args[0] === 'query' && args[1] === parent
    ? {code:0, stdout:parent.replace(/^HKCU/, 'HKEY_CURRENT_USER')+'\r\n  '+info.key.replace(/^HKCU/, 'HKEY_CURRENT_USER')+'\r\n'}
    : {code:1, stdout:''};
  await assert.rejects(registry.detach(info, dir, listed), {code:'errLegacyRegistry'});
  const absent = async (_file, args) => args[0] === 'query' && args[1] === parent
    ? {code:0, stdout:parent+'\r\n'} : {code:1, stdout:''};
  await registry.detach(info, dir, absent);
});

test('an unreadable legacy registry keeps the completed local restore retryable', async t => {
  const {dir, info} = fixture(t), backup = path.join(dir, '_DLSS5_Backup');
  fs.mkdirSync(backup);
  fs.writeFileSync(path.join(dir, 'Game.exe'), 'game');
  fs.writeFileSync(path.join(dir, 'winmm.dll'), 'managed proxy');
  const manifestPath = path.join(backup, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({version:1, route:'feeder', game:{exe:'Game.exe',api:'d3d9',bitness:32},
    replaced:[], added:['winmm.dll'], legacyRegistry:info}));
  const denied = async () => ({code:1, stdout:'', stderr:'access denied'});
  await assert.rejects(apply.restore(dir, null, null, {registryRunner:denied}), {code:'errLegacyRegistry'});
  assert.equal(fs.existsSync(path.join(dir, 'winmm.dll')), false, 'local restoration already completed');
  assert.equal(JSON.parse(fs.readFileSync(manifestPath)).restorePhase, 'detach-external');
  assert.equal(fs.readdirSync(backup).some(name => name.startsWith('manifest.json.done')), false);
  await apply.restore(dir, null, null, {registryRunner:async () => ({code:0, stdout:''})});
  assert.equal(fs.existsSync(manifestPath), false);
  assert.equal(fs.readdirSync(backup).filter(name => name.startsWith('manifest.json.done')).length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'Game.exe'), 'utf8'), 'game');
});
