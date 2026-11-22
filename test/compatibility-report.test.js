'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {assess, createReport, parseReport, csv} = require('../src/core/compatibility-report');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {scanGame} = require('../src/core/scan');
const {apiPreferenceKey} = require('../src/core/game-api');
const {writePe, writeProvider} = require('./fixtures/pe');
test('read-only compatibility reports retain capabilities without paths',()=>{
 const report=createReport([{name:'Example',status:'supported',api:'DirectX 12',bitness:64,nativeDlss:true,nativeDlssFg:true,routes:['encore'],recommendedRoute:'encore',dir:'D:/secret',exePath:'D:/secret/game.exe'}]);
 assert.equal(report.readOnly,true);assert.equal(report.rows[0].dir,undefined);assert.equal(report.rows[0].exePath,undefined);
 assert.deepEqual(parseReport(JSON.parse(JSON.stringify(report))),report);
 assert.match(csv(report),/Example/);assert.doesNotMatch(csv(report),/D:\/secret/);
});
test('report input is bounded and validated',()=>{
 assert.throws(()=>createReport([{name:''}]),/名称/);
 assert.throws(()=>parseReport({schema:'other'}),/不受支持/);
});

test('reports carry completeness and total and old v1 reports stay parseable',()=>{
 const rows=[{name:'Example',status:'supported',api:'DirectX 12',bitness:64,nativeDlss:true,nativeFg:true,nativeDlssFg:true,
   antiCheat:false,routes:['xemfg'],recommendedRoute:'xemfg',message:''}];
 const complete=createReport(rows);
 assert.equal(complete.complete,true);
 assert.equal(complete.total,1);
 assert.deepEqual(parseReport(JSON.parse(JSON.stringify(complete))),complete);
 const partial=createReport(rows,'2026-01-01T00:00:00.000Z',{complete:false,total:5});
 assert.equal(partial.complete,false);
 assert.equal(partial.total,5);
 assert.deepEqual(parseReport(JSON.parse(JSON.stringify(partial))),partial);
 // Reports written before the completeness fields still parse and round-trip.
 const legacy={schema:'neuralframe-compatibility-report',version:1,
   generatedAt:'2026-01-01T00:00:00.000Z',readOnly:true,rows:complete.rows};
 const migrated=parseReport(legacy);
 assert.equal(migrated.complete,true);
 assert.equal(migrated.total,1);
 assert.deepEqual(parseReport(JSON.parse(JSON.stringify(migrated))),migrated);
 assert.deepEqual(migrated.rows,complete.rows);
 const completeHeader=csv(complete).split('\r\n')[0];
 assert.doesNotMatch(completeHeader,/scanStatus|completed|plannedTotal/);
 const [partialHeader, partialRow]=csv(partial).split('\r\n');
 assert.equal(partialHeader,completeHeader+',"scanStatus","completed","plannedTotal"');
 assert.match(partialRow,/^"Example"/);
 assert.match(partialRow,/,"stopped","1","5"$/);
 const stoppedEmpty=createReport([],undefined,{complete:false,total:5,scanStatus:'stopped'});
 const [, summary]=csv(stoppedEmpty).split('\r\n');
 assert.equal(summary,[...Array(14).fill('""'),'"stopped"','"0"','"5"'].join(','));
 const failed=createReport(rows,undefined,{complete:false,total:5,scanStatus:'error'});
 assert.equal(parseReport(failed).scanStatus,'error');
 assert.match(csv(parseReport(failed)).split('\r\n')[1],/,"error","1","5"$/);
 assert.throws(()=>createReport(rows,undefined,{complete:'yes'}),/完整性/);
 assert.throws(()=>createReport(rows,undefined,{total:-1}),/总数/);
 assert.throws(()=>createReport(rows,undefined,{total:1.5}),/总数/);
 assert.throws(()=>parseReport({...legacy,complete:'yes'}),/完整性/);
 assert.throws(()=>parseReport({...legacy,total:-2}),/总数/);
 assert.throws(()=>parseReport({...partial,scanStatus:'running'}),/完整性/);
});

