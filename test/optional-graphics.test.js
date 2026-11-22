'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { writePe, writeNr } = require('./fixtures/pe');
const payload = require('./fixtures/payload');
const { scanGame } = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const backends = require('../src/core/backend-manager');
const graphics = require('../src/core/optional-graphics');
const ini = require('../src/core/feeder-config');
const { ComponentReview } = require('../src/core/component-review');

function fixture(t, relative = 'game.exe', name = 'Game') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-graphics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = path.join(root, name),
    exePath = writePe(path.join(gameDir, relative), { text: 'D3D12CreateDevice' });
  const userDataDir = path.join(root, 'profile');
  const options = {
    gameDir,
    exePath,
    api: 'dxgi',
    apiLabel: 'DirectX 12',
    bitness: 64,
    payloadDir: payload.root,
    userDataDir,
    target: { hasNativeDlssFg: true },
    gpuName: 'NVIDIA GeForce RTX 3070',
    antiCheatAcknowledged: true,
  };
  return { root, gameDir, exePath, options, reviews: new ComponentReview(userDataDir) };
}
test('PBZ layout selects the renderer in all three import combinations and keeps historical launcher restore', async (t) => {
  for (const [launcher, renderer] of [
    ['D3D12CreateDevice', 'D3D12CreateDevice'],
    ['', 'D3D12CreateDevice'],
    ['D3D12CreateDevice', ''],
  ]) {
    const f = fixture(t, 'platform/steam/PBZ.exe', 'PBZ');
    fs.mkdirSync(path.join(f.gameDir, 'Engine'));
    const shallow = writePe(path.join(f.gameDir, 'steam/PBZ.exe'), { text: launcher });
    writePe(f.exePath, { text: renderer });
    const oldFile = path.join(path.dirname(shallow), 'old-addon.dll');
    fs.writeFileSync(oldFile, 'managed');
    const old = require('../src/core/apply').beginManifest(f.gameDir, shallow, 'dxgi');
    old.added.push(path.relative(f.gameDir, oldFile));
    await require('../src/core/apply').saveActiveManifest(f.gameDir, old);
    const scan = await scanGame(f.gameDir, shallow);
    assert.equal(scan.chosen.path, f.exePath);
    assert.ok(!scan.exeCandidates.some((target) => target.path === shallow));
    assert.equal(await backends.restore(f.gameDir), true);
    assert.ok(!fs.existsSync(oldFile));
    assert.ok(fs.existsSync(shallow));
  }
});
test('optional frame generation checks native DLSS-G separately from FSR and ignores private providers', async (t) => {
  const f = fixture(t);
  writePe(path.join(f.gameDir, 'libxess_fg.dll'));
  writePe(path.join(f.gameDir, 'OptiScaler/custom/Apex Neural Rendering FG/dlssg/nvngx_dlssg.dll'));
  const scan = await scanGame(f.gameDir);
  assert.equal(scan.chosen.hasNativeDlssFg, false);
  assert.ok(!routes.componentRoutesFor(scan.chosen).includes('anr'));
  assert.ok(!routes.componentRoutesFor(scan.chosen).includes('hud'));
  assert.ok(routes.supportsPerformanceMonitor(scan.chosen));
  assert.equal(routes.supportsPerformanceMonitor({...scan.chosen, launcherProtected:true}), false);
  writePe(path.join(f.gameDir, 'sl.dlss_g.dll'));
  assert.ok(routes.componentRoutesFor((await scanGame(f.gameDir)).chosen).includes('anr'));
});
test('ANR on Radeon keeps frame generation independent from the NVIDIA neural model', async t => {
  const f = fixture(t);
  writePe(path.join(f.gameDir,'sl.dlss_g.dll'));
  const options = {...f.options, route:'anr', gpuName:'AMD Radeon RX 7800 XT',
    target:(await scanGame(f.gameDir)).chosen};
  assert.equal(options.target.hasNativeDlss,false);
  graphics.validateTarget(options);
  assert.throws(() => graphics.validateTarget({...options,graphics:{neural:true}}),/原生 DLSS 超分/);
  for (const name of ['AMD Radeon RX 480', 'Radeon (TM) RX 580', 'Radeon RX 640', 'Radeon RX Vega 64',
    'AMD Radeon R9 390', 'AMD Radeon HD 7970', 'AMD Radeon VII', 'AMD Radeon(TM) Vega 8 Graphics', 'Radeon Pro Vega 56'])
    assert.throws(() => graphics.validateTarget({...options, gpuName:name}), /Radeon/);
  for (const name of ['Intel(R) UHD Graphics 630', 'Intel(R) HD Graphics 530', 'Intel® Iris® Xe Graphics',
    'Intel Iris Plus Graphics 655','Intel(R) Iris(R) Xe MAX Graphics'])
    assert.throws(() => graphics.validateTarget({...options, gpuName:name}), /Intel/);
  for (const name of ['Radeon RX 5500 XT', 'AMD Radeon RX 6400', 'AMD Radeon RX 6600', 'AMD Radeon RX 9070 XT',
    'AMD Custom GPU 0405', 'Intel(R) Arc(TM) A770 Graphics', 'Intel Arc B580 Graphics', 'Intel Graphics', ''])
    graphics.validateTarget({...options, gpuName:name});
  const combined = require('../src/core/combined-manager');
  let prepared = false;
  await assert.rejects(combined.applyCombinedConfiguration(f.gameDir,{
    exePath:f.exePath, route:'anr', graphics:{neural:true}, payloadDir:payload.root, userDataDir:f.options.userDataDir,
    requirePayload:async () => { prepared = true; },
  }), /原生 DLSS 超分/);
  assert.equal(prepared,false);
  writePe(path.join(f.gameDir,'nvngx_dlss.dll'),{version:[3,7,0,0]});
  options.target = (await scanGame(f.gameDir)).chosen;
  for (const gpuName of [options.gpuName,'']) {
    assert.throws(() => graphics.validateTarget({...options,gpuName,graphics:{neural:true}}),/CUDA/);
    graphics.validateTarget({...options,gpuName,graphics:{neural:false}});
  }
  const source = fs.readFileSync(path.join(f.gameDir,'nvngx_dlss.dll'));
  const request = {kind:'enhanced',config:{route:'anr',exePath:f.exePath,graphics:{multiplier:3}}};
  const work = async () => ({ok:true,manifest:await backends.install({...options,graphics:request.config.graphics})});
  const run = token => f.reviews.run(f.gameDir,request,work,token);
  const {preview} = await run();
  assert.ok(preview.rows.some(row => row.action === 'add'));
  assert.ok(!preview.rows.some(row => /nvngx_dlssnr\.dll/i.test(row.rel)));
  assert.ok((await run(preview.token)).ok);
  assert.equal(graphics.inspect(f.gameDir,backends.readManifest(f.gameDir)).multiplier,3);
  assert.equal(fs.existsSync(path.join(f.gameDir,'nvngx_dlssnr.dll')),false);
  assert.ok(await backends.restore(f.gameDir));
  assert.deepEqual(fs.readFileSync(path.join(f.gameDir,'nvngx_dlss.dll')),source);
});

