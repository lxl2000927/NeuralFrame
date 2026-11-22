'use strict';
// #238: 2.2.1 shipped OptiScaler 0.1.1.5 and 2.2.2 shipped 0.2.0-patch1. No
// Man's Sky runs on the first and crashes on the second, and the only way back
// was to keep an old copy of the whole app. A game can name the older build
// now - but only from the list this app pins, so nothing unverified becomes
// installable and the guarantee #191 relies on is untouched.
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const opti = require('../src/core/optiscaler');

test('every pinned build carries a URL and a digest, exactly as the single one did', () => {
  assert.ok(opti.RELEASES.length >= 2, 'more than one to choose between');
  for (const release of opti.RELEASES) {
    assert.match(release.version, /^\d/, release.version);
    assert.match(release.url, /^https:\/\/github\.com\/.+\.zip$/, release.version);
    assert.match(release.sha256, /^[0-9a-f]{64}$/, release.version);
    // Its licence is either fetched beside the archive under a pinned digest,
    // or carried inside the archive the digest above already covers.
    if (release.licenseUrl) assert.match(release.licenseHash, /^[0-9a-f]{64}$/, release.version);
    else assert.ok(release.layout.gpl, release.version + ' must carry a licence of its own');
    // Every build says how its own package is laid out, because they are not
    // all the same project: one reaches the runtime through a forwarder DLL and
    // one opens it directly, and installing the wrong plan is silent.
    assert.ok(Array.isArray(release.layout.licenses) && release.layout.licenses.length >= 4, release.version);
    assert.match(release.layout.notes, /\.(txt|md)$/, release.version);
  }
  assert.equal(opti.RELEASE, opti.RELEASES[0], 'the first is the default');
});

test('a game names a build, and anything else falls back to the current one', () => {
  assert.equal(opti.releaseFor('0.1.1.5-dlssnr').version, '0.1.1.5-dlssnr');
  assert.equal(opti.releaseFor('0.2.0-patch1').version, '0.2.0-patch1');
  assert.equal(opti.releaseFor('0.8.92-presr').version, '0.8.92-presr');
  for (const junk of [undefined, null, '', 'nonsense', '../../etc/passwd', 42, {}]) {
    assert.equal(opti.releaseFor(junk).version, opti.RELEASE.version, String(junk));
  }
});

test('the two builds are kept apart on disk, so choosing one cannot corrupt the other', () => {
  const versions = opti.RELEASES.map((r) => r.version);
  assert.equal(new Set(versions).size, versions.length, 'distinct version names');
  const digests = opti.RELEASES.map((r) => r.sha256);
  assert.equal(new Set(digests).size, digests.length, 'and distinct archives');
});

test('each build is installed by its own plan, and the fork brings no forwarder', () => {
  const forwarded = opti.releaseFor('0.2.0-patch1');
  const presr = opti.releaseFor('0.8.92-presr');
  const plan = (release) => opti.copyPlan('ROOT', 'dxgi', release).map((item) => item.to);
  const forwardedPlan = plan(forwarded);
  const presrPlan = plan(presr);
  // The proxy name is the app's choice and does not move between builds.
  assert.equal(forwardedPlan[0], 'dxgi.dll');
  assert.equal(presrPlan[0], 'dxgi.dll');
  assert.ok(forwardedPlan.includes('nvngx.dll_dlssnr.dll'), 'the forwarded build carries its forwarder');
  assert.ok(!presrPlan.includes('nvngx.dll_dlssnr.dll'), 'the fork opens the runtime directly');
  // Whichever build supplied it, the GPL text lands under one name, and the
  // notes land under one name, so Restore and the folder both stay predictable.
  for (const list of [forwardedPlan, presrPlan]) {
    assert.ok(list.includes('OptiScaler/licenses/LICENSE.GPL-3.0.txt'));
    assert.ok(list.includes('OptiScaler/README-DLSSNR.txt'));
    for (const name of opti.LIBRARIES) assert.ok(list.includes('OptiScaler/' + name), name);
  }
  // Two licences the fork adds, one of them for the algorithm it squeezes the
  // periphery with.
  assert.ok(presrPlan.includes('OptiScaler/licenses/PeripheralWarp_LICENSE.txt'));
  assert.ok(presrPlan.includes('OptiScaler/licenses/FidelityFX_v1_LICENSE.md'));
  // Where each file comes from inside its own archive.
  const from = (release, to) => opti.copyPlan('ROOT', 'dxgi', release).find((item) => item.to === to).from;
  assert.match(from(forwarded, 'OptiScaler/README-DLSSNR.txt'), /READ ME - DLSS Neural Rendering\.txt$/);
  assert.match(from(presr, 'OptiScaler/README-DLSSNR.txt'), /INSTALL-DLSSNR\.md$/);
  assert.match(from(forwarded, 'OptiScaler/licenses/LICENSE.GPL-3.0.txt'), /OptiScaler-GPL-3\.0\.txt$/);
  assert.match(from(presr, 'OptiScaler/licenses/LICENSE.GPL-3.0.txt'), /LICENSE$/);
});

