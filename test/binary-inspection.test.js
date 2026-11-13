'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { findMarkers } = require('../src/core/pe');
const { identifyNgxBuffer } = require('../src/core/neural-models');

test('unsupported PE optional headers never become a 32-bit game candidate', async t => {
  const { writePe } = require('./fixtures/pe'), pe = require('../src/core/pe');
  const { scanGame } = require('../src/core/scan');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-pe-format-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  for (const magic of [0, 0x107, 0xffff]) {
    const game = path.join(root, String(magic)), file = writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
    const bytes = fs.readFileSync(file), optional = bytes.readUInt32LE(0x3c) + 24;
    bytes.writeUInt16LE(magic, optional);fs.writeFileSync(file, bytes);
    assert.equal(pe.getBitness(file),null,`optional header ${magic} is neither PE32 nor PE32+`);
    assert.deepEqual((await scanGame(game)).exeCandidates,[]);
  }
  for (const bitness of [32,64]) {
    const file=writePe(path.join(root,`valid-${bitness}.exe`),{bitness,text:'D3D12CreateDevice'});
    assert.equal(pe.getBitness(file),bitness);
  }
});

test('batched PE marker search preserves overlap, literal metacharacters and chunk boundaries', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-marker-search-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  const file = path.join(dir, 'binary.dll'), data = Buffer.alloc(8 * 1024 * 1024 + 64, 0x7f);
  data.write('DirectDrawCreateEx', 4 * 1024 * 1024 - 5, 'latin1');
  data.write('A.*[B]C+x?y$z|q', data.length - 32, 'latin1');
  const markers = ['DirectDrawCreate', 'DirectDrawCreateEx', 'DrawCreate', 'A.*[B]', 'C+x?y$z|q', 'DirectDrawCreate', 'absent'];
  fs.writeFileSync(file, data);
  assert.deepEqual(findMarkers(file, markers), new Set(markers.filter(m => data.includes(Buffer.from(m, 'latin1')))));
  assert.deepEqual(findMarkers(file, []), new Set());
  assert.deepEqual(findMarkers(path.join(dir, 'missing'), markers), new Set());
  fs.writeFileSync(file, 'changed');
  assert.deepEqual(findMarkers(file, markers), new Set(), 'refresh must read changed bytes');
});

test('NR marker shortcuts retain traditional runtime rejection and Unicode fallback', () => {
  const identify = (text, encoding='latin1') => {
    const data = Buffer.alloc(4096); data.write('MZ');data.write(text, 256, encoding);
    return identifyNgxBuffer(data).kind;
  };
  for (const [pdb,kind] of [['nvngx_dlss.pdb','dlss_sr'],['nvngx_dlssd.pdb','dlss_rr'],['nvngx_dlssg.pdb','dlss_fg']]) {
    assert.equal(identify(pdb+' nvngx_dlssnr.pdb dlssnr'), kind);
    assert.equal(identify(pdb+' DLSSNRGetStatsCallback'), 'dlss_nr');
  }
  assert.equal(identify('NVSDK_NGX_D3D12_DLSSNR', 'utf16le'), 'dlss_nr');
  assert.equal(identify('no recognized symbols'), 'unknown_dll');
});

test('browsing symbol cache survives restart, notices changed bytes and is disabled for install reads', async t => {
  const cache = require('../src/core/scan-cache');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-symbol-cache-'));
  t.after(() => {cache.configure(null);fs.rmSync(dir,{recursive:true,force:true});});
  const file = path.join(dir,'Game.exe'), index = path.join(dir,'symbols.json');
  fs.writeFileSync(file,'D3D12CreateDevice');
  const symbols = ['D3D12CreateDevice','D3D11CreateDevice'];
  cache.configure(index);
  assert.deepEqual(findMarkers(file,symbols),new Set([symbols[0]]));
  await cache.flush();cache.configure(null);cache.configure(index);
  const open = t.mock.method(fs,'openSync',()=>{throw Error('Unexpected full binary read');});
  assert.deepEqual(findMarkers(file,symbols),new Set([symbols[0]]));
  open.mock.restore();
  fs.writeFileSync(file,'D3D11CreateDevice updated');
  assert.deepEqual(findMarkers(file,symbols),new Set([symbols[1]]));
  cache.configure(null);
  assert.equal(cache.probe(file,symbols),null);
  assert.deepEqual(findMarkers(file,symbols),new Set([symbols[1]]));
});

test('mutation model verification rereads bytes even when filesystem timestamps repeat', t => {
  const {writeNr}=require('./fixtures/pe'), models=require('../src/core/neural-models');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-fresh-model-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=writeNr(path.join(dir,'nvngx_dlssnr.dll'),'310.9.16.0',89);
  const before=fs.statSync(file), first=models.inspectNeuralModelBinary(file);
  writeNr(file,'310.9.17.0',120);
  const stat=fs.statSync;
  t.mock.method(fs,'statSync',(name,...args)=>name===file?before:stat(name,...args));
  const changed=models.inspectNeuralModelBinary(file,{fresh:true});
  assert.notEqual(changed.sha256,first.sha256);
  assert.equal(changed.version,'310.9.17.0');
  assert.deepEqual(changed.architectures,['120']);
});
