'use strict';
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(process.env.NEURALFRAME_TEST_PAYLOAD_DIR || path.join(__dirname,'../../payload'));

// Integration tests may read an existing complete cache instead of duplicating
// large binaries in the checkout. This override is scoped to the test only.
function use(t) {
  const resolver = require('../../src/core/payload-root');
  const original = resolver.resolvePayloadDir;
  t.mock.method(resolver,'resolvePayloadDir',(explicit,resources,appRoot) => original(explicit || root,resources,appRoot));
}
// Copy only verified optional archives to each test's own temporary profile.
// The production extraction, integrity checks and deployment still run normally.
function seedRuntimeComponents(userDataDir) {
  const {DGVOODOO, LUMENITE, cached} = require('../../src/core/runtime-components');
  for (const [name, hash] of [
    [`dgVoodoo2-${DGVOODOO.version}.zip`, DGVOODOO.sha256],
    [`LumeniteFX-${LUMENITE.commit.slice(0, 8)}.zip`, LUMENITE.sha256],
  ]) {
    const source = path.join(root, 'enhanced', 'components', name);
    if (!fs.existsSync(source)) continue;
    if (!cached(source, hash)) throw Error('Invalid test component archive: ' + source);
    const destination = path.join(userDataDir, 'components', name);
    fs.mkdirSync(path.dirname(destination), {recursive:true});
    fs.copyFileSync(source, destination);
  }
}
module.exports = {root,use,seedRuntimeComponents};
