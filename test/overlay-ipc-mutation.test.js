'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const {createRequire} = require('node:module');
const {writePe} = require('./fixtures/pe');
const {createOverlayLibrary} = require('../src/overlays');
const registerOverlayIpc = require('../src/overlay-ipc');
const journal = require('../src/core/file-journal');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-overlay-ipc-lock-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const profile = path.join(root, 'profile'), game = path.join(root, 'game');
  const exe = writePe(path.join(game, 'Game.exe'), {text:'D3D12CreateDevice'});
  const source = writePe(path.join(root, 'custom.addon64'), {text:'custom addon'});
  const bytes = fs.readFileSync(source); bytes.writeUInt16LE(bytes.readUInt16LE(0x96) | 0x2000, 0x96); fs.writeFileSync(source, bytes);
  const lib = createOverlayLibrary(path.join(profile, 'overlay-library'), path.join(root, 'missing.addon64'));
  const entry = lib.add(source);
  const handlers = new Map(), main = path.resolve(__dirname, '../main.js'), realRequire = createRequire(main);
  let picked = exe, beforeConfirm = () => {};
  const app = {isPackaged:false, setAppUserModelId(){}, whenReady:()=>({then(){}}), on(){}, getPath:()=>profile};
  const ipcMain = {handle:(name, fn)=>handlers.set(name, fn)};
  const dialog = {showOpenDialog:async()=>({canceled:false,filePaths:[picked]}),
    showMessageBox:async()=>{await beforeConfirm();return {response:1};}};
  const electron = {app, ipcMain, dialog};
  const host = Object.create(process); host.on = () => host;
  const context = vm.createContext({require:n=>n==='electron'?electron:realRequire(n), __dirname:path.dirname(main), process:host, Buffer, AbortController, console});
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, {filename:main});
  const exclusiveMutation = vm.runInContext('exclusiveMutation', context);
  registerOverlayIpc({app,ipcMain,dialog,window:()=>null,exclusiveMutation});
  return {root,game,exe,source,profile,lib,entry,exclusiveMutation,context,
    pick:file=>{picked=file;}, confirm:fn=>{beforeConfirm=fn;},
    call:(name,...args)=>handlers.get('overlay-'+name)({},...args)};
}

test('overlay mutations share the game-operation lock and keep failure responses at the IPC boundary', async t => {
  const f = fixture(t), installed = f.lib.install(f.entry.id, f.exe);
  let release, enter;
  const started = new Promise(resolve=>{enter=resolve;});
  const gate = new Promise(resolve=>{release=resolve;});
  const job = f.exclusiveMutation(()=>journal.group(f.game, async()=>{enter();await gate;return {ok:true};}));
  await started;
  try {
    for (const [name,arg,picked] of [['uninstall',installed.id,f.exe], ['install',f.entry.id,f.exe], ['remove',f.entry.id,f.exe], ['add',undefined,f.source]]) {
      f.pick(picked);
      const result = await f.call(name,arg);
      assert.equal(result.ok,false, name+' must not bypass the active game operation');
      assert.match(result.error, /另一项操作正在进行|Another operation is in progress/);
      assert.ok(fs.existsSync(installed.file));
      assert.equal(f.lib.list().installations.length,1);
      assert.equal(f.lib.resolve(f.entry.id).ready,true);
    }
    assert.equal((await f.call('preferences')).ok,true,'read-only settings remain available while a game operation is running');
  } finally {release();await job;}
  assert.equal((await f.call('uninstall',installed.id)).ok,true);
  assert.equal(fs.existsSync(installed.file),false);
  assert.equal((await f.call('remove',f.entry.id)).ok,true);
  f.pick(f.source);assert.equal((await f.call('add')).ok,true);
  f.pick(f.exe);assert.equal((await f.call('install',f.entry.id)).ok,true);
});

test('overlay confirmation happens before taking the mutation lock and rechecks a newly pinned game', async t => {
  const f = fixture(t), installed = f.lib.install(f.entry.id, f.exe);
  f.confirm(async()=>{
    assert.equal(vm.runInContext('mutationBusy',f.context),false,'native confirmation must not reserve the mutation lock');
    const review = new (require('../src/core/component-review').ComponentReview)(f.profile);
    await review.save(f.game,{version:1,dir:f.game,receipts:{},lock:{files:{}}});
  });
  const result = await f.call('uninstall',installed.id);
  assert.equal(result.ok,false);
  assert.match(result.error,/已锁定组件版本/);
  assert.ok(fs.existsSync(installed.file));
  assert.equal(f.lib.list().installations.length,1);
});

test('a game pinned while overlay removal waits for catalog reads is protected before any write', async t => {
  const f = fixture(t), installed = f.lib.install(f.entry.id, f.exe);
  let release;
  f.context.pendingCatalogRead = new Promise(resolve=>{release=resolve;});
  vm.runInContext("libraryReads.set('overlay-fixture', pendingCatalogRead)",f.context);
  const removal = f.call('uninstall',installed.id);
  try {
    // showMessageBox resolves first; exclusiveMutation then waits for the read.
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(vm.runInContext('mutationBusy',f.context),true);
    assert.ok(fs.existsSync(installed.file));
    const review = new (require('../src/core/component-review').ComponentReview)(f.profile);
    await review.save(f.game,{version:1,dir:f.game,receipts:{},lock:{files:{}}});
  } finally { release(); }
  const result = await removal;
  assert.equal(result.ok,false);
  assert.match(result.error,/已锁定组件版本/);
  assert.ok(fs.existsSync(installed.file));
  assert.equal(f.lib.list().installations.length,1);
  assert.equal(vm.runInContext('mutationBusy',f.context),false);
});
