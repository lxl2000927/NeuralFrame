'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds } = require('../src/core/window-state');
const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const left = { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };

test('window state retains normal bounds and maximized state on a negative-coordinate monitor', () => {
  const saved = { x: -1800, y: 100, width: 1200, height: 800, maximized: true };
  assert.deepEqual(restoreBounds(saved, [primary, left], primary), saved);
});
test('a removed monitor or changed resolution cannot leave the window outside the work area', () => {
  const saved = { x: -4000, y: 1600, width: 2200, height: 1300, maximized: false };
  assert.deepEqual(restoreBounds(saved, [primary], primary), { ...primary.workArea, maximized: false });
});
test('window restoration clamps to a small display and rejects incomplete or corrupt state', () => {
  const small = { workArea: { x: 20, y: 10, width: 800, height: 600 } };
  assert.deepEqual(restoreBounds({ x: 10, y: 0, width: 500, height: 300 }, [small], small), { ...small.workArea, maximized: false });
  for (const saved of [null, {}, { x: 0, y: 0, width: NaN, height: 800 }, { x: '0', y: 0, width: 1200, height: 800 }]) {
    assert.equal(restoreBounds(saved, [primary], primary), null);
  }
});
