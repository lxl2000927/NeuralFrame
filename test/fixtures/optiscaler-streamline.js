'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {root} = require('./payload');

function addPrivateStreamline(game) {
  const dir = path.join(game,'OptiScaler','streamline');
  fs.mkdirSync(dir,{recursive:true});
  for (const name of ['sl.interposer.dll','sl.common.dll','sl.dlss_g.dll','sl.reflex.dll','sl.pcl.dll','nvngx_dlssg.dll'])
    fs.copyFileSync(path.join(root,'streamline',name),path.join(dir,name));
  return dir;
}
module.exports = {addPrivateStreamline};