test('ANR rejects known unsupported Intel hardware before downloading files',async t => {
  const f = fixture(t), guards = require('../src/core/install-guards'), combined = require('../src/core/combined-manager');
  writePe(path.join(f.gameDir,'sl.dlss_g.dll'));
  t.mock.method(guards,'queryNvidiaSmi',async () => { throw new Error('no NVIDIA driver'); });
  t.mock.method(guards,'displayAdapters',async () => ({name:'Intel(R) UHD Graphics 630',nvidiaPresent:false}));
  t.after(async () => { t.mock.restoreAll(); await combined.detectHardwareEnvironment(true); });
  await combined.detectHardwareEnvironment(true);
  let prepared = false;
  await assert.rejects(combined.applyCombinedConfiguration(f.gameDir,{
    exePath:f.exePath, route:'anr', payloadDir:payload.root, userDataDir:f.options.userDataDir,
    requirePayload:async () => { prepared = true; },
  }), /Intel/);
  assert.equal(prepared,false);
  assert.equal(backends.readManifest(f.gameDir),null);
});

test('ANR and sm86 retain their own diagnostic badge with an unused incompatible model in the game', async t => {
  const f = fixture(t);
  writePe(path.join(f.gameDir, 'nvngx_dlssg.dll'));
  writeNr(path.join(f.gameDir, 'nvngx_dlssnr.dll'), '310.9.16.0', 89);
  const combined = require('../src/core/combined-manager');
  const gpuName = 'NVIDIA GeForce RTX 2060';
  const hardware = {gpu:{name:gpuName, nvidiaPresent:true, architecture:require('../src/core/neural-models').detectGpuArchitecture(gpuName)}};
  const target = (await scanGame(f.gameDir, f.exePath)).chosen;
  for (const route of ['anr', 'sm86']) {
    await backends.install({ ...f.options, target, gpuName, route });
    const status = await combined.inspectCombinedStatus(f.gameDir, { ...f.options, detectedHardware: hardware });
    assert.equal(status.neural.mode, 'off');
    assert.equal(status.neural.installed, false);
    assert.equal(status.neural.overallStatus, 'incompatible');
    assert.equal(status.graphicsRoute.filesPresent, true);
    assert.equal(status.diagnostics.combinedStatus, 'experimental', route);
    assert.ok(await backends.restore(f.gameDir));
  }
});

