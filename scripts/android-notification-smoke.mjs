import {_android,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const attachedDevices=[];
async function listDevices(){const devices=await _android.devices();attachedDevices.push(...devices);return devices;}
const adb=path.resolve('.local/android-sdk/platform-tools/adb.exe'),serial='emulator-5554',pkg='local.unidesk.app';
const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:15000}).trim();
let device,page;
async function attach(){device=(await listDevices()).find(d=>d.serial()===serial);page=await(await device.webView({pkg},{timeout:60000})).page();await expect(page.locator('.app-shell,.setup-panel').first()).toBeVisible({timeout:45000});}
async function permissionButton(action){
 for(let attempt=0;attempt<40;attempt++){
  try{shell('shell','uiautomator','dump','/sdcard/unidesk-permission.xml');const xml=shell('shell','cat','/sdcard/unidesk-permission.xml');
   const tag=(xml.match(/<node\b[^>]*>/g)||[]).find(n=>n.includes(`resource-id="com.android.permissioncontroller:id/permission_${action}_button"`));
   const b=tag?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
   if(b){shell('shell','input','tap',String(Math.round((+b[1]+ +b[3])/2)),String(Math.round((+b[2]+ +b[4])/2)));return;}
  }catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 throw Error(`Notification ${action} dialog button unavailable`);
}
async function request(action,expected){await page.evaluate(()=>{window.__permissionResult=null;Notification.requestPermission().then(value=>window.__permissionResult=value);});await permissionButton(action);await expect.poll(()=>page.evaluate(()=>window.__permissionResult),{timeout:15000}).toBe(expected);}
async function deliver(title){await page.evaluate(async title=>{await window.__TAURI_INTERNALS__.invoke('plugin:notification|create_channel',{id:'academic-reminders',name:'Academic reminders',importance:3});new Notification(title,{body:'Native Android reminder verification',channelId:'academic-reminders'});},title);await expect.poll(()=>shell('shell','dumpsys','notification','--noredact').includes(title),{timeout:15000}).toBe(true);}
try{
 shell('shell','am','force-stop',pkg);
 shell('shell','pm','revoke',pkg,'android.permission.POST_NOTIFICATIONS');
 shell('shell','pm','clear-permission-flags',pkg,'android.permission.POST_NOTIFICATIONS','user-set','user-fixed');
 shell('shell','am','start','-W','-n',`${pkg}/.MainActivity`);await attach();
 await request('deny','denied');console.log('PASS: Android notification permission denial is handled');
 await request('allow','granted');await deliver('UniDesk permission verification');console.log('PASS: Android permission grant, channel and actual notification delivery');
 await device.close();device=null;shell('shell','am','force-stop',pkg);shell('shell','am','start','-W','-n',`${pkg}/.MainActivity`);await attach();
 await deliver('UniDesk reminder after restart');console.log('PASS: notification permission/channel delivery survives process restart');
}finally{await Promise.allSettled(attachedDevices.map(d=>d.close()));}
