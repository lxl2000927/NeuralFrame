'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('@playwright/test');

// Chromium keeps Local Storage and preferences in userData. Give each scenario
// its own profile, including separate runs of the same suite.
async function launchFixture({ main = 'neuralframe-flow-main.cjs', env = {} } = {}) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'neuralframe-fixture-'));
  const environment = { ...process.env, ...env, NEURALFRAME_QA_FLOW_PROFILE: profile };
  delete environment.ELECTRON_RUN_AS_NODE;
  const removeProfile = () => fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  let app;
  try {
    app = await _electron.launch({
      executablePath: require('electron'),
      args: [path.join(__dirname, main)],
      env: environment,
    });
  } catch (error) {
    await removeProfile();
    throw error;
  }
  return {
    app,
    async close() {
      await app.close();
      await removeProfile();
    },
  };
}

module.exports = { launchFixture };
