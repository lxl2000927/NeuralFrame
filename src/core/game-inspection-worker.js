'use strict';
// Only browsing uses this worker. Mutations and preview-fs stay on their
// original path so a worker cannot escape an installation preview context.
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { scanGame } = require('./scan');
const { inspectCombinedStatus } = require('./combined-manager');
const { getFileVersion } = require('./pe');
const scanCache = require('./scan-cache');

// Details needs only the SR version. A full payload scan also hashes the
// Feeder distribution, which belongs to installation and integrity checks.
function bundledDlssVersion(payloadDir) {
  if (!payloadDir) return null;
  const streamline = path.join(payloadDir, 'streamline');
  const dir = fs.existsSync(streamline) ? streamline : payloadDir;
  try {
    const file = fs.readdirSync(dir).find(name => /^nvngx_dlss\.dll$/i.test(name));
    return file ? getFileVersion(path.join(dir, file)) : null;
  } catch {
    return null;
  }
}

// The parent dispatches one read at a time so queued selections can be replaced.
parentPort.on('message', async ({ id, task, dir, options }) => {
  if (options.userDataDir) scanCache.configure(path.join(options.userDataDir, 'inspection-symbols-v1.json'));
  try {
    if (task === 'discover') {
      const { discover } = require('../library');
      const result = discover(options.folders, options.scanDrives, options.excludedRoots);
      parentPort.postMessage({ id, result });
      return;
    }
    if (task === 'inventory') {
      const { ComponentReview } = require('./component-review');
      const result = await new ComponentReview(options.userDataDir).inventory(dir);
      parentPort.postMessage({ id, result });
      return;
    }
    if (task === 'models') {
      const { listNeuralModels } = require('./neural-models');
      parentPort.postMessage({ id, result: listNeuralModels(options) });
      return;
    }
    if (!['scan', 'inspect'].includes(task)) throw Error('Unknown inspection task');
    const scan = await scanGame(dir);
    if (task === 'scan') {
      parentPort.postMessage({ id, result: scan });
      return;
    }
    // The header and install routes only need the file scan. Send it before
    // hardware detection and model verification, without walking the game twice.
    parentPort.postMessage({ id, phase: 'details', result: { scan, newDlss: bundledDlssVersion(options.payloadDir) } });
    let status;
    try { status = await inspectCombinedStatus(dir, { ...options, scanResult: scan }); }
    catch (error) { status = { ok: false, message: error.message }; }
    parentPort.postMessage({ id, result: { status } });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message, code: error.code });
  } finally {
    await scanCache.flush();
  }
});
