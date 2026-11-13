'use strict';
// Official MFG releases omit their MIT notice. Keep the verified upstream
// notice in source control so a clean build can reproduce the bundled pack.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pack=require('../src/core/runtime-catalog.json').packs.find(p=>p.id==='mfg-license');
if(!pack?.bundled||pack.files.length!==1)throw Error('Missing MFG license manifest');
const expected=pack.files[0],source=path.join(root,'assets/licenses/MFG-Unlocker-LICENSE.txt');
const bytes=fs.readFileSync(source);
if(bytes.length!==expected.size||crypto.createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('MFG license source fingerprint mismatch');
const destination=require('../src/core/file-journal').safePath(path.join(root,'dist/runtime-bootstrap'),expected.path);
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
console.log('Prepared verified MFG Unlocker license');