test('CSV treats text as text even with leading whitespace, quotes and line breaks', () => {
  for (const value of ['=1+1', '+1', '-1', '@SUM(1)', '  =1+1', '\uFEFF+1', '\tword', '\rword', '\nword']) {
    const report = createReport([{name: '=formula()', message: value}]);
    const content = csv(report);
    assert.ok(content.includes('"\'' + value + '"'));
    assert.ok(content.includes('"\'=formula()"'));
    assert.equal(report.rows[0].message, value);
  }
  const content = csv(createReport([{name:'Normal', message:'A,"B"\r\nC'}]));
  assert.ok(content.includes('"A,""B""\r\nC"'));
  for (const exe of ['C:\\private\\a.exe', 'C:private.exe', '/private/test.exe', '..\\private\\a.exe', '\\\\server\\a.exe']) {
    assert.equal(createReport([{name:'Game', exe}]).rows[0].exe, '');
  }
});

test('batch IPC evaluates default executable, effective API, hardware and install protections using real directory scans', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-batch-report-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const games = [], overrides = {};
  const options = {name:'AMD Radeon RX 6800', nvidiaPresent:false};
  const symbols = ['CreateFeature', 'EvaluateFeature', 'ReleaseFeature'].map(name => 'NVSDK_NGX_D3D12_' + name);
  function add(name, subdir = name) {
    const dir = path.join(root, subdir);
    fs.mkdirSync(dir, {recursive:true});
    games.push({name, dir});
    return dir;
  }
  function exe(dir, text = 'D3D12CreateDevice') {
    return writePe(path.join(dir, 'Game.exe'), {text});
  }
  const plain = add('Plain');
  exe(plain);
  const native = add('Native');
  exe(native);
  writeProvider(path.join(native, 'nvngx_dlss.dll'), symbols);
  const protectedGame = add('Protected');
  exe(protectedGame);
  writeProvider(path.join(protectedGame, 'nvngx_dlss.dll'), symbols);
  fs.mkdirSync(path.join(protectedGame, 'EasyAntiCheat'));
  const stock = add('Stock', 'Modpack/Stock Game');
  exe(stock);
  fs.writeFileSync(path.join(stock, '..', 'ModOrganizer.exe'), '');
  const dual = add('Multi');
  for (const child of ['First', 'Second']) writePe(path.join(dual, child, child + '.exe'), {text:'D3D12CreateDevice'});
  const dualTarget = (await scanGame(dual)).chosen;
  const selected = add('Selected API');
  const selectedExe = exe(selected);
  writeProvider(path.join(selected, 'nvngx_dlss.dll'), symbols);
  overrides[apiPreferenceKey(selected, selectedExe)] = 'd3d11';
  add('Empty');
  const fault = add('Fault');

  let detections = 0, scans = 0;
  const handlers = new Map();
  const main = path.resolve(__dirname, '../main.js'), fromMain = createRequire(main);
  const stubs = {
    electron: {app:{setAppUserModelId(){}, whenReady:() => ({then(){}}), on(){}, getPath:() => root},
      ipcMain:{handle:(name, callback) => handlers.set(name, callback)}},
    './src/overlay-preferences': {read:() => ({enabled:false})},
    './src/core/combined-manager': {detectHardwareEnvironment:async () => { detections++; return {gpu:options, os:'Windows_NT 10.0.26100 (x64)'}; }},
    './src/core/game-inspection': {GameInspection:class {
      async run(task, dir) {
        assert.equal(task, 'scan'); scans++;
        if (dir === fault) throw Error('Failure reading C:\\Users\\fixture\\Private');
        return scanGame(dir);
      }
    }},
  };
  const proc = Object.create(require('./fixtures/offline-process')(), {platform:{value:'win32'}});
  const context = vm.createContext({require:name => stubs[name] || fromMain(name), __dirname:path.dirname(main),
    process:proc, Buffer, console, games, overrides});
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, {filename:main});
  vm.runInContext('lastGames=games; loadState=()=>({apiOverrides:overrides})', context);
  const events = [];
  const sender = {send(channel, payload) { events.push({channel, ...payload}); }, isDestroyed: () => false};
  const event = {sender};
  const batch = dirs => handlers.get('games-batch-scan')(event, dirs);
  const taskState = () => handlers.get('games-batch-scan-state')(event).task;
  const waitForState = async predicate => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('批量扫描未在预期时间内结束');
  };
  const terminal = taskId => waitForState(() => {
    const task = taskState();
    return task && task.id === taskId && task.status !== 'running' ? task : null;
  });
  const runBatch = async dirs => {
    const started = await batch(dirs);
    assert.equal(started.ok, true);
    assert.equal(started.task.status, 'running');
    assert.equal(started.task.report, undefined);
    return terminal(started.task.id);
  };
  const result = await runBatch([...games.map(game => game.dir), plain]);
  assert.equal(result.status, 'done');
  assert.equal(result.total, games.length);
  assert.equal(typeof result.id, 'string');
  assert.equal(typeof result.startedAt, 'string');
  assert.equal(typeof result.finishedAt, 'string');
  assert.equal(detections, 1);
  assert.equal(scans, games.length);
  assert.doesNotMatch(JSON.stringify(result.report), /Users|nf-batch-report-/);
  assert.equal(result.report.complete, true);
  assert.equal(result.report.total, games.length);
  // Each item announces its name before posting a finished row and advancing the count.
  const taskEvents = events.filter(item => item.taskId === result.id);
  const running = taskEvents.filter(item => item.status === 'running');
  assert.equal(running.length, games.length * 2);
  assert.ok(running.every(item => item.channel === 'batch-scan-progress'));
  assert.ok(running.every(item => item.total === games.length));
  assert.deepEqual(running.map(item => [item.index, item.currentGame, item.row?.name]),
    games.flatMap((game,index) => [[index,game.name,undefined],[index+1,null,game.name]]));
  assert.equal(taskEvents.at(-1).status, 'done');
  assert.equal(taskEvents.at(-1).task.report.complete, true);
  const byName = Object.fromEntries(result.report.rows.map(row => [row.name, row]));
  assert.equal(byName.Plain.status, 'unsupported');
  assert.deepEqual(byName.Plain.routes, []);
  assert.equal(byName.Plain.driverHint, 'afmf-fullscreen');
  assert.deepEqual(byName.Native.routes, ['xemfg']);
  assert.equal(byName.Native.recommendedRoute, 'xemfg');
  assert.equal(byName.Native.driverHint, null);
  assert.equal(byName.Protected.status, 'verify');
  assert.equal(byName.Protected.antiCheat, true);
  assert.deepEqual(byName.Protected.routes, []);
  assert.equal(byName.Stock.status, 'unsupported');
  assert.equal(byName.Stock.driverHint, null);
  assert.match(byName.Stock.message, /管理器/);
  assert.equal(byName.Multi.status, 'verify');
  assert.equal(byName.Multi.exe, dualTarget.rel);
  assert.equal(byName.Multi.candidateCount, 2);
  assert.equal(byName['Selected API'].api, 'DirectX 11');
  assert.deepEqual(byName['Selected API'].routes, []);
  assert.equal(byName.Empty.message, '没有可执行文件');
  assert.equal(byName.Fault.status, 'error');
  assert.equal(byName.Fault.candidateCount, 0);
  Object.assign(options, {name:'NVIDIA GeForce RTX 4070', nvidiaPresent:true});
  const rtx = (await runBatch([plain, protectedGame])).report.rows;
  assert.equal(rtx[0].recommendedRoute, 'feeder');
  assert.ok(rtx[0].routes.includes('encore'));
  assert.ok(rtx[1].routes.includes('native'));
  assert.ok(!rtx[1].routes.includes('encore'));
  assert.ok(!rtx[1].routes.includes('xemfg'));
  assert.equal(rtx[1].status, 'verify');
  Object.assign(options, {name:'', nvidiaPresent:null});
  const unknown = (await runBatch([plain])).report.rows[0];
  assert.equal(unknown.status, 'verify');
  assert.ok(unknown.routes.includes('feeder'));
  assert.ok(!unknown.routes.includes('encore'));
  assert.equal((await batch([plain, null])).ok, false);
  assert.equal((await batch([path.join(root, 'not-listed')])).ok, false);
  assert.equal((await batch(Array(501).fill(plain))).ok, false);
  // An empty directory list reports an empty finished task and skips the hardware probe.
  const empty = await batch([]);
  assert.equal(empty.ok, true);
  assert.equal(empty.task.status, 'done');
  assert.equal(empty.task.total, 0);
  assert.equal(empty.task.report.complete, true);
  assert.equal(empty.task.report.rows.length, 0);
  assert.equal(taskState().id, empty.task.id);
  const emptyEvents = events.filter(item => item.taskId === empty.task.id);
  assert.equal(emptyEvents.length, 1);
  assert.equal(emptyEvents[0].status, 'done');
  assert.equal(emptyEvents[0].task.report.rows.length, 0);
  assert.equal(detections, 3);
});

