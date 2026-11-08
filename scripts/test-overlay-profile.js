'use strict';
// Check the actual native build, not just the build-script source text.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),profile=require('../package.json').distribution.userDataDirectory;
assert.match(profile, /^[a-z0-9-]+$/);
const binary=fs.readFileSync(process.argv[2]||path.join(root,'dist/overlay/dlss5-lab-overlay.addon64'));
for(const text of [profile+'-overlay-',String.fromCharCode(92)+profile])
 assert.ok(binary.includes(Buffer.from(text,'utf16le')),`Native add-on must use application profile: ${text}`);
assert.ok(!binary.includes(Buffer.from('dlss5-swapper-overlay-','utf16le')),'Legacy app pipe must not be embedded');
console.log(`PASS native overlay endpoint/preferences profile and pipe prefix: ${profile}`);
