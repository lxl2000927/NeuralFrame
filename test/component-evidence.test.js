'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEvidence, projectEvidenceSources } = require('../src/shared/component-evidence');
const text = evidence => JSON.stringify(evidence);

test('uncollected releases never borrow evidence from a known version', () => {
  for (const [component, version] of [
    ['mfg-renodx', '1.9.1'], ['mfg-renodx', '1.9.0-beta.1'], ['mfg-renodx', '1.9.0 patched'],
    ['mfg-universal', '1.7.2'], ['encore', '2.4.2'], ['streamline', '2.13'],
    ['renodx-nr', '8.5.0-rc10'], ['unknown', '1.9.0'], ['__proto__', 'constructor'],
  ]) {
    const result = projectEvidence(component, version);
    assert.equal(result.label, '暂未整理此版本说明');
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.sources, []);
    assert.equal(result.checkedAt, null);
    assert.doesNotMatch(result.label, /未验证|不兼容|待适配/);
  }
});

test('ambiguous neural-model DLL versions cannot acquire another file or project evidence', () => {
  for (const model of ['310.8.0.0', '310.8.SF-v2', '310.9.16-oct2026', '310.9.16.0']) {
    const result = projectEvidence('dlss-nr', model);
    assert.equal(result.checkedAt, null);
    assert.deepEqual(result.sources, []);
  }
});

test('RenoDX 1.5.5 retains its own real functional tests and measurement limits', () => {
  const result = projectEvidence('mfg-renodx', '1.5.5');
  assert.match(text(result), /RTX 4070 SUPER.*621\.01/);
  assert.match(text(result), /Elden Ring/);
  assert.match(text(result), /Dragon’s Dogma 2/);
  assert.match(text(result), /未包含画质与延迟测量/);
  assert.doesNotMatch(text(result), /RTX 5090D|RTX 3060 Ti|1\.9\.0/);
  assert.match(result.sources[0].url, /\/blob\/1\.5\.5\/docs\/releases\/1\.5\.5\.md$/);
});

test('RenoDX 1.9.0 distinguishes real XMX tests, simulated NVIDIA tests and native RTX 50', () => {
  const result = projectEvidence('mfg-renodx', '1.9.0');
  assert.match(text(result.records.find(item => item.scope === 'RTX 30 · XMX')), /已有实卡反馈/);
  const nvidia = result.records.find(item => item.scope === 'RTX 20 / 30 · NVIDIA 帧生成');
  assert.equal(nvidia.status, '实卡确认尚未完成');
  assert.match(nvidia.detail, /模拟.*不等同/);
  const native = result.records.find(item => item.scope.startsWith('RTX 50'));
  assert.match(native.detail, /不修改.*原生帧生成/);
  assert.match(native.detail, /RTX 5090D/);
});

test('Universal MFG evidence preserves native RTX 50 semantics and release-specific DX11 changes', () => {
  for (const version of ['1.7.0', '1.7.1']) {
    const result = projectEvidence('mfg-universal', version);
    const native = result.records.find(item => item.scope === 'RTX 50');
    assert.match(native.status, /原生多帧生成/);
    assert.match(native.detail, /不修改 NVIDIA/);
    assert.match(text(result), /需要游戏已有 Streamline DLSS 帧生成集成/);
  }
  const old = projectEvidence('mfg-universal', '1.7.0');
  assert.equal(old.records.find(item => item.scope === 'RTX 20 · DLSS 多帧生成').status, '实验性支持');
  assert.doesNotMatch(text(old.records), /新增的 DX11/);
  assert.match(text(projectEvidence('mfg-universal', '1.7.1').records), /DX11.*不等于 DX11 DLSS/);
});

test('Encore final fixes are not presented as confirmed in-game tests', () => {
  const current = projectEvidence('encore', '2.4.1');
  assert.match(text(current), /Stalker 2.*仍待反馈者确认/);
  assert.match(text(current), /HUD.*游戏内待确认/);
  const old = projectEvidence('encore', '2.3.0');
  assert.doesNotMatch(text(old), /Stalker 2|Horizon|2\.4\.1/);
  assert.match(text(old), /实验性/);
});

test('combined Feeder pack identifies each version without upgrading offline tests to game tests', () => {
  const combined = projectEvidence('feeder', '1.17 + 1.19');
  assert.equal(combined.sources.length, 2);
  assert.ok(combined.records.some(item => item.scope.startsWith('1.17.0')));
  assert.ok(combined.records.some(item => item.scope.startsWith('1.19.0')));
  assert.match(text(combined), /宿主自检，不是游戏内功能验证/);
  assert.match(text(combined), /这是模型限制，不是 Feeder 本身只支持 RTX 50/);
  assert.equal(projectEvidence('feeder', '1.17 + 1.20').checkedAt, null);
});

