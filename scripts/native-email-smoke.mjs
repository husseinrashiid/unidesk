// Native UI integration with a simulated Microsoft boundary. No real account or tokens.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(),run=path.join(root,'.local/native-email-smoke',String(Date.now()));fs.mkdirSync(run,{recursive:true});
const child=spawn(path.join(root,'src-tauri/target/release/unidesk.exe'),[],{env:{...process.env,UNIDESK_DATA_DIR:run,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9232 --remote-allow-origins=http://localhost:9232',WEBVIEW2_USER_DATA_FOLDER:path.join(run,'webview')},windowsHide:true,stdio:'ignore'});
let browser;
try{
 for(let i=0;i<40;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9232');break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
 if(!browser)throw Error('Native email test could not connect.');const page=browser.contexts()[0].pages()[0];
 page.on('pageerror',error=>console.log('Test page error: '+error.message));
 await expect(page.getByRole('heading',{name:'Welcome to UniDesk'})).toBeVisible({timeout:20000});
 await expect(page.getByRole('heading',{name:'Welcome to UniDesk'})).toBeVisible({timeout:20000});await page.getByLabel('University folder',{exact:true}).fill(path.join(run,'University'));await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Create semester',exact:true}).click();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 await page.evaluate(()=>{
  const original=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  window.__mailTest={mode:'pending',begins:0,cancels:0,pages:0,session:'',original};
  const failure=(code,kind,message)=>({code,kind,message,timestamp:new Date().toISOString(),http_status:400});
  window.__mailInvokeMock=async(command,args,options)=>{
   const state=window.__mailTest;
   if(command==='email_auth'){
    if(args.action==='cancel'){state.cancels++;if(!args.sessionId || args.sessionId===state.session)state.session='';return null;}
    if(args.action==='begin'){state.begins++;if(state.mode==='network')throw failure('network_unavailable','network','Could not reach Microsoft. Check your connection and retry; cached email remains available.');state.session=crypto.randomUUID();return {sessionId:state.session,userCode:'TEST-CODE',verificationUrl:'https://microsoft.com/devicelogin',interval:5,expiresIn:900};}
    if(args.action==='diagnostics')return {details:'Timestamp: fixture\nError code: AADSTS65001\nDescription: Administrator approval required.\nAuthority: organizations'};
    if(args.action==='poll'){
     if(state.mode==='expired')throw failure('expired_token','expired','Sign-in code expired. Retry to get a new code.');
     if(state.mode==='approval')throw failure('AADSTS65001','consent','Your university does not allow this app to access your mailbox without administrator approval.');
     if(state.mode!=='success')return {pending:true,interval:5};
     await original('batch',{statements:[{sql:"INSERT INTO email_accounts(id,provider,email_address,display_name,client_id,connected) VALUES('mock-aub','microsoft','student@mail.aub.edu','AUB test account','11111111-2222-3333-4444-555555555555',1) ON CONFLICT(id) DO UPDATE SET connected=1,sync_error='',retry_after=NULL"}]});
     return {connected:true,accountId:'mock-aub',emailAddress:'student@mail.aub.edu'};
    }
    return null;
   }
   if(command==='email_request' && args.accountId==='mock-aub'){
    if(args.operation==='disconnect'){await original('batch',{statements:[{sql:"UPDATE email_accounts SET connected=0 WHERE id='mock-aub'"}]});return null;}
    if(args.operation==='page'){state.pages++;if(state.mode==='revoked')throw failure('invalid_grant','expired','Microsoft sign-in expired or was revoked. Reconnect your university account; cached email remains available.');return {value:[{id:'immutable-fixture-message',subject:'University announcement',from:{emailAddress:{address:'professor@example.edu'}},receivedDateTime:'2026-09-07T08:00:00Z',bodyPreview:'Welcome to the course.'}],'@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=fixture'};}
   }
   return original(command,args,options);
  };
  // Simulate only email IPC responses; native database and other commands remain real.
  const realFetch=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
   const command=new URL(String(url),location.href).pathname.slice(1);
   if(command!=='email_auth' && command!=='email_request')return realFetch(url,options);
   try{return new Response(JSON.stringify(await window.__mailInvokeMock(command,JSON.parse(options.body))),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});}
   catch(error){return new Response(JSON.stringify(error),{headers:{'Content-Type':'application/json','Tauri-Response':'error'}});}
  };
 });
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Email source').selectOption('microsoft');const input=page.getByLabel('Microsoft 365 Client ID',{exact:true});await input.fill('bad-id');await page.getByRole('button',{name:'Connect Microsoft 365',exact:true}).click();await expect(page.getByRole('alert')).toContainText('UUID');expect(await page.evaluate(()=>window.__mailTest.begins)).toBe(0);
 await input.fill('11111111-2222-3333-4444-555555555555');await page.getByRole('button',{name:'Save client ID',exact:true}).click();await page.getByRole('button',{name:'Connect Microsoft 365',exact:true}).click();await expect(page.locator('.email-signin')).toContainText('https://microsoft.com/devicelogin');await expect(page.locator('.email-signin')).toContainText('AUB university account');await page.locator('.email-signin').getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.email-signin')).toHaveCount(0);expect(await page.evaluate(()=>window.__mailTest.session)).toBe('');
 await page.evaluate(()=>window.__mailTest.mode='expired');await page.getByRole('button',{name:'Connect Microsoft 365',exact:true}).click();await expect(page.getByRole('alert')).toContainText('code expired',{timeout:15000});
 await page.evaluate(()=>window.__mailTest.mode='approval');await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('alert')).toContainText('without administrator approval',{timeout:15000});await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toBeVisible();await page.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:'.local/review/microsoft-admin-approval.png'});
 await page.getByRole('button',{name:'Connect Gmail',exact:true}).click();await expect(page.getByLabel('Google OAuth Client ID')).toBeVisible();await page.getByLabel('Email source').selectOption('microsoft');await page.evaluate(()=>window.__mailTest.mode='network');await page.getByRole('button',{name:'Connect Microsoft 365',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Could not reach Microsoft');
 await page.evaluate(()=>window.__mailTest.mode='success');await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('.email-account')).toContainText('student@mail.aub.edu',{timeout:15000});await expect.poll(()=>page.evaluate(()=>window.__mailTest.pages)).toBeGreaterThan(0);await expect(page.locator('.email-account')).not.toContainText('Last sync: Never');
 await expect(page.getByText('Connected as student@mail.aub.edu. Recent Inbox sync finished.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sync now',exact:true}).click();await expect(page.getByRole('button',{name:'Sync now',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toHaveCount(0);const rows=await page.evaluate(()=>window.__mailTest.original('query',{sql:"SELECT count(*) n FROM emails WHERE account_id='mock-aub'",params:[]}));expect(rows[0].n).toBe(1);
 await page.evaluate(()=>window.__mailTest.mode='revoked');await page.getByRole('button',{name:'Sync now',exact:true}).click();await expect(page.getByRole('alert')).toContainText('expired or was revoked');
 await page.evaluate(()=>window.__mailTest.mode='success');await page.getByRole('button',{name:'Reconnect',exact:true}).click();await expect(page.locator('.email-signin')).toBeVisible();await expect(page.locator('.email-signin')).toHaveCount(0,{timeout:15000});await expect(page.locator('.email-account')).not.toContainText('Last sync failed');
 await page.getByRole('button',{name:'Disconnect…',exact:true}).click();await page.getByRole('button',{name:'Disconnect account',exact:true}).click();await expect(page.locator('.email-account')).toContainText('Disconnected');const retained=await page.evaluate(()=>window.__mailTest.original('query',{sql:"SELECT count(*) n FROM emails WHERE account_id='mock-aub'",params:[]}));expect(retained[0].n).toBe(1);
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(input).toHaveValue('11111111-2222-3333-4444-555555555555');
 console.log('PASS: native Email UI with simulated Microsoft responses: invalid/saved ID, code/URL, cancel, expiry, admin-consent message and Gmail alternative, network failure, confirmed AUB identity, automatic incremental sync/deduplication, expired-auth reconnect, disconnect with cache retention. No real mailbox sign-in was performed.');
 console.log('Isolated data: '+run);
}finally{if(browser)await browser.close();child.kill();}
