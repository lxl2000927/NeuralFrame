'use strict';

const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

async function publishFile(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.promises.rename(source, destination);
    } catch (error) {
      if (process.platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error.code) || attempt >= 4) throw error;
      await delay(40 * (attempt + 1));
    }
  }
}

module.exports = publishFile;
