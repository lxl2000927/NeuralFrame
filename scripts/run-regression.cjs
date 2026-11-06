const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-output');fs.mkdirSync(out,{recursive:true});
const log=fs.openSync(path.join(out,'regression.log'),'w');
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),['--test','--test-concurrency=1',...fs.readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.test.js')).map(f=>path.join(root,'test',f))],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore',log,log]});
child.on('error',e=>{console.error(e);process.exitCode=1});child.on('exit',code=>{fs.closeSync(log);console.log(fs.readFileSync(path.join(out,'regression.log'),'utf8').split('\n').slice(-22).join('\n'));process.exitCode=code??1});
