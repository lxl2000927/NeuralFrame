'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe, writeProvider} = require('./fixtures/pe');
const {scanGame} = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const combined = require('../src/core/combined-manager');

test('graphics application and setup agree on SR input instead of treating any NGX or Streamline file as native DLSS', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-native-input-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  t.mock.method(require('../src/core/install-guards'),'assertGameClosed',async () => {});
  const cases = [
    {name:'Reflex only',files:[['sl.reflex.dll',[2,13,0,0]]],route:'feeder'},
    {name:'Streamline common only',files:[['sl.common.dll',[2,13,0,0]]],route:'feeder'},
    {name:'NGX core only',files:[['nvngx.dll',[4,3,0,0]],['_nvngx.dll',[4,3,0,0]]],route:'feeder'},
    {name:'FG and NR only',files:[['nvngx_dlssg.dll',[310,9,1,0]],['nvngx_dlssnr.dll',[310,8,0,0]]],route:'feeder'},
    {name:'DLSS 1 plus FG',files:[['nvngx_dlss.dll',[1,0,0,0]],['nvngx_dlssg.dll',[310,9,1,0]]],route:'feeder'},
    {name:'Native DLSS 3',files:[['nvngx_dlss.dll',[3,1,0,0]]],route:'native'},
  ];
  for (const [i,item] of cases.entries()) {
    const dir = path.join(root,String(i));fs.mkdirSync(dir);
    writePe(path.join(dir,'Game-Win64-Shipping.exe'),{text:'D3D12CreateDevice',size:131072});
    for (const [name,version] of item.files) writePe(path.join(dir,name),{version});
    const before = Object.fromEntries(fs.readdirSync(dir).map(name=>[name,fs.readFileSync(path.join(dir,name))]));
    const scan = await scanGame(dir);
    assert.equal(routes.recommendedRoute(scan),item.route,item.name);
    assert.equal(routes.routesFor(scan.chosen).includes('native'),item.route === 'native',item.name);
    const stop = new Error('dependency check only');
    let route;
    await assert.rejects(combined.applyCombinedConfiguration(dir,{neuralMode:'latest_compatible',mfgMode:'off',
      payloadDir:root,requirePayload:async request => {route=request.route;throw stop;}}),error=>error===stop);
    assert.equal(route,item.route,item.name);
    for (const [name,bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(dir,name)),bytes);
  }
});

test('nested engine plug-ins stay with their own game, while common plugins remain shared', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-game-scopes-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const a = writePe(path.join(root,'First','Binaries','Win64','First.exe'),{text:'D3D12CreateDevice'});
  const b = writePe(path.join(root,'Second','Binaries','Win64','Second.exe'),{text:'D3D12CreateDevice'});
  writePe(path.join(root,'First','Engine','Binaries','Win64','Editor.exe'),{text:'D3D11CreateDevice'});
  writePe(path.join(root,'First','Engine','Binaries','Win64','UnrealCEFSubProcess.exe'),{text:'D3D12CreateDevice'});
  writePe(path.join(root,'Hub.exe'),{text:'D3D11CreateDevice'});
  const local = path.join(root,'First','Engine','Plugins','ThirdParty');
  const life = ['CreateFeature','EvaluateFeature','ReleaseFeature'].map(key => 'NVSDK_NGX_D3D12_' + key);
  const sr = path.join(local,'nvngx_dlss.dll');
  writeProvider(sr,life);
  writeProvider(path.join(local,'nvngx_dlssg.dll'),life);
  writeProvider(path.join(local,'sl.dlss_g.dll'),['slGetPluginFunction']);
  writeProvider(path.join(local,'libxess.dll'),['xessD3D12Execute','xessGetVersion']);
  writePe(path.join(root,'Shared','Plugins','sl.reflex.dll'));
  const other = await scanGame(root,b);
  assert.equal(other.primaryDlss,null);
  assert.equal(other.chosen.hasNativeDlss,false);
  assert.equal(other.chosen.hasNativeDlssFg,false);
  assert.equal(other.chosen.hasXeMfgDx12Upscaler,false);
  assert.equal(other.chosen.hasXeMfgDlssFgDx12,false);
  assert.deepEqual(other.streamlineFiles.map(file=>file.name),['sl.reflex.dll']);
  assert.deepEqual(other.upscalerFiles,[]);
  const first = await scanGame(root,a);
  assert.ok(!first.exeCandidates.some(exe=>exe.name==='UnrealCEFSubProcess.exe'));
  assert.equal(first.primaryDlss.path,sr);
  assert.equal(first.chosen.hasNativeDlss,true);
  assert.equal(first.chosen.hasXeMfgDlssFgDx12,true);
  assert.equal(first.chosen.hasXeMfgDx12Upscaler,true);
  assert.deepEqual(first.streamlineFiles.map(file=>file.name).sort(),['sl.dlss_g.dll','sl.reflex.dll']);
});

