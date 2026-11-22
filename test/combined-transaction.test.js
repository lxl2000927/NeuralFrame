'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { writePe } = require('./fixtures/pe');
const combined = require('../src/core/combined-manager');
const apply = require('../src/core/apply');
const mfg = require('../src/core/mfg-manager');
const journal = require('../src/core/file-journal');
const previewFs = require('../src/core/preview-fs');
const vulkan = require('../src/core/vulkan-layer');
const payload = require('./fixtures/payload').root;
test.beforeEach(t => require('./fixtures/payload').use(t));
const config = { apiOverride: 'd3d12', hardwareProfile: 'rtx40_laptop', neuralMode: 'latest_compatible', mfgMode: 'x3' };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t, nativeFg = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-combined-tx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'Game'), profile = path.join(root, 'Profile');
  fs.mkdirSync(game);
  const exe = writePe(path.join(game, 'Game.exe'), { bitness: 64, text: 'D3D12CreateDevice', size: 131072 });
  const original = writePe(path.join(game, 'nvngx_dlss.dll'), { bitness: 64, version: [2, 3, 0, 0] });
  const before = hash(original);
  const fgFile=path.join(game,'nvngx_dlssg.dll');
  if (nativeFg) fs.copyFileSync(path.join(payload,'enhanced/streamline-2.14.16/nvngx_dlssg.dll'),fgFile);
  const originalFiles=fs.readdirSync(game).sort(),fgHash=nativeFg && hash(fgFile);
  function assertRestored() {
    assert.deepEqual(fs.readdirSync(game).filter(name => name !== '_DLSS5_Backup').sort(),originalFiles);
    assert.equal(hash(original), before);
    if (nativeFg) assert.equal(hash(fgFile),fgHash);
    assert.ok(!fs.existsSync(path.join(game, '_DLSS5_Backup/manifest.json')));
    assert.ok(!fs.existsSync(journal.pendingPath(game)));
    const backups = apply.backupRoot(game);
    if (fs.existsSync(backups)) {
      assert.equal(fs.readdirSync(backups, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length, 0);
    }
  }
  return { root, game, profile, exe, assertRestored };
}

test('an MFG failure after NR deployment restores the entire combined operation', async t => {
  const f = fixture(t,true);
  t.mock.method(mfg, 'applyMfgConfiguration', async () => {
    assert.ok(fs.existsSync(path.join(f.game, 'nvngx_dlssnr.dll')));
    assert.ok(fs.existsSync(path.join(f.game, 'renodx-dlss5.addon64')));
    throw Object.assign(new Error('MFG file locked'), { code: 'EBUSY' });
  });
  await assert.rejects(combined.applyCombinedConfiguration(f.game, {
    ...config, payloadDir: payload, userDataDir: f.profile
  }), { code: 'EBUSY' });
  f.assertRestored();
});

test('MFG repairs only active Streamline replacements and preserves game updates and archived backups', async t => {
  const f = fixture(t,true);
  const active = apply.beginManifest(f.game,f.exe,'dxgi');
  const version = (name,v) => writePe(path.join(f.game,name),{version:v});
  const tracked = version('sl.common.dll','2.14.16.0');
  const updated = version('sl.interposer.dll','2.15.0.0');
  const unrelated = version('sl.reflex.dll','2.15.0.0');
  for (const rel of ['sl.common.dll','sl.interposer.dll']) {
    active.replaced.push({rel,oldVersion:'2.13.0.0',newVersion:'2.14.16.0'});
    writePe(apply.originalPath(f.game,active,rel),{version:'2.13.0.0'});
  }
  writePe(path.join(apply.backupRoot(f.game),'originals','previous','sl.reflex.dll'),{version:'2.10.0.0'});
  await apply.saveActiveManifest(f.game,active);
  await mfg.applyMfgConfiguration(f.game,{exePath:f.exe,mode:'x2',gpuName:'NVIDIA GeForce RTX 4070',
    hardwareProfile:'rtx40_laptop',payloadDir:payload,userDataDir:f.profile});
  const pe = require('../src/core/pe');
  assert.equal(pe.getFileVersion(tracked),'2.13.0.0');
  assert.equal(pe.getFileVersion(updated),'2.15.0.0');
  assert.equal(pe.getFileVersion(unrelated),'2.15.0.0');
});

