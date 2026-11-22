'use strict';

const path = require('node:path');
const { fs } = require('./preview-fs');
const apply = require('./apply');
const journal = require('./file-journal');
const { getIni, editIniField } = require('./feeder-config');

const kind = 'optiscaler-shared-config';
const asiBackend = 'mfg-unlocker-asi';
const countKeys = ['InterpolationCount', 'OverrideInterpolationCount'];
const dynamicKeys = ['ForceDMFG', 'OverrideForceDMFG'];

function read(file) {
  const bytes = fs.readFileSync(file);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8';
  const text = bytes.toString(encoding);
  return { text: text.replace(/^\uFEFF/, ''), encode: value => Buffer.from((text.startsWith('\uFEFF') ? '\uFEFF' : '') + value, encoding) };
}

function legacyReceipt(gameDir, manifest, rel) {
  const old = manifest.mfg;
  if (old?.backend !== asiBackend || path.dirname(rel) !== path.dirname(manifest.game.exe)) return null;
  const entry = manifest.replaced.find(item => item.rel === rel);
  const original = entry && apply.originalPath(gameDir, manifest, rel);
  const base = original && fs.existsSync(original) ? read(original).text : null;
  if (base === null && !old.optiDlssg) return null;
  const fields = [];
  const created = [];
  function recover(section, key, value, fallback) {
    if (fallback === undefined && base === null) return;
    const prior = base === null ? null : getIni(base, section, key);
    const before = fallback === undefined || (fallback === 'auto' && base !== null && prior === null) ? prior : fallback;
    if (value !== before) fields.push({ section, key, value, before });
    if (base !== null && !base.split(/\r?\n/).some(line => line.trim().toLowerCase() === `[${section.toLowerCase()}]`) && !created.includes(section)) created.push(section);
  }
  recover('Plugins', 'LoadAsiPlugins', 'true');
  if (old.optiDlssg) {
    for (const key of [...countKeys, ...dynamicKeys]) {
      if (Object.hasOwn(old.optiDlssg, key)) recover('DLSSG', key, countKeys.includes(key) ? String(old.multiplier - 1) : 'false', old.optiDlssg[key]);
    }
  } else {
    recover('MfgUnlock', 'Enabled', 'true');
    recover('MfgUnlock', 'ForceMultiplier', String(old.multiplier));
    const jsonRel = path.join(path.dirname(rel), 'RTXMFG-Universal.json');
    if (manifest.added.includes(jsonRel) || manifest.replaced.some(item => item.rel === jsonRel)) {
      try {
        const cfg = JSON.parse(read(journal.safePath(gameDir, jsonRel)).text);
        if (typeof cfg.temporalFix === 'boolean') recover('MfgUnlock', 'TemporalFix', String(cfg.temporalFix));
      } catch { /* An edited or removed legacy file cannot establish the old setting. */ }
    }
  }
  return { fields, created };
}

function restoreFields(text, record) {
  for (const field of record.fields) {
    if (getIni(text, field.section, field.key) === field.value) text = editIniField(text, field.section, field.key, field.before, record.created);
  }
  return text;
}

function recoverLegacyConfig(gameDir, manifest) {
  if (manifest.mfg?.backend !== asiBackend) return;
  const rel = path.join(path.dirname(manifest.game.exe), 'OptiScaler.ini');
  if (manifest.mfgOptiConfigs?.[rel]) return;
  const record = legacyReceipt(gameDir, manifest, rel);
  if (record) (manifest.mfgOptiConfigs ||= {})[rel] = record;
}

function setField(text, record, section, key, value) {
  const before = getIni(text, section, key);
  if (before === value) return text;
  const previous = record.fields.find(field => field.section === section && field.key === key);
  if (previous) {
    if (previous.value !== before) previous.before = before;
    previous.value = value;
  } else record.fields.push({ section, key, before, value });
  return editIniField(text, section, key, value, record.created);
}