for (const route of ['anr', 'anr-addon', 'sm86', 'sm86-delta', 'hud']) {
  test(route + ' release bytes support preview, apply, reconfiguration and restore', async (t) => {
    const f = fixture(
      t,
      route === 'sm86-delta' ? 'Binaries/Win64/DeltaForceClient-Win64-Shipping.exe' : 'game.exe',
    );
    const bin = path.dirname(f.exePath);
    const opti = path.join(bin, 'OptiScaler.ini');
    const original = '[Private]\r\nOptiDllPath=Unrelated\r\n[Libraries]\r\nOptiDllPath=GameProviders\r\n[PrivateSettings]\r\nKeep=original';
    if (route === 'anr-addon') {
      fs.writeFileSync(opti, original);
      fs.copyFileSync(path.join(payload.root, 'enhanced/anr/dxgi.dll'), path.join(bin, 'dxgi.dll'));
    }
    if (route === 'sm86-delta') {
      const local = process.env.LOCALAPPDATA;
      process.env.LOCALAPPDATA = path.join(f.root, 'local');
      fs.mkdirSync(process.env.LOCALAPPDATA);
      t.after(() => {
        if (local) process.env.LOCALAPPDATA = local;
        else delete process.env.LOCALAPPDATA;
      });
    }
    const options = { ...f.options, route, graphics: route === 'hud' ? {} : { multiplier: 6 } };
    const work = async () => ({ ok: true, manifest: await backends.install(options) });
    const request = { kind: 'enhanced', config: { route, exePath: f.exePath, graphics: options.graphics } };
    const preview = await f.reviews.run(f.gameDir, request, work);
    assert.ok(preview.preview.rows.some((row) => row.scope === 'game' && row.action === 'add'));
    assert.ok(!backends.readManifest(f.gameDir));
    const applied = await f.reviews.run(f.gameDir, request, work, preview.preview.token);
    assert.equal(applied.ok, true);
    const active = backends.readManifest(f.gameDir);
    const state = graphics.inspect(f.gameDir, active);
    assert.equal(state.exePath, f.exePath);
    assert.equal(state.route, route);
    if (route === 'anr-addon') assert.equal(active.graphicsRoute.providerDir, path.join('GameProviders','custom','Apex Neural Rendering FG'));
    if (route === 'hud') {
      assert.ok(fs.existsSync(path.join(bin, 'dlss5-zh-cn.addon64')));
      assert.equal(
        ini.getIni(fs.readFileSync(path.join(bin, 'ReShade.ini'), 'utf8'), 'DLSS5Swapper.HUD', 'Mode'),
        '1',
      );
    } else assert.equal(state.multiplier, 6);
    if (route.startsWith('sm86')) {
      await assert.rejects(
        backends.install({ ...options, graphics: { engine: 'XeSS', multiplier: 6 } }),
        /倍率/,
      );
      await backends.install({ ...options, graphics: { engine: 'XeSS', multiplier: 4 } });
      assert.equal(graphics.inspect(f.gameDir, backends.readManifest(f.gameDir)).engine, 'XeSS');
      const savedIni = path.join(bin, 'dlssg_sm86.ini');
      const validIni = fs.readFileSync(savedIni, 'utf8');
      fs.writeFileSync(savedIni, ini.setIni(validIni, 'FrameGeneration', 'MaxGeneratedFrames', '5'));
      const invalid = graphics.inspect(f.gameDir, backends.readManifest(f.gameDir));
      assert.equal(invalid.multiplier, null, 'an out-of-range XeSS setting must not report 6×');
      assert.match(invalid.error, /MaxGeneratedFrames/);
      fs.writeFileSync(savedIni, validIni);
    }
    if (route === 'sm86-delta') {
      const cache = path.join(
        process.env.LOCALAPPDATA,
        'RTXFG-Delta4X',
        'games',
        active.graphicsRoute.deltaCache.id,
      );
      assert.equal(JSON.parse(fs.readFileSync(path.join(cache, 'owner.json'))).exe, f.exePath);
      assert.ok(await backends.restore(f.gameDir));
      assert.ok(!fs.existsSync(cache));
      return;
    }
    if (route === 'anr-addon') fs.writeFileSync(opti, fs.readFileSync(opti,'utf8').replace('Keep=original','Keep=player'));
    await backends.install({ ...options, graphics: {} });
    if (route === 'anr') {
      const file = path.join(bin, 'dxgi.dll');
      const bytes = fs.readFileSync(file);
      fs.appendFileSync(file, 'updated by another program');
      await assert.rejects(backends.restore(f.gameDir), /文件已变化/);
      fs.writeFileSync(file, bytes);
    }
    assert.ok(await backends.restore(f.gameDir));
    for (const rel of Object.keys(active.graphicsRoute.files))
      assert.ok(!fs.existsSync(path.join(f.gameDir, rel)), rel);
    if (route === 'anr-addon') {
      const text = fs.readFileSync(opti, 'utf8');
      assert.equal(text, original.replace('Keep=original','Keep=player'));
    }
  });
}
test('switching EXEs retires the old ownership while leaving later changes and shared files intact', async (t) => {
  const f = fixture(t, 'A/Game.exe');
  const other = writePe(path.join(f.gameDir, 'B/Game.exe'), { text: 'D3D12CreateDevice' });
  const shared = writePe(path.join(f.gameDir, 'Engine/nvngx_dlssg.dll'));
  const original = fs.readFileSync(shared);
  await backends.install({ ...f.options, route: 'hud' });
  await backends.install({ ...f.options, exePath: other, route: 'anr' });
  const retired = path.join(f.gameDir, 'A/dxgi.dll');
  assert.ok(!fs.existsSync(retired));
  fs.writeFileSync(retired, 'new application-owned renderer');
  assert.ok(await backends.restore(f.gameDir));
  assert.equal(fs.readFileSync(retired, 'utf8'), 'new application-owned renderer');
  assert.deepEqual(fs.readFileSync(shared), original);
});
test('ANR full chains a verified ReShade and restores the original loader bytes', async (t) => {
  const f = fixture(t);
  const loader = path.join(f.gameDir, 'dxgi.dll');
  const bytes = fs.readFileSync(path.join(payload.root, 'reshade-vulkan/ReShade64.dll'));
  fs.writeFileSync(loader, bytes);
  const options = { ...f.options, route: 'anr' };
  await backends.install(options);
  const chain = path.join(f.gameDir, 'ReShade64.dll');
  assert.deepEqual(fs.readFileSync(chain), bytes);
  const hostConfig = path.join(f.gameDir,'OptiScaler.ini');
  const configured = fs.readFileSync(hostConfig,'utf8');
  fs.writeFileSync(hostConfig,ini.setIni(configured,'FrameGen','FGInput','Upscaler'));
  assert.match(graphics.inspect(f.gameDir,backends.readManifest(f.gameDir)).error,/ANR 帧生成输入/);
  fs.writeFileSync(hostConfig,configured);
  assert.equal(
    ini.getIni(fs.readFileSync(path.join(f.gameDir, 'OptiScaler.ini'), 'utf8'), 'Plugins', 'LoadReshade'),
    'true',
  );
  await backends.install(options);
  assert.ok(backends.readManifest(f.gameDir).graphicsRoute.files['ReShade64.dll']);
  assert.ok(await backends.restore(f.gameDir));
  assert.deepEqual(fs.readFileSync(loader), bytes);
  assert.ok(!fs.existsSync(chain));
});
test('F7 previews and changes display modes alongside ANR without changing its backend or frame settings', async (t) => {
  const f = fixture(t);
  const options = {...f.options, route:'anr', graphics:{multiplier:5, sceneCut:false}};
  const active = await backends.install(options);
  const proxy = fs.readFileSync(path.join(f.gameDir, active.graphicsRoute.proxy));
  const request = {kind:'enhanced',config:{performanceMonitor:2,exePath:f.exePath}};
  const work = async () => ({ok:true,manifest:await backends.configurePerformanceMonitor({...f.options, monitorMode:2})});
  const before = await f.reviews.run(f.gameDir, request, work);
  assert.ok(!fs.existsSync(path.join(f.gameDir, 'ReShade64.dll')));
  assert.ok(before.preview.rows.every(row => row.action === 'keep' || row.rel !== active.graphicsRoute.proxy));
  await f.reviews.run(f.gameDir, request, work, before.preview.token);
  for (const mode of [2,0,1]) {
    const manifest = await backends.configurePerformanceMonitor({...f.options,monitorMode:mode,
      payloadDir:path.join(f.root,'uncached'), requirePayload:() => assert.fail('installed monitor requested a new payload')});
    assert.equal(manifest.route, 'anr');
    assert.equal(graphics.inspect(f.gameDir, manifest).multiplier, 5);
    assert.deepEqual(fs.readFileSync(path.join(f.gameDir, active.graphicsRoute.proxy)), proxy);
    const state = graphics.inspectPerformanceMonitor(f.gameDir, {path:f.exePath,bitness:64});
    assert.deepEqual(state, {installed:true,mode,corner:1});
    assert.equal(ini.getIni(fs.readFileSync(path.join(f.gameDir,'OptiScaler.ini'),'utf8'),'Plugins','LoadReshade'), 'true');
  }
  await backends.restore(f.gameDir);
  for (const name of ['dxgi.dll','ReShade64.dll','ReShade.ini','dlss5-zh-cn.addon64'])
    assert.equal(fs.existsSync(path.join(f.gameDir,name)), false, name);
});
test('F7 installs a loadable hook for the actual renderer and preserves unrelated ReShade copies', async t => {
  for (const [api,apiLabel,unrelated,wanted] of [
    ['dxgi','DirectX 12','ReShade64.dll','dxgi.dll'],
    ['dxgi','DirectX 12','d3d11.dll','dxgi.dll'],
    ['dxgi','DirectX 11','d3d12.dll','dxgi.dll'],
    ['opengl','OpenGL','d3d9.dll','opengl32.dll'],
    ['d3d9','DirectX 9','opengl32.dll','d3d9.dll'],
  ]) {
    const f = fixture(t);
    const file = name => path.join(f.gameDir,name);
    fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade64.dll'),file(unrelated));
    fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon64'),file('dlss5-zh-cn.addon64'));
    const exe = {path:f.exePath,rel:'game.exe',bitness:64,api,apiLabel};
    assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,false,unrelated);
    const manifest = await backends.configurePerformanceMonitor({...f.options,api,apiLabel});
    assert.ok(manifest.graphicsRoute.files[wanted],wanted);
    assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe,manifest).installed,true,wanted);
    await backends.restore(f.gameDir);
    assert.ok(fs.existsSync(file(unrelated)));
    assert.ok(!fs.existsSync(file(wanted)));
  }
});

