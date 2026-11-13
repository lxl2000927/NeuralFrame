'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {writePe} = require('./fixtures/pe');
const {scanGame} = require('../src/core/scan');
const routes = require('../src/shared/install-routes');
const combined = require('../src/core/combined-manager');

test('graphics application and setup agree on SR input instead of treating any NGX or Streamline file as native DLSS', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nf-native-input-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  t.mock.method(require('../src/core/install-guards'),'assertGameClosed',async () => {});
  const cases = [
    {name:'Reflex only',files:[['sl.reflex.dll',[2,13,0,0]]],route:'feeder'},
    {name:'Streamline common only',files:[['sl.common.dll',[2,13,0,0]]],route:'feeder'},
    {name:'FG and NR only',files:[['nvngx_dlssg.dll',[310,9,1,0]],['nvngx_dlssnr.dll',[310,8,0,0]]],route:'feeder'},
    {name:'DLSS 1 plus FG',files:[['nvngx_dlss.dll',[1,0,0,0]],['nvngx_dlssg.dll',[310,9,1,0]]],route:'feeder'},
    {name:'Native DLSS 3',files:[['nvngx_dlss.dll',[3,1,0,0]]],route:'native'},
  ];
  for (const [i,item] of cases.entries()) {
    const dir = path.join(root,String(i));fs.mkdirSync(dir);
    writePe(path.join(dir,'Game-Win64-Shipping.exe'),{text:'D3D12CreateDevice',size:131072});
    for (const [name,version] of item.files) writePe(path.join(dir,name),{version});
    const before = Object.fromEntries(fs.readdirSync(dir).map(name=>[name,fs.readFileSync(path.join(dir,name))]));
    const scan = await scanGame(dir);
    assert.equal(routes.recommendedRoute(scan),item.route,item.name);
    const stop = new Error('dependency check only');
    let route;
    await assert.rejects(combined.applyCombinedConfiguration(dir,{neuralMode:'latest_compatible',mfgMode:'off',
      payloadDir:root,requirePayload:async request => {route=request.route;throw stop;}}),error=>error===stop);
    assert.equal(route,item.route,item.name);
    for (const [name,bytes] of Object.entries(before)) assert.deepEqual(fs.readFileSync(path.join(dir,name)),bytes);
  }
});