test('all documented sources are fixed HTTPS primary-project paths with a release or tag', () => {
  const owners = new Set(['mavismmg', 'dashdogy', 'SilyNoMeta', 'jlrouzies-fr', 'NVIDIA-RTX', 'NVIDIA', 'crosire']);
  const urls = projectEvidenceSources();
  assert.equal(urls.length, new Set(urls).size);
  assert.ok(urls.length >= 10);
  for (const source of urls) {
    const url = new URL(source);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'github.com');
    assert.equal(url.search, '');
    const parts = url.pathname.split('/');
    assert.ok(owners.has(parts[1]));
    assert.ok(parts[3] === 'blob' || (parts[3] === 'releases' && parts[4] === 'tag'));
    assert.doesNotMatch(url.pathname, /\/(?:main|master|latest)\//);
  }
});

test('metadata does not contain installation permissions and callers cannot mutate the catalog', () => {
  const result = projectEvidence('mfg-renodx', 'v1.9.0');
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'label', 'records', 'sources', 'summary']);
  result.records[0].status = 'all games supported';
  result.sources[0].url = 'https://example.com';
  result.records.push({ scope: 'cached', status: 'ready', detail: 'trusted' });
  const next = projectEvidence('mfg-renodx', '1.9.0');
  assert.equal(next.records.length, 3);
  assert.equal(next.records[0].status, '已有实卡反馈');
  assert.ok(projectEvidenceSources().includes(next.sources[0].url));
  const urls = projectEvidenceSources();
  urls.push('https://example.com');
  assert.ok(!projectEvidenceSources().includes('https://example.com'));
});

test('production runtime rows resolve exact evidence through the actual UI wrapper', async () => {
  const { groupLibrary, versionProjectEvidence } = await import('../ui/src/features/libraryCatalog.ts');
  const { packs } = require('../src/core/runtime-catalog.json');
  const engines = require('../src/core/engine-packages');
  const runtimePacks = packs.filter(pack => !pack.bundled).map(pack => ({
    ...pack,
    engine: ['encore', 'mfg-universal'].includes(pack.component) ? engines.describe(pack.component, pack) : undefined,
  }));
  const rows = groupLibrary({ runtimePacks, packages: [] }, []).flatMap(group => group.versions);
  const expected = new Map([
    ['feeder', ['v1.17.0', 'v1.19.0']],
    ['mfg-universal', ['v1.7.1']],
    ['mfg-optiscaler-170', ['v1.7.0']],
    ['encore', ['v2.4.1']],
    ['mfg-renodx', ['1.5.5']],
    ['sl-modern', ['v2.14.16']],
    ['sr-modern', ['v310.9.16']],
    ['reshade', ['v6.8.0']],
  ]);
  for (const [id, versions] of expected) {
    const row = rows.find(row => row.pack.id === id);
    assert.ok(row, `missing production row: ${id}`);
    const result = versionProjectEvidence(row);
    assert.equal(result.sources.length, versions.length, id);
    for (const version of versions) {
      assert.ok(result.sources.some(source => source.url.split('/').includes(version)), `${id}: ${version}`);
    }
  }
  for (const row of rows.filter(row => row.pack.component === 'dlss-nr')) {
    assert.equal(versionProjectEvidence(row).checkedAt, null, 'a model PE version cannot identify community project evidence');
  }
});

test('combined Feeder evidence stays version-scoped when both installed packages share its row', async () => {
  const { groupLibrary, versionProjectEvidence } = await import('../ui/src/features/libraryCatalog.ts');
  const pack = require('../src/core/runtime-catalog.json').packs.find(pack => pack.id === 'feeder');
  const packages = ['1.17.0', '1.19.0'].map(version => ({ id: version, component: 'feeder', version, present: true }));
  const [{ versions }] = groupLibrary({ runtimePacks: [{ ...pack, packageIds: packages.map(pkg => pkg.id) }], packages }, []);
  assert.equal(versions.length, 1);
  const result = versionProjectEvidence(versions[0]);
  assert.equal(result.sources.length, 2);
  assert.ok(result.records.some(item => item.scope.startsWith('1.17.0')));
  assert.ok(result.records.some(item => item.scope.startsWith('1.19.0')));
});

test('fingerprint-backed engine versions override misleading local or release labels in evidence', async () => {
  const { versionProjectEvidence } = await import('../ui/src/features/libraryCatalog.ts');
  const engines = require('../src/core/engine-packages');
  for (const component of ['encore', 'mfg-universal']) {
    const engine = engines.recommended(component);
    const result = versionProjectEvidence({ id: 'local', packages: [{ component, version: 'unrelated-label', engine }], releases: [] });
    assert.deepEqual(result, projectEvidence(component, engine.version));
  }
  const oldEncore = engines.identify('encore', 'b668a747e5eba576b544e4c6a790ce9c2d52b80389fe4f6ec999b6020f612471');
  assert.equal(oldEncore.version, '2.3.0');
  const oldResult = versionProjectEvidence({ id: 'old-encore', packages: [], releases: [{ component: 'encore', tag: 'v2.4.1', engine: oldEncore }] });
  assert.deepEqual(oldResult, projectEvidence('encore', '2.3.0'));
  const modelResult = versionProjectEvidence({ id: 'model', packages: [{ component: 'dlss-nr', version: '310.9.16.0' }], releases: [] });
  assert.equal(modelResult.checkedAt, null);
});
