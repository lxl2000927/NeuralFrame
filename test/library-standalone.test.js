'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const standalone=require('../src/library-standalone');
const library=require('../src/library');
function fixture(t){
 const prefix=path.join(os.tmpdir(),'enhanced-library-'),root=fs.mkdtempSync(prefix);
 t.after(()=>{library.setRegistryRunner();assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function touch(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');}
function rail(dir){touch(path.join(dir,'StarRail.exe'));touch(path.join(dir,'UnityPlayer.dll'));fs.mkdirSync(path.join(dir,'StarRail_Data'),{recursive:true});}
function wuwa(dir){touch(path.join(dir,'Wuthering Waves Game','Client','Binaries','Win64','Client-Win64-Shipping.exe'));}
test('finds Wuthering Waves and Starward Star Rail inside Program Files',t=>{
 const root=fixture(t),programs=path.join(root,'Program Files');
 const a=path.join(programs,'Wuthering Waves'),b=path.join(programs,'Starward','Game','hkrpg_bilibili');
 wuwa(a);rail(b);touch(path.join(programs,'Other App','app.exe'));
 const games=standalone.fromRoots([programs,a]);
 assert.equal(games.length,2);assert.ok(games.some(g=>g.dir===a&&g.name==='鸣潮'));
 assert.ok(games.some(g=>g.dir===b&&g.launcher==='Starward'));
});
test('a selected Star Rail game root is one game, not its data subdirectories',t=>{
 const root=fixture(t);rail(root);touch(path.join(root,'StarRail_Data','Plugins','helper.exe'));
 assert.deepEqual(library.folder(root,'My folders',true).map(g=>g.dir),[root]);
});

test('a renamed Wuthering Waves client root is discovered as one game with the same evidence as the protected installer',t=>{
 const root=fixture(t),games=path.join(root,'Games'),game=path.join(games,'Renamed channel install');
 const client=path.join(game,'Client','Binaries','Win64','Client-Win64-Shipping.exe');
 touch(client);touch(path.join(game,'Wuthering Waves.exe'));
 assert.equal(require('../src/core/wuthering-waves').gameRoot(game,client),game,'the installation route already recognises this layout');
 const found=standalone.fromRoots([games,game]);
 assert.equal(found.length,1);assert.equal(found[0].dir,game);assert.equal(found[0].name,'鸣潮');
 assert.deepEqual(library.folder(game,'My folders',true).map(g=>g.dir),[game]);
 const unrelated=path.join(games,'Unrelated client');touch(path.join(unrelated,'Client','Binaries','Win64','Client-Win64-Shipping.exe'));
 assert.equal(standalone.recognize(unrelated),null,'a generic Unreal Client binary alone is not sufficient for a renamed root');
});
test('launcher-only and stale folders are not games and arbitrary apps are not traversed',t=>{
 const root=fixture(t);touch(path.join(root,'Wuthering Waves','launcher.exe'));
 touch(path.join(root,'Starward','Starward.exe'));
 rail(path.join(root,'Unrelated App','nested game'));
 assert.deepEqual(standalone.fromRoots([root,path.join(root,'Missing')]),[]);
});
test('known uninstall records find moved games and preserve exclusion/deduplication',t=>{
 const root=fixture(t),game=path.join(root,'Custom Install');wuwa(game);
 library.setRegistryRunner(args=>{
  const [,key,flag,value]=args;
  if(key==='HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')return 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KRInstall Wuthering Waves\n';
  if(/KRInstall Wuthering Waves$/.test(key)&&flag==='/v'&&value==='DisplayIcon')return `    DisplayIcon    REG_SZ    "${path.join(game,'launcher.exe')}",0\n`;
  throw Error('not found');
 });
 const found=library.standalone({roots:[],platform:'win32'});assert.equal(found.length,1);assert.equal(found[0].dir,game);
 assert.equal(library.dedupe([...found,...library.folder(game)]).length,1);
 assert.deepEqual(library.filterExcluded(found,[game]),[]);
});
test('install commands are only parsed as absolute executable paths',t=>{
 const root=fixture(t),exe=path.join(root,'launcher.exe');
 assert.equal(standalone.commandDirectory(`"${exe}",0`),root);
 assert.equal(standalone.commandDirectory(`${exe} --uninstall`),root);
 assert.equal(standalone.commandDirectory('launcher.exe --uninstall'),null);
});
