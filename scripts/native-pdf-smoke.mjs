import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pdfFixture} from '../tests/document-fixtures.ts';
const run=path.resolve('.local/native-pdf',String(Date.now()));fs.mkdirSync(run,{recursive:true});
const child=spawn(path.resolve('src-tauri/target/release/unidesk.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,UNIDESK_DATA_DIR:run,WEBVIEW2_USER_DATA_FOLDER:path.join(run,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9235 --remote-allow-origins=http://localhost:9235'}});
let browser;
try {
 for(let i=0;i<40;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9235');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!browser)throw Error('Native app did not start');
 const page=browser.contexts()[0].pages()[0];
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByLabel('University folder',{exact:true}).fill(path.join(run,'University'));
 await page.getByRole('button',{name:'Explore with sample data'}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 const source=path.join(run,'Syllabus.pdf');fs.writeFileSync(source,pdfFixture(['Course syllabus','Assessment policy on page two']));
 const id=await page.evaluate(async(source)=>{
   const invoke=window.__TAURI_INTERNALS__.invoke;
   const courses=await invoke('query',{sql:'SELECT id FROM courses LIMIT 1',params:[]});
   const imported=await invoke('import_file',{courseId:courses[0].id,category:'Previous Exams',source});
   return imported.id;
 },source);
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('unidesk:pdf',{detail:{id,filename:'Syllabus.pdf'}})),id);
 const dialog=page.getByRole('dialog',{name:'Syllabus.pdf'});
 await expect(dialog.locator('canvas').first()).toBeVisible({timeout:30000});
 await dialog.getByRole('button',{name:'Next page',exact:true}).click();
 await expect(dialog.getByLabel('PDF page',{exact:true})).toHaveValue('2');
 await dialog.getByLabel('Find in PDF',{exact:true}).fill('policy');
 await dialog.getByRole('button',{name:'Find next',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('1 / 1');
 await page.screenshot({path:'.local/review/native-pdf.png'});
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('unidesk:pdf',{detail:{id,filename:'Syllabus.pdf'}})),id);
 await expect(page.getByRole('dialog',{name:'Syllabus.pdf'}).locator('canvas').first()).toBeVisible();
 expect(errors).toEqual([]);
 console.log('PASS: Native PDF bytes, offline worker/fonts under app CSP, original pages, navigation, search, close and reopen.');
}finally{await browser?.close();child.kill();}
