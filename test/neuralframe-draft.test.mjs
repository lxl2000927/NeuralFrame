import test from 'node:test';
import assert from 'node:assert/strict';
import {readDraft,applyPatch,changedFields,defaultStack,neuralChoice,modelArchitectureLimit,libraryUpgrade} from '../ui/src/domain.ts';
test('update actions compare numeric releases within one available component and source', () => {
  const target = {component:'dlss-sr', repo:'RankFTW/rhi-repo', tag:'dlss-v3.7.20'};
  const pack = {component:target.component, source:target.repo, version:'dlss-3.7.10', present:true};
  assert.deepEqual(libraryUpgrade(target, [pack, {...pack, version:'dlss-3.7.2'}]), ['3.7.10','3.7.20']);
  for (const patch of [{source:'other'}, {present:false}, {component:'dlss-fg'}, {version:'other-3.7.10'}, {version:'dlss-3.7.9-beta'}])
    assert.equal(libraryUpgrade(target, [{...pack, ...patch}]), undefined);
  assert.equal(libraryUpgrade(target, [pack, {...pack, version:'dlss-3.8.0'}]), undefined);
  assert.equal(libraryUpgrade({...target, component:'dlss-nr'}, [{...pack, component:'dlss-nr'}]), undefined);
});
test('model availability distinguishes the detected GPU from a previewed profile', () => {
  const blackwell = {architectures:['120']};
  assert.equal(modelArchitectureLimit(blackwell, '89', '120'), '本机显卡不支持');
  assert.equal(modelArchitectureLimit(blackwell, '120', '89'), '');
  assert.equal(modelArchitectureLimit(blackwell, null, '89'), '当前档位不支持');
  assert.equal(modelArchitectureLimit(blackwell), '');
  assert.equal(modelArchitectureLimit({}, '89'), '');
});
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

test('standalone recommends dynamic control without relabeling explicit fixed or external selections', () => {
  const base = readDraft({ ok:true, launcherProtected:true });
  assert.equal(applyPatch(base, base, 'enableBoth', true).mfgMode, 'dynamic');
  assert.equal(applyPatch(base, {...base,mfgMode:'x4'}, 'enableBoth', true).mfgMode, 'x4');
  for (const mode of ['dynamic','follow','x5','x6']) {
    const draft = readDraft({ok:true,launcherProtected:true,mfg:{currentConfig:{mode}}});
    assert.equal(draft.mfgMode,mode);
    assert.equal(applyPatch(base,draft,'mfg',true).mfgMode,mode);
    assert.throws(()=>applyPatch(base,draft,'mfg'), /不支持/);
  }
});
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
test('one-click uses the compatible model for the detected GPU and keeps existing 4×', () => {
  const status = { ok: true, launcherProtected: true, neural: { mode: 'off', currentModel: {id: 'sm120-only'},
    gpuCompatibility: {status: 'incompatible', compatible: false}, latestCompatibleModel: {id: 'cached-sm89'} },
    mfg: {currentConfig: {mode: 'x4'}} };
  const base = readDraft(status);
  const patch = applyPatch(base, base, 'enableBoth');
  assert.equal(patch.neuralMode, 'latest_compatible');
  assert.equal(patch.neuralModelId, 'cached-sm89');
  assert.equal(patch.mfgMode, 'x4');
  assert.equal(applyPatch(base, {...base, neuralModelId:'user-model', mfgMode:'off'}, 'enableBoth').neuralModelId, 'user-model');
  const off = readDraft({ok:true, launcherProtected:true});
  assert.equal(applyPatch(off, off, 'enableBoth').mfgMode, 'x2');
  assert.equal(applyPatch(off, off, 'neural').neuralMode, 'off');
});
test('independent apply excludes pending changes to the other module',()=>{const base=readDraft({ok:true});const draft={...base,mfgMode:'x4',neuralMode:'latest_compatible'};const nr=applyPatch(base,draft,'neural'),mfg=applyPatch(base,draft,'mfg');assert.equal(nr.mfgMode,undefined);assert.equal(nr.neuralMode,draft.neuralMode);assert.equal(mfg.neuralMode,undefined);assert.equal(mfg.neuralModelId,undefined);assert.equal(mfg.mfgMode,'x4')});
test('RTX 50 uses the upstream runtime default while retaining an explicit configured stack',()=>{assert.equal(defaultStack('rtx50_desktop'),'oct2026-310.9.16');assert.equal(readDraft({ok:true,hardwareProfile:'rtx50_desktop'}).runtimeStack,'oct2026-310.9.16');assert.equal(readDraft({ok:true,hardwareProfile:'rtx50_desktop',neural:{configuredRuntimeStack:'baseline-310.9.1'}}).runtimeStack,'baseline-310.9.1')});
