'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const library = require('../src/library');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-steam-artwork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const apps = path.join(root, 'steamapps');
  const game = path.join(apps, 'common', 'Example Game');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(apps, 'appmanifest_123.acf'), '"AppState" { "appid" "123" "name" "Example Game" "installdir" "Example Game" }');
  const cache = path.join(root, 'appcache', 'librarycache');
  const write = name => {
    const file = path.join(cache, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'cached image');
    return file;
  };
  return { root, game, cache, write, discover: () => library.steam({ roots: [root] })[0] };
}

test('Steam discovery reuses local cover, hero and landscape capsule independently', t => {
  const f = fixture(t);
  const cover = f.write('123/library_600x900.jpg');
  const hero = f.write('123/library_hero.jpg');
  const tile = f.write('123/capsule_616x353.jpg');
  f.write('123/header.jpg');
  const game = f.discover();
  assert.deepEqual(game.poster, { file: cover, tall: true });
  assert.deepEqual(game.artwork, { hero, tile });
});

test('Steam artwork supports old flat cache and prefers a hero over a newer header', t => {
  const f = fixture(t);
  const hero = f.write('123_library_hero.jpg');
  const tile = f.write('123_capsule_616x353.jpg');
  f.write('123/header.jpg');
  assert.deepEqual(f.discover().artwork, { hero, tile });
});

test('Steam prefers a flat portrait over a nested header and ignores directories named as images', t => {
  const f = fixture(t);
  const cover = f.write('123_library_600x900.jpg');
  f.write('123/header.jpg');
  assert.deepEqual(f.discover().poster,{file:cover,tall:true});
  fs.mkdirSync(path.join(f.cache,'123/library_600x900.jpg'));
  assert.deepEqual(f.discover().poster,{file:cover,tall:true});
});

test('Steam headers are a hero fallback only and missing artwork never points at nonexistent files', t => {
  const f = fixture(t);
  assert.deepEqual(f.discover().artwork, { hero: null, tile: null });
  const header = f.write('123_header.jpg');
  f.write('123/header_292x136.jpg');
  fs.mkdirSync(path.join(f.cache, '123/capsule_616x353.jpg'));
  assert.deepEqual(f.discover().artwork, { hero: header, tile: null });
});

test('Steam artwork discovery never enumerates the artwork cache', t => {
  const f = fixture(t);
  const hero = f.write('123/library_hero.jpg');
  const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function(file, ...args) {
    assert.ok(!path.resolve(file).startsWith(path.resolve(f.cache)), 'fixed artwork candidates do not require a cache walk');
    return readdir.call(this, file, ...args);
  });
  assert.equal(f.discover().artwork.hero, hero);
});

test('canonicalized Cyberpunk DLC cannot keep artwork for its old Steam ID', t => {
  const f = fixture(t);
  const binary = path.join(f.game, 'bin/x64/Cyberpunk2077.exe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'fixture');
  const artwork = { hero: 'dlc-hero.jpg', tile: 'dlc-tile.jpg' };
  const dlc = { dir: f.game, launcher: 'Steam', name: 'Phantom Liberty', id: '2138330', artwork };
  assert.deepEqual(library.dedupe([dlc])[0].artwork, { hero: null, tile: null });
  const base = { ...dlc, id: '1091500', name: 'Cyberpunk 2077' };
  assert.deepEqual(library.dedupe([base])[0].artwork, artwork);
});
