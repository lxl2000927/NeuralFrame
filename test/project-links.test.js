'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {projectUrl} = require('../src/core/project-links');
const catalog = require('../src/core/runtime-catalog.json');
const {projectEvidenceSources} = require('../src/shared/component-evidence');

test('only registered version-specific evidence documents can be opened', () => {
  for (const url of projectEvidenceSources()) assert.equal(projectUrl({componentSource:url}), url);
  const doc = projectEvidenceSources().find(url => url.includes('/blob/'));
  for (const url of [doc + '?redirect=other', doc.replace(/\/blob\/[^/]+\//, '/blob/unregistered/'), doc.replace('github.com', 'github.com.evil.test')])
    assert.equal(projectUrl({componentSource:url}), null);
});

test('every downloadable paired component can open the release page rendered by the library', () => {
  for (const pack of catalog.packs.filter(pack => !pack.bundled)) {
    const release = pack.url.replace(/\/download\/([^/]+)\/[^/]+$/, '/tag/$1');
    assert.equal(projectUrl({componentSource:release}), release, pack.id + ' release page');
    const repository = 'https://github.com/' + (pack.repository || catalog.repository);
    assert.equal(projectUrl({componentSource:repository}), repository, pack.id + ' repository');
  }
});

test('paired-component links do not authorize unrelated repositories, pages or protocols', () => {
  for (const componentSource of [
    'https://github.com/SilyNoMeta/another-repo/releases',
    'https://github.com/SilyNoMeta/rtx-encore/issues',
    'https://github.com.evil.test/SilyNoMeta/rtx-encore/releases',
    'https://user:pass@github.com/SilyNoMeta/rtx-encore/releases',
    'file:///SilyNoMeta/rtx-encore/releases',
    'http://github.com/SilyNoMeta/rtx-encore/releases',
    'https://github.com/NVIDIA/DLSS/issues',
    'https://github.com/NVIDIA/other'
  ]) assert.equal(projectUrl({componentSource}), null);
});

test('every recorded component upstream has an openable project or release link independent of its download host',()=>{
  for (const pack of catalog.packs.filter(p=>!p.bundled)) {
    assert.ok(pack.upstreams?.length,pack.id+' has provenance');
    for (const upstream of pack.upstreams) {
      assert.notEqual(upstream.name.toLowerCase(),'lxl2000927/neuralframe');
      assert.equal(projectUrl({componentSource:upstream.url}),upstream.url,pack.id+' '+upstream.name);
    }
  }
});
