'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const standalone=require('../src/library-standalone');
const library=require('../src/library');
const {writePe}=require('./fixtures/pe');
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
 const registrations=[{name:'KRInstall Wuthering Waves',icon:`"${path.join(game,'launcher.exe')}",0`}];
 const found=library.standalone({roots:[],platform:'win32',registrations});assert.equal(found.length,1);assert.equal(found[0].dir,game);
 assert.equal(library.dedupe([...found,...library.folder(game)]).length,1);
 assert.deepEqual(library.filterExcluded(found,[game]),[]);
});

test('recognizes NetEase official games from a corroborated installation and keeps Steam copies separate', t=>{
 const root=fixture(t),official=path.join(root,'Naraka'),steam=path.join(root,'steamapps','common','Naraka');
 const once=path.join(root,'OnceHuman'),launcher=path.join(root,'Launcher'),other=path.join(root,'Music');
 for(const dir of [official,steam])writePe(path.join(dir,'Client','Binaries','Win64','Game.exe'));
 writePe(path.join(once,'client.exe'));
 writePe(path.join(launcher,'launcher.exe'));writePe(path.join(other,'Music.exe'));
 const base={name:'{package-id}',title:'永劫无间',publisher:'杭州网易雷火科技有限公司'};
 const registrations=[{...base,location:official},{...base,location:steam},{...base,location:launcher},
   {...base,location:path.join(root,'Missing')},{...base,title:'网易云音乐',url:'https://oncehuman.game.invalid',location:other},
   {...base,publisher:'Unknown',location:other},
   {...base,title:'Once Human Global',url:'https://www.oncehuman.game/',icon:`"${path.join(once,'client.exe')}",0`},
   {...base,location:official}];
 const found=library.standalone({roots:[],platform:'win32',registrations});
 assert.deepEqual(found.map(g=>g.dir).sort(),[official,once].sort());
 assert.ok(found.every(g=>g.launcher==='NetEase Games'));
 const merged=library.dedupe([...found,{launcher:'Steam',id:'1203220',name:'永劫无间',dir:steam}]);
 assert.equal(merged.find(g=>g.dir===steam).launcher,'Steam');
 assert.equal(merged.find(g=>g.dir===official).launcher,'NetEase Games');
});
test('NetEase does not turn an external store record, stale icon or shared launcher helper into an official game',t=>{
 const root=fixture(t), bin=path.join(root,'Loading Bay','bin'), store=path.join(root,'Store copy');
 const game=writePe(path.join(store,'NarakaBladepoint.exe'));
 const helper=writePe(path.join(bin,'QtWebEngineProcess.exe'));
 const launcher=writePe(path.join(bin,'launcher.exe'));
 const note=path.join(root,'Incomplete');touch(path.join(note,'Game.exe'));
 const base={name:'Official',title:'NARAKA: BLADEPOINT',publisher:'NetEase Games'};
 const registrations=[
   {...base,location:bin}, {...base,icon:helper}, {...base,icon:launcher},
   {...base,location:note}, {...base,icon:path.join(store,'MissingGame.exe')},
   {...base,name:'Steam App 1203220',location:store}, {...base,name:'Uplay Install 999',icon:game},
 ];
 assert.deepEqual(library.standalone({roots:[],platform:'win32',registrations}),[]);
 assert.equal(library.standalone({roots:[],platform:'win32',registrations:[{...base,icon:game}]})[0].dir,store);
 const moved = {...base,location:path.join(root,'Old install'),icon:game};
 assert.equal(library.standalone({roots:[],platform:'win32',registrations:[moved]})[0].dir,store);
 assert.deepEqual(library.standalone({roots:[],platform:'win32',registrations:[{...moved,icon:helper}]}),[]);
});
test('install commands are only parsed as absolute executable paths',t=>{
 const root=fixture(t),exe=path.join(root,'launcher.exe');
 assert.equal(standalone.commandDirectory(`"${exe}",0`),root);
 assert.equal(standalone.commandDirectory(`${exe} --uninstall`),root);
 assert.equal(standalone.commandDirectory('launcher.exe --uninstall'),null);
});