function legacyNeural(gameDir, manifest, rel) {
  if (!manifest.neuralRendering || path.dirname(manifest.game.exe) !== path.dirname(rel)) return null;
  const item = manifest.replaced.find(row => row.rel === rel);
  if (!item) return null;
  const base = read(apply.originalPath(gameDir, manifest, rel)).text;
  const section = 'DlssNr', key = 'Enabled';
  const before = getIni(base, section, key);
  const value = manifest.neuralRendering.mode === 'off' ? 'false' : 'true';
  return {
    fields: value === before ? [] : [{section, key, before, value}],
    created: /^\s*\[DlssNr\]\s*$/im.test(base) ? [] : [section]
  };
}

async function configureNeural(gameDir, manifest, file, enabled) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(gameDir, file);
  const records = manifest.neuralOptiConfigs ||= {};
  const record = records[rel] ||= legacyNeural(gameDir, manifest, rel) || {fields: [], created: []};
  const { text, encode } = read(file);
  const next = setField(text, record, 'DlssNr', 'Enabled', String(enabled));
  if (text !== next) await apply.writeTracked(manifest, gameDir, file, encode(next), {kind});
}

async function configureAsi(gameDir, manifest, file, multiplier) {
  const rel = path.relative(gameDir, file);
  const record = manifest.mfgOptiConfigs?.[rel] ?? legacyReceipt(gameDir, manifest, rel);
  if (!fs.existsSync(file) || (!record && !multiplier)) return;
  const { text, encode } = read(file);
  let next = text;
  const active = record || { fields: [], created: [] };
  if (multiplier) {
    next = setField(next, active, 'Plugins', 'LoadAsiPlugins', 'true');
    next = setField(next, active, 'FrameGen', 'Enabled', 'true');
    next = setField(next, active, 'FrameGen', 'FGNvngxReplacement', 'none');
    for (const key of countKeys) next = setField(next, active, 'DLSSG', key, String(multiplier - 1));
    for (const key of dynamicKeys) {
      if (/^(true|1)$/i.test(getIni(next, 'DLSSG', key))) next = setField(next, active, 'DLSSG', key, 'false');
    }
  } else next = restoreFields(next, active);
  manifest.mfgOptiConfigs ||= {};
  // Another add-on can still have fields in a section ASI introduced. Keep that
  // provenance for full restore even after ASI itself has been switched off.
  manifest.mfgOptiConfigs[rel] = multiplier ? active : { fields: [], created: active.created };
  // Older stand-alone ASI installs tracked the entire external host as a generic config.
  const item = manifest.replaced.find(row => row.rel === rel);
  if (record && item?.kind === 'config' && !manifest.route) item.kind = kind;
  if (next !== text) await apply.writeTracked(manifest, gameDir, file, encode(next), { kind });
}

async function restoreExternal(gameDir, manifest, item) {
  if (path.basename(item.rel).toLowerCase() !== 'optiscaler.ini') return false;
  const shared = manifest.performanceMonitor?.shared?.[item.rel] || manifest.graphicsRoute?.shared?.[item.rel];
  // OptiScaler/ANR deployments also own host settings beyond these add-ons.
  if (manifest.optiscaler || manifest.route === 'anr') return false;
  const asi = manifest.mfgOptiConfigs?.[item.rel] ?? legacyReceipt(gameDir, manifest, item.rel);
  const neural = manifest.neuralOptiConfigs?.[item.rel] ?? legacyNeural(gameDir, manifest, item.rel);
  if (!asi && !neural && item.kind !== kind) return false;
  const records = [asi, neural, shared].filter(Boolean);
  const file = journal.safePath(gameDir, item.rel);
  if (records.length && fs.existsSync(file)) {
    const { text, encode } = read(file);
    const owners = { fields: records.flatMap(r => r.fields), created: records.flatMap(r => r.created || []) };
    const next = restoreFields(text, owners);
    if (next !== text) await require('./replace-file').writeText(file, encode(next));
  }
  return true;
}

module.exports = { configureAsi, configureNeural, restoreExternal, recoverLegacyConfig };
