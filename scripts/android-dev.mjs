import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0','--port','1420','--configLoader','runner'],{env:{...process.env,UNIDESK_ANDROID_DEV:'1'},stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exit(code??1));
