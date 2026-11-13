'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mfg = require('../src/core/mfg-manager');
const {selectHardwareProfile} = require('../src/core/hardware-profile');
const {getIni} = require('../src/core/feeder-config');
const {writePe} = require('./fixtures/pe');
const payloadDir = require('./fixtures/payload').root;

test('RTX 50 desktop and laptop advertise native capability, never runtime success or unlocking', () => {
  for (const gpuName of ['NVIDIA GeForce RTX 5090 D', 'NVIDIA GeForce RTX 5070 Laptop GPU']) {
    for (const hardwareProfile of ['rtx40_laptop', 'rtx40_desktop', 'rtx50_desktop']) {
      const support = mfg.evaluateMfgGpuSupport(gpuName, '', hardwareProfile);
      assert.equal(support.nativeX3X4, true);
      assert.equal(support.unlockRequiredForX3X4, false);
      assert.deepEqual(support.supportedModes, ['off', 'x2', 'x3', 'x4']);
      assert.match(support.summary, /无需解锁/);
      assert.doesNotMatch(support.summary, /已启用|零.*冲突|已验证/);
      for (const mode of ['x2', 'x3', 'x4']) {
        assert.equal(support.modeBadges[mode].status, 'untested');
        assert.match(support.modeBadges[mode].badge, /原生支持.*需游戏验证/);
      }
    }
  }
  for (const gpuName of ['', 'NVIDIA GeForce RTX 4070']) {
    const support = mfg.evaluateMfgGpuSupport(gpuName, '', 'rtx50_desktop');
    assert.equal(support.nativeX3X4, false, 'a selected preset is not evidence of Blackwell hardware');
  }
});

test('RTX 50 hardware detection preserves existing or explicitly selected game profiles', () => {
  const gpu = {name:'NVIDIA GeForce RTX 5070 Laptop GPU'};
  assert.deepEqual(selectHardwareProfile({gpu}), {id:'rtx50_desktop', source:'blackwell-mobile'});
  assert.deepEqual(selectHardwareProfile({gpu, manifestProfile:'rtx40_laptop'}), {id:'rtx40_laptop', source:'manifest'});
  assert.deepEqual(selectHardwareProfile({gpu, requestedProfile:'rtx40_desktop'}), {id:'rtx40_desktop', source:'selected'});
});

test('Encore target validation accepts RTX suffix spellings without widening its game route', () => {
  const encore = require('../src/core/encore');
  const target = {path:path.resolve('fixture-game', 'Game.exe'), bitness:64, api:'dxgi', apiLabel:'DirectX 12', hasNativeFg:false};
  for (const gpu of ['NVIDIA GeForce RTX 5090D', 'NVIDIA GeForce RTX 5070Ti', 'NVIDIA GeForce RTX 4080Super', 'NVIDIA GeForce RTX 5090 Laptop GPU']) {
    assert.equal(encore.assertTarget(path.resolve('fixture-game'), {chosen:target}, target, gpu).path, target.path);
  }
  for (const gpu of ['', 'AMD Radeon RX 9070', 'NVIDIA GeForce RTX 50900', 'NVIDIA GeForce RTX 5090Invalid']) {
    assert.throws(() => encore.assertTarget(path.resolve('fixture-game'), {chosen:target}, target, gpu), /需要识别到/);
  }
  assert.throws(() => encore.assertTarget(path.resolve('fixture-game'), {chosen:target}, {...target, bitness:32}, 'RTX 5090D'), /64/);
});

test('RTX 20/30 community capability is limited to recognized standalone MFG versions', () => {
  const engines = require('../src/core/engine-packages');
  const known = engines.recommended('mfg-universal');
  for (const gpu of ['NVIDIA GeForce RTX 2070', 'NVIDIA GeForce RTX 3080']) {
    const supported = mfg.evaluateMfgGpuSupport(gpu, '', 'rtx50_desktop', known);
    assert.equal(supported.nativeX2, false);
    assert.equal(supported.nativeX3X4, false);
    assert.equal(supported.modeBadges.x2.status, 'experimental');
    assert.equal(supported.modeBadges.x4.status, 'experimental');
    for (const unknown of [null, {...known, verified:false}, {...known, compatible:false},
      {...known, version:'1.8.0'}, {...known, component:'encore'}]) {
      assert.equal(mfg.evaluateMfgGpuSupport(gpu, '', 'rtx50_desktop', unknown).modeBadges.x4.status, 'incompatible');
    }
  }
});

