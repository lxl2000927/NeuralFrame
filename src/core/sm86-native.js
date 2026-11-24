'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const {fs} = require('./preview-fs');
const journal = require('./file-journal');
const apply = require('./apply');
const {copyFile} = require('./replace-file');
const {packs} = require('./runtime-catalog.json');
const pe = require('./pe');
const {isSteamMiles} = require('./steam-identity');

const packIds = Object.freeze({sr:'sm86-native-sr', rr:'rr-modern', fg:'sm86-native-fg', streamline:'sm86-native-streamline'});
const coreNames = {'nvngx_dlss.dll':'sr','nvngx_dlssd.dll':'rr','nvngx_dlssg.dll':'fg'};
const slNames = new Set(packs.find(p=>p.id===packIds.streamline).files
  .map(file=>path.basename(file.path).toLowerCase()).filter(name=>name.startsWith('sl.') && name.endsWith('.dll')));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const key = rel => path.normalize(rel).toLowerCase();
const parts = version => String(version || '').match(/\d+/g)?.slice(0,4).map(Number) || [];
function newer(a,b) {
  const x=parts(a), y=parts(b);
  for (let i=0;i<4;i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
function validate(selection) {
  if (!Array.isArray(selection) || selection.length > 4 || new Set(selection).size !== selection.length ||
      selection.some(k=>typeof k !== 'string' || !Object.hasOwn(packIds,k))) throw Error('原生运行库选择无效。');
  return selection;
}
function available(scan) {
  const added = new Set((scan.install?.added || []).map(key));
  const result = {sr:[],rr:[],fg:[],streamline:[]};
  const native = f => f.bitness === 64 && !f.featureMismatch && !added.has(key(f.rel));
  for (const f of scan.dlssFiles || []) {
    const kind=coreNames[f.name.toLowerCase()];
    if (kind && native(f) && f.version && !/^1\./.test(f.version) &&
        (f.xeMfgNgxDx12===kind || f.xeMfgNgxVk===kind)) result[kind].push(f);
  }
  const sl=(scan.streamlineFiles || []).filter(native);
  const folders=new Set(sl.filter(f=>/^sl\.(?:dlss(?:_[gd])?|common)\.dll$/i.test(f.name)).map(f=>key(path.dirname(f.rel))));
  result.streamline=sl.filter(f=>folders.has(key(path.dirname(f.rel))) && parts(f.version)[0]===2);
  return result;
}

function externalOwners(gameDir,exePath,files) {
  const dirs=new Set([path.dirname(exePath)]);
  for (const file of files) {
    let dir=path.dirname(file.path);
    while (!dirs.has(dir) && path.relative(gameDir,dir)!=='') {
      dirs.add(dir);
      dir=path.dirname(dir);
    }
  }
  dirs.add(gameDir);
  const foreign=new Set();
  for (const dir of dirs) {
    for (const name of ['.rtx-fg-v3/install.json',...['sr','rr','fg','streamline','encorefg'].map(id=>'.rtx-fg-runtimes/'+id+'/ownership.json')]) {
      const file=journal.safePath(gameDir,path.relative(gameDir,path.join(dir,name)));
      if (!fs.existsSync(file)) continue;
      if (!fs.statSync(file).isFile() || fs.statSync(file).size>1048576) throw Error('无法核对 RTXManager 的运行库记录：'+file);
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      const names=name.endsWith('install.json') ? Object.keys(saved.hashes || {}) : saved.entries.map(entry=>entry.path);
      for (const entry of names) foreign.add(key(path.resolve(dir,entry)));
    }
  }
  return foreign;
}

function streamlineTargets(scan,targets,byName) {
  const companions=[];
  for (const dir of new Set(targets.map(f=>path.dirname(f.path)))) {
    const present=new Map(fs.readdirSync(dir).map(name=>[name.toLowerCase(),name]));
    const unsupported=[...present.keys()].find(n=>/^sl\..+\.dll$/i.test(n) && !slNames.has(n));
    const incompatible=scan.streamlineFiles.find(f=>key(path.dirname(f.path))===key(dir) && f.name.toLowerCase()!=='sl.interposer.dll' &&
      (!f.version || parts(f.version)[0]!==2 || f.bitness!==64));
    if (unsupported || incompatible) throw Error('已有 Streamline 插件不在匹配组内：'+(unsupported || incompatible.rel));
    const required=['RTXFG-Streamline-LICENSE.txt'];
    if (present.has('sl.dlss_g.dll')) required.push('sl.common.dll','sl.pcl.dll','sl.reflex.dll');
    else if (present.has('sl.dlss.dll') || present.has('sl.dlss_d.dll')) required.push('sl.common.dll');
    for (const name of required) {
      const existing=present.get(name.toLowerCase()),item=byName.get(name.toLowerCase());
      if (existing) {
        if (name.endsWith('.txt') && hash(journal.safePath(dir,existing))!==item.sha256)
          throw Error('现有 Streamline 许可文件与配套包不同：'+path.join(dir,existing));
        continue;
      }
      const dest=journal.safePath(dir,name);
      companions.push({item,dest,rel:path.relative(scan.gameDir,dest),current:null});
    }
  }
  return companions;
}

async function update({gameDir,exePath,route,selection,manifest,files,checkedSource,copy}) {
  const kinds=validate(selection);
  const owned={...manifest.graphicsRoute?.nativeFiles};
  if (!kinds.length && !Object.keys(owned).length) return {nativeRuntimes:[],nativeFiles:{}};
  const scan=await require('./scan').scanGame(gameDir,exePath);
  if (!scan.chosen || path.relative(exePath,scan.chosen.path) !== '') throw Error('无法核实原生运行库所属的游戏程序。');
  const groups=available(scan);
  const miles=route==='sm86-delta' && isSteamMiles(exePath);
  const foreign=externalOwners(gameDir,exePath,kinds.flatMap(kind=>groups[kind]));
  const plans=[];
  for (const kind of kinds) {
    const pack=packs.find(p=>p.id===packIds[kind]);
    const byName=new Map(pack.files.map(f=>[path.basename(f.path).toLowerCase(),f]));
    const targets=groups[kind].filter(f=>kind!=='streamline' || f.name.toLowerCase()!=='sl.interposer.dll' ||
      miles && path.relative(path.dirname(exePath),path.dirname(f.path))==='' && groups.streamline.some(other=>
        key(path.dirname(other.path))===key(path.dirname(f.path)) && other.name.toLowerCase()==='sl.dlss_g.dll'));
    if (!targets.length) throw Error('当前游戏程序没有可更新的原生运行库：'+kind);
    if (kind==='streamline') {
      for (const file of streamlineTargets(scan,targets,byName))
        plans.push({...file,kind,src:checkedSource(pack,file.item)});
    }
    for (const file of targets) {
      const dest=journal.safePath(gameDir,file.rel), item=byName.get(file.name.toLowerCase());
      if (!item || (kind==='streamline' && parts(file.version)[0] !== 2)) throw Error('已有 Streamline 插件不在匹配组内：'+file.rel);
      const current=hash(dest);
      if (current===item.sha256) continue;
      if (foreign.has(key(dest))) throw Error('运行库由 RTXManager 管理：'+file.rel);
      if (!owned[file.rel] && (files[file.rel] || manifest.replaced.some(r=>key(r.rel)===key(file.rel)))) throw Error('原生运行库已有其他部署记录：'+file.rel);
      const src=checkedSource(pack,item);
      if (newer(file.version,pe.getFileVersion(src))) throw Error('已安装的运行库版本较新：'+file.rel);
      if (kind==='streamline' && !pe.hasExports(dest,[file.name.toLowerCase()==='sl.interposer.dll'?'slInit':'slGetPluginFunction'])) throw Error('Streamline 文件身份不匹配：'+file.rel);
      plans.push({src,dest,item,kind,rel:file.rel,current});
    }
  }
  for (const [rel,record] of Object.entries(owned)) {
    if (kinds.includes(record.kind)) continue;
    const dest=journal.safePath(gameDir,rel);
    if (fs.existsSync(dest) && hash(dest)!==files[rel]) throw Error('原生运行库已变化：'+rel);
    await journal.capture(gameDir,dest);
    if (record.original===null) {
      if (fs.existsSync(dest)) await fs.promises.unlink(dest);
      manifest.added=manifest.added.filter(item=>key(item)!==key(rel));
    } else {
      const backup=apply.originalPath(gameDir,manifest,rel);
      if (!fs.existsSync(backup) || hash(backup)!==record.original) throw Error('原件备份已变化：'+rel);
      await journal.capture(gameDir,backup);
      await copyFile(backup,dest,{clearReadOnly:true});
      await fs.promises.unlink(backup);
      manifest.replaced=manifest.replaced.filter(r=>key(r.rel)!==key(rel));
    }
    delete files[rel]; delete owned[rel];
  }
  for (const {src,dest,item,kind,rel,current} of plans) {
    if (foreign.has(key(dest)) || (fs.existsSync(dest) ? hash(dest) : null)!==current) throw Error('原生运行库已变化，请重新预览：'+rel);
    await copy(src,dest,item.sha256,true);
    if (hash(dest)!==item.sha256) throw Error('原生运行库与所选版本不一致：'+rel);
    owned[rel] ||= {kind,original:current};
  }
  return {nativeRuntimes:kinds,nativeFiles:owned};
}
module.exports={packIds,validate,available,update,externalOwners};
