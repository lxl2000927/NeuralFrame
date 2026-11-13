'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameInspection } = require('../src/core/game-inspection');
const { writePe } = require('./fixtures/pe');

test('background-only scans persist symbol results and invalidate changed executables after restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-background-symbols-'));
  let service = new GameInspection();
  t.after(async () => { await service.close(); fs.rmSync(root, {recursive:true, force:true}); });
  const game = path.join(root, 'Game'), exe = path.join(game, 'Game.exe');
  const userDataDir = path.join(root, 'user'), cacheFile = path.join(userDataDir, 'inspection-symbols-v1.json');
  writePe(exe, {text:'D3D12CreateDevice'});
  assert.equal((await service.run('scan', game, {userDataDir})).chosen.apiLabel, 'DirectX 12');
  // The worker sends the scan result before its asynchronous cache flush.
  const deadline = Date.now() + 2000;
  while (!fs.existsSync(cacheFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(cached.schema, 1);
  assert.ok(cached.entries.some(([key, value]) => JSON.parse(key)[0] === path.resolve(exe) && value.found.includes('D3D12CreateDevice')));
  await service.close();
  service = new GameInspection();
  assert.equal((await service.run('scan', game, {userDataDir})).chosen.apiLabel, 'DirectX 12');
  writePe(exe, {text:'D3D11CreateDevice'});
  assert.equal((await service.run('scan', game, {userDataDir})).chosen.apiLabel, 'DirectX 11', 'persisted results must not hide a changed executable');
});

test('background inspection shares pending reads but refresh sees changed files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-inspection-'));
  const service = new GameInspection();
  t.after(async () => {
    await service.close();
    // Only the freshly created test directory can be removed.
    assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(), 'nf-inspection-')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  writePe(path.join(dir, 'game.exe'), { text: 'D3D12CreateDevice' });
  const first = service.run('scan', dir);
  assert.equal(service.run('scan', dir), first);
  service.invalidate();
  const afterMutation = service.run('scan', dir);
  assert.notEqual(afterMutation, first, 'post-apply reads cannot join pre-apply work');
  const scanned = await first;
  await afterMutation;
  assert.equal(scanned.chosen.apiLabel, 'DirectX 12');
  assert.equal(scanned.dlssFiles.length, 0);
  writePe(path.join(dir, 'nvngx_dlss.dll'), { version: [310, 9, 1, 0] });
  const refreshed = await service.run('scan', dir);
  assert.equal(refreshed.dlssFiles.length, 1);
  await assert.rejects(service.run('unsupported', dir), /Unknown inspection task/);
  assert.equal((await service.run('scan', dir)).chosen.apiLabel, 'DirectX 12');
  const hardware = (name, vramTotalMB) => ({gpu:{name, vramTotalMB,driver:'test'}});
  service.setHardware(hardware('RTX 4070 Laptop GPU', 8192));
  assert.equal((await service.run('inspect', dir)).status.hardwareProfile, 'rtx40_laptop');
  service.setHardware(hardware('RTX 5090', 32768));
  const payloadDir = path.join(dir, 'payload');
  writePe(path.join(payloadDir, 'streamline', 'NVNGX_DLSS.dll'), {version:[310, 9, 1, 0]});
  const order = [];
  const details = service.run('inspect', dir, {payloadDir}, 'selection', 'details')
    .then(result => { order.push('details'); return result; });
  const full = service.run('inspect', dir, {payloadDir}, 'selection')
    .then(result => { order.push('status'); return result; });
  const [early, {status: afterRefresh, newDlss, scan}] = await Promise.all([details, full]);
  assert.deepEqual(order, ['details', 'status']);
  assert.equal(early.scan, scan, 'the early details and final status share one scan');
  assert.equal(early.newDlss, newDlss);
  assert.equal(early.status, undefined);
  assert.equal(newDlss, '310.9.1.0');
  assert.equal(afterRefresh.hardwareProfile, 'rtx50_desktop');
  assert.equal(afterRefresh.diagnostics.coExecution.vramBudget.vramTotalMB, 32768);

  // A broken hardware reading fails in inspectCombinedStatus *after* scanGame.
  service.setHardware({});
  const fileRead = service.run('inspect', dir, {payloadDir}, 'selection', 'details');
  const failedStatus = service.run('inspect', dir, {payloadDir}, 'selection');
  assert.equal((await fileRead).scan.chosen.path, path.join(dir, 'game.exe'));
  assert.equal((await failedStatus).status.ok, false);
  service.setHardware(hardware('RTX 5090', 32768));
  assert.equal((await service.run('inspect', dir, {payloadDir})).status.ok, true);
});

test('stopping inspection settles pending work and rejects further requests', async () => {
  const service = new GameInspection();
  const pending = service.run('scan', os.tmpdir());
  const rejection = assert.rejects(pending, /检测服务已关闭/);
  await service.close();
  await rejection;
  await assert.rejects(service.run('scan', os.tmpdir()), /检测服务已关闭/);
});

