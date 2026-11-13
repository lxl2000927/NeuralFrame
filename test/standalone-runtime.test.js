'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { RuntimeStatus } = require('../src/core/runtime-status');
const { parseStandalone } = require('../src/core/standalone-runtime');

test('resuming standalone NR after off, pending or an error requires new progress', () => {
  const base = {pid:77,dlss5:true,dlss5State:2,dlss5Live:1,dlss5Evaluations:100};
  for (const interruption of [
    {dlss5:false,dlss5State:0}, {dlss5State:7}, {dlss5Pending:true}, {dlss5Live:0}
  ]) {
    let at = 100000, previous;
    const sample = patch => {
      at += 1000;
      const result = parseStandalone({...base,...patch},{file:'status.json',mtime:at},at,previous);
      previous = result.history;
      return result.nr.state;
    };
    assert.equal(sample({}),'observed');
    assert.equal(sample({dlss5Evaluations:120}),'active');
    sample({...interruption,dlss5Evaluations:120});
    assert.equal(sample({dlss5Evaluations:120}),'observed','old progress must not prove work after an interrupted execution period');
    assert.equal(sample({dlss5Evaluations:121}),'active');
  }
});

test('standalone telemetry requires the current process, progress and fresh samples; pending parameters are not effective', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-proxy-telemetry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.now(), running = true;
  const exe = path.join(dir, 'Client-Win64-Shipping.exe');
  const process = { pid: 77, processBirth: '134067000000000001', exe, startedAt: new Date(now - 5000).toISOString(), modules: [] };
  const reader = new RuntimeStatus({ clock: () => now, temp: dir,
    scanGame: async () => ({ chosen: { path: exe } }), query: async () => ({ processes: running ? [process] : [] }) });
  const file = path.join(dir, 'RTXMFG-Universal.status.json');
  const base = { pid: 77, processBirth: process.processBirth,
    dlss5: true, dlss5State: 2, dlss5Evaluations: 100, dlss5Failures: 0, dlss5Live: 1,
    dlss5Pending: false, dlss5ResolutionScale: 75, dlss5EffectiveScale: 75,
    dlss5Stage: 2, dlss5Passes: 1, dlss5Width: 2560, dlss5Height: 1600,
    dlss5ExtentWidth: 1920, dlss5ExtentHeight: 1200,
    mode: 'dynamic', appliedMode: 'dynamic', appliedMultiplier: 4,
    getStateSeen: true, getStateResult: 0, dlssgStatus: 0, stateSampleAgeMs: 0, actualFramesPresented: 3,
    activeProviderVersionMajor: 310, activeProviderVersionMinor: 9, activeProviderVersionBuild: 16, activeProviderVersionPrivate: 0 };
  async function poll(patch = {}, advance = 3000) {
    now += advance;
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...base, ...patch }));
    fs.renameSync(file + '.tmp', file); // The real component uses atomic replacement.
    fs.utimesSync(file, new Date(now), new Date(now));
    return reader.inspect(dir);
  }
  assert.equal((await poll({ pid: 88 })).standalone, undefined);
  assert.equal((await poll({ processBirth: '134067000000000002' })).standalone, undefined);
  let r = await poll();
  assert.equal(r.nr.state, 'observed', 'first cumulative count is not continuous activity');
  assert.equal(r.standalone.stack.fg, '310.9.16.0');
  r = await poll({ dlss5Evaluations: 120 });
  assert.equal(r.nr.state, 'active');
  assert.equal(r.standalone.actual.extentWidth, 1920);
  assert.match(r.mfg.detail, /动态/);
  r = await poll({ dlss5Evaluations: 120 }, 31000);
  assert.equal(r.nr.state, 'observed', 'a rewritten status with frozen counter is not progress');
  r = await poll({ dlss5Evaluations: 130, dlss5Pending: true, dlss5ResolutionScale: 100 });
  assert.equal(r.nr.state, 'pending'); assert.equal(r.standalone.actual, null);
  r = await poll({ dlss5: false, dlss5State: 0, dlss5Evaluations: 130 });
  assert.equal(r.nr.state, 'off');
  r = await poll({ dlss5State: 7, dlss5Result: 0xBAD00001, dlss5Evaluations: 130 });
  assert.equal(r.nr.state, 'error');
  r = await poll({ dlss5Evaluations: 1 });
  assert.equal(r.nr.state, 'observed', 'counter reset cannot reuse old progress');
  now += 31000; r = await reader.inspect(dir);
  assert.equal(r.standalone, undefined, 'stale file cannot supply current settings');
  running = false; now += 3000;
  r = await reader.inspect(dir);
  assert.equal(r.processState, 'stopped'); assert.equal(r.standalone, undefined);
});
