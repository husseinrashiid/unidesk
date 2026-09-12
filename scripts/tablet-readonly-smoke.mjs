import {_android,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';
const serial=process.env.UNIDESK_TABLET_SERIAL;if(!serial||serial.startsWith('emulator-'))throw Error('Set UNIDESK_TABLET_SERIAL to the connected physical tablet');
const attachedDevices=[];
async function listDevices(){const devices=await _android.devices();attachedDevices.push(...devices);return devices;}
const adb=path.resolve('.local/android-sdk/platform-tools/adb.exe'),pkg='local.unidesk.app';
const shell=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:20000}).trim();
const previous={auto:shell('shell','settings','get','system','accelerometer_rotation'),rotation:shell('shell','settings','get','system','user_rotation')};
const run=path.resolve('.local/tablet-acceptance',String(Date.now()));fs.mkdirSync(run,{recursive:true});
let device,page;
try{
 device=(await listDevices()).find(x=>x.serial()===serial);page=await(await device.webView({pkg},{timeout:60000})).page();await expect(page.locator('.app-shell')).toBeVisible({timeout:45000});
 const snapshot=()=>page.evaluate(async()=>{const q=sql=>window.__TAURI_INTERNALS__.invoke('query',{sql,params:[]});return {courses:await q('SELECT * FROM courses ORDER BY id'),semesters:await q('SELECT * FROM semesters ORDER BY id'),files:await q('SELECT id,filename,size FROM files ORDER BY id'),device:await q('SELECT device_id FROM sync_context'),signedIn:(await window.__TAURI_INTERNALS__.invoke('sync_account',{action:'status'})).configured};});
 await page.evaluate(()=>{if(document.querySelector('dialog[open]'))window.unideskAndroidBack();});
 shell('shell','uiautomator','dump','/sdcard/unidesk-hardware-check.xml');
 if(/Android App Compatibility|isn.t 16 KB compatible|LOAD segment not aligned/.test(shell('shell','cat','/sdcard/unidesk-hardware-check.xml')))throw Error('Native Android compatibility warning blocks the UI');
 const original=await snapshot(),fingerprint=createHash('sha256').update(JSON.stringify(original)).digest('hex');
 const before=JSON.parse(fs.readFileSync('.local/tablet-upgrade-baseline.json','utf8'));if(fingerprint!==before.fingerprint)throw Error('Tablet workspace fingerprint changed during upgrade');
 console.log('PASS: data-preserving APK update retains courses, semesters, files, device identity and account state');
 const navigate=async name=>{const trigger=page.getByRole('button',{name:'Open navigation'});if(await trigger.isVisible())await trigger.click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
 const capture=name=>fs.writeFileSync(path.join(run,name),execFileSync(adb,['-s',serial,'exec-out','screencap','-p'],{maxBuffer:16*1024*1024}));
 shell('shell','settings','put','system','accelerometer_rotation','0');
 for(const [rotation,orientation] of [['0','portrait'],['1','landscape']]){
  shell('shell','settings','put','system','user_rotation',rotation);
  await expect.poll(()=>page.evaluate(()=>innerWidth>innerHeight),{timeout:15000}).toBe(rotation==='1');
  await navigate('Courses');await expect(page.getByRole('heading',{name:'Courses',exact:true})).toBeVisible();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`${orientation} overflows horizontally`);
  await page.getByRole('button',{name:`Open ${original.courses[0].code}`,exact:true}).click();
  await page.getByRole('button',{name:'Syllabus',exact:true}).click();await expect(page.getByRole('button',{name:/^(Import|Replace) syllabus$/})).toBeVisible();
  await navigate('Degree Progress');await expect(page.getByRole('heading',{name:/Degree/}).first()).toBeVisible();
  await navigate('Calendar');await expect(page.getByRole('heading',{name:'Calendar',exact:true})).toBeVisible();
  await navigate('Assignments');await page.getByRole('button',{name:'Add assignment',exact:true}).click();
  const modal=page.getByRole('dialog');await expect(modal).toBeVisible();await modal.getByLabel('Title',{exact:true}).click();await modal.getByLabel('Title',{exact:true}).fill('Unsaved hardware check');
  const keyboard=shell('shell','dumpsys','input_method');console.log(`PASS: ${orientation} courses, syllabus, degree, calendar and edit dialog (keyboard reported: ${/mInputShown=true|mIsInputViewShown=true/.test(keyboard)})`);
  const submit=modal.getByRole('button',{name:'Add assignment',exact:true});await submit.scrollIntoViewIfNeeded();await expect(submit).toBeInViewport();capture(`${orientation}-dialog.png`);
  await page.evaluate(()=>window.unideskAndroidBack());await expect(modal).not.toBeVisible();
 }
 await navigate('Dashboard');capture('tablet-dashboard.png');
 if(createHash('sha256').update(JSON.stringify(await snapshot())).digest('hex')!==fingerprint)throw Error('Readonly tablet checks changed workspace records');
 console.log(`PASS: physical tablet portrait/landscape, fit and readonly academic navigation. Evidence: ${run}`);
}finally{
 await page?.evaluate(()=>{if(document.querySelector('dialog[open]'))window.unideskAndroidBack();}).catch(()=>{});
 for(const [key,value] of [['accelerometer_rotation',previous.auto],['user_rotation',previous.rotation]]){if(value==='null')shell('shell','settings','delete','system',key);else shell('shell','settings','put','system',key,value);}
 await Promise.allSettled(attachedDevices.map(d=>d.close()));
}