for (const route of ['optiscaler','renodx']) {
  test('changing the NR model retains the existing ' + route + ' renderer on a game without DLSS', async t => {
    const f = fixture(t), ini = require('../src/core/feeder-config');
    fs.unlinkSync(path.join(f.game,'nvngx_dlss.dll'));
    writePe(path.join(f.game,'libxess.dll'));
    const manifest = apply.beginManifest(f.game,f.exe,'dxgi');
    manifest.route = route;
    if (route === 'optiscaler') manifest.optiscaler = {version:'0.2.0-patch1',hook:'dxgi.dll'};
    await apply.saveActiveManifest(f.game,manifest);
    const original = '[Other]\nSaved=1\n[DlssNr]\nEnabled=false\n';
    const opti = path.join(f.game,'OptiScaler.ini');
    const reshade = path.join(f.game,'ReShade.ini');
    const multi = path.join(f.game,'renodx-dlss.addon64');
    const pairedMulti = path.join(payload,'feeder','host64','renodx-dlss.addon64');
    if (route === 'optiscaler') {
      const pkg = path.resolve(__dirname,'../vendor/runtime-tests/components/OptiScaler-0.2.0-patch1');
      const options = {exePath:f.exe,apiOverride:'d3d12',neuralMode:'latest_compatible',
        payloadDir:payload,userDataDir:f.root,requirePayload:()=>assert.fail('invalid host requested payload')};
      const direct = () => require('../src/core/neural-models').applyNeuralModelSelection(f.game,{...options,mode:'latest_compatible'});
      fs.writeFileSync(opti,original);
      await assert.rejects(combined.applyCombinedConfiguration(f.game,options),{code:'errOptiPayload'});
      await assert.rejects(direct(),{code:'errOptiPayload'});
      fs.copyFileSync(path.join(pkg,'OptiScaler.dll'),path.join(f.game,'dxgi.dll'));
      await assert.rejects(direct(),{code:'errOptiPayload'});
      fs.copyFileSync(path.join(pkg,'nvngx.dll_dlssnr.dll'),path.join(f.game,'nvngx.dll_dlssnr.dll'));
      await assert.rejects(direct(),{code:'errOptiNeedsDlss'});
      fs.copyFileSync(path.join(pkg,'OptiScaler/libxess.dll'),path.join(f.game,'libxess.dll'));
      for (const [settings,code] of [['[Inputs]\nEnableXeSSInputs=false','errOptiNeedsDlss'],
        ['[ProcessFilter]\nTargetProcessName=Other.exe','errOptiPayload']]) {
        fs.writeFileSync(opti,original+settings);
        await assert.rejects(combined.applyCombinedConfiguration(f.game,options),{code});
      }
      fs.writeFileSync(opti,original);
      await assert.rejects(combined.applyCombinedConfiguration(f.game,{...options,apiOverride:'vulkan'}),{code:'errOptiPayload'});
      assert.equal(fs.existsSync(path.join(f.game,'nvngx_dlssnr.dll')),false);
    } else {
      fs.writeFileSync(reshade,'[RenoDX DLSS]\nNRPasses=4\n');
      fs.copyFileSync(pairedMulti,multi);
    }
    const modes = route === 'optiscaler' ? ['latest_compatible','latest_compatible','off','latest_compatible']
      : ['latest_compatible','off','latest_compatible'];
    for (const [step,mode] of modes.entries()) {
      const result = await combined.applyCombinedConfiguration(f.game,{exePath:f.exe,neuralMode:mode,apiOverride:'d3d12',
        payloadDir:payload,userDataDir:f.profile,requirePayload:async request => {
          if (mode !== 'off') assert.equal(request.route,route);
        }});
      assert.equal(result.feederDeployed,false);
      assert.equal(require('../src/core/backend-manager').readManifest(f.game).route,route);
      assert.equal(fs.existsSync(path.join(f.game,'dlss5-feed.addon64')),false);
      assert.equal(fs.existsSync(path.join(f.game,'renodx-dlss5.addon64')),false);
      if (route === 'optiscaler') {
        assert.equal(fs.existsSync(reshade),false);
        assert.equal(fs.existsSync(path.join(f.game,'nvngx_dlss.dll')),false);
        assert.equal(ini.getIni(fs.readFileSync(opti,'utf8'),'DlssNr','Enabled'),String(mode !== 'off'));
        const nr = path.join(f.game,'nvngx_dlssnr.dll');
        if (step === 0) fs.writeFileSync(nr,'damaged managed model');
        if (step === 1) assert.equal(hash(nr),hash(path.join(payload,'streamline/nvngx_dlssnr.dll')));
      } else {
        assert.equal(fs.existsSync(multi),mode !== 'off');
        if (mode !== 'off') assert.equal(hash(multi),hash(pairedMulti));
        assert.equal(ini.getIni(fs.readFileSync(reshade,'utf8'),'RenoDX DLSS','NRPasses'),'4');
      }
    }
    await apply.restore(f.game);
    if (route === 'optiscaler') assert.equal(fs.readFileSync(opti,'utf8'),original);
    else assert.equal(hash(multi),hash(pairedMulti));
  });
}

