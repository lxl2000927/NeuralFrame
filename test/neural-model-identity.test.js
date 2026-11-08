'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writePe } = require('./fixtures/pe');
const models = require('../src/core/neural-models');
const { estimateVramBudget } = require('../src/core/combined-manager');
const payloadDir = path.resolve(__dirname, '../payload');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-identity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// Non-executable fixture: PE metadata, NR identity symbols and one CUDA descriptor.
function writeNr(file, version = '310.9.16.0') {
  writePe(file, { version, text: 'nvngx_dlssnr.pdb DLSSNRGetStatsCallback source/features/dlssnr/' });
  const fatbin = Buffer.alloc(81);
  Buffer.from([0x50,0xed,0x55,0xba,1,0,0x10,0]).copy(fatbin);
  fatbin.writeBigUInt64LE(65n, 8);
  fatbin.writeUInt16LE(2, 16);
  fatbin.writeUInt32LE(64, 20);
  fatbin.writeBigUInt64LE(1n, 24);
  fatbin.writeUInt32LE(89, 44);
  fs.appendFileSync(file, fatbin);
}

test('the component selection resolves catalog aliases by identity and leaves other components in the plan', () => {
  const deploy = require('../src/core/component-deploy');
  const file = {rel:'nvngx_dlssnr.dll',sha256:models.MODEL_DATABASE[0].sha256};
  const library = {package:()=>({component:'dlss-nr',files:[file]}),directory:()=>path.join(payloadDir,'streamline')};
  const selected = {'dlss-nr':'saved-model','dlss-sr':'saved-sr'};
  for (const id of [undefined,'310.9.16-oct2026','310.8.SF-v2']) {
    const {selection,request} = deploy.resolveManagedSelection(library,selected,{kind:'enhanced',config:{
      neuralMode:'latest_compatible', neuralModelId:id}});
    assert.deepEqual(selection,{'dlss-sr':'saved-sr'});
    assert.equal(request.config.neuralModelId,'310.8.SF-v2');
    assert.equal(request.config.neuralModelSha256,file.sha256);
  }
  assert.throws(()=>deploy.resolveManagedSelection(library,selected,{kind:'enhanced',config:{neuralMode:'legacy'}}),/不同/);
});