test('F7 on translated legacy renderers requires the matching dgVoodoo wrappers', async t => {
  for (const [api,wrapperNames] of [['d3d8',['D3D8.dll']],['ddraw',['DDraw.dll','D3DImm.dll']]]) {
    const f = fixture(t);
    const file = name => path.join(f.gameDir,name);
    const exe = {path:f.exePath,api,bitness:32};
    fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade32.dll'),file('dxgi.dll'));
    fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon32'),file('dlss5-zh-cn.addon32'));
    for (const name of wrapperNames) {
      assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,false);
      writePe(file(name),{bitness:32,version:'2.8.0.0'});
      const bytes = fs.readFileSync(file(name));
      Buffer.from('dgVoodoo','utf16le').copy(bytes,0x320);
      fs.writeFileSync(file(name),bytes);
    }
    assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,true);
    const manifest = await backends.configurePerformanceMonitor({...f.options,bitness:32,api});
    assert.deepEqual(manifest.graphicsRoute.files,{});
  }
});

test('F7 recognizes the verified 32-bit OpenGL preloader without installing a duplicate hook', async t => {
  const f = fixture(t);
  const file = name => path.join(f.gameDir,name);
  const exe = {path:f.exePath,api:'opengl',bitness:32};
  fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade32.dll'),file('ReShade32.dll'));
  fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon32'),file('dlss5-zh-cn.addon32'));
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,false);
  fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/winmm.dll'),file('winmm.dll'));
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,true);
  await backends.configurePerformanceMonitor({...f.options,api:exe.api,bitness:exe.bitness});
  assert.equal(fs.existsSync(file('opengl32.dll')),false);
});

