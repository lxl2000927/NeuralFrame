import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticChecks } from '../ui/src/diagnostics.ts';

test('missing diagnostics never produce a passing check', () => {
  const checks = diagnosticChecks({});
  assert.equal(checks.length, 7);
  assert.ok(checks.every(check => check.state === 'unknown'));
});
test('inactive collaboration and original files are not displayed as runtime success', () => {
  const checks = diagnosticChecks({coExecution:{bothActive:false,
    motionVectorCheck:{ok:true,message:'old optimistic label'},
    reflexCheck:{ok:true,hasReflexDll:false,message:'hardware supported'},
    backupCheck:{ok:true,hasManifest:false,message:'Original files'}}});
  assert.equal(checks[2].state, 'idle');
  assert.equal(checks[5].state, 'unknown');
  assert.equal(checks[6].state, 'idle');
});
test('missing mitigation, HDR advisory, full VRAM budget and damaged backup require attention', () => {
  const checks = diagnosticChecks({dllConflicts:[{message:'conflict'}],coExecution:{bothActive:true,
    motionVectorCheck:{ok:true,mitigationActive:false,message:''},
    hudFlickerCheck:{ok:true,hdrGameNeedsGuard:true,message:''},
    vramBudget:{usagePercent:96,vramTotalMB:8192},
    backupCheck:{ok:false,hasManifest:true,message:'missing backup'}}});
  for (const index of [0,2,3,4,6]) assert.equal(checks[index].state, 'warn');
});
test('zero or absent VRAM capacity cannot pass a budget check', () => {
  for (const vramBudget of [{usagePercent:0},{usagePercent:0,vramTotalMB:0}])
    assert.equal(diagnosticChecks({coExecution:{vramBudget}})[4].state,'unknown');
});

test('VRAM headroom is an estimate; the backend budget level determines warnings', () => {
  const check = level => diagnosticChecks({coExecution: {vramBudget: {vramTotalMB:8188, usagePercent:80, level}}})[4];
  assert.equal(check('safe').state, 'estimate');
  assert.equal(check('caution').state, 'warn');
});

test('standalone routes do not report a missing RenoDX setting as a failure or a passing HUD check', () => {
  const checks = diagnosticChecks({coExecution:{bothActive:true,
    motionVectorCheck:{ok:true,configurationSupported:false,mitigationActive:false,message:'Standalone motion input requires runtime verification'},
    hudFlickerCheck:{ok:true,configurationSupported:false,qualityGuardMode:'0',message:'Standalone route has no RenoDX QualityGuard'}}});
  assert.equal(checks[2].state,'unknown');
  assert.match(checks[2].message,/Standalone/);
  assert.equal(checks[3].state,'unknown');
  assert.match(checks[3].message,/no RenoDX/);
});
