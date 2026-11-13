'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {writePe} = require('./fixtures/pe');
const payload = require('./fixtures/payload');
const wuwa = require('../src/core/wuthering-waves'), apply = require('../src/core/apply');
const engines = require('../src/core/engine-packages'), {ComponentLibrary} = require('../src/core/component-library');
const {ComponentReview} = require('../src/core/component-review');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('original MFG package installs in an isolated no-index game with selected identity, diagnostics and exact restore',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nf-wuwa-engine-package-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const dir=path.join(temp,'Game'),root=path.join(dir,'Wuthering Waves Game'),userDataDir=path.join(temp,'profile');
  const exe=writePe(path.join(root,'Client/Binaries/Win64/Client-Win64-Shipping.exe'),{text:'D3D12CreateDevice',size:131072});
  fs.writeFileSync(path.join(root,'Wuthering Waves.exe'),'launcher');
  const stock=writePe(path.join(root,'Engine/Plugins/nvngx_dlss.dll'),{version:[310,5,0,0]}),stockHash=digest(stock);
  const bin=path.dirname(exe),scan={chosen:{path:exe,bitness:64,api:'dxgi',apiLabel:'DirectX 12'}};
  const recommended=await engines.resolve({component:'mfg-universal',payloadDir:payload.root});
  assert.equal(recommended.version,'1.7.1');
  const library=new ComponentLibrary(userDataDir);
  const pkg=await library.importPackage({component:'mfg-universal',version:recommended.version,
    files:{'MFGUnlocker.dll':recommended.filePath},source:'isolated original engine test'});
  const config={payloadDir:payload.root,userDataDir,mfgMode:'x3',hardwareProfile:'rtx40_laptop',
    mfgPackageId:pkg.id,mfgAdvanced:{model:1,structure:1.25,tone:0.75,characterMask:true,character:0.5,diagnosticLogging:true}};
  const reviews=new ComponentReview(userDataDir),request={kind:'enhanced',config};
  const work=()=>wuwa.configure(dir,root,scan,config,()=>{});
  const plan=await reviews.run(dir,request,work);
  assert.equal(fs.existsSync(path.join(bin,'version.dll')),false);
  assert.ok(plan.preview.rows.some(row=>row.rel.endsWith('RTX40MFG-UI.ini')));
  await reviews.run(dir,request,work,plan.preview.token);
  const manifest=require('../src/core/backend-manager').readManifest(dir);
  const status=wuwa.inspectProxy(bin,manifest);
  assert.equal(digest(path.join(bin,'version.dll')),engines.recommended('mfg-universal').sha256);
  assert.equal(status.mfg.packageId,pkg.id);
  assert.equal(status.mfg.version,'1.7.1');
  assert.equal(status.mfg.engine.capabilities.diagnosticLogging,true);
  assert.equal(status.mfg.advanced.structure,1.25);
  assert.equal(status.mfg.advanced.diagnosticLogging,true);
  assert.equal(status.nr,false);
  const readCombined=()=>require('../src/core/combined-manager').inspectCombinedStatus(dir,{
    detectedHardware:{gpu:{name:'NVIDIA GeForce RTX 4070 Laptop GPU',driver:'617.42'}},
    payloadDir:payload.root,userDataDir
  });
  const combined=await readCombined();
  assert.equal(combined.launcherProtected,true);
  assert.equal(combined.mfg.version,'1.7.1');
  assert.equal(combined.mfg.packageId,pkg.id);
  assert.deepEqual(combined.mfg.engine,status.mfg.engine);
  assert.deepEqual(combined.mfg.advanced,config.mfgAdvanced);
  assert.deepEqual(combined.mfg.currentConfig.advanced,combined.mfg.advanced);
  assert.equal(combined.mfg.currentConfig.mode,'x3');
  assert.ok(fs.readFileSync(path.join(bin,'MFG-Unlocker-LICENSE.txt'),'utf8').includes('MIT'));
  // Editing FG later retains the installed selected version even without a
  // payload path or component-library handle; it is not an implicit update.
  await wuwa.configure(dir,root,scan,{mfgMode:'x4',hardwareProfile:'rtx40_laptop'},()=>{});
  assert.equal(wuwa.inspectProxy(bin,require('../src/core/backend-manager').readManifest(dir)).mfg.packageId,pkg.id);
  const restore=()=>apply.restore(dir);
  const removal=await reviews.run(dir,{kind:'restore'},restore);
  await reviews.run(dir,{kind:'restore'},restore,removal.preview.token);
  for(const name of ['version.dll','RTXMFG-Universal.json','RTX40MFG-UI.ini','MFG-Unlocker-LICENSE.txt'])
    assert.equal(fs.existsSync(path.join(bin,name)),false,name);
  assert.equal(digest(stock),stockHash);
  const restoredStatus=await readCombined();
  assert.equal(restoredStatus.mfg.engine,undefined);
  assert.equal(restoredStatus.mfg.advanced,undefined,'an absent loader must not expose invented capabilities or tuning');
});