test('F7 restores root add-on settings while preserving later player edits and the original INI layout', async t => {
  const f = fixture(t), file = path.join(f.gameDir,'ReShade.ini');
  const original = '\uFEFFDisabledAddons = dlss5-zh-cn.addon64,other.addon64\r\n[Player]\r\nValue=雪';
  fs.writeFileSync(file, original);
  await backends.configurePerformanceMonitor({...f.options,monitorMode:1,monitorCorner:2});
  const active = fs.readFileSync(file,'utf8');
  assert.equal(ini.getIni(active,'','DisabledAddons'),'other.addon64');
  fs.writeFileSync(file,active.replace('Value=雪','Value=雨'));
  await backends.restore(f.gameDir);
  assert.deepEqual(fs.readFileSync(file), Buffer.from(original.replace('Value=雪','Value=雨')));
});

test('F7 reuses a verified external OptiScaler chain and restores its disabled setting', async t => {
  const f = fixture(t);
  const file = name => path.join(f.gameDir,name);
  const exe = {path:f.exePath,api:'dxgi',apiLabel:'DirectX 12',bitness:64};
  fs.copyFileSync(path.join(payload.root,'enhanced/anr/dxgi.dll'),file('dxgi.dll'));
  fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade64.dll'),file('ReShade64.dll'));
  fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon64'),file('dlss5-zh-cn.addon64'));
  const original = '[Plugins]\r\nLoadReshade=false\r\n';
  fs.writeFileSync(file('OptiScaler.ini'),original);
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,false);
  const manifest = await backends.configurePerformanceMonitor(f.options);
  assert.deepEqual(manifest.graphicsRoute.files,{});
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe,manifest).installed,true);
  assert.equal(fs.existsSync(file('d3d12.dll')),false);
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(file('OptiScaler.ini'),'utf8'),original);
});