test('batch scan tasks stream progress, stop, get replaced and reattach by snapshot', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-batch-task-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const csvPath = path.join(root, 'stopped.csv');
  const games = [], overrides = {}, gates = new Map();
  const dirs = ['One', 'Two', 'Three'].map(name => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, {recursive:true});
    writePe(path.join(dir, 'Game.exe'), {text:'D3D12CreateDevice'});
    games.push({name, dir});
    return dir;
  });
  let detections = 0, scans = 0;
  const handlers = new Map();
  const main = path.resolve(__dirname, '../main.js'), fromMain = createRequire(main);
  const stubs = {
    electron: {app:{setAppUserModelId(){}, whenReady:() => ({then(){}}), on(){}, getPath:() => root},
      BrowserWindow:{fromWebContents:() => null},
      dialog:{showSaveDialog:async () => ({canceled:false, filePath:csvPath})},
      ipcMain:{handle:(name, callback) => handlers.set(name, callback)}},
    './src/overlay-preferences': {read:() => ({enabled:false})},
    './src/core/combined-manager': {detectHardwareEnvironment:async () => {
      detections++;
      return {gpu:{name:'AMD Radeon RX 6800', nvidiaPresent:false}, os:'Windows_NT 10.0.26100 (x64)'};
    }},
    './src/core/game-inspection': {GameInspection:class {
      async run(task, dir) {
        assert.equal(task, 'scan'); scans++;
        const gate = gates.get(dir);
        if (gate) await gate;
        return scanGame(dir);
      }
    }},
  };
  const proc = Object.create(require('./fixtures/offline-process')(), {platform:{value:'win32'}});
  const context = vm.createContext({require:name => stubs[name] || fromMain(name), __dirname:path.dirname(main),
    process:proc, Buffer, console, games, overrides});
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, {filename:main});
  vm.runInContext('lastGames=games; loadState=()=>({apiOverrides:overrides})', context);
  const events = [];
  const sender = {send(channel, payload) { events.push({channel, ...payload}); }, isDestroyed: () => false};
  const event = {sender};
  const batch = dirs => handlers.get('games-batch-scan')(event, dirs);
  const taskState = () => handlers.get('games-batch-scan-state')(event).task;
  const stop = taskId => handlers.get('games-batch-scan-stop')(event, taskId);
  const waitForState = async predicate => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('批量扫描未在预期时间内结束');
  };
  const terminal = taskId => waitForState(() => {
    const task = taskState();
    return task && task.id === taskId && task.status !== 'running' ? task : null;
  });
  const eventsFor = taskId => events.filter(item => item.taskId === taskId);
  const gate = () => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return {promise, release};
  };

  // Nothing has run yet, and a stop for a task that does not exist is rejected.
  const initial = handlers.get('games-batch-scan-state')(event);
  assert.equal(initial.ok, true);
  assert.equal(initial.task, null);
  const missingStop = stop('missing');
  assert.equal(missingStop.ok, false);
  assert.match(missingStop.message, /没有正在运行的批量扫描/);
  assert.equal(stop(undefined).ok, false);

  // A held second item lets the running state snapshot and the first event be observed.
  const secondGate = gate();
  gates.set(dirs[1], secondGate.promise);
  const firstScans = scans;
  const started = await batch(dirs);
  assert.equal(started.ok, true);
  assert.equal(started.task.status, 'running');
  assert.equal(started.task.total, 3);
  assert.equal(started.task.finishedAt, null);
  assert.equal(started.task.currentGame, null);
  assert.equal(started.task.report, undefined);
  assert.equal(started.task.rows.length, 0);
  assert.equal(typeof started.task.id, 'string');
  assert.ok(started.task.id.length > 0);
  await waitForState(() => taskState().id === started.task.id && taskState().rows.length === 1 && taskState().status === 'running');
  const runningSnapshot = taskState();
  assert.deepEqual(Array.from(runningSnapshot.rows, row => row.name), ['One']);
  assert.equal(runningSnapshot.report, undefined);
  assert.equal(runningSnapshot.total, 3);
  assert.equal(runningSnapshot.currentGame, 'Two');
  const firstProgress = eventsFor(started.task.id);
  assert.deepEqual(firstProgress.map(item => [item.index, item.currentGame, item.row?.name]),
    [[0,'One',undefined],[1,null,'One'],[1,'Two',undefined]]);
  secondGate.release();
  const done = await terminal(started.task.id);
  assert.equal(done.status, 'done');
  assert.equal(done.currentGame, null);
  assert.equal(done.report.complete, true);
  assert.equal(done.report.total, 3);
  assert.deepEqual(Array.from(done.report.rows, row => row.name), ['One', 'Two', 'Three']);
  assert.deepEqual(eventsFor(started.task.id).filter(item => item.row).map(item => item.index), [1, 2, 3]);
  assert.equal(eventsFor(started.task.id).at(-1).status, 'done');
  assert.equal(eventsFor(started.task.id).at(-1).task.report.complete, true);
  assert.equal(scans - firstScans, 3);
  // A settled task can no longer be stopped.
  assert.equal(stop(started.task.id).ok, false);

  // Stopping keeps the rows that finished and settles a partial report.
  gates.clear();
  const stopGate = gate();
  gates.set(dirs[1], stopGate.promise);
  const stopScans = scans;
  const stopping = await batch(dirs);
  await waitForState(() => taskState().id === stopping.task.id && taskState().rows.length === 1);
  assert.equal(taskState().status, 'running');
  const stoppingOnce = stop(stopping.task.id);
  assert.equal(stoppingOnce.ok, true);
  assert.equal(stoppingOnce.stopping, true);
  const stoppingTwice = stop(stopping.task.id);
  assert.equal(stoppingTwice.ok, true);
  assert.equal(stoppingTwice.stopping, true);
  stopGate.release();
  const stopped = await terminal(stopping.task.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.currentGame, null);
  assert.equal(stopped.report.complete, false);
  assert.equal(stopped.report.scanStatus, 'stopped');
  assert.equal(stopped.report.total, 3);
  assert.deepEqual(Array.from(stopped.report.rows, row => row.name), ['One', 'Two']);
  assert.deepEqual(Array.from(stopped.rows, row => row.name), ['One', 'Two']);
  assert.equal(scans - stopScans, 2);
  assert.equal(eventsFor(stopping.task.id).at(-1).status, 'stopped');
  assert.equal(eventsFor(stopping.task.id).at(-1).task.report.complete, false);
  assert.equal(stop(stopping.task.id).ok, false);
  assert.equal(taskState().id, stopping.task.id);
  assert.equal(taskState().status, 'stopped');
  const saved = await handlers.get('games-export-scan')(event, stopped.report, 'csv');
  assert.equal(saved.ok, true);
  assert.equal(saved.file, csvPath);
  const [header, first, second] = fs.readFileSync(csvPath, 'utf8').split('\r\n');
  assert.match(header, /,"scanStatus","completed","plannedTotal"$/);
  assert.match(first, /^"One".*,\s*"stopped","2","3"$/);
  assert.match(second, /^"Two".*,\s*"stopped","2","3"$/);

  // A new batch settles a still-running task immediately and only the new one continues.
  gates.clear();
  const replacedGate = gate();
  gates.set(dirs[0], replacedGate.promise);
  const replacedScans = scans;
  const replaced = await batch(dirs);
  await waitForState(() => scans > replacedScans && taskState().id === replaced.task.id && taskState().status === 'running');
  const replacement = await batch([dirs[2]]);
  assert.equal(replacement.ok, true);
  assert.notEqual(replacement.task.id, replaced.task.id);
  assert.equal(stop(replaced.task.id).ok, false);
  const replacedEvents = eventsFor(replaced.task.id);
  assert.equal(replacedEvents.at(-1).status, 'stopped');
  assert.equal(replacedEvents.at(-1).task.report.complete, false);
  assert.equal(replacedEvents.at(-1).task.report.total, 3);
  assert.equal(replacedEvents.at(-1).task.report.rows.length, 0);
  assert.equal(replacedEvents.at(-1).task.rows.length, 0);
  replacedGate.release();
  await new Promise(resolve => setTimeout(resolve, 50));
  // The abandoned in-flight item is swallowed instead of leaking a late row.
  assert.equal(eventsFor(replaced.task.id).length, replacedEvents.length);
  assert.equal(eventsFor(replaced.task.id).at(-1).task.rows.length, 0);
  const winner = await terminal(replacement.task.id);
  assert.equal(winner.status, 'done');
  assert.deepEqual(Array.from(winner.report.rows, row => row.name), ['Three']);
  assert.equal(taskState().id, winner.id);
  assert.equal(detections, 4);

  // A destroyed or throwing renderer must never abort the scan.
  gates.clear();
  const throwing = {send() { throw Error('renderer gone'); }, isDestroyed: () => false};
  const throwingStart = handlers.get('games-batch-scan')({sender:throwing}, [dirs[0]]);
  assert.equal(throwingStart.ok, true);
  const throwingDone = await terminal(throwingStart.task.id);
  assert.equal(throwingDone.status, 'done');
  assert.deepEqual(Array.from(throwingDone.report.rows, row => row.name), ['One']);
  const destroyed = {send() { throw Error('send must not be called'); }, isDestroyed: () => true};
  const destroyedStart = handlers.get('games-batch-scan')({sender:destroyed}, [dirs[1]]);
  assert.equal(destroyedStart.ok, true);
  const destroyedDone = await terminal(destroyedStart.task.id);
  assert.equal(destroyedDone.status, 'done');
  assert.deepEqual(Array.from(destroyedDone.report.rows, row => row.name), ['Two']);
  assert.equal(detections, 6);
});