test('Wuthering Waves status scopes RTX 20/30 support to the actual recognized proxy bytes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-wuwa-legacy-gpu-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const exe = writePe(path.join(root, 'Client/Binaries/Win64/Client-Win64-Shipping.exe'), {text:'D3D12CreateDevice'});
  writePe(path.join(root, 'Wuthering Waves.exe'));
  const bin = path.dirname(exe), proxy = path.join(bin, 'version.dll');
  const control = path.join(bin, 'RTXMFG-Universal.json');
  fs.writeFileSync(control, JSON.stringify({mode:'fixed', multiplier:4, followGame:false}));
  const scanResult = {chosen:{path:exe, bitness:64, apiLabel:'DirectX 12'}, dlssFiles:[], streamlineFiles:[]};
  const inspect = (gpuName, scan = scanResult) => mfg.inspectGameMfgStatus(root, {gpuName, hardwareProfile:'rtx50_desktop', scanResult:scan});
  const assertPending = status => {
    assert.equal(status.status, 'untested');
    assert.equal(status.statusBadge, '独立方案待校验');
    assert.equal(status.gpuSupport.nativeX2, false);
    assert.equal(status.gpuSupport.nativeX3X4, false);
    assert.equal(status.gpuSupport.unlockRequiredForX3X4, false);
    assert.deepEqual(status.gpuSupport.supportedModes, ['off'], 'missing evidence does not grant supported modes');
    for (const mode of ['x2', 'x3', 'x4']) assert.equal(status.gpuSupport.modeBadges[mode].status, 'untested');
  };
  for (const gpuName of ['RTX 2070', 'RTX 3080']) assertPending(await inspect(gpuName));
  const source = require('../src/core/runtime-catalog.json').packs.find(p=>p.id==='mfg-universal')
    .files.find(f=>f.path.endsWith('/MFGUnlocker.dll')).path;
  for (const relative of [source, mfg.MFG_UNLOCKERS.asiPlugin.relPath]) {
    fs.copyFileSync(path.join(payloadDir, relative), proxy);
    for (const gpuName of ['NVIDIA GeForce RTX 2070', 'NVIDIA GeForce RTX 3080']) {
      const status = await mfg.inspectGameMfgStatus(root, {gpuName, hardwareProfile:'rtx50_desktop', scanResult});
      assert.equal(status.currentConfig.backend, 'wuwa-proxy');
      assert.equal(status.status, 'experimental');
      assert.equal(status.gpuSupport.nativeX3X4, false);
      assert.equal(status.gpuSupport.modeBadges.x2.status, 'experimental');
      assert.equal(status.runtimeVerification.verifiedActive, false);
      assert.equal(status.currentConfig.mode, 'x4');
    }
  }
  writePe(proxy, {text:'Unrecognized MFG loader', version:[1,7,1,0]});
  for (const gpuName of ['RTX 2070', 'RTX 3080']) assertPending(await inspect(gpuName));
  for (const chosen of [{...scanResult.chosen, apiLabel:'DirectX 11'}, {...scanResult.chosen, bitness:32}]) {
    const invalid = await inspect('RTX 3080', {...scanResult, chosen});
    assert.equal(invalid.status, 'incompatible', 'API/bitness errors take priority over missing engine evidence');
    assert.ok(invalid.conflicts.some(conflict=>conflict.severity==='error'));
  }
  writePe(path.join(bin, 'nvngx_dlssg.dll'), {text:'dlssg_to_fsr3'});
  for (const recognized of [false, true]) {
    if (recognized) fs.copyFileSync(path.join(payloadDir, source), proxy);
    const conflict = await inspect('RTX 3080');
    assert.equal(conflict.status, 'incompatible', 'a conflicting DLL takes priority for both unknown and recognized engines');
    assert.ok(conflict.conflicts.some(item=>item.code==='CONFLICT_FAKE_DLSSG'));
  }
  assert.equal(fs.readFileSync(control, 'utf8'), JSON.stringify({mode:'fixed', multiplier:4, followGame:false}));
});