test('graphics preview resolves one model for the executable, nested plugins and manifest', async t => {
  const {ComponentLibrary} = require('../src/core/component-library');
  const {createRequire} = require('node:module');
  const vm = require('node:vm'), backends = require('../src/core/backend-manager');
  const dir = scratch(t), game = path.join(dir, 'Game'), user = path.join(dir, 'Profile');
  const payload = path.join(dir, 'payload'), source = path.join(dir, 'import/nvngx_dlssnr.dll');
  const nested = path.join(game, 'Engine/Plugins');
  writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
  for (const base of [game,nested,path.join(payload,'streamline')]) writePe(path.join(base,'nvngx_dlss.dll'),{version:'3.8.0.0'});
  writeNr(source);
  const lib = new ComponentLibrary(user, {payloadDir:payload});
  const saved = await lib.importPackage({component:'dlss-nr', files:{'nvngx_dlssnr.dll': source}});
  await lib.select(game, {'dlss-nr':saved.id});
  const info = models.inspectNeuralModelBinary(source);
  const previous = models.applyNeuralModelSelection;
  t.mock.method(models, 'applyNeuralModelSelection', (g,options,log) => previous(g,{...options,gpuName:'RTX 4070 Laptop GPU'},log));
  t.mock.method(require('../src/core/install-guards'),'gpuInfo',async()=>[{name:'RTX 4070 Laptop GPU'}]);
  const deploy = require('../src/core/component-deploy');
  const direct = modelId => deploy.managed(lib,game,lib.profile(game).selected,()=>
    models.applyNeuralModelSelection(game,{mode:'latest_compatible',modelId,payloadDir:payload,userDataDir:user}));
  await assert.rejects(direct('310.9.16-oct2026'), /310\.8\.SF-v2.*custom-/);
  assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);

  const main = path.resolve(__dirname,'../main.js'), realRequire = createRequire(main), handlers = new Map();
  const electron = {app:{setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>user},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)}};
  const ctx=vm.createContext({require:name=>name==='electron'?electron:realRequire(name),__dirname:path.dirname(main),
    process,Buffer,console,lib,fixturePayload:payload,requireFixture:async()=>{}});
  vm.runInContext(fs.readFileSync(main,'utf8'),ctx,{filename:main});
  vm.runInContext('unifiedComponents=lib;resolvePayloadRoot=()=>fixturePayload;requireRuntime=requireFixture',ctx);
  const run = (config,token) => handlers.get('enhanced-apply')({sender:{send(){}}},game,config,token);
  const conflict = await run({neuralMode:'latest_compatible',neuralModelId:'310.9.16-oct2026'});
  assert.match(conflict.message,/310\.8\.SF-v2.*custom-/);
  assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup')),false);

  const cfg = {neuralMode:'latest_compatible',neuralModelId:'custom-'+info.sha256.slice(0,8)};
  const plan = await run(cfg);
  assert.ok(plan.preview, JSON.stringify(plan));
  const {preview} = plan;
  const hashes = preview.rows.filter(row=>path.basename(row.rel)==='nvngx_dlssnr.dll');
  assert.equal(hashes.length,2);
  assert.ok(hashes.every(row=>row.after.sha256===info.sha256 && row.after.version===info.version));
  assert.equal(fs.existsSync(path.join(game,'nvngx_dlssnr.dll')),false);
  const installed = await run(cfg,preview.token);
  assert.equal(installed.ok,true,JSON.stringify(installed));
  for (const base of [game,nested]) assert.equal(models.inspectNeuralModelBinary(path.join(base,'nvngx_dlssnr.dll')).sha256,info.sha256);
  const stored=backends.readManifest(game).neuralRendering;
  assert.deepEqual([stored.modelId,stored.modelVersion,stored.sha256],[info.modelId,info.version,info.sha256]);

  writeNr(source,'310.8.0.0');
  const replacement=await lib.importPackage({component:'dlss-nr',files:{'nvngx_dlssnr.dll':source}});
  const alt=models.inspectNeuralModelBinary(source);
  await lib.apply(game,{'dlss-nr':replacement.id});
  const manifest=backends.readManifest(game);
  assert.equal(manifest.neuralRendering.sha256,alt.sha256);
  assert.equal(manifest.neuralRendering.modelId,alt.modelId);
  await lib.rollback(game,manifest.componentHistory.at(-1).id);
  assert.equal(backends.readManifest(game).neuralRendering.sha256,info.sha256);

  // Reapplying also repairs metadata from releases that recorded one model
  // while the component pass installed another, even if the DLL is already correct.
  const manifestFile = path.join(game, '_DLSS5_Backup/manifest.json');
  const stale = backends.readManifest(game);
  Object.assign(stale.neuralRendering, {modelId:alt.modelId,modelVersion:alt.version,sha256:alt.sha256});
  fs.writeFileSync(manifestFile,JSON.stringify(stale));
  const repair = await run(cfg);
  assert.equal((await run(cfg,repair.preview.token)).ok,true);
  assert.equal(backends.readManifest(game).neuralRendering.sha256,info.sha256);
  fs.writeFileSync(manifestFile,JSON.stringify(stale));
  assert.equal((await lib.apply(game,{'dlss-nr':saved.id})).changed,0);
  assert.equal(backends.readManifest(game).neuralRendering.sha256,info.sha256);

  // An NR choice saved in the library must not resurrect the DLL on disable.
  const off={neuralMode:'off',neuralModelId:alt.modelId};
  const disable=await run(off);
  assert.ok(disable.preview.rows.some(row=>path.basename(row.rel)==='nvngx_dlssnr.dll' && row.action==='remove'));
  assert.equal((await run(off,disable.preview.token)).ok,true);
  assert.equal(backends.readManifest(game).neuralRendering.mode,'off');
  assert.equal(fs.existsSync(path.join(game,'nvngx_dlssnr.dll')),false);

  // A leftover consumer does not authorize reinstalling or replacing its NR model.
  const modelPath = path.join(game,'nvngx_dlssnr.dll');
  writePe(path.join(game,'renodx-dlss5.addon64'),{});
  t.mock.method(require('../src/core/mfg-manager'),'applyMfgConfiguration',async()=>({ok:true}));
  for (const modelExists of [false,true]) {
    if (modelExists) fs.copyFileSync(source, modelPath);
    const mfg = {mfgMode:'x3'};
    const mfgPlan = await run(mfg);
    assert.ok(mfgPlan.preview,JSON.stringify(mfgPlan));
    assert.ok(mfgPlan.preview.rows.filter(row => path.basename(row.rel)==='nvngx_dlssnr.dll').every(row => row.action==='keep'));
    assert.equal((await run(mfg,mfgPlan.preview.token)).ok,true);
    assert.equal(fs.existsSync(modelPath),modelExists);
    if(modelExists) assert.equal(models.inspectNeuralModelBinary(modelPath).sha256,alt.sha256);
    assert.equal(backends.readManifest(game).neuralRendering.mode,'off');
  }
  const directResult = await direct(cfg.neuralModelId);
  assert.equal(directResult.sha256,info.sha256);
  assert.equal(models.inspectNeuralModelBinary(modelPath).sha256,info.sha256);
  assert.equal(backends.readManifest(game).neuralRendering.sha256,info.sha256);
});

