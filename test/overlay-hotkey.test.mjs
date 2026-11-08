import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { keyFromEvent, keyLabel } from '../ui/src/overlay-hotkey.ts';

const require = createRequire(import.meta.url);
const { validate, defaults } = require('../src/overlay-preferences.js');
const event = (code, modifiers = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });

test('captured keys and combinations are accepted by the actual overlay preferences', () => {
  const keys = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F8', 'F24', 'Space', 'PageUp', 'PageDown', 'End', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete'];
  for (const code of keys) for (let mods = 0; mods < 8; mods++) {
    const hotkey = keyFromEvent(event(code, { ctrlKey: !!(mods & 1), altKey: !!(mods & 2), shiftKey: !!(mods & 4) }));
    assert.ok(hotkey, code);
    assert.equal(hotkey.mods, mods);
    assert.deepEqual(validate({ ...defaults(), hotkey }).hotkey, hotkey);
  }
  assert.equal(keyLabel(keyFromEvent(event('KeyO', { ctrlKey: true, shiftKey: true }))), 'Ctrl + Shift + O');
  assert.equal(keyLabel(keyFromEvent(event('F24'))), 'F24');
});

test('reserved keys, modifier-only events and unsupported keys cannot be saved', () => {
  for (const code of ['Home', 'Escape', 'Tab', 'ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'Enter', 'F0', 'F25', 'Numpad1', 'Unidentified']) assert.equal(keyFromEvent(event(code)), null, code);
  assert.equal(keyFromEvent(event('KeyO', { metaKey: true })), null);
});
