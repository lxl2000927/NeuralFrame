'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const config = require('../src/core/encore-config');
const routes = require('../src/shared/install-routes');
const {requiredPacks,RuntimePayload} = require('../src/core/runtime-payload');
const catalog = require('../src/core/runtime-catalog.json');
test('Encore eligibility separates native SR, native FG and owned added FG; defaults stay unchanged', () => {
  const target = {bitness:64,api:'dxgi',apiLabel:'DirectX 12',hasNativeFg:false,hasNativeDlss:true};
  assert.ok(routes.routesFor(target).includes('encore'));
  assert.equal(routes.recommendedRoute({chosen:target,primaryDlss:{rel:'nvngx_dlss.dll',version:'3.7.0.0'}}),'native');
  for (const patch of [{bitness:32},{api:'opengl'},{apiLabel:'DirectX 10'},{hasNativeFg:true},{hasNativeFg:undefined},{launcherProtected:true}])
    assert.ok(routes.encoreReason({...target,...patch}),JSON.stringify(patch));
  assert.equal(routes.encoreReason({...target,api:'vulkan',apiLabel:'Vulkan'}),null);
  const files = [{name:'nvngx_dlss.dll',rel:'nvngx_dlss.dll'},{name:'sl.reflex.dll',rel:'sl.reflex.dll'}];
  assert.equal(routes.nativeFgPresent({dlssFiles:files}),false);
  files.push({name:'nvngx_dlssg.dll',rel:'bin/nvngx_dlssg.dll'});
  assert.equal(routes.nativeFgPresent({dlssFiles:files}),true);
  assert.equal(routes.nativeFgPresent({dlssFiles:files,install:{added:['bin\\nvngx_dlssg.dll']}}),false);
});
test('Encore JSONC writes v4 nested settings and keeps comments, unknown fields and user tuning', () => {
  const original = '\uFEFF{\r\n // keep my menu\r\n "configVersion":4,"menu":{"language":"fr"},"neuralRendering":{"core":{"nrPlacement":"present","nrResolution":"quality","nrResolutionScale":67},"style":{"custom":3}},"frameGeneration":{"flipMeteringLearned":"bypass"},"future":{"a":[1,2,3]},\r\n}\r\n';
  const settings = {...config.read(original),neuralMode:'latest_compatible',mfgMode:'x4',upscaling:'dlss'};
  const text = config.configure(original,settings,false), result = config.document(text);
  assert.ok(text.startsWith('\uFEFF')); assert.ok(text.includes('// keep my menu')); assert.ok(text.includes('\r\n'));
  assert.deepEqual({...result.menu},{language:'fr'});assert.deepEqual({...result.future},{a:[1,2,3]});
  assert.equal(result.neuralRendering.core.nrPlacement,'present');assert.equal(result.neuralRendering.core.nrResolution,'quality');
  assert.equal(result.neuralRendering.core.nrResolutionScale,67);assert.deepEqual({...result.neuralRendering.style},{custom:3});
  assert.equal(result.frameGeneration.flipMeteringLearned,'bypass');assert.equal(result.frameGeneration.multiplier,4);
  assert.equal(result.renderingEngines.frameGenerationEngine,'dlss-fg');assert.equal(result.smoothMotion.smoothMotionEnabled,false);
  assert.equal(result.neuralRendering.core.nrWithoutGameDlss,true);assert.equal(result.dlssSuperResolution.dlssWithoutGameDlssEngine,'dlss');
  assert.equal(config.configure(text,settings,false),text,'re-applying is stable');
  const off = config.document(config.configure(text,{...settings,mfgMode:'off',neuralMode:'off',upscaling:'off'},false));
  assert.equal(off.frameGeneration.frameGenerationWithoutGameFg,false);assert.equal(off.neuralRendering.core.nrEnabled,false);
  assert.deepEqual(off.future,result.future);assert.equal(off.neuralRendering.core.nrPlacement,'present');
});
test('Encore configuration rejects malformed, duplicate, future protocol and invalid parameters without guessing', () => {
  for (const text of ['{oops}', '{"x":1,"x":2}', '{"configVersion":5}', '[]', '{"neuralRendering":{"core":4}}','{"frameGeneration":[]}'])
    assert.throws(()=>config.configure(text,config.DEFAULTS,false),{code:'errEncoreConfig'});
  for (const patch of [{mfgMode:'dynamic'},{nrScale:NaN},{nrPasses:5},{motion:'bogus'},{nrResolution:'auto'},{upscaling:'xess'}])
    assert.throws(()=>config.validate({...config.DEFAULTS,neuralMode:'latest_compatible',...patch}),{code:'errEncoreConfig'});
  assert.throws(()=>config.configure('{}',{...config.DEFAULTS,upscaling:'dlss'},true),/原生 DLSS/);
  const nr = config.document(config.configure('{}',{...config.DEFAULTS,neuralMode:'latest_compatible'},true));
  assert.equal(nr.neuralRendering.core.nrWithoutGameDlss,false);
});
test('editing frame generation keeps omitted upstream NR defaults and allows disabling unsupported hidden NR settings', () => {
  const original='{"configVersion":4,"neuralRendering":{"core":{"nrEnabled":true,"nrResolution":"custom"}}}';
  const settings=config.read(original);
  assert.equal(settings.nrScale,67,'an existing JSONC uses the upstream default, not the fresh-install recommendation');
  assert.equal(config.document(config.configure(original,{...settings,mfgMode:'x3'},false)).neuralRendering.core.nrResolutionScale,67);
  const unsupported='{"configVersion":4,"neuralRendering":{"core":{"nrEnabled":true,"nrResolution":"future","nrResolutionScale":10,"nrPasses":9}}}';
  const disabled=config.document(config.configure(unsupported,{...config.read(unsupported),neuralMode:'off'},false));
  assert.equal(disabled.neuralRendering.core.nrEnabled,false);
  assert.equal(disabled.neuralRendering.core.nrResolution,'future');
  assert.equal(disabled.neuralRendering.core.nrResolutionScale,10);
  assert.equal(disabled.neuralRendering.core.nrPasses,9);
});
test('Encore added FG reads upstream game-mode X2 and omitted fixed X4 without changing the requested multiplier', () => {
  for (const [frameGeneration, expected] of [
    [{frameGenerationWithoutGameFg:true}, 'x2'],
    [{frameGenerationWithoutGameFg:true,mode:'game',multiplier:6}, 'x2'],
    [{frameGenerationWithoutGameFg:true,mode:'fixed'}, 'x4'],
    [{frameGenerationWithoutGameFg:true,mode:'fixed',multiplier:3}, 'x3'],
  ]) {
    const original = JSON.stringify({configVersion:4,frameGeneration});
    const settings = config.read(original);
    assert.equal(settings.mfgMode,expected);
    assert.doesNotThrow(()=>config.validate(settings));
    const edited = config.read(config.configure(original,{...settings,neuralMode:'latest_compatible'},false));
    assert.equal(edited.mfgMode,expected,'editing NR preserves the already-effective added FG multiplier');
  }
  for (const value of [
    {frameGeneration:{frameGenerationWithoutGameFg:true,mode:'dynamic'}},
    {frameGeneration:{frameGenerationWithoutGameFg:true,mode:'game'},renderingEngines:{frameGenerationEngine:'xefg'}},
    {frameGeneration:{frameGenerationWithoutGameFg:true,mode:'fixed',multiplier:0}},
  ]) assert.throws(()=>config.validate(config.read(JSON.stringify(value))),{code:'errEncoreConfig'});
});
test('Encore 2.4 per-pass placements preserve comments and omitted fields while old engines reject edits', () => {
  const original = '\uFEFF{\r\n // user menu state\r\n "configVersion":4,"neuralRendering":{"core":{"nrEnabled":true,"nrPasses":4,"nrPlacement":"present"}},"private":{"key":7}\r\n}\r\n';
  const unchanged = config.document(config.configure(original,config.read(original),true,'2.4.1'));
  for (const key of config.PASS_KEYS) assert.equal(Object.hasOwn(unchanged.neuralRendering.core,key),false,'absent defaults stay absent');
  assert.equal(Object.hasOwn(unchanged.dlssSuperResolution,'dlssRenderScale'),false);
  const settings = {...config.read(original),nrPass1Placement:'before-sr',nrPass2Placement:'after-sr',nrPass3Placement:'present'};
  assert.throws(()=>config.configure(original,settings,true,'2.3.0'),/2.4.0/);
  const text = config.configure(original,settings,true,'2.4.1'), value = config.document(text);
  assert.ok(text.startsWith('\uFEFF')); assert.ok(text.includes('// user menu state'));assert.ok(text.includes('\r\n'));
  assert.deepEqual({...value.private},{key:7});assert.equal(value.neuralRendering.core.nrPlacement,'present');
  assert.equal(value.neuralRendering.core.nrPass1Placement,'before-sr');assert.equal(value.neuralRendering.core.nrPass3Placement,'present');
  assert.equal(Object.hasOwn(value.neuralRendering.core,'nrPass4Placement'),false);
  assert.equal(config.configure(text,settings,true,'2.4.1'),text);
  assert.throws(()=>config.configure(original,{...settings,nrPass1Placement:'final'},true,'2.4.1'),/处理位置无效/);
  const future = '{"neuralRendering":{"core":{"nrPass1Placement":"future","nrPass2Placement":"present"}}}';
  const preserved = config.document(config.configure(future,{...config.read(future),mfgMode:'x3'},false,'2.3.0'));
  assert.equal(preserved.neuralRendering.core.nrPass1Placement,'future');assert.equal(preserved.neuralRendering.core.nrPass2Placement,'present');
  assert.throws(()=>config.configure(future,{...config.read(future),nrPass2Placement:'inherit'},false,'2.3.0'),/不支持修改/);
  assert.throws(()=>config.configure(future,{...config.read(future),neuralMode:'latest_compatible'},false,'2.3.0'),/处理位置/);
});
test('Encore SR custom-scale limits depend on the selected version and never conflate NR scale', () => {
  const original = '{"dlssSuperResolution":{"dlssRenderScale":"custom","dlssCustomScale":67},"neuralRendering":{"core":{"nrEnabled":true,"nrResolution":"custom","nrResolutionScale":33}}}';
  const settings = {...config.read(original),dlssCustomScale:33};
  assert.throws(()=>config.configure(original,settings,true,'2.3.0'),/50–100/);
  const value = config.document(config.configure(original,settings,true,'2.4.1'));
  assert.equal(value.dlssSuperResolution.dlssCustomScale,33);assert.equal(value.neuralRendering.core.nrResolutionScale,33);
  for (const dlssCustomScale of [32,101,NaN,33.5]) assert.throws(()=>config.configure(original,{...settings,dlssCustomScale},true,'2.4.1'),/33–100/);
  assert.throws(()=>config.configure('{}',{...config.DEFAULTS,dlssRenderScale:'custom',dlssCustomScale:50},false,'2.4.1'),/原生 DLSS/);
  const custom = '{"dlssSuperResolution":{"dlssRenderScale":"future","dlssCustomScale":12}}';
  const preserved = config.document(config.configure(custom,{...config.read(custom),mfgMode:'x3'},false,'2.3.0'));
  assert.equal(preserved.dlssSuperResolution.dlssRenderScale,'future');assert.equal(preserved.dlssSuperResolution.dlssCustomScale,12);
  // Earlier API clients omit both newly exposed fields entirely.
  const legacy = {...config.read(original)};delete legacy.dlssRenderScale;delete legacy.dlssCustomScale;
  for (const key of config.PASS_KEYS) delete legacy[key];
  assert.equal(config.document(config.configure(original,legacy,true)).dlssSuperResolution.dlssCustomScale,67);
  const dormant = '{"dlssSuperResolution":{"dlssRenderScale":"game","dlssCustomScale":33}}';
  assert.throws(()=>config.configure(dormant,{...config.read(dormant),dlssRenderScale:'custom'},true,'2.3.0'),/50–100/);
});
test('Encore uses its own pinned runtime group and does not change Wuthering Waves dependencies', () => {
  assert.deepEqual(requiredPacks({route:'encore',config:{mfgMode:'x3'}}),['encore','sl-modern','fg-modern']);
  assert.deepEqual(requiredPacks({route:'encore',config:{neuralMode:'latest_compatible',encore:{upscaling:'dlss'}}}),['encore','sl-modern','fg-modern','sr-modern','nr-3108']);
  assert.deepEqual(requiredPacks({route:'wuwa-proxy',config:{mfgMode:'x3'}}),['mfg-universal','mfg-license']);
  const pack = catalog.packs.find(p=>p.id==='encore');
  assert.equal(pack.repository,'SilyNoMeta/rtx-encore');assert.equal(pack.version,'2.4.1');
  assert.doesNotThrow(()=>new RuntimePayload(__dirname));
  for (const patch of [{url:'https://github.com/wrong/repo/releases/download/v2.3.0/RTX-Encore.zip'},
    {files:pack.files.map(f=>({...f,archivePath:'../outside.dll'}))}])
    assert.throws(()=>new RuntimePayload(__dirname,{manifest:{...catalog,packs:[{...pack,...patch}]}}));
});