test('actual 310.9.16 NR files have a distinct hash identity and no invented performance metadata', async t => {
  const dir = scratch(t), file = path.join(dir, 'payload/streamline/nvngx_dlssnr.dll');
  writeNr(file);
  const info = models.inspectNeuralModelBinary(file);
  assert.equal(info.valid, true);
  assert.equal(info.version, '310.9.16.0');
  assert.match(info.modelId, /^custom-[0-9a-f]{12}$/);
  const { GameInspection } = require('../src/core/game-inspection');
  const service = new GameInspection();
  t.after(() => service.close());
  const options = { payloadDir: path.join(dir, 'payload') };
  const first = service.run('models', null, options);
  assert.equal(first, service.run('models', null, options));
  const list = await first;
  assert.deepEqual(list, models.listNeuralModels(options));
  assert.equal(list.find(m => m.id === '310.8.SF-v2').availableOnDisk, false);
  const local = list.filter(m => m.availableOnDisk);
  assert.equal(local.length, 1);
  assert.equal(local[0].id, info.modelId);
  assert.equal(local[0].version, info.version);
  assert.equal(local[0].role, 'custom');
  assert.equal(local[0].parameters, undefined);
  assert.equal(local[0].compatStatus, 'untested');
  assert.equal(models.listNeuralModels({ payloadDir: path.join(dir, 'payload'), gpuName: 'RTX 4070 Laptop GPU' })
    .find(m => m.id === info.modelId).compatStatus, 'experimental');
});

test('loose portable DLLs and spoofed bundled cache files require an explicit model import', t => {
  const dir = scratch(t), portable = path.join(dir,'portable'), user = path.join(dir,'user');
  const file = path.join(portable, 'nvngx_dlssnr.dll'), missing = path.join(dir, 'missing');
  writeNr(file);
  const cache = path.join(user,'neural-models','bundled-310.8.SF-v2.dll');
  fs.mkdirSync(path.dirname(cache), {recursive:true});
  fs.copyFileSync(file,cache);
  const previous = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = portable;
  t.after(() => { if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR; else process.env.PORTABLE_EXECUTABLE_DIR = previous; });
  const list = () => models.listNeuralModels({payloadDir:missing,userDataDir:user});
  assert.equal(list().some(m => m.availableOnDisk), false);
  const imported = models.importNeuralModel(file,user);
  assert.ok(list().some(m => m.availableOnDisk && m.sha256 === imported.sha256));
  fs.copyFileSync(path.join(payloadDir, 'streamline/nvngx_dlssnr.dll'), cache);
  assert.equal(list().find(m => m.id === '310.8.SF-v2').filePath, cache);
});

