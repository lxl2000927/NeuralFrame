'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const crypto=require('node:crypto');
const update=require('../src/core/appimage-update');
const sha=value=>crypto.createHash('sha512').update(value).digest('base64');
test('AppImage selection is architecture-specific and requires signed-size metadata fields',()=>{
 const release={assets:[{name:'NeuralFrame-2.0.0-arm64.AppImage',size:12,browser_download_url:'https://github.com/acme/app/releases/download/v2/arm64.AppImage'},{name:'NeuralFrame-2.0.0-x86_64.AppImage',size:12,browser_download_url:'https://github.com/acme/app/releases/download/v2/x64.AppImage'}]};
 assert.equal(update.selectAsset(release,'x64').name,'NeuralFrame-2.0.0-x86_64.AppImage');
 const metadata=update.parseMetadata('version: 2.0.0\nfiles:\n  - url: NeuralFrame-2.0.0-x86_64.AppImage\n    sha512: '+sha('new image')+'\n    size: 9\n','NeuralFrame-2.0.0-x86_64.AppImage');
 assert.equal(metadata.size,9);assert.equal(metadata.sha512,sha('new image'));
 assert.throws(()=>update.parseMetadata('files: []','x.AppImage'),/未描述/);
});
test('release resolution stays on the fixed repository and binds metadata to the selected asset',async()=>{
 const bytes=Buffer.from('image'),name='NeuralFrame-2.0.0-x86_64.AppImage',prefix='https://github.com/acme/app/releases/download/v2/';
 const release={assets:[{name,size:bytes.length,browser_download_url:prefix+name},{name:'latest-linux.yml',size:100,browser_download_url:prefix+'latest-linux.yml'}]};
 const asset=await update.resolve(release,{repository:'acme/app',arch:'x64',fetchImpl:async url=>{assert.equal(url,prefix+'latest-linux.yml');return new Response(`files:\n  - url: ${name}\n    sha512: ${sha(bytes)}\n    size: ${bytes.length}\n`);}});
 assert.equal(asset.sha512,sha(bytes));
 release.assets[0].browser_download_url='https://evil.example/update.AppImage';
 await assert.rejects(update.resolve(release,{repository:'acme/app',arch:'x64',fetchImpl:fetch}),/固定发布通道/);
});
test('local channel verifies bytes and transactionally applies and rolls back an AppImage',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'neuralframe-appimage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const current=path.join(root,'NeuralFrame.AppImage'),bytes=Buffer.from('new verified AppImage bytes');
 fs.writeFileSync(current,'old AppImage');
 const asset={name:'NeuralFrame-2.0.0-x86_64.AppImage',size:bytes.length,sha512:sha(bytes),url:null};
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 asset.url=`http://127.0.0.1:${server.address().port}/update.AppImage`;
 const{staged}=await update.download(asset,current,{fetchImpl:fetch});
 assert.equal((await update.hashFile(staged)).sha512,asset.sha512);
 await update.apply(asset,current,staged);assert.equal(fs.readFileSync(current,'utf8'),bytes.toString());assert.equal(fs.readFileSync(`${current}.previous`,'utf8'),'old AppImage');
 await update.rollback(current);assert.equal(fs.readFileSync(current,'utf8'),'old AppImage');
 fs.copyFileSync(current,`${current}.previous`);fs.rmSync(current);await update.recoverInterrupted(current);assert.equal(fs.readFileSync(current,'utf8'),'old AppImage');
});

test('arm64 release selection uses its own electron-builder manifest in a mixed or arm-only release', async () => {
  const prefix = 'https://github.com/acme/app/releases/download/v2/';
  const blob = name => ({name, size:7, browser_download_url:prefix + name});
  const arm = blob('NeuralFrame-2-arm64.AppImage');
  const metadata = blob('latest-linux-arm64.yml');
  for (const assets of [[arm, metadata], [blob('latest-linux.yml'), blob('NeuralFrame-2-x64.AppImage'), arm, metadata]]) {
    const asset = await update.resolve({assets}, {repository:'acme/app', arch:'arm64', fetchImpl:async url => {
      assert.equal(url, metadata.browser_download_url);
      return new Response(`files:\n  - url: ${arm.name}\n    sha512: ${sha('image64')}\n    size: 7\n`);
    }});
    assert.equal(asset.name, arm.name);
  }
  const oldRelease = {assets:[arm, blob('latest-linux.yml')]};
  const readLegacy = contents => update.resolve(oldRelease, {repository:'acme/app', arch:'arm64', fetchImpl:async () => new Response(contents)});
  assert.equal((await readLegacy(`files:\n  - url: ${arm.name}\n    sha512: ${sha('image64')}\n    size: 7\n`)).name, arm.name);
  await assert.rejects(readLegacy(`files:\n  - url: x64.AppImage\n    sha512: ${sha('image64')}\n    size: 7\npath: ${arm.name}\n`), /未描述/);
});