const {writeNr,writePe} = require('./fixtures/pe');
const scanGame = require('../src/core/scan').scanGame;
const payload = version => path.join(__dirname,'../vendor/runtime-tests/components/OptiScaler-' + version);
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nf-opti-proof-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
test('installed status matches the real build, forwarder, INI, and selected NR model', async t => {
  for (const version of ['0.2.0-patch1','0.8.92-presr']) {
    const game = scratch(t), local = name => path.join(game,name), dir = payload(version);
    const release = opti.releaseFor(version);
    writePe(local('Game.exe'),{text:'D3D12CreateDevice'});
    fs.copyFileSync(path.join(dir,'OptiScaler.dll'),local('dxgi.dll'));
    const forward = local('nvngx.dll_dlssnr.dll');
    if (release.layout.forwarder) fs.copyFileSync(path.join(dir,release.layout.forwarder),forward);
    const ini = local('OptiScaler.ini'), model = writeNr(local('nvngx_dlssnr.dll'));
    const cfg = on => fs.writeFileSync(ini,'[DlssNr]\nEnabled='+on+'\n[ProcessFilter]\nTargetProcessName=Game.exe\n');
    cfg('true');
    const mf = local('_DLSS5_Backup/manifest.json');
    fs.mkdirSync(path.dirname(mf));
    const receipt = v => fs.writeFileSync(mf,JSON.stringify({version:1,route:'optiscaler',game:{exe:'Game.exe',api:'dxgi'},
      added:[],replaced:[],optiscaler:{version:v,hook:'dxgi.dll',installed:true}}));
    const installed = async () => (await scanGame(game)).install.optiscaler.installed;
    for (const v of [version,undefined]) {receipt(v);assert.equal(await installed(),true);}
    receipt('0.99-future');assert.equal(await installed(),false);
    receipt(version);
    for (const bits of [64,32]) {
      writePe(model,{bitness:bits});
      assert.equal(await installed(),false,version+' unrelated runtime');
    }
    fs.unlinkSync(model);fs.mkdirSync(model);
    assert.equal(await installed(),false);
    fs.rmdirSync(model);
    for (const on of ['false','auto']) {cfg(on);assert.equal(await installed(),true,'disabled feature keeps its host');}
    fs.writeFileSync(ini,'[Upscalers]\nDx12Upscaler=auto\n');
    assert.equal(await installed(),true,'all three pinned hosts default a missing NR switch to off');
    cfg('true');writeNr(model);
    fs.writeFileSync(ini,'[unrelated]\nsetting=1');assert.equal(await installed(),false);
    fs.unlinkSync(ini);fs.mkdirSync(ini);assert.equal(await installed(),false);
    fs.rmdirSync(ini);cfg('true');
    fs.writeFileSync(forward,'unrelated');assert.equal(await installed(),false,'wrong or unexpected forwarder');
  }
});

test('an invalid existing NR model or source is rejected before creating a receipt or replacing player files', async t => {
  const root = scratch(t), gameDir = path.join(root,'game'), model = path.join(gameDir,'nvngx_dlssnr.dll');
  const exePath = writePe(path.join(gameDir,'Game.exe'),{text:'D3D12CreateDevice'});
  const pathToModel = writeNr(path.join(root,'source/nvngx_dlssnr.dll'));
  const options = {gameDir,exePath,api:'dxgi',optiRoot:payload(opti.RELEASE.version),source:{payload:[{name:'nvngx_dlssnr.dll',path:pathToModel}]}};
  for (const bits of [64,32]) {
    writePe(model,{bitness:bits});
    const before = fs.readFileSync(model);
    await assert.rejects(opti.install(options,()=>{}),{code:'errInvalidNeuralModel'});
    assert.deepEqual(fs.readFileSync(model),before);
    fs.unlinkSync(model);
  }
  fs.mkdirSync(model);
  await assert.rejects(opti.install(options,()=>{}),{code:'errInvalidNeuralModel'});
  fs.rmdirSync(model);
  writePe(pathToModel,{bitness:64});
  await assert.rejects(opti.install(options,()=>{}),{code:'errInvalidNeuralModel'});
  assert.deepEqual(fs.readdirSync(gameDir),['Game.exe']);
});