test('Vulkan/Proton and ANR GPU requirements narrow the batch component list', () => {
  const target = {api:'vulkan', apiLabel:'Vulkan', bitness:64, rel:'game.exe', path:path.resolve('game.exe'),
    hasNativeDlssFg:true, hasNativeFg:true, hasXeMfgDlssSrVk:true};
  const input = {name:'Game', scan:{exeCandidates:[target], chosen:target}, dir:path.dirname(target.path),
    target, hardware:{gpu:{name:'AMD Radeon RX 580', nvidiaPresent:false}}};
  const result = assess(input);
  assert.deepEqual(result.routes, ['xemfg']);
  assert.equal(assess({...input, linux:true, proton:false}).status, 'verify');
  assert.deepEqual(assess({...input, linux:true, proton:true, hardware:{gpu:{name:'NVIDIA GeForce RTX 4080', nvidiaPresent:true}}}).routes, ['xemfg']);
  const newer = assess({...input, hardware:{gpu:{name:'AMD Radeon RX 6800', nvidiaPresent:false}}});
  assert.ok(newer.routes.includes('anr'));
  assert.ok(!newer.routes.includes('anr-addon'));
});

test('AMD hardware retains only the verified OptiScaler host route for the selected executable', () => {
  const base = {api:'dxgi', apiLabel:'DirectX 12', bitness:64, rel:'Game.exe', path:path.resolve('Game.exe'),
    hasOptiScalerConfig:true, hasNativeFg:false};
  function inspect(fields) {
    const target = {...base, ...fields};
    return assess({name:'Hosted', dir:path.dirname(target.path), scan:{exeCandidates:[target], chosen:target},
      target, hardware:{os:'Windows_NT 10.0.26100', gpu:{name:'AMD Radeon RX 7900 XT', nvidiaPresent:false}}, antiCheat:target.antiCheatWarning});
  }
  assert.deepEqual(inspect({hasXeMfgDx12Upscaler:true}).routes, []);
  assert.equal(inspect({hasXeMfgDx12Upscaler:true}).driverHint, 'afmf');
  const opti = {optiFgHost:true, hasOptiFgDx12Upscaler:true};
  assert.deepEqual(inspect(opti).routes, ['optifg']);
  assert.equal(inspect(opti).recommendedRoute, 'optifg');
  assert.equal(inspect(opti).driverHint, null);
  const plugin = {xeMfgOptiHost:'dx12', hasXeMfgDx12Upscaler:true};
  assert.deepEqual(inspect(plugin).routes, ['xemfg-optiscaler']);
  assert.equal(inspect(plugin).recommendedRoute, 'xemfg-optiscaler');
  assert.deepEqual(inspect({...opti, antiCheatWarning:true}).routes, []);
  assert.deepEqual(inspect({...plugin, antiCheatWarning:true}).routes, []);
});