test('the retained OptiScaler NR host uses the selected DX11 or Vulkan input and bridge', async t => {
  const pkg = path.resolve(__dirname,'../vendor/runtime-tests/components/OptiScaler-0.8.92-presr');
  for (const [override,api,hook,provider,bridge] of [
    ['d3d11','dxgi','dxgi.dll','libxess_dx11.dll','Dx11Upscaler'],
    ['vulkan','vulkan','winmm.dll','libxess.dll','VulkanUpscaler']
  ]) {
    const f = fixture(t), dest = name => path.join(f.game,name);
    fs.unlinkSync(dest('nvngx_dlss.dll'));
    fs.copyFileSync(path.join(pkg,'OptiScaler.dll'),dest(hook));
    fs.copyFileSync(path.join(pkg,'OptiScaler',provider),dest(provider));
    const manifest = apply.beginManifest(f.game,f.exe,api);
    manifest.route = 'optiscaler';
    manifest.optiscaler = {version:'0.8.92-presr',hook};
    await apply.saveActiveManifest(f.game,manifest);
    const config = mode => fs.writeFileSync(dest('OptiScaler.ini'),'[DlssNr]\nEnabled=false\n[Upscalers]\n'+bridge+'='+mode+'\n');
    config('ffx_12');
    const scan = require('../src/core/game-api').withGameApi(await require('../src/core/scan').scanGame(f.game,f.exe),override);
    const check = () => require('../src/core/optiscaler').assertNeuralTarget(scan,manifest);
    assert.doesNotThrow(check,override);
    if (api === 'vulkan') {
      config('dlss');
      assert.doesNotThrow(check,'the pinned pre-SR build also supports native Vulkan');
    }
    config(api === 'vulkan' ? 'unknown_12' : 'dlss');
    assert.throws(check,{code:'errOptiPayload'});
  }
});