test('import index cannot override actual version/hash, duplicate files are merged and missing entries are not ready', t => {
  const dir = scratch(t), file = path.join(dir, 'external.dll'), indexDir = path.join(dir, 'neural-models');
  writeNr(file);
  fs.mkdirSync(indexDir);
  // Prevent background cache copy in this isolated test.
  fs.writeFileSync(path.join(indexDir, 'bundled-310.8.SF-v2.dll'), 'fixture');
  fs.writeFileSync(path.join(indexDir, 'index.json'), JSON.stringify([
    { id:'310.9.16-oct2026', modelId:'310.9.16-oct2026', version:'999.0.0.0', sha256:'stale', filePath:file },
    { id:'duplicate', modelId:'duplicate', filePath:file },
    { id:'missing', filePath:path.join(dir, 'missing.dll') },
    { id:'bundled-copy', filePath:path.join(payloadDir, 'streamline/nvngx_dlssnr.dll') }
  ]));
  const list = models.listNeuralModels({ payloadDir, userDataDir:dir });
  const ready = list.filter(m => m.availableOnDisk);
  assert.equal(ready.length, 2);
  assert.equal(new Set(ready.map(m => m.sha256)).size, 2);
  const custom = ready.find(m => m.role === 'custom');
  assert.equal(custom.version, '310.9.16.0');
  assert.match(custom.id, /^custom-/);
  assert.notEqual(custom.sha256, 'stale');
  assert.ok(!list.some(m => ['missing','310.9.16-oct2026','duplicate'].includes(m.id)));
});

