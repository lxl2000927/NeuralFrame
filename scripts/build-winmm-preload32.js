'use strict';
// Compile the reviewed C source. Do not regenerate it from an embedded copy.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const zig = option('--zig', process.env.NEURALFRAME_ZIG || 'zig');
const output = path.resolve(option('--output', path.join(root, 'build-output/preloader32/winmm.dll')));
const native = path.join(root, 'src/native/dgv_preload32');
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync(zig, ['cc', '-target', 'x86-windows-gnu', '-shared', '-O2', '-s', path.join(native, 'winmm_preload.c'), path.join(native, 'winmm.def'), '-o', output], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SOURCE_DATE_EPOCH: '1794470400' } });
const bytes = fs.readFileSync(output), sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
if (require('../src/core/pe').getBitness(output) !== 32) throw Error('Expected a 32-bit preloader');
if (args.includes('--stage')) {
  const catalogPath = path.join(root, 'src/core/runtime-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const pack = catalog.packs.find(p => p.id === 'localization');
  const file = pack.files.find(f => f.path === 'enhanced/zh-cn/winmm.dll');
  file.size = bytes.length; file.sha256 = sha256(bytes);
  pack.contentId = sha256(JSON.stringify(pack.files));
  const staged = path.join(root, 'dist/runtime-bootstrap', file.path);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.copyFileSync(output, staged);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
}
console.log(JSON.stringify({ output, size: bytes.length, sha256: sha256(bytes), staged: args.includes('--stage') }));
