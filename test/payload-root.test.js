'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {writePe} = require('./fixtures/pe');
const {resolvePayloadDir} = require('../src/core/payload-root');
const {applyMfgConfiguration} = require('../src/core/mfg-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-root-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('payload-root-'));
    fs.rmSync(root, {recursive:true,force:true});
  });
  return root;
}

test('legacy and on-demand desktop entry points use only the app resources, checkout, or prepared cache', t => {
  const root = fixture(t);
  const source = path.join(root,'checkout'), resources = path.join(root,'DLSS5-Swapper-app','resources');
  const cache = path.join(root,'cache'), dev = path.join(source,'payload'), packed = path.join(resources,'payload');
  const portable = path.join(root,'neighbor','portable');
  const stray = path.join(root,'ns123.tmp','app','resources','payload','streamline');
  for (const dir of [dev, portable, path.join(root,'neighbor','payload'), stray]) {
    fs.mkdirSync(dir,{recursive:true});
  }
  fs.writeFileSync(path.join(stray,'nvngx_dlssnr.dll'),'untrusted installer file');
  const entry = path.resolve(__dirname,'../main.js'), realRequire = createRequire(entry);
  const fakeProcess = Object.create(process, {
    resourcesPath:{value:resources}, env:{value:{...process.env, DLSS5_LIGHTWEIGHT:'0', PORTABLE_EXECUTABLE_DIR:portable}}
  });
  const app = {isPackaged:false,setAppUserModelId(){},whenReady:()=>({then(){}}),on(){},getPath:()=>root};
  const stubs = {electron:{app,ipcMain:{handle(){}}}, os:{...os,tmpdir:()=>root}};
  const context = vm.createContext({process:fakeProcess, __dirname:source, Buffer, console,
    require:id=>stubs[id] || realRequire(id), cache});
  vm.runInContext(fs.readFileSync(entry,'utf8'),context,{filename:entry});
  assert.equal(vm.runInContext('resolvePayloadRoot()',context),dev);
  fs.mkdirSync(packed,{recursive:true});
  assert.equal(vm.runInContext('resolvePayloadRoot()',context),packed);
  assert.equal(resolvePayloadDir(cache,resources,source),cache, 'explicit sources may be awaiting a download');
  app.isPackaged = true;
  vm.runInContext('runtimeCache = {payloadDir:cache}',context);
  assert.equal(vm.runInContext('resolvePayloadRoot()',context),cache);
});

test('MFG keeps an explicitly empty payload and cannot borrow an unrelated portable installation', async t => {
  const root = fixture(t), game = path.join(root,'game'), portable = path.join(root,'portable');
  const candidate = path.join(portable,'resources','payload','enhanced','mfg','renodx-mfgunlock.addon64');
  fs.mkdirSync(path.dirname(candidate),{recursive:true});
  fs.writeFileSync(candidate,'wrong package');
  writePe(path.join(game,'Game.exe'),{text:'D3D12CreateDevice'});
  const old = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = portable;
  t.after(() => { if (old === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR; else process.env.PORTABLE_EXECUTABLE_DIR = old; });
  await assert.rejects(applyMfgConfiguration(game, {
    mode:'x3', apiOverride:'d3d12', payloadDir:path.join(root,'missing'), gpuName:'NVIDIA GeForce RTX 4070 Laptop GPU'
  }), {code:'errMfgPayloadMissing'});
  assert.equal(fs.existsSync(path.join(game,'renodx-mfgunlock.addon64')),false);
  assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup','manifest.json')),false);
});
