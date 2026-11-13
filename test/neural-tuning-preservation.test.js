'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {writePe} = require('./fixtures/pe');
const {root:payloadDir} = require('./fixtures/payload');
const neural = require('../src/core/neural-models');
const ini = require('../src/core/feeder-config');
const backends = require('../src/core/backend-manager');

test('NR reapply preserves panel tuning; profile changes only budget and explicit reset restores defaults',async t=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-neural-tuning-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const game = path.join(root,'Game');
  const exePath = writePe(path.join(game,'Game.exe'),{text:'D3D12CreateDevice'});
  const file = path.join(game,'ReShade.ini');
  const original = '[OVERLAY]\nUiLanguage=en-US\n[RenoDX.DLSS5]\nNRIntensity=0.42\nNRLocalStructure=1.3\nNRLocalTone=0.7\nNRStyle=1\nNRResolutionScale=0.61\nNRMaxWorksets=3\nNRPasses=3\nCustomFutureField=keep\n';
  fs.writeFileSync(file,original);
  const options = {mode:'latest_compatible',modelId:'310.8.SF-v2',exePath,hardwareProfile:'rtx40_laptop',
    payloadDir,userDataDir:path.join(root,'profile'),gpuName:'NVIDIA GeForce RTX 4070 Laptop GPU'};
  const read = key=>ini.getIni(fs.readFileSync(file,'utf8'),'RenoDX.DLSS5',key);
  await neural.applyNeuralModelSelection(game,options);
  await neural.applyNeuralModelSelection(game,options);
  assert.equal(read('NRIntensity'),'0.42');assert.equal(read('NRLocalStructure'),'1.3');
  assert.equal(read('NRLocalTone'),'0.7');assert.equal(read('NRStyle'),'1');
  assert.equal(read('NRResolutionScale'),'0.61');assert.equal(read('NRMaxWorksets'),'3');
  assert.equal(read('NRPasses'),'1','the single-pass RenoDX consumer still enforces its supported route');
  await neural.applyNeuralModelSelection(game,{...options,hardwareProfile:'rtx40_desktop'});
  assert.equal(read('NRResolutionScale'),'1');assert.equal(read('NRMaxWorksets'),'8');
  assert.equal(read('NRIntensity'),'0.42');assert.equal(read('NRPasses'),'1');
  await neural.applyNeuralModelSelection(game,{...options,resetNeuralTuning:true});
  assert.equal(read('NRIntensity'),'1');assert.equal(read('NRStyle'),'0');assert.equal(read('NRPasses'),'1');
  assert.equal(read('NRResolutionScale'),'0.75');assert.equal(read('CustomFutureField'),'keep');
  await backends.restore(game);
  assert.equal(fs.readFileSync(file,'utf8'),original);
});
