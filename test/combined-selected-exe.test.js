'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe} = require('./fixtures/pe');
const {scanGame} = require('../src/core/scan');
const combined = require('../src/core/combined-manager');
const backend = require('../src/core/backend-manager');

for (const [feature, options, addon] of [
  ['MFG', {mfgMode:'off'}, 'renodx-mfgunlock.addon64'],
  ['NR', {neuralMode:'off'}, 'renodx-dlss5.addon64'],
]) test(`combined ${feature} configuration applies to the explicitly selected executable`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-selected-graphics-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const game = path.join(root,'Game'), alternate = path.join(game,'Alternate');
  const primary = writePe(path.join(game,'Game.exe'), {bitness:64,text:'D3D12CreateDevice',size:1024*1024});
  const selected = writePe(path.join(alternate,'Alternate.exe'), {bitness:64,text:'D3D12CreateDevice',size:131072});
  const unselectedAddon = path.join(game,addon), selectedAddon = path.join(alternate,addon);
  for (const file of [unselectedAddon,selectedAddon]) writePe(file,{bitness:64,text:'addon'});
  const untouched = fs.readFileSync(unselectedAddon);
  assert.equal((await scanGame(game)).chosen.path, primary);
  t.mock.method(require('../src/core/install-guards'),'assertGameClosed',async()=>{});
  const result = await combined.applyCombinedConfiguration(game, {...options,exePath:selected,apiOverride:'d3d12',hardwareProfile:'rtx40_laptop',userDataDir:path.join(root,'profile')});
  assert.equal(result.ok,true);
  assert.equal(fs.existsSync(selectedAddon),false,'the selected executable loses its disabled plugin');
  assert.deepEqual(fs.readFileSync(unselectedAddon),untouched,'the other executable keeps its own plugin');
  assert.equal(backend.readManifest(game).game.exe,path.relative(game,selected));
  assert.equal(result.status.exePath,selected,'the returned state describes the same executable');
});

for (const feature of ['NR','MFG']) test(`a missing selected executable cannot redirect ${feature} configuration to another game binary`, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nf-missing-graphics-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const primary=writePe(path.join(root,'Game.exe'),{bitness:64,text:'D3D12CreateDevice',size:1024*1024});
  const selected=writePe(path.join(root,'Alternate/Alternate.exe'),{bitness:64,text:'D3D12CreateDevice',size:131072});
  const addon=path.join(root,feature==='NR'?'renodx-dlss5.addon64':'renodx-mfgunlock.addon64');
  fs.writeFileSync(addon,'unselected plugin');
  t.mock.method(require('../src/core/install-guards'),'assertGameClosed',async()=>fs.unlinkSync(selected));
  const options=feature==='NR'?{neuralMode:'off'}:{mfgMode:'off'};
  await assert.rejects(combined.applyCombinedConfiguration(root,{...options,exePath:selected,apiOverride:'d3d12',userDataDir:path.join(root,'profile')}),{code:'errSelectedExeMissing'});
  assert.equal(fs.readFileSync(addon,'utf8'),'unselected plugin');
  assert.equal(fs.existsSync(primary),true);
  assert.equal(backend.readManifest(root),null);
});