test('FSR backend and swapchain helpers alone are not a game upscaler or FG provider', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-fsr-helpers-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  writePe(path.join(root,'Game.exe'),{text:'D3D12CreateDevice'});
  writeProvider(path.join(root,'ffx_fsr2_api_dx12_x64.dll'),['ffxFsr2GetInterfaceDX12']);
  writeProvider(path.join(root,'amd_fidelityfx_framegeneration_swapchain_dx12.dll'),['ffxCreateContext','ffxDispatch']);
  const {chosen} = await scanGame(root);
  assert.equal(chosen.hasNativeUpscaler,false);
  assert.equal(chosen.hasNativeFg,false);
  assert.ok(!routes.routesFor(chosen).includes('optiscaler'));
  assert.ok(routes.routesFor(chosen).includes('encore'));
  writePe(path.join(root,'amd_fidelityfx_framegeneration_dx12.dll'));
  assert.equal((await scanGame(root)).chosen.hasNativeFg,true);
});

test('a positively identified runtime cannot supply another vendor or a different XeSS or FSR effect', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-vendor-identity-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  writePe(path.join(root,'Game.exe'),{text:'D3D12CreateDevice'});
  const products = new Map([
    ['nvngx_dlss.dll','Intel Corporation\0libxess.dll\0'],
    ['nvngx_dlssg.dll','Advanced Micro Devices, Inc.\0AMD FidelityFX Frame Generation'],
    ['libxess_fg.dll','Intel Corporation\0libxell.dll\0'],
    ['libxess.dll','NVIDIA Corporation\0NVIDIA Deep Learning SuperSampling'],
    ['amd_fidelityfx_framegeneration_dx12.dll','AMD FidelityFX Upscaler'],
    ['amd_fidelityfx_upscaler_vk.dll','AMD FidelityFX (DirectX) Upscaler Library'],
    ['sl.dlss_g.dll','ReShade']
  ]);
  for (const [name,product] of products) {
    const file = writePe(path.join(root,name),{version:[3,1,0,0]});
    const bytes = fs.readFileSync(file);
    bytes.writeUInt32LE(0x200,0x264);
    bytes.write(product,0x340,'utf16le');
    fs.writeFileSync(file,bytes);
  }
  const scan = await scanGame(root);
  for (const field of ['hasNativeDlss','hasNativeDlssFg','hasNativeUpscaler','nativeFsrFg','nativeXessFg','hasNativeFg'])
    assert.equal(scan.chosen[field],false,field);
  assert.ok([...scan.dlssFiles,...scan.upscalerFiles,...scan.streamlineFiles].every(file => file.featureMismatch));
});

test('wrong-role NVIDIA files remain visible while SR, FG and RR input and SR replacement are rejected', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-ngx-role-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  writePe(path.join(root,'Game.exe'),{text:'D3D12CreateDevice'});
  const products = new Map([['nvngx_dlss.dll','NVIDIA DLSS Ray Reconstruction'],['nvngx_dlssg.dll','NVIDIA Deep Learning SuperSampling'],
    ['nvngx_dlssd.dll','NVIDIA DLSS-G MFGLW'],['sl.dlss_g.dll','NVIDIA STREAMLINE PRODUCTION: SL.REFLEX PLUGIN']]);
  for (const [name,product] of products) {
    const file = writePe(path.join(root,name),{version:[310,9,16,0]});
    const bytes = fs.readFileSync(file);
    bytes.writeUInt32LE(0x200,0x264);
    bytes.write(product,0x340,'utf16le');
    fs.writeFileSync(file,bytes);
  }
  const scan = await scanGame(root);
  assert.equal(scan.primaryDlss,null);
  assert.equal(scan.chosen.hasNativeDlss,false);
  assert.equal(scan.chosen.hasNativeDlssFg,false);
  assert.equal(scan.chosen.hasXeMfgDlssRrDx12,false);
  assert.ok([...scan.dlssFiles,...scan.streamlineFiles].every(file=>file.featureMismatch === true));
  const apply = require('../src/core/apply');
  const source = writePe(path.join(root,'source.dll'),{version:[310,9,16,0]});
  for (const name of products.keys()) {
    const dest = path.join(root,name), before = fs.readFileSync(dest);
    await assert.rejects(apply.copyTracked({added:[],replaced:[]},root,source,dest),{code:'errRuntimeIdentity'});
    assert.deepEqual(fs.readFileSync(dest),before);
  }
  assert.equal(fs.existsSync(path.join(root,'_DLSS5_Backup')),false);
});

