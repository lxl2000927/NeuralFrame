'use strict';
// Exercise the actual portable wrapper twice without opening the app, accessing
// user data, or touching games. Keep the first extracted runtime alive while the
// second exits, then verify that its bundled F8 add-on can still be resolved.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const portable = path.resolve(process.argv[2] || '');
const evidence = path.resolve(process.argv[3] || 'build-output/portable-isolation');
const expectBug = process.argv.includes('--expect-shared-bug');
const stageIndex = process.argv.indexOf('--expected-stage');
const expectedStage = stageIndex >= 0 ? path.resolve(process.argv[stageIndex + 1]) : null;
if (!fs.statSync(portable).isFile()) throw Error('Pass the portable EXE path');
fs.mkdirSync(evidence, { recursive: true });
const runDir = fs.mkdtempSync(path.join(evidence, 'run-'));
const temp = path.join(runDir, 'temp');
fs.mkdirSync(temp);
const probe = path.join(runDir, 'probe.cjs');
if (expectedStage) {
  const hash = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const walk = (dir, prefix = '') => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [{file:prefix + e.name,sha256:hash(path.join(dir,e.name))}]);
  fs.writeFileSync(path.join(runDir, 'expected-payload.json'), JSON.stringify(walk(expectedStage)));
}
fs.writeFileSync(probe, `
const fs=require('fs'),path=require('path');
const root=path.dirname(process.execPath),out=process.env.PORTABLE_TEST_OUTPUT,id=process.env.PORTABLE_TEST_ID;
const archive=path.join(root,'resources/app.asar');
const pkg=require(path.join(archive,'package.json'));
const library=require(path.join(archive,'src/overlays.js')).createOverlayLibrary(path.join(out,'library-'+id),path.join(root,'resources/overlay/dlss5-lab-overlay.addon64'));
const snapshot=()=>({root,version:pkg.version,addon:library.resolve('builtin')});
const verifyPayload=()=>{
 const manifest=path.join(out,'expected-payload.json');if(!fs.existsSync(manifest))return null;
 const expected=JSON.parse(fs.readFileSync(manifest)),crypto=require('crypto'),physical=require('original-fs');
 // Electron's normal fs exposes app.asar as a virtual directory. Compare the
 // actual archive bytes and physical file list, just as the parent Node does.
 const walk=(dir,prefix='')=>physical.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
 if(JSON.stringify(walk(root))!==JSON.stringify(expected.map(e=>e.file).sort()))throw Error('Portable file list differs from staging');
 for(const item of expected){if(crypto.createHash('sha256').update(physical.readFileSync(path.join(root,item.file))).digest('hex')!==item.sha256)throw Error('Portable payload differs: '+item.file);}
 return {files:expected.length,allHashesMatched:true};
};
fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(snapshot()));
if(id==='first'){
 const timer=setInterval(()=>{
  if(!fs.existsSync(path.join(out,'finish')))return;
  clearInterval(timer);
  try{fs.writeFileSync(path.join(out,'after.json'),JSON.stringify({...snapshot(),payload:verifyPayload()}));}
  catch(e){fs.writeFileSync(path.join(out,'after.json'),JSON.stringify({error:e.message,root}));}
 },100);
 setTimeout(()=>process.exit(2),150000).unref();
}
`);
const children = [];
const pause = () => new Promise(r => setTimeout(r, 100));
async function waitFor(fn, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (!fn()) { if (Date.now() > deadline) throw Error('Timed out: ' + label); await pause(); }
}
function launch(id) {
  const child = cp.spawn(portable, [probe], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, ELECTRON_RUN_AS_NODE: '1', TEMP: temp, TMP: temp,
    PORTABLE_TEST_OUTPUT: runDir, PORTABLE_TEST_ID: id
  } });
  children.push(child);
  return child;
}
(async () => {
  try {
    const firstStarted = Date.now();
    const first = launch('first');
    await waitFor(() => fs.existsSync(path.join(runDir, 'first.json')), 'first extraction');
    const firstReadyMs = Date.now() - firstStarted;
    const a = JSON.parse(fs.readFileSync(path.join(runDir, 'first.json')));
    assert.ok(a.addon.ready, 'F8 add-on must be present on first launch');
    // Do not start a second instance until we know this test is isolated from
    // every user app already running in the normal Windows temporary folder.
    const relative = path.relative(temp, a.root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Extraction escaped test TEMP');
    const secondStarted = Date.now();
    const second = launch('second');
    await waitFor(() => fs.existsSync(path.join(runDir, 'second.json')), 'second extraction');
    const secondReadyMs = Date.now() - secondStarted;
    await waitFor(() => second.exitCode !== null, 'second wrapper exit');
    assert.equal(second.exitCode, 0);
    const b = JSON.parse(fs.readFileSync(path.join(runDir, 'second.json')));
    assert.ok(b.addon.ready, 'F8 add-on must be present on second launch');
    fs.writeFileSync(path.join(runDir, 'finish'), '');
    await waitFor(() => first.exitCode !== null, 'first wrapper exit');
    assert.equal(first.exitCode, 0);
    const after = JSON.parse(fs.readFileSync(path.join(runDir, 'after.json')));
    if (expectBug) {
      assert.equal(a.root, b.root);
      assert.ok(after.error || !after.addon?.ready, 'Expected the old shared-directory resource loss');
    } else {
      assert.notEqual(a.root, b.root, 'Each launch needs its own extraction directory');
      assert.ok(!after.error, after.error);
      assert.ok(after.addon?.ready, 'Second wrapper must not remove the running app F8 add-on');
      assert.equal(after.addon.sha256, a.addon.sha256);
      if (expectedStage) assert.ok(after.payload?.allHashesMatched, 'All extracted portable files must match staging');
    }
    assert.ok(!fs.existsSync(a.root) && !fs.existsSync(b.root), 'Wrappers must clean their own extraction directories');
    const result = { passed: true, reproducedOldBug: expectBug, first: a, second: b, after, temporaryExtractionsCleaned: true,
      startup: { firstReadyMs, secondReadyMs, boundary: 'portable wrapper spawn to extracted Electron Node probe and bundled F8 resolution; excludes renderer and game scanning' } };
    fs.writeFileSync(path.join(evidence, expectBug ? 'old-bug.json' : 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: true, version: a.version, reproducedOldBug: expectBug, separateDirectories: a.root !== b.root, addonSurvived: !!after.addon?.ready, firstReadyMs, secondReadyMs }));
  } finally {
    // Let the probe exit even if a preceding assertion fails.
    fs.writeFileSync(path.join(runDir, 'finish'), '');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
