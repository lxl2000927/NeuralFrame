'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe} = require('./fixtures/pe');
const {ComponentLibrary} = require('../src/core/component-library');
const guards = require('../src/core/install-guards');
const backends = require('../src/core/backend-manager');

for (const operation of ['update','rollback']) {
  test(`component ${operation} rejects an executable replaced during the process check`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-exe-change-'));
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const game = path.join(root,'game'), exe = path.join(game,'Game.exe');
    const target = path.join(game,'nvngx_dlss.dll'), source = path.join(root,'source.dll');
    writePe(exe,{bitness:64,text:'D3D12CreateDevice'});
    writePe(target,{version:[2,0,0,0],text:'nvngx_dlss.pdb'});
    writePe(source,{version:[3,0,0,0],text:'nvngx_dlss.pdb'});
    const lib = new ComponentLibrary(path.join(root,'profile'));
    const pkg = await lib.importPackage({component:'dlss-sr',files:{'nvngx_dlss.dll':source}});
    t.mock.method(guards,'assertGameClosed',async()=>{});
    if (operation === 'rollback') await lib.apply(game,{'dlss-sr':pkg.id},{strict:true});
    const before = fs.readFileSync(target), manifest = backends.readManifest(game);
    t.mock.method(guards,'assertGameClosed',async()=>{
      fs.unlinkSync(exe);
      writePe(exe,{bitness:32,text:'D3D11CreateDevice'});
    });
    const work = operation === 'rollback' ? lib.rollback(game,manifest.componentHistory.at(-1).id)
      : lib.apply(game,{'dlss-sr':pkg.id},{strict:true});
    await assert.rejects(work,/主程序.*变化/);
    assert.deepEqual(fs.readFileSync(target),before);
    assert.deepEqual(backends.readManifest(game),manifest);
    assert.equal(fs.existsSync(path.join(game,'_DLSS5_Backup','pending-switch.json')),false);
  });
}
