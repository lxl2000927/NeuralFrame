'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Only share work in flight. Explicit refreshes still read disk, and binary
// inspection uses the same stat-keyed cache throughout the worker's lifetime.
class GameInspection {
  constructor() {
    this.worker = null;
    this.nextId = 0;
    this.generation = 0;
    this.hardware = null;
    this.requests = new Map();
    this.active = null;
    this.nextSelection = null;
    this.closed = false;
  }
  start() {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, 'game-inspection-worker.js'));
    this.worker = worker;
    worker.on('message', ({ id, result, error, code }) => {
      if (this.worker !== worker || this.active?.id !== id) return;
      const request = this.active;
      this.active = null;
      this.requests.delete(request.key);
      if (error) request.reject(Object.assign(new Error(error), {code}));
      else request.resolve(result);
      this.dispatch();
    });
    const failed = error => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.rejectAll(error);
    };
    worker.on('error', failed);
    worker.on('exit', code => failed(new Error(`后台检测已退出 (${code})`)));
    return worker;
  }
  run(task, dir, options = {}, priority) {
    if (this.closed) return Promise.reject(new Error('检测服务已关闭'));
    let normalized = dir && path.resolve(dir);
    if (normalized && process.platform === 'win32') normalized = normalized.toLowerCase();
    const key = JSON.stringify([this.generation, task, normalized, options]);
    let request = this.requests.get(key);
    if (!request) {
      const workerOptions = task === 'inspect' ? { ...options, detectedHardware: this.hardware } : options;
      request = { key, id: ++this.nextId, task, dir, options: workerOptions, explicit: false };
      request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
      this.requests.set(key, request);
    }
    if (priority === 'selection') {
      const previous = this.nextSelection;
      // A normal caller sharing this read still needs its answer.
      if (previous && previous !== request && !previous.explicit) {
        this.requests.delete(previous.key);
        previous.reject(Object.assign(new Error('已切换到其他游戏'), {code: 'SELECTION_SUPERSEDED'}));
      }
      this.nextSelection = request === this.active ? null : request;
    } else {
      request.explicit = true;
    }
    this.dispatch();
    return request.promise;
  }
  dispatch() {
    if (this.active) return;
    const request = this.nextSelection || this.requests.values().next().value;
    if (!request) {
      this.worker?.unref();
      return;
    }
    this.active = request;
    this.nextSelection = null;
    try {
      const worker = this.start();
      worker.ref();
      const {id, task, dir, options} = request;
      worker.postMessage({id, task, dir, options});
    } catch (error) {
      this.active = null;
      this.requests.delete(request.key);
      request.reject(error);
      this.dispatch();
    }
  }
  invalidate() {
    // A post-apply request must not join a scan that began before the write.
    this.generation++;
  }
  setHardware(hardware) {
    this.hardware = hardware;
    this.invalidate();
  }
  rejectAll(error) {
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear();
    this.active = null;
    this.nextSelection = null;
  }
  close() {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    this.rejectAll(new Error('检测服务已关闭'));
    return worker?.terminate();
  }
}
module.exports = { GameInspection };
