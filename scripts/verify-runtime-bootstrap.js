'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),catalog=require('../src/core/runtime-catalog.json');
const expected=catalog.packs.flatMap(p=>p.files.filter(f=>p.bundled||f.path.startsWith('licenses/')));
for(const f of expected){const file=path.join(root,'dist/runtime-bootstrap',f.path);if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==f.sha256)throw Error('Missing or modified bootstrap: '+f.path+'. Run scripts/build-runtime-packs.py with the verified native payload, or use the complete source archive.');}
const pkg=require('../package.json');
if(pkg.build.extraResources.some(r=>r.from==='payload'||r.from==='addons'))throw Error('Full offline payload must not be bundled');
console.log(JSON.stringify({bootstrapFiles:expected.length,bootstrapBytes:expected.reduce((s,f)=>s+f.size,0),runtimePacks:catalog.packs.filter(p=>!p.bundled).length}));
