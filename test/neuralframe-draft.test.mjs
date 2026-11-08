import test from 'node:test';
import assert from 'node:assert/strict';
import {readDraft,applyPatch,changedFields,defaultStack,neuralChoice} from '../ui/src/domain.ts';
test('reselecting compatible rendering preserves the chosen model file', () => {
  const custom = { ...readDraft({ok:true}), neuralModelId:'custom-test' };
  assert.equal(neuralChoice(custom, 'latest_compatible').neuralModelId, 'custom-test');
  const legacy = { ...custom, ...neuralChoice(custom, 'legacy') };
  assert.equal(legacy.neuralModelId, '310.8.0-RTX40');
  assert.equal(neuralChoice(legacy, 'latest_compatible').neuralModelId, '310.8.SF-v2');
});
test('an empty runtime scan does not override the RTX 50 profile default', () => {
  assert.equal(readDraft({ok:true, hardwareProfile:'rtx50_desktop', neural:{
    runtimeStack:'baseline-310.9.1', runtimeVersion:null,
  }}).runtimeStack, 'oct2026-310.9.16');
});
test('reading an uninstalled game keeps both rendering features off',()=>{const d=readDraft({ok:true});assert.equal(d.neuralMode,'off');assert.equal(d.mfgMode,'off');assert.equal(changedFields(d,d).length,0)});
test('MFG applies the shared stack without submitting any neural rendering changes', () => {
  const base = readDraft({ok:true, hardwareProfile:'rtx50_desktop',
    configuredRuntimeStack:'baseline-310.9.1', neural:{configuredRuntimeStack:'oct2026-310.9.16'}});
  assert.equal(base.runtimeStack, 'baseline-310.9.1');
  const draft = {...base, mfgMode:'x3'};
  for (const scope of ['changed', 'mfg']) {
    const patch = applyPatch(base, draft, scope);
    assert.equal(patch.runtimeStack, 'baseline-310.9.1');
    assert.equal(patch.mfgMode, 'x3');
    assert.equal(patch.neuralMode, undefined);
    assert.equal(patch.neuralModelId, undefined);
  }
  const stackOnly = applyPatch(draft, {...draft, runtimeStack:'oct2026-310.9.16'});
  assert.equal(stackOnly.mfgMode, 'x3');
  assert.equal(stackOnly.neuralMode, undefined);
});
test('editing neural rendering does not replace the frame generation choice',()=>{const base=readDraft({ok:true,mfg:{currentConfig:{mode:'x4'}}});const patch=applyPatch(base,{...base,neuralMode:'latest_compatible'});assert.equal(patch.neuralMode,'latest_compatible');assert.equal(patch.mfgMode,undefined)});
test('unsupported plugin values are not silently written',()=>{const base=readDraft({ok:true});assert.throws(()=>applyPatch(base,{...base,mfgMode:'auto'}),/尚不支持/)});
test('changing hardware profile reapplies only enabled features',()=>{const base=readDraft({ok:true,mfg:{currentConfig:{mode:'x3'}}});const patch=applyPatch(base,{...base,hardwareProfile:'rtx50_desktop'});assert.equal(patch.mfgMode,'x3');assert.equal(patch.neuralMode,undefined)});
test('explicitly disabling a feature is represented in the patch',()=>{const base=readDraft({ok:true,neural:{mode:'latest_compatible'},mfg:{currentConfig:{mode:'x3'}}});const patch=applyPatch(base,{...base,neuralMode:'off'});assert.equal(patch.neuralMode,'off');assert.equal(patch.mfgMode,undefined)});
test('unchanged state cannot submit a file operation',()=>{const base=readDraft({ok:true});assert.throws(()=>applyPatch(base,base),/没有待应用/)});
test('explicit reapply preserves disabled features and does not turn them on',()=>{const base=readDraft({ok:true});assert.deepEqual(applyPatch(base,base,'both'),base)});
test('independent apply excludes pending changes to the other module',()=>{const base=readDraft({ok:true});const draft={...base,mfgMode:'x4',neuralMode:'latest_compatible'};const nr=applyPatch(base,draft,'neural'),mfg=applyPatch(base,draft,'mfg');assert.equal(nr.mfgMode,undefined);assert.equal(nr.neuralMode,draft.neuralMode);assert.equal(mfg.neuralMode,undefined);assert.equal(mfg.neuralModelId,undefined);assert.equal(mfg.mfgMode,'x4')});
test('RTX 50 uses the upstream runtime default while retaining an explicit configured stack',()=>{assert.equal(defaultStack('rtx50_desktop'),'oct2026-310.9.16');assert.equal(readDraft({ok:true,hardwareProfile:'rtx50_desktop'}).runtimeStack,'oct2026-310.9.16');assert.equal(readDraft({ok:true,hardwareProfile:'rtx50_desktop',neural:{configuredRuntimeStack:'baseline-310.9.1'}}).runtimeStack,'baseline-310.9.1')});