for (const backend of ['renodx-mfgunlock', 'mfg-unlocker-asi']) {
  test(`${backend}: physical GPU controls Ada patches and preserves selected profile, runtime, multiplier and unrelated settings`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-rtx50-policy-'));
    t.after(() => fs.rmSync(root, {recursive:true, force:true}));
    writePe(path.join(root, 'Game.exe'), {text:'D3D12CreateDevice'});
    const reshadePath = path.join(root, 'ReShade.ini'), optiPath = path.join(root, 'OptiScaler.ini');
    fs.writeFileSync(reshadePath, '[RenoDX.DLSS5]\nNRResolutionScale=0.65\nNRStructureIntensity=0.73\n[Other]\nCustom=keep\n');
    fs.writeFileSync(optiPath, '[Other]\nCustom=keep\n');
    // Change GPUs/presets repeatedly to catch stale Ada flags on native hardware.
    const cases = [
      {gpuName:'NVIDIA GeForce RTX 4070', hardwareProfile:'rtx40_desktop', ada:true, native:false},
      {gpuName:'NVIDIA GeForce RTX 5090', hardwareProfile:'rtx40_laptop', ada:false, native:true},
      {gpuName:'NVIDIA GeForce RTX 5070 Laptop GPU', hardwareProfile:'rtx40_desktop', ada:false, native:true},
      {gpuName:'NVIDIA GeForce RTX 4070', hardwareProfile:'rtx50_desktop', ada:true, native:false},
      {gpuName:'', hardwareProfile:'rtx50_desktop', ada:false, native:false},
      {gpuName:'', hardwareProfile:'rtx40_desktop', ada:false, native:false},
    ];
    for (const config of cases) {
      const result = await mfg.applyMfgConfiguration(root, {...config, backend, mode:'x4',
        payloadDir, upgradeDlssg:false, runtimeStack:'baseline-310.9.1'});
      assert.equal(result.runtimeStack, 'baseline-310.9.1');
      assert.equal(result.hardwareProfile, config.hardwareProfile);
      assert.equal(result.multiplier, 4);
      if (config.native || !config.gpuName) assert.equal(result.status, 'untested');
      const manifest = require('../src/core/backend-manager').readManifest(root);
      assert.equal(manifest.hardwareProfile, config.hardwareProfile);
      assert.equal(manifest.mfg.runtimeStack, 'baseline-310.9.1');
      const reshade = fs.readFileSync(reshadePath, 'utf8');
      assert.equal(getIni(reshade, 'RenoDX.DLSS5', 'NRResolutionScale'), '0.65');
      assert.equal(getIni(reshade, 'RenoDX.DLSS5', 'NRStructureIntensity'), '0.73');
      assert.equal(getIni(reshade, 'Other', 'Custom'), 'keep');
      if (backend === 'renodx-mfgunlock') {
        assert.equal(getIni(reshade, 'RenoDX.MFGUnlock', 'TemporalFix'), config.ada ? '1' : '0');
        assert.equal(getIni(reshade, 'RenoDX.MFGUnlock', 'BlackwellFrameworkKernels'), config.ada ? '1' : '0');
        assert.equal(getIni(reshade, 'RenoDX.MFGUnlock', 'ForceMultiplier'), '4');
        assert.equal(getIni(reshade, 'RenoDX.MFGUnlock', 'DynamicMFG'), '1');
        if (!config.ada) for (const key of ['ForceFlipMeteringOff', 'ExperimentalAdaptiveQuality',
          'AdaptiveQualityV3StabilityMode', 'AdaptiveQualityV3InpaintMode', 'IntermediateScatterRetention', 'ValidatedWarpBlend']) {
          assert.equal(getIni(reshade, 'RenoDX.MFGUnlock', key), '0', key);
        }
      } else {
        const json = JSON.parse(fs.readFileSync(path.join(root, 'RTXMFG-Universal.json'), 'utf8'));
        assert.equal(json.blackwellNative, config.native);
        assert.equal(json.temporalFix, config.ada);
        assert.equal(json.multiplier, 4);
        const opti = fs.readFileSync(optiPath, 'utf8');
        assert.equal(getIni(opti, 'MfgUnlock', 'TemporalFix'), String(config.ada));
        assert.equal(getIni(opti, 'Other', 'Custom'), 'keep');
      }
    }
  });
}
