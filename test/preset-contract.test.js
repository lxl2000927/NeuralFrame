'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPreset,parsePreset,presetMatches,SCHEMA} = require('../src/core/preset-contract');

test('presets retain configuration but remove paths, tokens and local diagnostics', () => {
  const preset = createPreset({name:'  平衡画质  ',gameName:'Example',route:'streamline',createdAt:'2026-11-20T00:00:00Z',settings:{
    draft:{neuralMode:'latest_compatible',mfgMode:'x3',exePath:'D:/private/game.exe'},
    graphics:{multiplier:3},mfgAdvanced:{tone:1,diagnosticLogging:true},token:'secret',encore:undefined,
  }});
  assert.equal(preset.schema,SCHEMA);assert.equal(preset.name,'平衡画质');
  assert.deepEqual(preset.settings.draft,{neuralMode:'latest_compatible',mfgMode:'x3'});
  assert.deepEqual(preset.settings.mfgAdvanced,{tone:1});
  assert.equal('token' in preset.settings,false);
  assert.deepEqual(parsePreset(JSON.stringify(preset)),preset);
});

test('optional route presets exclude unrelated classic drafts and validate writable settings',()=>{
  const entry={name:'Game profile',gameName:'Example',route:'xemfg',settings:{draft:{mfgMode:'host'},graphics:{neural:true,multiplier:5,engine:'XeSS'}}};
  const preset=createPreset(entry);
  assert.deepEqual(preset.settings,{graphics:{multiplier:5}});
  assert.equal(presetMatches(preset,'anr','Example'),false);
  assert.equal(presetMatches(preset,'xemfg','Another game'),true);
  assert.deepEqual(createPreset({...entry,route:'optifg'}).settings,{});
  for (const multiplier of [0,7,'5',true]) assert.throws(()=>parsePreset(JSON.stringify({...preset,settings:{graphics:{multiplier}}})),/参数无效/);
  assert.throws(()=>parsePreset(JSON.stringify({...preset,settings:{components:['dlss']}})),/参数无效/);
});

test('Encore spatial controls survive an export/import and reject invalid public settings',()=>{
  const encore={upscaling:'mwsr',spatialAa:'smaa',spatialSharpness:0,spatialAaPlacement:'after',spatialAaQuality:'ultra'};
  const preset=createPreset({name:'Spatial',gameName:'Example',route:'encore',settings:{encore}});
  assert.deepEqual(parsePreset(JSON.stringify(preset)).settings.encore,encore);
  for(const patch of [{upscaling:'xess'},{spatialSharpness:101},{spatialAa:'msaa'},{spatialAaPlacement:'final'},{spatialAaQuality:'extreme'}])
    assert.throws(()=>parsePreset(JSON.stringify({...preset,settings:{encore:{...encore,...patch}}})),/参数无效/);
});

test('legacy profiles retain applicable settings without crossing independent engines',()=>{
  const saved=createPreset({name:'Old',gameName:'Example',route:'streamline',settings:{draft:{mfgMode:'x3'},encore:{},components:{}}});
  assert.equal(presetMatches(saved,'feeder','Other game'),true);
  assert.equal(presetMatches(saved,'xemfg','Example'),false);
  assert.equal(presetMatches(saved,'wuwa-proxy','Different'),false);
  assert.equal(presetMatches(saved,'wuwa-proxy','Example'),false);
  const dedicated={...saved,settings:{draft:{mfgMode:'dynamic'}}};
  assert.equal(presetMatches(dedicated,'renodx','Example'),false);
  assert.equal(presetMatches(dedicated,'wuwa-proxy','Example'),true);
  assert.throws(()=>createPreset({...saved,settings:{draft:{runtimeStack:{id:'unexpected'}}}}),/参数无效/);
});

test('preset imports reject executable paths, dangerous fields and oversized data', () => {
  const base = createPreset({name:'safe',gameName:'Example',route:'encore',settings:{draft:{neuralMode:'quality'}}});
  for (const key of ['exePath','dir','token','diagnosticLogging']) {
    const value = {...base,settings:{draft:{[key]:key === 'diagnosticLogging' ? true : 'value'}}};
    assert.throws(() => parsePreset(JSON.stringify(value)),/不允许导出/);
  }
  assert.throws(() => parsePreset('{'),/JSON/);
  assert.throws(() => parsePreset(JSON.stringify({...base,version:99})),/不受支持/);
  assert.throws(() => createPreset({...base,settings:{draft:{text:'x'.repeat(5000)}}}),/文本过长/);
});
