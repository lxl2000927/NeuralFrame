'use strict';
const fs=require('./core/preview-fs').fs,path=require('node:path');
const {readNative}=require('./overlays');
const journal = require('./core/file-journal');
// Refuse unsupported routes BEFORE the game installer changes files. OptiScaler
// and the x86 helper architecture are deliberately not advertised as supported.
// The routes the panel can attach to. It rides on ReShade's Direct3D path, so
// what matters is that ReShade is installed under dxgi - which is true of the
// DLSS Tool route as much as of native and Feeder. Leaving it off this list is
// why a game installed that way got no overlay file at all, silently.
function routes(target){return target?.bitness===64&&target.api==='dxgi'&&target.apiLabel!=='DirectX 10'?['native','feeder']:[];}
function prepare({library,target,route}){
  if(!routes(target).includes(route))throw Error('The in-game overlay currently supports 64-bit DX11/DX12 only.');
  const entry=library.resolve('builtin');
  if(!entry.ready)throw Error(`The overlay add-on is missing from this app: ${entry.file}. Antivirus software removes it; restore it and add an exclusion, or reinstall DLSS 5 Swapper.`);
  const dir=path.dirname(target.path);
  const records=library.list().installations.filter(r=>r.directory.toLowerCase()===dir.toLowerCase());
  const previous = records.filter(record => record.overlayId === 'builtin' && record.sha256 !== entry.sha256);
  for (const record of previous) {
    if (fs.existsSync(record.file) && readNative(record.file).sha256 !== record.sha256)
      throw Error('Overlay was modified. Nothing was removed.');
  }
  const file=path.join(dir,`dlss5-lab-overlay-${entry.sha256.slice(0,16)}.addon64`);
  if(fs.existsSync(file)&&(!records.some(r=>r.file.toLowerCase()===file.toLowerCase())||readNative(file).sha256!==entry.sha256))throw Error('An untracked or modified overlay already exists.');
  return {entry,file,previous,alreadyPresent:fs.existsSync(file)};
}
async function attach({library,target,gameDir,manifest,saveManifest,plan}){
  const rel = path.relative(gameDir, plan.file);
  journal.safePath(gameDir, rel);
  let installed, next;
  await journal.transaction(gameDir, async () => {
    await journal.capture(gameDir, plan.file);
    const retired = new Set();
    for (const record of plan.previous) {
      await journal.capture(gameDir, record.file);
      retired.add(path.relative(gameDir, record.file).toLowerCase());
      if (!fs.existsSync(record.file)) continue;
      if (readNative(record.file).sha256 !== record.sha256) throw Error('Overlay was modified. Nothing was removed.');
      fs.unlinkSync(record.file);
    }
    // A backend switch can remove the previous managed file after preflight.
    const alreadyPresent = fs.existsSync(plan.file);
    let register;
    installed = library.install('builtin', target.path, target.bitness, plan.entry.sha256, write => { register = write; });
    const added = manifest.added.filter(file => !retired.has(file.toLowerCase()));
    if (!alreadyPresent && !added.some(file => file.toLowerCase() === rel.toLowerCase())) added.push(rel);
    next = { ...manifest, added, labOverlay: { sha256:installed.sha256, rel, recordId:installed.id, route:manifest.route, architecture:64 } };
    await saveManifest(gameDir, next);
    // These records live in the application profile. Commit them only after
    // every game file and the selected component versions have passed.
    if (register || plan.previous.length) journal.deferExternal(gameDir, installed.id, () => {
      if (register) register();
      for (const record of plan.previous) library.forgetMissing(record.id);
    });
  });
  Object.assign(manifest, next);
  return installed;
}
function cleanupMissing(library,exeDir){
  // Restore already removed tracked bytes. Only stale metadata is discarded.
  for(const record of library.list().installations){
    if (record.overlayId !== 'builtin' || path.relative(exeDir, record.directory) !== '') continue;
    if(!fs.existsSync(record.file))library.forgetMissing(record.id);
  }
}
function completeFeederConfig(text){
  // Pinned v0.12.0 upstream defaults absent from the shared app's cfg template.
  // Never reset a user's existing choice or invent values for unknown builds.
  let result=String(text);
  for(const [key,value] of [['work_upscale','0'],['work_sharpness','0.3']]){
    if(!new RegExp(`^[ \\t]*${key}[ \\t]*=`, 'im').test(result))result=result.replace(/\s*$/,'')+`\r\n${key}=${value}\r\n`;
  }
  return result;
}
module.exports={routes,prepare,attach,cleanupMissing,completeFeederConfig};
