import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, dateTime, locale } from '../ui/src/i18n.ts';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const parser = require('prettier/plugins/typescript').parsers.typescript;
const uiRoot = path.resolve(import.meta.dirname, '../ui/src');
const catalog = JSON.parse(fs.readFileSync(path.join(uiRoot, 'locales/en.json')));

test('every UI source phrase has an English translation with the same placeholders', () => {
  const missing = [];
  const scan = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) { scan(file); continue; }
      if (!/\.tsx?$/.test(item.name) || item.name === 'i18n.ts') continue;
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        const value = node.type === 'Literal' ? node.value : node.type === 'JSXText' ? node.value.trim() : null;
        if (typeof value === 'string' && /[\u3400-\u9fff]/.test(value) && value !== '简体中文' && !catalog[value]) missing.push(`${item.name}: ${value}`);
        for (const [key, child] of Object.entries(node)) {
          if (['loc', 'range', 'comments', 'tokens'].includes(key)) continue;
          if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === 'object') walk(child);
        }
      };
      walk(parser.parse(fs.readFileSync(file, 'utf8')));
    }
  };
  scan(uiRoot);
  assert.deepEqual(missing, []);
  for (const [source, target] of Object.entries(catalog)) {
    assert.deepEqual([...(target.match(/\{\d+\}/g) || [])].sort(), [...(source.match(/\{\d+\}/g) || [])].sort(), source);
  }
});

test('live language switching translates UI text and preserves opaque paths and game names', () => {
  setLanguage('en');
  assert.equal(t('设置'), 'Settings');
  assert.equal(t('更换封面：{0}', ['鸣潮']), 'Change cover: 鸣潮');
  assert.equal(t('需要 64 位组件：D:\\Games\\mod.dll'), 'A 64-bit component is required: D:\\Games\\mod.dll');
  setLanguage('zh');
  assert.equal(t('Settings'), '设置');
  assert.equal(t('Change cover: 鸣潮'), '更换封面：鸣潮');
});
test('interpolated messages translate in both directions without losing quantities', () => {
  setLanguage('en');
  assert.equal(t('恢复 {0} 个 · 移除 {1} 个', [2, 8]), '2 restored · 8 removed');
  assert.equal(t('恢复 2 个 · 移除 8 个'), '2 restored · 8 removed');
  setLanguage('zh');
  assert.equal(t('2 restored · 8 removed'), '恢复 2 个 · 移除 8 个');
});
test('dates follow the selected language and invalid legacy timestamps remain safe', () => {
  const value = '2026-11-06T12:34:56Z';
  for (const language of ['en', 'zh']) {
    setLanguage(language);
    assert.equal(dateTime(value), new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)));
    assert.equal(dateTime('invalid'), '—');
  }
});
