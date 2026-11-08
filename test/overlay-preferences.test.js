'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preferences = require('../src/overlay-preferences');

test('reads Windows UTF-8 BOM preferences and preserves the saved hotkey on a theme change', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-prefs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'overlay-preferences.json');
  const prefs = { enabled: false, theme: 'blue', hotkey: { key: 79, mods: 5 }, custom: null };
  const original = '\uFEFF' + JSON.stringify(prefs, null, 2);
  fs.writeFileSync(file, original);
  assert.deepEqual(preferences.read(dir), prefs);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  preferences.save(dir, { theme: 'purple' });
  assert.deepEqual(preferences.read(dir), { ...prefs, theme: 'purple' });
});