test('F7 uses a direct renderer hook when the external OptiScaler excludes the selected process', async t => {
  const f = fixture(t), file = name => path.join(f.gameDir,name);
  const original = '[Plugins]\nLoadReshade=true\n[ProcessFilter]\nTargetProcessName=another.exe\n';
  fs.copyFileSync(path.join(payload.root,'enhanced/anr/dxgi.dll'),file('dxgi.dll'));
  fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade64.dll'),file('ReShade64.dll'));
  fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon64'),file('dlss5-zh-cn.addon64'));
  fs.writeFileSync(file('OptiScaler.ini'),original);
  const exe = {path:f.exePath,api:'dxgi',apiLabel:'DirectX 12',bitness:64};
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe).installed,false);
  const manifest = await backends.configurePerformanceMonitor(f.options);
  assert.ok(manifest.graphicsRoute.files['d3d12.dll']);
  assert.equal(graphics.inspectPerformanceMonitor(f.gameDir,exe,manifest).installed,true);
  await backends.restore(f.gameDir);
  assert.equal(fs.readFileSync(file('OptiScaler.ini'),'utf8'),original);
  assert.ok(!fs.existsSync(file('d3d12.dll')));
});

test('both installation orders restore external OptiScaler settings shared by F7 and MFG ASI', async t => {
  for (const monitorFirst of [false, true]) {
    const f = fixture(t);
    const file = name => path.join(f.gameDir, name);
    fs.copyFileSync(path.join(payload.root, 'enhanced/anr/dxgi.dll'), file('dxgi.dll'));
    fs.copyFileSync(path.join(payload.root, 'reshade-vulkan/ReShade64.dll'), file('ReShade64.dll'));
    fs.copyFileSync(path.join(payload.root, 'streamline/nvngx_dlss.dll'), file('nvngx_dlss.dll'));
    require('./fixtures/optiscaler-streamline').addPrivateStreamline(f.gameDir);
    const host = file('OptiScaler.ini');
    const encoding = 'utf8';
    const original = (monitorFirst ? '' : '\uFEFF') + '[FrameGen]\r\nFGInput=upscaler\r\nFGOutput=dlssg\r\n[Other]\r\nCustom=中文1\r\n';
    fs.writeFileSync(host, original, encoding);
    const monitor = () => backends.configurePerformanceMonitor(f.options);
    const asi = () => require('../src/core/mfg-manager').applyMfgConfiguration(f.gameDir, {
      ...f.options, mode: 'x3', backend: 'mfg-unlocker-asi', upgradeDlssg: false
    });
    const neural = () => require('../src/core/neural-models').applyNeuralModelSelection(f.gameDir, {...f.options, mode: 'off'});
    for (const action of monitorFirst ? [monitor, asi, neural] : [neural, asi, monitor]) await action();
    const active = fs.readFileSync(host, encoding);
    assert.equal(ini.getIni(active, 'Plugins', 'LoadReshade'), 'true');
    assert.equal(ini.getIni(active, 'Plugins', 'LoadAsiPlugins'), 'true');
    assert.equal(ini.getIni(active, 'DLSSG', 'InterpolationCount'), '2');
    assert.equal(ini.getIni(active, 'DlssNr', 'Enabled'), 'false');
    fs.writeFileSync(host, active.replace('中文1', '中文2'), encoding);
    if (!monitorFirst) {
      await require('../src/core/mfg-manager').applyMfgConfiguration(f.gameDir, { mode:'off' });
      assert.equal(ini.getIni(fs.readFileSync(host, encoding), 'Plugins', 'LoadReshade'), 'true');
    }
    await backends.restore(f.gameDir);
    assert.deepEqual(fs.readFileSync(host), Buffer.from(original.replace('中文1', '中文2'), encoding));
  }
});

