'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('module');

// The update lookup runs in the main process against the real GitHub endpoint.
// Here the network is a stub, so the test is about what the app concludes.
function load(t, { version = '2.2.1', fetchImpl, channel = 'upstream', releaseRepository, appImage = false, electronVersion = version, windows } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swapper-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.resolve(__dirname, '../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const calls = { count: 0 };
  const stubs = {
    './package.json': {version, distribution:{channel,releaseRepository}},
    electron: {
      net: { fetch: async (...args) => { calls.count++; return fetchImpl(...args); } },
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => root, getVersion: () => electronVersion,
        relaunch: options => { calls.relaunch = options.execPath; }, exit() {} },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      shell: {openPath: async file => { calls.installer = file; return ''; }, showItemInFolder: file => { calls.revealed = file; }},
      clipboard: { writeText() {} }
    },
    './src/core/scan.js': { scanGame: async () => ({ chosen: null, exeCandidates: [] }), scanSource: () => ({ ok: false }) }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main),
    process: Object.assign(new EventEmitter(), appImage
      ? {env:{...process.env, APPIMAGE:path.join(root, 'current.AppImage')}, platform:'linux', arch:'arm64'}
      : windows ? {env:windows === 'portable' ? {PORTABLE_EXECUTABLE_DIR:root} : {}, platform:'win32', arch:'x64'}
      : {env:process.env, platform:process.platform}),
    Buffer, console, setTimeout, clearTimeout,
    AbortSignal,
    fetch: async (...args) => { calls.count++; return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });
  return { handlers, calls, root };
}

const release = (tag) => ({ ok: true, json: async () => ({ tag_name: tag }) });

test('independent version line never treats an upstream 2.x release as its update', async t => {
  const {handlers,calls}=load(t,{version:'0.1.0',channel:'independent',fetchImpl:async()=>release('v2.3.1')});
  const answer=await handlers.get('update-check')();
  assert.equal(answer.current,'0.1.0');assert.equal(answer.newer,false);assert.equal(answer.status,'unconfigured');assert.equal(calls.count,0);
});

test('independent release check uses only its configured repository', async t => {
  const {handlers,calls}=load(t,{version:'0.1.0',channel:'independent',releaseRepository:'lxl2000927/DLSS5-Swapper-Enhanced',fetchImpl:async url=>{
    assert.equal(url,'https://api.github.com/repos/lxl2000927/DLSS5-Swapper-Enhanced/releases/latest');return release('v0.1.1');
  }});
  const result=await handlers.get('update-check')();assert.equal(result.newer,true);assert.equal(result.latest,'0.1.1');assert.equal(calls.count,1);
});

test('a newer release is reported, an older or equal one is not', async (t) => {
  for (const [tag, newer] of [['v2.2.2', true], ['v2.3.0', true], ['v3.0.0', true],
    ['v2.2.1', false], ['v2.2.0', false], ['v2.10.0', true]]) {
    const { handlers } = load(t, { fetchImpl: async () => release(tag) });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, newer, `${tag} against 2.2.1`);
    assert.equal(answer.current, '2.2.1');
    assert.equal(answer.latest, tag.replace(/^v/, ''));
  }
});

test('automatic checks reuse the launch result', async (t) => {
  const { handlers, calls } = load(t, { fetchImpl: async () => release('v9.0.0') });
  const first = await handlers.get('update-check')();
  const second = await handlers.get('update-check')();
  assert.equal(first.newer, true);
  assert.deepEqual(second, first);
  assert.equal(calls.count, 1, 'the answer is kept for the session');
});

test('an offline AppImage can roll back locally and cannot process a competing switch before restart', async t => {
  const {root, handlers, calls} = load(t, {appImage:true, fetchImpl:async () => {throw Error('offline');}});
  const current = path.join(root, 'current.AppImage');
  fs.writeFileSync(current, 'new'); fs.writeFileSync(current + '.previous', 'old');
  const answer = await handlers.get('update-check')();
  assert.equal(answer.latest, null);
  assert.equal(answer.rollbackAvailable, true);
  const rollback = handlers.get('update-rollback')();
  assert.equal((await handlers.get('update-apply')()).ok, false);
  assert.equal((await handlers.get('update-rollback')()).ok, false);
  assert.equal((await rollback).ok, true);
  assert.equal((await handlers.get('update-rollback')()).ok, false);
  assert.equal(fs.readFileSync(current, 'utf8'), 'old');
  assert.equal(fs.readFileSync(current + '.rejected', 'utf8'), 'new');
  assert.equal(calls.count, 1);
});

