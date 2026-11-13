const {app,BrowserWindow,ipcMain}=require('electron'),path=require('path');
ipcMain.handle('qa-validate-overlay',(_event,value)=>{
 try{return{ok:true,value:require('../../src/overlay-preferences').validate(value)};}
 catch(error){return{ok:false,error:error.message};}
});
app.setPath('userData',path.resolve(__dirname,'../../qa-output/flow-profile'));
app.whenReady().then(()=>{const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:path.join(__dirname,'neuralframe-flow-preload.cjs'),contextIsolation:true,nodeIntegration:false}});win.loadFile(path.resolve(__dirname,'../../src/ui-dist/index.html'));});
app.on('window-all-closed',()=>app.quit());
