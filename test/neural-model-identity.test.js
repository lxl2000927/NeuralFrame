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

test('actual 310.9.16 NR files have a distinct hash identity and no invented performance metadata', t => {
  const dir = scratch(t), file = path.join(dir, 'payload/streamline/nvngx_dlssnr.dll');
  writeNr(file);
  const info = models.inspectNeuralModelBinary(file);
  assert.equal(info.valid, true);
  assert.equal(info.version, '310.9.16.0');
  assert.match(info.modelId, /^custom-[0-9a-f]{12}$/);
  const list = models.listNeuralModels({ payloadDir: path.join(dir, 'payload') });
  assert.equal(list.find(m => m.id === '310.8.SF-v2').availableOnDisk, false);
  const local = list.filter(m => m.availableOnDisk);
  assert.equal(local.length, 1);
  assert.equal(local[0].id, info.modelId);
  assert.equal(local[0].version, info.version);
  assert.equal(local[0].role, 'custom');
  assert.equal(local[0].parameters, undefined);
  assert.equal(local[0].compatStatus, 'experimental');
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
  const spoof = models.evaluateModelGpuCompatibility({ id:'310.8.SF-v2', architectures:['89'] });
  assert.equal(spoof.status, 'experimental');
  const unknown = models.evaluateModelGpuCompatibility({ architectures:['89','120'] }, 'Unknown GPU');
  assert.equal(unknown.status, 'untested');
  assert.equal(unknown.gpu.sm, null);
});