test('enhanced NR keeps user tuning and the Feeder hook when an unrelated Streamline plugin is present', async t => {
  const f = fixture(t), ini = require('../src/core/feeder-config');
  fs.unlinkSync(path.join(f.game,'nvngx_dlss.dll'));
  writePe(path.join(f.game,'sl.reflex.dll'),{version:'2.13.0.0'});
  const file = path.join(f.game,'ReShade.ini');
  const original = '[RenoDX.DLSS5]\nNRResolutionScale=0.64\nNRMaxWorksets=3\nNRFollowInputRes=1\nNRHookPoint=2\n';
  fs.writeFileSync(file,original);
  require('./fixtures/payload').seedRuntimeComponents(f.profile);
  const result = await combined.applyCombinedConfiguration(f.game,{...config,mfgMode:undefined,payloadDir:payload,userDataDir:f.profile});
  assert.equal(result.feederDeployed,true);
  const text = fs.readFileSync(file,'utf8');
  for (const [key,value] of [['EnableHooks','2'],['NRResolutionScale','0.64'],['NRMaxWorksets','3'],['NRFollowInputRes','1'],['NRHookPoint','2']])
    assert.equal(ini.getIni(text,'RenoDX.DLSS5',key),value,key);
  await apply.restore(f.game);
  assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('confirmed enhanced IPC rolls back NR and MFG if a selected component fails its final verification', async t => {
  const f = fixture(t,true), handlers = new Map();
  const main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main);
  const electron = { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => f.profile },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
  const sr = path.join(payload, 'streamline/nvngx_dlss.dll');
  const component = { id: 'test-sr', component: 'dlss-sr', files: [{ rel: 'nvngx_dlss.dll', sha256: hash(sr), bitness: 64 }] };
  let checks = 0;
  const library = {
    profile: () => ({ selected: { 'dlss-sr': component.id } }),
    package: () => component, directory: () => path.dirname(sr), compatibility: () => ({ ready: true }),
    verify: async () => {
      if (!previewFs.active() && ++checks === 2) {
        assert.ok(fs.existsSync(path.join(f.game, 'renodx-dlss5.addon64')));
        assert.ok(fs.existsSync(path.join(f.game, 'renodx-mfgunlock.addon64')));
        throw Object.assign(new Error('selected file changed'), { code: 'EBUSY' });
      }
    }
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : realRequire(name),
    __dirname: path.dirname(main), process: require('./fixtures/offline-process')(), Buffer, console, library
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  vm.runInContext('unifiedComponents = library', context);
  const run = token => handlers.get('enhanced-apply')({ sender: { send() {} } }, f.game, config, token);
  const plan = await run();
  assert.ok(plan.preview?.token, JSON.stringify(plan));
  f.assertRestored();
  assert.equal((await run(plan.preview.token)).code, 'EBUSY');
  f.assertRestored();
  assert.equal(handlers.get('history')().rows.length, 0);
});

test('standalone native NR ignores a D3D9 ReShade host in a DX12 game and restores only its own proxy',async t=>{
  const f=fixture(t),dxgi=path.join(f.game,'dxgi.dll'),dx9=path.join(f.game,'d3d9.dll');
  fs.copyFileSync(path.join(payload,'reshade-vulkan','ReShade64.dll'),dx9);
  fs.writeFileSync(dxgi,'original DXGI wrapper');
  const dx12=path.join(f.game,'d3d12.dll');
  const original=hash(dx9);
  const options={...config,mfgMode:undefined,exePath:f.exe,payloadDir:payload,userDataDir:f.profile};
  const before=await combined.inspectCombinedStatus(f.game,options);
  assert.equal(before.diagnostics.coExecution.dlssCompat.hook,'d3d12.dll');
  assert.equal(before.diagnostics.coExecution.dlssCompat.avoidedConflict,'dxgi.dll');
  const run=()=>combined.applyCombinedConfiguration(f.game,options);
  const plan=await previewFs.simulate(run);
  assert.ok(plan.state.touched.has(dx12.toLowerCase()));
  assert.equal(fs.existsSync(dx12),false);
  assert.ok((await run()).ok);assert.equal(hash(dx12),original);
  assert.ok(fs.existsSync(path.join(f.game,'renodx-dlss5.addon64')));
  await apply.restore(f.game);
  assert.equal(fs.existsSync(dx12),false);assert.equal(hash(dx9),original);
  assert.equal(fs.readFileSync(dxgi,'utf8'),'original DXGI wrapper');
});

for (const [name, mfgMode] of [['NR alone', undefined], ['NR and MFG', 'x3']]) {
  test('Vulkan ' + name + ' preserves the pre-existing ReShade DXGI for full restore', async t => {
    const f = fixture(t,!!mfgMode), dxgi = path.join(f.game, 'dxgi.dll');
    fs.copyFileSync(path.join(payload, 'reshade-vulkan', 'ReShade64.dll'), dxgi);
    const original = hash(dxgi);
    t.mock.method(vulkan, 'register', async () => ({ owned: false, global: true }));
    const result = await combined.applyCombinedConfiguration(f.game, {
      ...config, apiOverride: 'vulkan', mfgMode, payloadDir: payload, userDataDir: f.profile
    });
    assert.equal(result.ok, true);
    assert.ok(!fs.existsSync(dxgi));
    const manifest = require('../src/core/backend-manager').readManifest(f.game);
    assert.ok(manifest.replaced.some(item => item.rel === 'dxgi.dll'));
    assert.equal(hash(apply.originalPath(f.game, manifest, 'dxgi.dll')), original);
    await apply.restore(f.game);
    assert.equal(hash(dxgi), original);
  });
}

test('Vulkan failure keeps the managed DXGI record and a successful retry retires only the old file', async t => {
  const f = fixture(t,true), dxgi = path.join(f.game, 'dxgi.dll');
  fs.copyFileSync(path.join(payload, 'reshade-vulkan', 'ReShade64.dll'), dxgi);
  const original = hash(dxgi), manifest = apply.beginManifest(f.game, f.exe, 'dxgi');
  manifest.added = ['dxgi.dll'];
  manifest.reshade = { file: 'dxgi.dll', installedByUs: true, filesAdded: ['dxgi.dll'] };
  await apply.saveActiveManifest(f.game, manifest);
  t.mock.method(vulkan, 'register', async () => ({ owned: false, global: true }));
  const run = () => combined.applyCombinedConfiguration(f.game, {
    ...config, apiOverride: 'vulkan', payloadDir: payload, userDataDir: f.profile
  });
  const unlink = fs.promises.unlink;
  const lock = t.mock.method(fs.promises, 'unlink', async file => {
    if (file === dxgi) throw Object.assign(new Error('locked DXGI'), { code: 'EBUSY' });
    return unlink(file);
  });
  await assert.rejects(run(), { code: 'EBUSY' });
  assert.equal(hash(dxgi), original);
  assert.deepEqual(require('../src/core/backend-manager').readManifest(f.game), manifest);
  lock.mock.restore();
  await run();
  const deployed = require('../src/core/backend-manager').readManifest(f.game);
  assert.ok(!deployed.added.includes('dxgi.dll'));
  assert.ok(!deployed.replaced.some(item => item.rel === 'dxgi.dll'));
  fs.writeFileSync(dxgi, 'user replacement after install');
  await apply.restore(f.game);
  assert.equal(fs.readFileSync(dxgi, 'utf8'), 'user replacement after install');
});

test('nested steps share the owner while unrelated transactions and recovery are rejected', async t => {
  const f = fixture(t), value = path.join(f.game, 'tuning.ini');
  fs.writeFileSync(value, 'original');
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const operation = journal.group(f.game, async () => {
    for (const text of ['stage A', 'stage B']) {
      await journal.transaction(f.game, async () => {
        await journal.capture(f.game, value);
        fs.writeFileSync(value, text);
      });
    }
    entered();
    await resume;
    return { ok: false, code: 'cancelled' };
  });
  await waiting;
  try {
    assert.equal(fs.readFileSync(value, 'utf8'), 'stage B');
    assert.equal(journal.hasPendingRecovery(f.game), true);
    await assert.rejects(journal.transaction(f.game, () => {}), { code: 'errJobBusy' });
    await assert.rejects(journal.capture(f.game, value), { code: 'errJobBusy' });
    await assert.rejects(journal.recover(f.game), { code: 'errJobBusy' });
  } finally { release(); }
  assert.equal((await operation).ok, false);
  assert.equal(fs.readFileSync(value, 'utf8'), 'original');
  assert.ok(!fs.existsSync(journal.pendingPath(f.game)));
});

test('shared Vulkan registration runs after local stages and retains its cleanup manifest on registry failure', async t => {
  const f = fixture(t), source = path.join(f.root, 'source'), shared = path.join(f.profile, 'reshade-vulkan');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'ReShade64.dll'), 'sample');
  fs.writeFileSync(path.join(source, 'ReShade64.json'), '{"layer":{}}');
  let registrations = 0;
  const runner = async (_file, args) => {
    if (args[0] === 'add') registrations++;
    return { code: 1, stdout: '', stderr: '' };
  };
  const deploy = failLocal => journal.transaction(f.game, async () => {
    const manifest = apply.beginManifest(f.game, f.exe, 'vulkan');
    manifest.vulkanLayer = await vulkan.register({ sourceDir: source, targetDir: shared, gameDir: f.game, runner });
    await apply.saveActiveManifest(f.game, manifest);
    assert.equal(registrations, 0);
    if (failLocal) throw new Error('MFG stage failed');
  });
  await assert.rejects(deploy(true), /MFG stage failed/);
  assert.equal(registrations, 0);
  assert.ok(!fs.existsSync(shared));
  f.assertRestored();
  await assert.rejects(deploy(false), { code: 'errBackendRecovery' });
  assert.equal(registrations, 1);
  assert.equal(JSON.parse(fs.readFileSync(journal.pendingPath(f.game))).phase, 'external-commit');
  assert.equal(await journal.recover(f.game), true);
  assert.equal(require('../src/core/backend-manager').readManifest(f.game).vulkanLayer.dir, shared);
});