test('the latest visible game precedes older explicit reads and supersedes only queued browsing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-selection-'));
  const service = new GameInspection();
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const dir = name => path.join(root, name);
  for (const name of ['A', 'B', 'C']) writePe(path.join(dir(name), 'game.exe'), { text: 'D3D12CreateDevice' });
  service.setHardware({gpu:{name:'RTX 4070 Laptop GPU',vramTotalMB:8192,driver:'test'}});
  const options = { userDataDir: dir('user'), payloadDir: dir('payload') };
  const select = name => service.run('inspect', dir(name), options, 'selection');

  const order = [];
  const first = select('A').then(() => order.push('A'));
  const queued = select('B');
  assert.equal(service.run('inspect', dir('B'), options), queued, 'preserve an explicit reader sharing B');
  const normal = queued.then(() => order.push('B'));
  const inventory = service.run('inventory', dir('A'), {userDataDir: dir('user')}).then(() => order.push('inventory'));
  const latest = select('C');
  assert.equal(select('C'), latest);
  await Promise.all([first, normal, inventory, latest.then(() => order.push('C'))]);
  assert.deepEqual(order, ['A', 'C', 'B', 'inventory']);

  const running = select('A');
  const staleDetails = assert.rejects(service.run('inspect', dir('B'), options, 'selection', 'details'),
    {code:'SELECTION_SUPERSEDED'});
  const stale = assert.rejects(select('B'), {code:'SELECTION_SUPERSEDED'});
  const current = select('C');
  await Promise.all([stale, staleDetails]);
  await Promise.all([running, current]);
  assert.equal((await service.run('inspect', dir('B'), options)).status.gameName, 'B', 'a later explicit read remains valid');
});

test('a 2.3.0 Off record restores the game profile even when its older top-level value disagrees', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-old-profile-'));
  const service = new GameInspection();
  t.after(async () => { await service.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  writePe(path.join(dir, 'Game.exe'), {text:'D3D12CreateDevice'});
  const backupDir = path.join(dir, '_DLSS5_Backup');
  fs.mkdirSync(backupDir);
  const manifestFile = path.join(backupDir, 'manifest.json');
  const legacy = {version:1,game:{exe:'Game.exe'},hardwareProfile:'rtx40_laptop',added:[],replaced:[],
    neuralRendering:{mode:'latest_compatible',hardwareProfile:'rtx40_laptop',updatedAt:'2026-09-01T00:00:00Z'},
    mfg:{mode:'off',hardwareProfile:'rtx50_desktop',updatedAt:'2026-10-01T00:00:00Z'}};
  fs.writeFileSync(manifestFile, JSON.stringify(legacy));
  service.setHardware({gpu:{name:'RTX 4070 Laptop GPU',vramTotalMB:8192,driver:'test'}});
  const inspect = options => service.run('inspect', dir, options).then(result => result.status.hardwareProfile);
  assert.equal(await inspect({defaultHardwareProfile:'rtx40_desktop'}), 'rtx50_desktop');
  assert.equal(await inspect({hardwareProfile:'rtx40_desktop'}), 'rtx40_desktop');
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), JSON.stringify(legacy));
});

test('changing defaults affects only unconfigured games and never changes persisted presets or runtime stacks', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-default-preservation-'));
  const service=new GameInspection();
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  service.setHardware({gpu:{name:'RTX 4070 Laptop GPU',vramTotalMB:8192,driver:'test'}});
  const saved=path.join(root,'Saved'),fresh=path.join(root,'New');
  for(const dir of [saved,fresh])writePe(path.join(dir,'Game.exe'),{text:'D3D12CreateDevice'});
  const backup=path.join(saved,'_DLSS5_Backup');fs.mkdirSync(backup);
  const manifestFile=path.join(backup,'manifest.json');
  const manifest={version:1,game:{exe:'Game.exe'},hardwareProfile:'rtx40_laptop',added:[],replaced:[],
    neuralRendering:{mode:'off',hardwareProfile:'rtx40_laptop',runtimeStack:'baseline-310.9.1',updatedAt:'2026-10-01T00:00:00Z'}};
  fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  for(const defaultHardwareProfile of ['rtx40_desktop','rtx50_desktop']){
    const existing=(await service.run('inspect',saved,{defaultHardwareProfile})).status;
    assert.equal(existing.hardwareProfile,'rtx40_laptop');assert.equal(existing.hardwareProfileSource,'manifest');
    assert.equal(existing.configuredRuntimeStack,'baseline-310.9.1');
    const newGame=(await service.run('inspect',fresh,{defaultHardwareProfile})).status;
    assert.equal(newGame.hardwareProfile,defaultHardwareProfile);assert.equal(newGame.hardwareProfileSource,'default');
  }
  const automatic=(await service.run('inspect',fresh,{})).status;
  assert.equal(automatic.hardwareProfile,'rtx40_laptop');assert.equal(automatic.hardwareProfileSource,'detected');
  const explicit=(await service.run('inspect',saved,{hardwareProfile:'rtx40_desktop',defaultHardwareProfile:'rtx50_desktop'})).status;
  assert.equal(explicit.hardwareProfile,'rtx40_desktop');assert.equal(explicit.hardwareProfileSource,'selected');
  assert.equal(fs.readFileSync(manifestFile,'utf8'),JSON.stringify(manifest));
  assert.equal(fs.existsSync(path.join(fresh,'_DLSS5_Backup')),false);
});
