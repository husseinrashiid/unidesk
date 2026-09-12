import {ensureOffline} from '../src/features/sync/transfers.ts';
import {pdfFixture} from '../tests/document-fixtures.ts';
import {chromium,expect,_android} from '@playwright/test';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const attachedDevices=[];
async function listDevices(){const devices=await _android.devices();attachedDevices.push(...devices);return devices;}
const root=process.cwd(),run=path.join(root,'.local/native-cross-device',String(Date.now()));fs.mkdirSync(run,{recursive:true});
const adb=path.join(root,'.local/android-sdk/platform-tools/adb.exe');
const shell=(...args)=>execFileSync(adb,['-s','emulator-5554',...args],{encoding:'utf8'}).trim();
const cli=process.env.SUPABASE_CLI??'supabase';
const coreOnly=process.env.UNIDESK_CORE_ONLY==='1';
const status=spawnSync(cli,['status','--workdir','.local/supabase-runtime','--output','json'],{encoding:'utf8'});if(status.status!==0)throw Error('Local Supabase is not running');
const server=JSON.parse(status.stdout),email=`native-${randomUUID()}@example.com`,password=`Native-${randomUUID()}-aA1!`;
const win=spawn(path.join(root,'src-tauri/target/debug/unidesk.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,UNIDESK_DATA_DIR:path.join(run,'windows'),UNIDESK_TEST_VAULT_PREFIX:`UniDesk/Test/${randomUUID()}`,WEBVIEW2_USER_DATA_FOLDER:path.join(run,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9233 --remote-allow-origins=http://localhost:9233'}});
let windows,android;
async function tap(selector,options={timeout:30000}){for(let attempt=0;;attempt++){try{return await android.tap(selector,options);}catch(error){if(attempt>=3||!String(error).includes('StaleObjectException'))throw error;await new Promise(r=>setTimeout(r,500));}}}
async function allowNotification() {
 for(let attempt=0;attempt<90;attempt++) {
  try {
   shell('shell','uiautomator','dump','/sdcard/unidesk-permission.xml');
   const xml=shell('shell','cat','/sdcard/unidesk-permission.xml');
   const node=xml.match(/<node\b[^>]*resource-id="com\.android\.permissioncontroller:id\/permission_allow_button"[^>]*>/)?.[0];
   const bounds=node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
   if(bounds){shell('shell','input','tap',String(Math.round((+bounds[1]+ +bounds[3])/2)),String(Math.round((+bounds[2]+ +bounds[4])/2)));return;}
  } catch {}
  await new Promise(r=>setTimeout(r,1000));
 }
 throw Error('Android notification permission dialog did not appear');
}
const captureAndroid=name=>fs.writeFileSync(path.join(run,name),execFileSync(adb,['-s','emulator-5554','exec-out','screencap','-p'],{maxBuffer:16*1024*1024}));
async function connect(port){for(let i=0;i<60;i++){try{return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);}catch{await new Promise(r=>setTimeout(r,500));}}throw Error(`WebView unavailable on ${port}`);}
const invoke=(page,command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const query=(page,sql,params=[])=>invoke(page,'query',{sql,params});
const batch=(page,statements)=>invoke(page,'batch',{statements});
async function sync(page){await page.evaluate(()=>window.dispatchEvent(new Event('unidesk:sync-now')));await expect.poll(async()=>Number((await query(page,'SELECT COUNT(*) n FROM sync_outbox'))[0].n),{timeout:45000}).toBe(0);}
try {
 windows=await connect(9233);let pc;
 for(let attempt=0;attempt<60;attempt++){
  pc=windows.contexts()[0].pages().find(p=>!p.isClosed()&&p.url()!=='about:blank');
  try{if(pc&&await pc.evaluate(()=>!!window.__TAURI_INTERNALS__))break;}catch{}
  pc=null;await new Promise(r=>setTimeout(r,500));
 }
 if(!pc)throw Error('Windows application page did not initialize');
 android=(await listDevices()).find(d=>d.serial()==='emulator-5554');const tab=await(await android.webView({pkg:'local.unidesk.app'},{timeout:60000})).page();await tab.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
 await expect(tab.getByRole('heading',{name:'Welcome to UniDesk'})).toBeVisible({timeout:30000});
 assertNative: {const versions=await Promise.all([query(pc,'PRAGMA user_version'),query(tab,'PRAGMA user_version')]);if(versions.some(v=>v[0].user_version!==21))throw Error('Native SQLite migration mismatch');}
 const folder=await invoke(pc,'create_folder',{base:run,name:`CrossDevice-${randomUUID()}`,course:true});
 const semester=randomUUID(),course=randomUUID(),task=randomUUID();
 await batch(pc,[{sql:'INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES(?,?,?,?,?)',params:[semester,'Native sync semester','2026-08-01','2026-12-31',folder]},{sql:'INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES(?,?,?,?,?)',params:[course,semester,'SYNC101','Native cross-device course',folder]},{sql:'INSERT INTO tasks(id,course_id,title) VALUES(?,?,?)',params:[task,course,'Windows offline task']}]);
 const file=await invoke(pc,'import_file',{courseId:course,category:'Resources',filename:'Windows syllabus.txt',bytes:[83,121,108,108,97,98,117,115]});
 const pdf=await invoke(pc,'import_file',{courseId:course,category:'Resources',filename:'Windows syllabus.pdf',bytes:Array.from(pdfFixture(['Windows syllabus evidence']))});
 const signup=await invoke(pc,'sync_account',{action:'signup',url:server.API_URL,publicKey:server.ANON_KEY,email,password});if(!signup.configured)throw Error('Local Supabase must auto-confirm test email');
 await pc.reload();await pc.getByRole('button',{name:'Settings',exact:true}).click();await pc.getByRole('button',{name:'Review this workspace'}).click();await pc.getByRole('button',{name:'Upload and enable sync'}).click();await sync(pc);
 // Android signs in through its production account screen and stores tokens in Keystore.
 await tab.getByText('Connect an existing UniDesk workspace',{exact:true}).click();
 await tab.getByLabel('Supabase server',{exact:true}).fill(server.API_URL);await tab.getByLabel('Publishable / anon key',{exact:true}).fill(server.ANON_KEY);await tab.getByLabel('Account email',{exact:true}).fill(email);await tab.getByLabel('Account password',{exact:true}).fill(password);await tab.getByRole('button',{name:'Sign in',exact:true}).click();
 await tab.getByRole('button',{name:'Set up this device',exact:true}).click({timeout:30000});
 await expect.poll(async()=>(await query(tab,'SELECT title FROM tasks WHERE id=?',[task]))[0]?.title,{timeout:45000}).toBe('Windows offline task');
 await expect.poll(async()=>(await query(tab,'SELECT state FROM sync_blobs WHERE file_id=?',[file.id]))[0]?.state,{timeout:45000}).toBe('available_offline');
 captureAndroid('android-synced.png');console.log('PASS: native account setup and Windows-to-Android records/files');
 const extracted=await invoke(tab,'document_extract',{fileId:pdf.id});if(!JSON.stringify(extracted.extraction).includes('Windows syllabus evidence'))throw Error('Android PDF extraction failed');
 const navigateAndroid=async(name)=>{const trigger=tab.getByRole('button',{name:'Open navigation'});if(await trigger.isVisible())await trigger.click();await tab.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
 await navigateAndroid('Courses');await expect(tab.getByRole('heading',{name:'Courses',exact:true})).toBeVisible();
 await tab.getByRole('button',{name:'Open SYNC101',exact:true}).click();await tab.getByRole('button',{name:'Syllabus',exact:true}).click();await expect(tab.getByRole('button',{name:'Import syllabus',exact:true})).toBeVisible();
 await navigateAndroid('Degree Progress');await expect(tab.getByRole('heading',{name:/Degree/}).first()).toBeVisible();
 await navigateAndroid('Calendar');await expect(tab.getByRole('heading',{name:'Calendar',exact:true})).toBeVisible();
 console.log('PASS: Android course, syllabus, degree and calendar pages');
 // Disable the emulator's connection to the test server, then commit an ordinary local edit.
 shell('reverse','--remove','tcp:54321');await batch(tab,[{sql:'UPDATE tasks SET title=? WHERE id=?',params:['Edited offline on Android',task]}]);if((await query(tab,'SELECT title FROM tasks WHERE id=?',[task]))[0].title!=='Edited offline on Android')throw Error('Offline save failed');
 shell('reverse','tcp:54321','tcp:54321');await sync(tab);await sync(pc);await expect.poll(async()=>(await query(pc,'SELECT title FROM tasks WHERE id=?',[task]))[0]?.title,{timeout:45000}).toBe('Edited offline on Android');
 if(!coreOnly){
 // Exercise the real Android document picker and URI staging before import.
 const pickedName=`Tablet-picked-${Date.now()}.txt`,pickedPath=path.join(run,pickedName);fs.writeFileSync(pickedPath,'Android document picker evidence');shell('push',pickedPath,`/sdcard/Download/${pickedName}`);
 await tab.evaluate(()=>{window.__picked=null;window.__TAURI_INTERNALS__.invoke('pick_documents',{multiple:false}).then(value=>window.__picked=value).catch(error=>window.__picked={error:String(error)});});
 await tap({desc:'Show roots'});await tap({text:'Downloads',res:'android:id/title'});
 await tap({text:pickedName,res:'android:id/title'});await expect.poll(()=>tab.evaluate(()=>window.__picked),{timeout:15000}).not.toBeNull();
 const selections=await tab.evaluate(()=>window.__picked);const picked=Array.isArray(selections)?selections[0]:null;if(typeof picked!=='string')throw Error('Document picker did not return a URI');
 const staged=await invoke(tab,'stage_document',{source:picked});const mobileFile=await invoke(tab,'import_file',{courseId:course,category:'Resources',source:staged});await sync(tab);await sync(pc);await expect.poll(async()=>(await query(pc,'SELECT state FROM sync_blobs WHERE file_id=?',[mobileFile.id]))[0]?.state,{timeout:45000}).toBe('available_offline');
 console.log('PASS: Android Storage Access Framework picker, native import and Windows download');
 await invoke(tab,'file_action',{id:file.id,action:'share'});await new Promise(r=>setTimeout(r,1000));shell('shell','input','keyevent','4');shell('shell','am','start','-W','-n','local.unidesk.app/.MainActivity');
 await tab.evaluate(id=>{window.__exported=null;window.__TAURI_INTERNALS__.invoke('file_action',{id,action:'export'}).then(()=>window.__exported=true).catch(e=>window.__exported=String(e));},file.id);
 for(let i=0;i<90;i++){let focus='';try{focus=shell('shell','dumpsys','window').match(/mCurrentFocus=.*/)?.[0]??'';}catch{}if(focus.includes('documentsui'))break;await new Promise(r=>setTimeout(r,1000));}
 await tap({text:/SAVE/i},{timeout:90000});await expect.poll(()=>tab.evaluate(()=>window.__exported),{timeout:15000}).toBe(true);
 shell('shell','am','start','-W','-n','local.unidesk.app/.MainActivity');console.log('PASS: Android FileProvider share and document-provider export');
 }
 // Evict only the synced cache, retaining the logical file and remote version.
 await invoke(tab,'sync_file',{operation:'evict',id:file.id});if((await query(tab,'SELECT COUNT(*) n FROM files WHERE id=?',[file.id]))[0].n!==1)throw Error('Eviction deleted logical metadata');
 const [evicted]=await query(tab,'SELECT state,auto_download,hash FROM sync_blobs WHERE file_id=?',[file.id]);
 if(evicted.state!=='cloud_available'||evicted.auto_download!==0)throw Error('Eviction did not retain cloud-only availability');
 await ensureOffline({query:(sql,params=[])=>query(tab,sql,params),batch:statements=>batch(tab,statements),command:(name,args)=>invoke(tab,name,args)},file.id);
 const restored=await invoke(tab,'sync_file',{operation:'prepare',id:file.id});if(restored.hash!==evicted.hash)throw Error('Redownload changed file bytes');
 await invoke(tab,'file_action',{id:file.id,action:'remove',disk:false});await sync(tab);await sync(pc);
 await expect.poll(async()=>(await query(pc,'SELECT COUNT(*) n FROM files WHERE id=?',[file.id]))[0].n,{timeout:45000}).toBe(0);
 console.log('PASS: Android local eviction, verified redownload and file tombstone to Windows');
 await batch(tab,[{sql:'DELETE FROM tasks WHERE id=?',params:[task]}]);await sync(tab);await sync(pc);await expect.poll(async()=>(await query(pc,'SELECT COUNT(*) n FROM tasks WHERE id=?',[task]))[0].n,{timeout:45000}).toBe(0);
 // Android Back closes the portrait drawer instead of leaving the app.
 const nav=tab.getByRole('button',{name:'Open navigation'});if(await nav.isVisible()){await nav.click();shell('shell','input','keyevent','4');await expect(tab.getByRole('dialog',{name:'Navigation',exact:true})).not.toBeVisible();}
 shell('shell','am','start','-W','-n','local.unidesk.app/.MainActivity');captureAndroid('android-final.png');console.log('PASS: offline reconnect, task/file tombstones and Android Back');await pc.screenshot({path:path.join(run,'windows-final.png')});
 // Restart with an offline change still queued; restoring transport happens after verification.
 const restartTask=randomUUID();shell('reverse','--remove','tcp:54321');
 await batch(tab,[{sql:'INSERT INTO tasks(id,course_id,title) VALUES(?,?,?)',params:[restartTask,course,'Pending across Android restart']}]);
 // Restart Android: SQLite and secure sign-in survive a process restart.
 await android.close();android=null;shell('shell','am','force-stop','local.unidesk.app');shell('shell','am','start','-n','local.unidesk.app/.MainActivity');
 let newPid='';for(let i=0;i<40&&!newPid;i++){try{newPid=shell('shell','pidof','local.unidesk.app');}catch{}if(!newPid)await new Promise(r=>setTimeout(r,500));}android=(await listDevices()).find(d=>d.serial()==='emulator-5554');const reopened=await(await android.webView({pkg:'local.unidesk.app'},{timeout:60000})).page();await reopened.waitForFunction(()=>!!window.__TAURI_INTERNALS__);await expect(reopened.locator('.app-shell')).toBeVisible({timeout:45000});
 if(!(await invoke(reopened,'sync_account',{action:'status'})).configured)throw Error('Android Keystore session did not survive restart');
 if((await query(reopened,'SELECT COUNT(*) n FROM courses WHERE id=?',[course]))[0].n!==1)throw Error('Android SQLite did not persist');
 if((await query(reopened,'SELECT COUNT(*) n FROM tasks WHERE id=?',[restartTask]))[0].n!==1)throw Error('Offline edit did not persist');
 if(!(await query(reopened,'SELECT COUNT(*) n FROM sync_outbox'))[0].n)throw Error('Offline outbox did not persist');
 shell('reverse','tcp:54321','tcp:54321');await sync(reopened);await sync(pc);
 await expect.poll(async()=>(await query(pc,'SELECT COUNT(*) n FROM tasks WHERE id=?',[restartTask]))[0].n,{timeout:45000}).toBe(1);
 if((await query(reopened,'SELECT COUNT(*) n FROM files WHERE id=?',[file.id]))[0].n!==0)throw Error('Deleted file returned after restart');
 console.log('PASS: Android Back, Keystore/SQLite and offline outbox restart persistence');
 if(!coreOnly){
 // Request permission in context and deliver through an Android native channel.
 await reopened.evaluate(()=>{window.__permission=null;Notification.requestPermission().then(p=>window.__permission=p);});
 if(await reopened.evaluate(()=>window.__permission)!=='granted')await allowNotification();
 await expect.poll(()=>reopened.evaluate(()=>window.__permission)).toBe('granted');
 await invoke(reopened,'plugin:notification|create_channel',{id:'academic-reminders',name:'Academic reminders',importance:3});
 await reopened.evaluate(()=>new Notification('UniDesk test reminder',{body:'Local reminder verification',channelId:'academic-reminders'}));
 await expect.poll(()=>shell('shell','dumpsys','notification','--noredact').includes('UniDesk test reminder'),{timeout:15000}).toBe(true);
 console.log('PASS: Android share, document export and native notification permission/channel delivery');

 }
 await invoke(reopened,'sync_account',{action:'signout'});await invoke(pc,'sync_account',{action:'signout'});
 console.log('PASS: native Windows/Android SQLite v19, Supabase signup/sign-in and first-sync review, structured/file synchronization, offline edit/reconnect, verified eviction/redownload, tombstones, Android Back and Keystore/SQLite/outbox restart persistence.');console.log(`Evidence: ${run}`);
}finally{await Promise.allSettled(attachedDevices.map(d=>d.close()));await windows?.close();win.kill();}