test('AppImage IPC refreshes invalid staging and keeps one candidate across concurrent download, check and install requests', async t => {
  const repo = 'acme/app', base = 'https://github.com/' + repo + '/releases/download/v3/';
  const name = 'NeuralFrame-3.0.0-arm64.AppImage', bytes = Buffer.from('release bytes');
  const sha = require('node:crypto').createHash('sha512').update(bytes).digest('base64');
  const assets = [name, 'latest-linux-arm64.yml'].map(item => ({name:item, size:bytes.length, browser_download_url:base+item}));
  let downloads = 0, entered, resume;
  const started = new Promise(resolve => {entered = resolve;});
  const allowed = new Promise(resolve => {resume = resolve;});
  const {root, handlers} = load(t, {appImage:true, channel:'independent', releaseRepository:repo, fetchImpl:async url => {
    if (url.includes('api.github.com')) return Response.json({tag_name:'v3.0.0', assets});
    if (url === base + 'latest-linux-arm64.yml')
      return new Response(`files:\n  - url: ${name}\n    sha512: ${sha}\n    size: ${bytes.length}\n`);
    assert.equal(url, base + name);
    downloads++; entered(); await allowed; return new Response(bytes);
  }});
  const check = handlers.get('update-check'), download = handlers.get('update-download');
  const current = path.join(root, 'current.AppImage'), staged = path.join(root, '.neuralframe-update', name + '.verified');
  fs.writeFileSync(current, 'baseline'); fs.mkdirSync(path.dirname(staged));
  fs.writeFileSync(staged, Buffer.alloc(bytes.length, 1));
  assert.equal((await check()).staged, false, 'a corrupted file already present at startup is downloadable');
  fs.writeFileSync(staged, bytes);
  assert.equal((await check({}, true)).staged, true);
  fs.writeFileSync(staged, Buffer.alloc(bytes.length, 2));
  const failed = await handlers.get('update-apply')();
  assert.equal(failed.ok, false); assert.match(failed.message, /重新下载/);
  assert.equal((await check()).staged, false, 'the About pane immediately receives the cached download action');
  const sender = {isDestroyed:() => false, send() {}};
  const first = download({sender});
  await started;
  const second = download({sender});
  assert.equal((await check({}, true)).latest, '3.0.0');
  assert.equal((await handlers.get('update-rollback')()).ok, false);
  resume();
  assert.equal((await first).staged, true); assert.equal((await second).staged, true); assert.equal(downloads, 1);
  const rename = fs.promises.rename.bind(fs.promises);
  const backupWrite = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === current + '.previous') throw Error('fixture stopped finalizing backup');
    return rename(from, to);
  });
  const installed = await handlers.get('update-apply')();
  assert.equal(installed.ok, true, 'a switch that already took effect must restart instead of offering to install the same image again');
  assert.ok(installed.message);
  assert.equal(fs.readFileSync(current, 'utf8'), bytes.toString());
  backupWrite.mock.restore();
  await require('../src/core/appimage-update').recoverInterrupted(current);
  assert.equal(fs.readFileSync(current + '.previous', 'utf8'), 'baseline');
});

test('manual checks retry an offline result and share an in-flight release query', async t => {
  let online = false, tag = 'v2.2.2';
  const {handlers, calls} = load(t, {fetchImpl: async () => {
    if (!online) throw Error('offline');
    return release(tag);
  }});
  const check = handlers.get('update-check');
  assert.equal((await check()).latest, null);
  online = true;
  const [first, second] = await Promise.all([check({}, true), check({}, true)]);
  assert.equal(first.latest, '2.2.2');
  assert.deepEqual(first, second);
  assert.equal(calls.count, 2);
  tag = 'v2.2.3';
  assert.equal((await check({}, true)).latest, '2.2.3');
  assert.equal((await check()).latest, '2.2.3');
  assert.equal(calls.count, 3);
});

test('being offline, rate-limited or blocked says nothing at all', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const { handlers } = load(t, { fetchImpl });
    const answer = await handlers.get('update-check')();
    assert.equal(answer.newer, false, 'no notice is shown');
    assert.equal(answer.current, '2.2.1', 'and the running version is still reported');
  }
});