test('AFMF guidance needs the matching Radeon, Windows, API and absence of native frame generation', () => {
  const {afmfDriverMode} = require('../src/shared/install-routes');
  const target = {api:'dxgi', apiLabel:'DirectX 11', hasNativeFg:false};
  const hardware = {os:'Windows_NT 10.0.26100 (x64)', gpu:{name:'AMD Radeon RX 6800 XT', nvidiaPresent:false}};
  assert.equal(afmfDriverMode(target, hardware), 'afmf-fullscreen');
  assert.equal(afmfDriverMode({...target, api:'opengl'}, {...hardware, gpu:{name:'AMD Radeon 780M', nvidiaPresent:false}}), 'afmf');
  for (const fields of [{api:'d3d9'}, {apiLabel:'DirectX 10'}, {hasNativeFg:undefined}, {hasNativeFg:true},
    {hasNativeDlssFg:true}, {launcherProtected:true}]) {
    assert.equal(afmfDriverMode({...target, ...fields}, hardware), null);
  }
  assert.equal(afmfDriverMode(target, {...hardware, os:'Linux 6.12'}), null);
  for (const gpu of [{name:'AMD Radeon RX 5700', nvidiaPresent:false}, {...hardware.gpu, nvidiaPresent:null},
    {...hardware.gpu, nvidiaPresent:true}]) {
    assert.equal(afmfDriverMode(target, {...hardware, gpu}), null);
  }
});