test('SR and FG evidence is specific to providers, native files and executable architecture', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-sr-fg-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const exe64 = writePe(path.join(root,'Game64.exe'), {bitness:64,text:'D3D12CreateDevice',size:131072});
  const exe32 = writePe(path.join(root,'Game32.exe'), {bitness:32,text:'D3D11CreateDevice',size:131072});
  writePe(path.join(root,'ffx_fsr3upscaler_x64.dll'));
  for (const dir of ['OptiScaler','rtx-encore-runtimes','dlssg_sm86','Apex Neural Rendering FG/dlssg',
    'BepInEx/plugins/FrameGen','MelonLoader/Dependencies/FrameGen']) {
    writePe(path.join(root,dir,'nvngx_dlssg.dll'));
  }
  const scan = await scanGame(root,exe64);
  const other = scan.exeCandidates.find(exe => exe.path === exe32);
  assert.equal(scan.chosen.hasNativeUpscaler,true);
  assert.equal(scan.chosen.hasNativeFg,false);
  assert.equal(other.hasNativeUpscaler,false);
  assert.equal(scan.dlssFiles.length,0,'patch-private runtimes are excluded from deployment targets');
  assert.ok(routes.routesFor(scan.chosen).includes('encore'));
  fs.unlinkSync(path.join(root,'ffx_fsr3upscaler_x64.dll'));
  for (const name of ['libxess_fg.dll','ffx_fsr3frameinterpolation_x64.dll']) {
    const file=writePe(path.join(root,name)), {chosen}=await scanGame(root,exe64);
    assert.equal(chosen.hasNativeUpscaler,false,name);
    assert.equal(chosen.hasNativeFg,true,name);
    assert.equal(chosen.hasNativeDlssFg,false,name);
    assert.equal(chosen.nativeXessFg,name==='libxess_fg.dll',name);
    assert.equal(chosen.nativeFsrFg,name==='ffx_fsr3frameinterpolation_x64.dll',name);
    fs.unlinkSync(file);
  }
  for (const name of ['amd_fidelityfx_dx12.dll','amd_fidelityfx_vk.dll','ffx_fsr3_x64.dll']) {
    const file = writePe(path.join(root,name));
    if (name.startsWith('amd_')) {
      const invalid = (await scanGame(root,exe64)).chosen;
      assert.equal(invalid.hasNativeFg,false,name);
      assert.equal(invalid.hasNativeUpscaler,false,name);
      writeProvider(file,['ffxCreateContext','ffxDestroyContext','ffxConfigure','ffxDispatch']);
    }
    const {chosen} = await scanGame(root,exe64);
    assert.equal(chosen.hasNativeFg,true,name);
    assert.equal(chosen.nativeFsrFg,false,'combined runtimes alone do not establish the selected game FG input');
    assert.equal(chosen.nativeXessFg,false,name);
    fs.unlinkSync(file);
  }
});

test('a manager-added nearby SR file cannot hide the original engine SR runtime', () => {
  const near = {rel:'nvngx_dlss.dll',name:'nvngx_dlss.dll',bitness:64};
  const engine = {...near,rel:'Engine/Plugins/nvngx_dlss.dll'};
  const scan = {chosen:{bitness:64,api:'dxgi',apiLabel:'DirectX 12'}, primaryDlss:near,
    dlssFiles:[near,engine],install:{added:['NVNGX_DLSS.DLL']}};
  assert.equal(routes.nativeDlssPresent(scan),true);
  assert.equal(routes.recommendedRoute(scan), 'native');
  assert.equal(routes.recommendedRoute(scan,{...scan.chosen,hasNativeDlss:false}), 'feeder');
});

test('native FG input types ignore manager-added and other-architecture providers', () => {
  const scan = {chosen:{bitness:64}, upscalerFiles:[
    {name:'libxess_fg.dll',rel:'Plugins/XeSS/libxess_fg.dll',bitness:64},
    {name:'amd_fidelityfx_framegeneration_dx12.dll',rel:'amd_fidelityfx_framegeneration_dx12.dll',bitness:32}
  ], install:{added:['plugins\\xess\\LIBXESS_FG.DLL']}};
  assert.equal(routes.nativeFgPresent(scan,'xess'),false);
  assert.equal(routes.nativeFgPresent(scan,'fsr'),false);
  scan.install.added = [];
  assert.equal(routes.nativeFgPresent(scan,'xess'),true);
  assert.equal(routes.nativeFgPresent(scan,'fsr'),false);
});

test('invalid or renamed executables do not qualify as native SR/FG runtime DLLs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-native-pe-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const exe = writePe(path.join(root,'Game.exe'), {text:'D3D12CreateDevice'});
  for (const content of [Buffer.from('placeholder'),fs.readFileSync(exe)]) {
    for (const name of ['nvngx_dlss.dll','nvngx_dlssg.dll','sl.dlss_g.dll','libxess.dll']) fs.writeFileSync(path.join(root,name),content);
    const scan = await scanGame(root,exe);
    assert.equal(scan.primaryDlss,null);
    assert.equal(scan.chosen.hasNativeDlss,false);
    assert.equal(scan.chosen.hasNativeUpscaler,false);
    assert.equal(scan.chosen.hasNativeFg,false);
    assert.equal(scan.chosen.hasNativeDlssFg,false);
    assert.deepEqual(routes.componentRoutesFor(scan.chosen),[]);
  }
});
