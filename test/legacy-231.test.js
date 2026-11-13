'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {writePe}=require('./fixtures/pe');
const registry=require('../src/core/legacy-installscript');
const ini=require('../src/core/feeder-config');
const legacy=require('../src/core/legacy-compat');
const library=require('../src/library');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-231-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('legacy profiles default only affected engines and retain explicit compatibility choices',t=>{
  const dir=fixture(t);
  const generic=legacy.configure('',path.join(dir,'Game.exe'));
  assert.equal(ini.getIni(generic,'Compatibility','CpuLimit'),'0');
  assert.equal(ini.getIni(generic,'Compatibility','LegacyMemory'),'0');
  assert.equal(ini.getIni(legacy.configure('',path.join(dir,'prototypef.exe')),'Compatibility','CpuLimit'),'8');
  assert.equal(ini.getIni(legacy.configure('',path.join(dir,'DFTFD.exe')),'Compatibility','LegacyMemory'),'1');
  assert.equal(ini.getIni(legacy.configure('',path.join(dir,'hl.exe')),'Compatibility','GoldSrc'),'1');
  const custom='[Compatibility]\nCpuLimit=0\nLegacyMemory=0\nGoldSrc=0\nRegistryRoot=Software\\OtherApp\n';
  const result=legacy.configure(custom,path.join(dir,'prototypef.exe'));
  assert.equal(ini.getIni(result,'Compatibility','CpuLimit'),'0');
  assert.equal(ini.getIni(result,'Compatibility','RegistryRoot'),'');
  assert.equal(legacy.supported(64,'dxgi'),false); assert.equal(legacy.supported(32,'dxgi'),false);
});

test('32-bit dgVoodoo fixes unsafe defaults while keeping custom settings and resolution modes',()=>{
  const output=ini.configureDgVoodoo('[DirectX]\nVRAM=4096\nFiltering=16\n[DirectXExt]\nExtraEnumeratedResolutions=1920x1080\n',{bitness:32,preserveExisting:true});
  assert.equal(ini.getIni(output,'DirectX','VRAM'),'1024');
  assert.equal(ini.getIni(output,'DirectX','Filtering'),'16');
  assert.match(ini.getIni(output,'DirectXExt','ExtraEnumeratedResolutions'),/1920x1080/);
  assert.match(ini.getIni(output,'DirectXExt','ExtraEnumeratedResolutions'),/640x480/);
  const custom=ini.configureDgVoodoo('[DirectX]\nVRAM=1536\n[GeneralExt]\nFullscreenAttributes=borderless\n',{bitness:32,preserveExisting:true});
  assert.equal(ini.getIni(custom,'DirectX','VRAM'),'1536'); assert.equal(ini.getIni(custom,'GeneralExt','FullscreenAttributes'),'borderless');
  assert.equal(ini.getIni(ini.configureDgVoodoo('',{bitness:64}),'DirectX','VRAM'),'4096');
});

test('Steam vendor registry parser handles language/default values but excludes system keys and executable commands',t=>{
  const dir=fixture(t);
  const text='"InstallScript" { "Registry" { "HKLM\\\\Software\\\\Vendor\\\\Title" { "string" { "english" { "Path" "wrong" } "Path" "%INSTALLDIR%" } "dword" { "Installed" "1" } } "HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run" { "string" { "Bad" "bad.exe" } } } }';
  fs.writeFileSync(path.join(dir,'installscript.vdf'),text);
  const result=registry.collectInstallRegistry(dir,dir);
  assert.equal(result.length,2); assert.equal(result.find(v=>v.name==='Path').data,dir);
  assert.ok(result.every(v=>v.hive==='HKLM'&&v.subkey==='Vendor\\Title'));
  const reg=registry.parseRegFile('[HKEY_CURRENT_USER\\Software\\Vendor\\Game]\n@="hello"\n"Count"=dword:00000010\n[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Vendor]\n"Delete"="ignored"',dir);
  assert.equal(reg[0].values[0].name,'(Default)'); assert.equal(reg[0].values[1].data,'16');
});

test('installscript references cannot escape the game root or follow a junction',t=>{
  const root=fixture(t),dir=path.join(root,'Game');fs.mkdirSync(dir);
  const outside=path.join(root,'outside.reg');fs.writeFileSync(outside,'[HKLM\\Software\\Vendor]\n"Path"="bad"');
  const vdf=reg=>'"InstallScript" { "Run Process" { "Reg" { "command" "'+reg.replace(/\\/g,'\\\\')+'" } } }';
  fs.writeFileSync(path.join(dir,'installscript.vdf'),vdf(outside));
  assert.throws(()=>registry.collectInstallRegistry(dir,dir),{code:'errUnsafeTarget'});
  const target=path.join(root,'External');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'x.reg'),'');
  fs.symlinkSync(target,path.join(dir,'linked'),'junction');
  fs.writeFileSync(path.join(dir,'installscript.vdf'),vdf(path.join(dir,'linked','x.reg')));
  assert.throws(()=>registry.collectInstallRegistry(dir,dir),{code:'errUnsafeTarget'});
  assert.throws(()=>registry.checkOwned({version:1,owned:true,key:'HKCU\\Software\\OtherApp'},dir),{code:'errUnsafeTarget'});
});

test('shared Steam depots lose to an installed title in both discovery orders',t=>{
  const dir=fixture(t),shared={launcher:'Steam',id:'70',name:'Half-Life',dir,stateFlags:68},installed={launcher:'Steam',id:'10',name:'Counter-Strike',dir,stateFlags:4};
  for(const games of [[shared,installed],[installed,shared]]) assert.equal(library.dedupe(games)[0].id,'10');
});

test('legacy scanner excludes tools and prefers the game to its map editor',async t=>{
  const dir=fixture(t);
  for(const name of ['DFX.EXE','dfxmed.exe','REVUPDAT.EXE','hltv.exe']) writePe(path.join(dir,name),{bitness:32,text:'Direct3DCreate9',size:256*1024});
  const result=await require('../src/core/scan').scanGame(dir);
  assert.equal(result.chosen.name,'DFX.EXE');
});

test('Steam orphan filtering keeps resolvable, ambiguous and manifest-backed layouts',t=>{
  const dir=fixture(t);writePe(path.join(dir,'Game.exe'),{bitness:32});
  t.mock.method(require('../src/core/pe'),'getImports',()=>['vorbisfile.dll']);
  assert.equal(library.isBrokenSteamOrphan(dir,[]),true);
  fs.mkdirSync(path.join(dir,'bin'));fs.writeFileSync(path.join(dir,'bin','vorbisfile.dll'),'dependency');
  assert.equal(library.isBrokenSteamOrphan(dir,[]),false);
  fs.unlinkSync(path.join(dir,'bin','vorbisfile.dll'));fs.writeFileSync(path.join(dir,'Game.exe.manifest'),'side by side dependencies');
  assert.equal(library.isBrokenSteamOrphan(dir,[]),false);
});