test('game manifest cannot relabel a model file or fabricate an installed SR runtime', async t => {
  const dir = scratch(t);
  writePe(path.join(dir, 'Game.exe'), { text:'D3D12CreateDevice' });
  writeNr(path.join(dir, 'nvngx_dlssnr.dll'), '310.8.0.0');
  fs.mkdirSync(path.join(dir, '_DLSS5_Backup'));
  const manifest = path.join(dir, '_DLSS5_Backup/manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ neuralRendering: {mode:'oct2026_faster', modelId:'310.9.16-oct2026', modelVersion:'310.9.16.0', runtimeStack:'oct2026-310.9.16'} }));
  const before = fs.readFileSync(manifest);
  const status = await models.inspectGameNeuralStatus(dir, { payloadDir });
  assert.match(status.currentModel.id, /^custom-/);
  assert.equal(status.currentModel.version, '310.8.0.0');
  assert.equal(status.runtimeVersion, null);
  assert.equal(status.configuredRuntimeStack, 'oct2026-310.9.16');
  assert.equal(status.mode, 'latest_compatible');
  assert.deepEqual(fs.readFileSync(manifest), before, 'inspection must not migrate files in the game');
});

test('explicit unavailable model fails without silently installing another model', async t => {
  const dir = scratch(t);
  writePe(path.join(dir, 'Game.exe'), { text:'D3D12CreateDevice' });
  await assert.rejects(models.applyNeuralModelSelection(dir, { modelId:'310.8.0-RTX40', payloadDir }), { code:'errModelNotOnDisk' });
  assert.equal(fs.existsSync(path.join(dir, 'nvngx_dlssnr.dll')), false);
});

test('legacy alias does not receive a fictional VRAM discount and GPU labels cannot fake validation', () => {
  for (const hardwareProfile of ['rtx40_laptop','rtx40_desktop','rtx50_desktop']) {
    const opts = { hardwareProfile, neuralMode:'latest_compatible', mfgMode:'x3' };
    assert.deepEqual(estimateVramBudget({...opts, neuralModelId:'310.8.SF-v2'}), estimateVramBudget({...opts, neuralModelId:'310.9.16-oct2026'}));
  }
  const spoof = models.evaluateModelGpuCompatibility({ id:'310.8.SF-v2', architectures:['89'] }, 'RTX 4070 Laptop GPU');
  assert.equal(spoof.status, 'experimental');
  const unknown = models.evaluateModelGpuCompatibility({ architectures:['89','120'] }, 'Unknown GPU');
  assert.equal(unknown.status, 'untested');
  assert.equal(unknown.gpu.sm, null);
  const blackwellOnly = { architectures:['120'] };
  const ada = models.evaluateModelGpuCompatibility(blackwellOnly, 'RTX 4070 Laptop GPU', 'rtx50_desktop');
  assert.equal(ada.gpu.sm, '89');
  assert.equal(ada.compatible, false);
  const mfg = require('../src/core/mfg-manager').evaluateMfgGpuSupport('RTX 4070 Laptop GPU', '', 'rtx50_desktop');
  assert.equal(mfg.nativeX3X4, false);
  assert.equal(mfg.modeBadges.x3.status, 'experimental');
  const missing = require('../src/core/mfg-manager').evaluateMfgGpuSupport();
  assert.equal(missing.gpuName, '');
  assert.equal(missing.driverVersion, '');
  assert.equal(missing.modeBadges.x3.status, 'untested');
  assert.equal(models.evaluateModelGpuCompatibility(blackwellOnly, '', 'rtx50_desktop').status, 'untested');
});

test('the selected rendering profile changes the estimate, never physical memory capacity', () => {
  for (const hardwareProfile of ['rtx40_laptop','rtx40_desktop','rtx50_desktop']) {
    const config = {hardwareProfile, neuralMode:'latest_compatible', mfgMode:'x4'};
    const budget = estimateVramBudget({...config, vramTotalMB:8192});
    assert.equal(budget.vramTotalMB, 8192);
    assert.equal(budget.headroomMB, 8192 - budget.estimatedTotalMB);
    assert.equal(estimateVramBudget(config).usagePercent, null);
    assert.equal(estimateVramBudget(config).level, 'unknown');
  }
});

test('automatic presets distinguish detected hardware, borrowed parameters and saved choices', () => {
  const { selectHardwareProfile } = require('../src/core/hardware-profile');
  const gpu = {name:'NVIDIA GeForce RTX 4060', vramTotalMB:8188};
  assert.deepEqual(selectHardwareProfile({gpu}), {id:'rtx40_laptop',source:'low-vram'});
  assert.deepEqual(selectHardwareProfile({gpu:{...gpu, vramTotalMB:12288}}), {id:'rtx40_desktop',source:'detected'});
  assert.equal(selectHardwareProfile({gpu:{name:'RTX 5070 Laptop GPU'}}).source, 'blackwell-mobile');
  assert.equal(selectHardwareProfile({gpu:{...gpu, detected:false}}).source, 'fallback');
  assert.equal(selectHardwareProfile({gpu:{name:'Unknown'}}).source, 'fallback');
  assert.equal(selectHardwareProfile({gpu:null, defaultProfile:['rtx50_desktop']}).source, 'fallback');
  const saved = {gpu, manifestProfile:'rtx40_desktop', defaultProfile:'rtx50_desktop'};
  assert.deepEqual(selectHardwareProfile(saved), {id:'rtx40_desktop',source:'manifest'});
  assert.deepEqual(selectHardwareProfile({...saved, requestedProfile:'rtx40_laptop'}), {id:'rtx40_laptop',source:'selected'});
  assert.deepEqual(selectHardwareProfile({gpu, defaultProfile:'rtx40_desktop'}), {id:'rtx40_desktop',source:'default'});
  assert.equal(estimateVramBudget({hardwareProfile:'rtx50_desktop', resolution:'3840x2160'}).resolution, '1920x1080');
});