// A lookup that could not run reported {latest: null, newer: false}, which the
// sidebar rendered exactly like "nothing new". Someone on an old build whose
// check never completed was told nothing and had no reason to go and look.
test('a failed lookup is distinguishable from being up to date', () => {
  const failed = { current: '2.2.2', latest: null, newer: false };
  const current = { current: '2.2.3', latest: '2.2.3', newer: false };
  const behind = { current: '2.2.2', latest: '2.2.3', newer: true };

  // Exactly the branch order src/renderer/renderer.js uses.
  const shown = (a) => !a ? 'nothing' : !a.latest ? 'failed' : !a.newer ? 'nothing' : 'update';
  assert.equal(shown(failed), 'failed');
  assert.equal(shown(current), 'nothing');
  assert.equal(shown(behind), 'update');

  const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
  assert.match(renderer, /if \(!answer\.latest\) \{[\s\S]*updateCheckFailed/,
    'the renderer separates the two before it decides there is no news');
});

test('0.1.3 compares its own manifest with the release even when Electron reports 0.1.2', async t => {
  const {handlers} = load(t, {version:'0.1.3', electronVersion:'0.1.2', windows:'setup', fetchImpl:async () => release('v0.1.3')});
  for (const refresh of [false, true]) {
    const answer = await handlers.get('update-check')({}, refresh);
    assert.equal(answer.current, '0.1.3');
    assert.equal(answer.latest, '0.1.3');
    assert.equal(answer.newer, false);
    assert.ok(!answer.canInstall);
  }
});

for (const kind of ['setup', 'portable']) {
  test('Windows ' + kind + ' selects, verifies, and opens the matching release asset', async t => {
    const bytes = Buffer.from('verified fixture bytes');
    const sha = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const repository = 'acme/NeuralFrame', tag = 'v0.1.4';
    const prefix = 'https://github.com/' + repository + '/releases/download/' + tag + '/';
    const assets = ['Setup', 'Portable'].map(label => {
      const name = 'NeuralFrame-0.1.4-' + label + '-x64.exe';
      return {name, browser_download_url:prefix + name, size:bytes.length, digest:'sha256:' + sha};
    });
    const wanted = assets[kind === 'portable' ? 1 : 0];
    let body = Buffer.alloc(bytes.length);
    const {root, handlers, calls} = load(t, {version:'0.1.3', channel:'independent', releaseRepository:repository, windows:kind,
      fetchImpl:async url => {
        if (url.includes('api.github.com')) return Response.json({tag_name:tag, assets});
        assert.equal(url, wanted.browser_download_url);
        return new Response(body);
      }});
    const check = handlers.get('update-check'), apply = handlers.get('update-apply');
    const progress = [];
    const download = () => handlers.get('update-download')({sender:{isDestroyed:() => false, send:(_event, value) => progress.push(value)}});
    const file = path.join(root, 'NeuralFrame', wanted.name);
    assert.equal((await check()).assetName, wanted.name);
    assert.equal((await apply()).ok, false);
    assert.equal((await download()).ok, false);
    assert.ok(!fs.existsSync(file));
    body = bytes;
    assert.equal((await download()).staged, true);
    assert.equal(progress.at(-1).phase, 'verified');
    fs.writeFileSync(file, Buffer.alloc(bytes.length));
    assert.equal((await apply()).ok, false);
    assert.equal((await check()).staged, false);
    assert.equal((await download()).ok, true);
    assert.equal((await check({}, true)).staged, true);
    assert.equal((await apply()).ok, true);
    assert.equal(calls[kind === 'portable' ? 'revealed' : 'installer'], file);
    assert.equal(calls[kind === 'portable' ? 'installer' : 'revealed'], undefined);
  });
}

test('Windows checksum fallback binds the exact release file and refuses foreign assets', async () => {
  const channel = require('../src/core/windows-update');
  const name = 'NeuralFrame-0.1.4-Setup-x64.exe', tag = 'v0.1.4', repository = 'acme/app';
  const prefix = 'https://github.com/acme/app/releases/download/v0.1.4/';
  const sum = 'a'.repeat(64), manifest = sum + '  ' + name + '\n';
  const assets = [name, 'SHA256SUMS.txt'].map(n => ({name:n, browser_download_url:prefix+n, size:n === name ? 10 : Buffer.byteLength(manifest)}));
  const options = {repository, platform:'windows-setup', fetchImpl:async () => new Response(manifest)};
  assert.equal((await channel.resolve({tag_name:tag, assets}, options)).sha256, sum);
  assets[0].browser_download_url = 'https://example.com/' + name;
  await assert.rejects(channel.resolve({tag_name:tag, assets}, options), /缺少匹配/);
});