test('failed image switches preserve the launcher and historical backups and can be retried', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-appimage-failure-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const current = path.join(dir, 'NeuralFrame.AppImage'), previous = current + '.previous', rejected = current + '.rejected';
  const asset = {name:'v2.AppImage', size:3, sha512:sha('new')};
  const staged = update.stagedPath(asset, current);
  fs.mkdirSync(path.dirname(staged));
  fs.writeFileSync(current, 'old'); fs.writeFileSync(previous, 'older'); fs.writeFileSync(rejected, 'first'); fs.writeFileSync(staged, 'new');
  const rename = fs.promises.rename.bind(fs.promises);
  const failure = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === current) {
      assert.equal(fs.readFileSync(current, 'utf8'), 'old', 'the public launcher is live at the instant of replacement');
      throw Error('fixture replacement interrupted');
    }
    return rename(from, to);
  });
  await assert.rejects(update.apply(asset, current, staged), /replacement interrupted/);
  await assert.rejects(update.rollback(current), /replacement interrupted/);
  assert.deepEqual([current, previous, rejected, staged].map(file => fs.readFileSync(file, 'utf8')), ['old','older','first','new']);
  failure.mock.restore();
  await update.apply(asset, current, staged);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'old');
  await update.rollback(current);
  assert.equal(fs.readFileSync(current, 'utf8'), 'old');
  assert.equal(fs.readFileSync(rejected, 'utf8'), 'new');
});

test('startup recovers snapshots on both sides of an interrupted atomic switch, including copy fallback', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-appimage-recovery-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const current = path.join(dir, 'NeuralFrame.AppImage'), previous = current + '.previous';
  fs.writeFileSync(current, 'old'); fs.writeFileSync(previous, 'older');
  fs.copyFileSync(current, previous + '.pending');
  await update.recoverInterrupted(current);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'older');
  const asset = {name:'v2.AppImage', size:3, sha512:sha('new')}, staged = update.stagedPath(asset, current);
  fs.mkdirSync(path.dirname(staged)); fs.writeFileSync(staged, 'new');
  t.mock.method(fs.promises, 'link', async () => {throw Object.assign(Error('no hard links'), {code:'ENOTSUP'});});
  const rename = fs.promises.rename.bind(fs.promises);
  const failed = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === previous || to === current + '.rejected') throw Error('fixture stopped after the switch');
    return rename(from, to);
  });
  await assert.rejects(update.apply(asset, current, staged), /stopped after/);
  assert.equal(fs.readFileSync(current, 'utf8'), 'new');
  failed.mock.restore();
  await update.recoverInterrupted(current);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'old');
  const failedRollback = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === current + '.rejected') throw Error('fixture stopped during rollback');
    return rename(from, to);
  });
  await assert.rejects(update.rollback(current), /stopped during rollback/);
  assert.equal(fs.readFileSync(current, 'utf8'), 'old');
  failedRollback.mock.restore();
  await update.recoverInterrupted(current);
  assert.equal(fs.readFileSync(current + '.rejected', 'utf8'), 'new');
});
test('a modified staged image is never activated',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'neuralframe-appimage-reject-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const current=path.join(root,'NeuralFrame.AppImage');fs.writeFileSync(current,'old');
 const bytes=Buffer.from('new'),asset={name:'NeuralFrame.AppImage',size:3,sha512:sha(bytes)};
 const directory=path.join(root,'.neuralframe-update');fs.mkdirSync(directory);const staged=path.join(directory,'NeuralFrame.AppImage.verified');fs.writeFileSync(staged,'bad');
 await assert.rejects(update.apply(asset,current,staged),/校验失败/);assert.equal(fs.readFileSync(current,'utf8'),'old');
});

test('opening or writing staging failures reject the download, clean partials, and permit retry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-appimage-storage-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const current = path.join(root, 'Current.AppImage'), asset = {name:'new.AppImage', size:7, sha512:sha('updated')};
  fs.writeFileSync(current, 'running');
  const open = fs.promises.open.bind(fs.promises);
  for (const code of ['EACCES', 'ENOSPC']) {
    const failed = t.mock.method(fs.promises, 'open', async (file, flags, mode) => {
      if (!file.endsWith('.part')) return open(file, flags, mode);
      const error = Object.assign(Error('fixture disk error'), {code});
      if (code === 'EACCES') throw error;
      const handle = await open(file, flags, mode);
      return {writeFile:async () => {throw error;}, close:() => handle.close()};
    });
    const body = code === 'EACCES' ? new ReadableStream({pull() {}}) : 'updated';
    await assert.rejects(update.download(asset, current, {fetchImpl:async () => new Response(body)}), {code});
    failed.mock.restore();
    assert.equal(fs.readFileSync(current, 'utf8'), 'running');
    assert.deepEqual(fs.readdirSync(path.dirname(update.stagedPath(asset, current))), []);
  }
  await update.download(asset, current, {fetchImpl:async () => new Response('updated')});
  assert.equal(await update.isStaged(asset, current), true);
});

test('independent processes cannot mutate the same AppImage and killing the holder releases its lock', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuralframe-appimage-process-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const current = path.join(root, 'game.AppImage');
  fs.writeFileSync(current, 'working'); fs.writeFileSync(current + '.previous', 'backup');
  const script = `
    const update = require(process.argv[1]);
    update.download({name:'v2.AppImage'}, process.argv[2], {
      fetchImpl() { process.stdout.write('locked'); return new Promise(() => {}); }
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const {spawn} = require('node:child_process'), {once} = require('node:events');
  const holder = spawn(process.execPath, ['-e', script, require.resolve('../src/core/appimage-update'), current], {windowsHide:true});
  const exited = once(holder, 'exit');
  t.after(() => {if (holder.exitCode === null && holder.signalCode === null) holder.kill();});
  await Promise.race([once(holder.stdout, 'data'), exited.then(() => {throw Error('fixture failed to reserve the image');})]);
  await assert.rejects(update.rollback(current), /正在进行/);
  assert.equal(fs.readFileSync(current, 'utf8'), 'working');
  holder.kill(); await exited;
  await update.rollback(current);
  assert.equal(fs.readFileSync(current, 'utf8'), 'backup');
});
