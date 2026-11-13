'use strict';
// Prepare reproducible integration-test inputs outside the application profile.
// No game deployment, package build or release publishing happens here.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { RuntimePayload } = require('../src/core/runtime-payload');
const { DGVOODOO, LUMENITE, cached, fetchVerified } = require('../src/core/runtime-components');
const { distribution } = require('../package.json');

async function main() {
  if (!process.argv[2]) throw Error('Usage: node --use-env-proxy scripts/prepare-test-payload.js <test-cache-directory> [payload-source ...]');
  const destination = path.resolve(process.argv[2]);
  const appData = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), distribution.userDataDirectory);
  if (destination.toLowerCase() === path.resolve(appData).toLowerCase()) throw Error('Choose an isolated test directory, not the application profile.');
  const existing = new RuntimePayload(appData);
  let lastProgress = '';
  const runtime = new RuntimePayload(destination, {
    bundledRoot: path.resolve(__dirname, '../dist/runtime-bootstrap'),
    legacyRoots: [existing.payloadDir, ...process.argv.slice(3).map(p => path.resolve(p))],
    onProgress(event) {
      const percent = event.total ? Math.floor(event.loaded / event.total * 10) * 10 : 0;
      const message = `${event.id}: ${event.stage}${event.stage === 'download' ? ` ${percent}%` : ''}`;
      if (message !== lastProgress) { console.log(message); lastProgress = message; }
    },
  });
  await runtime.prepare([...runtime.packs.keys()]);
  const archives = [
    [`dgVoodoo2-${DGVOODOO.version}.zip`, DGVOODOO],
    [`LumeniteFX-${LUMENITE.commit.slice(0, 8)}.zip`, LUMENITE],
  ];
  for (const [name, spec] of archives) {
    const output = path.join(runtime.payloadDir, 'enhanced', 'components', name);
    if (cached(output, spec.sha256)) continue;
    const source = path.join(appData, 'components', name);
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    if (cached(source, spec.sha256)) await fs.promises.copyFile(source, output);
    else {
      console.log('Downloading verified test archive: ' + name);
      await fetchVerified(spec.url, spec.sha256, output);
    }
    if (!cached(output, spec.sha256)) throw Error('Test archive failed verification: ' + name);
  }
  await runtime.require([...runtime.packs.keys()]);
  console.log('\nTest payload ready: ' + runtime.payloadDir);
  console.log('Set NEURALFRAME_TEST_PAYLOAD_DIR to that directory before running npm test.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