test('a monitor-only Vulkan installation can add ANR while retaining its existing shared layer', {skip:process.platform !== 'win32'}, async (t) => {
  const f = fixture(t);
  const registrations = new Set();
  const registryRunner = async (_command,args) => {
    if (args[0] === 'query') return {code:registrations.size ? 0 : 1,stdout:[...registrations].map(file => '    ' + file + '    REG_DWORD    0x0').join('\n')};
    if (args[0] === 'add') registrations.add(args[args.indexOf('/v')+1]);
    return {code:0,stdout:''};
  };
  const options = {...f.options,api:'vulkan',apiLabel:'Vulkan',registryRunner};
  const first = await backends.configurePerformanceMonitor({...options,monitorMode:2});
  const combined = await backends.install({...options,route:'anr'});
  assert.equal(combined.route,'anr');
  assert.equal(registrations.size,1);
  assert.deepEqual(combined.vulkanLayer,first.vulkanLayer);
  assert.deepEqual(graphics.inspectPerformanceMonitor(f.gameDir,{path:f.exePath,rel:'game.exe',bitness:64,api:'vulkan'},combined),{installed:true,mode:2,corner:1});
});
test('the Add-ons and Overlay requests install independently and change only the reviewed HUD settings', async (t) => {
  const f = fixture(t);
  const combined = require('../src/core/combined-manager');
  const config = {exePath:f.exePath, apiOverride:'d3d12', payloadDir:payload.root, userDataDir:f.options.userDataDir};
  const file = path.join(f.gameDir,'ReShade.ini');
  fs.writeFileSync(file,'[DLSS5Swapper.HUD]\r\nMode=2\r\nCorner=0\r\n');
  await assert.rejects(combined.applyCombinedConfiguration(f.gameDir,{...config,performanceMonitor:{corner:1}}),/请先在附加组件/);
  await combined.applyCombinedConfiguration(f.gameDir,{...config,performanceMonitor:{install:true,corner:1}});
  const exe = {path:f.exePath,bitness:64};
  assert.deepEqual(graphics.inspectPerformanceMonitor(f.gameDir,exe),{installed:true,mode:2,corner:1});
  const patch = {performanceMonitor:{corner:3},exePath:f.exePath};
  const request = {kind:'enhanced',config:patch};
  const work = () => combined.applyCombinedConfiguration(f.gameDir,{...config,...patch,requirePayload:()=>assert.fail('configuration requested downloads')});
  const preview = await f.reviews.run(f.gameDir,request,work);
  assert.deepEqual(preview.preview.rows.filter(row=>row.scope === 'game' && row.action !== 'keep').map(row=>row.rel),['ReShade.ini']);
  assert.equal(ini.getIni(fs.readFileSync(file,'utf8'),'DLSS5Swapper.HUD','Corner'),'1');
  await f.reviews.run(f.gameDir,request,work,preview.preview.token);
  assert.deepEqual(graphics.inspectPerformanceMonitor(f.gameDir,exe),{installed:true,mode:2,corner:3});
});
test('monitor-only installation carries its last in-game mode to a backend and reuses an external host and add-on', async (t) => {
  const f = fixture(t);
  const file = name => path.join(f.gameDir,name);
  fs.copyFileSync(path.join(payload.root,'reshade-vulkan/ReShade64.dll'),file('dxgi.dll'));
  fs.mkdirSync(file('addons'));
  fs.copyFileSync(path.join(payload.root,'enhanced/zh-cn/dlss5-zh-cn.addon64'),file('addons/dlss5-zh-cn.addon64'));
  const original = '[ADDON]\r\nAddonPath=addons\r\nDisabledAddons=other.addon64,dlss5-zh-cn.addon64\r\n';
  fs.writeFileSync(file('ReShade.ini'), original);
  await assert.rejects(backends.configurePerformanceMonitor({...f.options,monitorCorner:2,monitorSettingsOnly:true}),/请先在附加组件/);
  const standalone = await backends.configurePerformanceMonitor({...f.options,monitorMode:1});
  await backends.configurePerformanceMonitor({...f.options,monitorCorner:3,monitorSettingsOnly:true});
  assert.deepEqual(graphics.inspectPerformanceMonitor(f.gameDir,{path:f.exePath,bitness:64}),{installed:true,mode:1,corner:3});
  assert.deepEqual(standalone.graphicsRoute.files,{});
  const current = fs.readFileSync(file('ReShade.ini'),'utf8');
  fs.writeFileSync(file('ReShade.ini'),ini.setIni(current,'DLSS5Swapper.HUD','Mode','2'));
  const combined = await backends.install({...f.options,route:'sm86',graphics:{engine:'XeSS',multiplier:3}});
  assert.equal(combined.route,'sm86');
  assert.deepEqual(graphics.inspectPerformanceMonitor(f.gameDir,{path:f.exePath,bitness:64}),{installed:true,mode:2,corner:3});
  assert.deepEqual(combined.performanceMonitor.files,{});
  assert.equal(graphics.inspect(f.gameDir,combined).multiplier,3);
  await backends.restore(f.gameDir);
  assert.ok(fs.existsSync(file('dxgi.dll')));
  assert.ok(fs.existsSync(file('addons/dlss5-zh-cn.addon64')));
  assert.equal(ini.getIni(fs.readFileSync(file('ReShade.ini'),'utf8'),'ADDON','DisabledAddons'),'other.addon64,dlss5-zh-cn.addon64');
});
test('ANR can add neural rendering after installation, preserve an occupied DXGI slot and restore shared original DLSS', async (t) => {
  const f = fixture(t);
  const proxy = path.join(f.gameDir, 'dxgi.dll');
  fs.writeFileSync(proxy, 'existing game proxy');
  const common = writePe(path.join(f.gameDir, 'Engine/nvngx_dlss.dll'), { version: [3, 7, 0, 0] });
  const original = fs.readFileSync(common);
  const options = {
    ...f.options,
    route: 'anr',
    gpuName: 'NVIDIA GeForce RTX 4070 Laptop GPU',
    target: { hasNativeDlssFg: true, hasNativeDlss: true },
    hardwareProfile: 'rtx40_laptop',
  };
  await backends.install(options);
  assert.equal(backends.readManifest(f.gameDir).graphicsRoute.proxy, 'winmm.dll');
  const model = path.join(f.gameDir, 'nvngx_dlssnr.dll');
  assert.ok(!fs.existsSync(model));
  await backends.install({ ...options, graphics: { neural: true } });
  assert.ok(fs.existsSync(model));
  assert.ok(fs.existsSync(path.join(f.gameDir, 'renodx-dlss5.addon64')));
  assert.ok(fs.existsSync(path.join(f.gameDir, 'dlss5-zh-cn.addon64')));
  assert.equal(
    ini.getIni(fs.readFileSync(path.join(f.gameDir, 'OptiScaler.ini'), 'utf8'), 'Plugins', 'LoadReshade'),
    'true',
  );
  assert.equal(graphics.inspect(f.gameDir, backends.readManifest(f.gameDir)).neural, true);
  assert.notDeepEqual(fs.readFileSync(common), original);
  const other = writePe(path.join(f.gameDir, 'B/Game2.exe'), { text: 'D3D12CreateDevice' });
  await assert.rejects(backends.configurePerformanceMonitor({ ...f.options, exePath: other, monitorMode:1 }), /已部署的游戏程序/);
  assert.ok(fs.existsSync(model));
  await backends.install({ ...f.options, exePath: other, route: 'anr' });
  assert.deepEqual(fs.readFileSync(common), original);
  fs.writeFileSync(common, 'later game update');
  assert.ok(await backends.restore(f.gameDir));
  assert.equal(fs.readFileSync(common, 'utf8'), 'later game update');
  assert.equal(fs.readFileSync(proxy, 'utf8'), 'existing game proxy');
  assert.ok(!fs.existsSync(model));
});
