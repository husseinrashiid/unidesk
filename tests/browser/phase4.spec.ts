import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {pdfFixture,docxFixture,pptxFixture} from '../document-fixtures';
test('local materials: actual formats, automatic indexing, search, source scope, failures, changes and reopen',async({page})=>{
 test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(command:string,args:Record<string,unknown>)=>{const response=await page.request.post('/api/local',{headers:{'X-UniDesk-Local':'1'},data:{command,args}});expect(response.ok(),await response.text()).toBeTruthy();return(await response.json()).value;};
 await page.goto('/');await page.getByLabel('University folder',{exact:true}).fill(path.resolve('.local/phase4-e2e-files',String(Date.now())));await page.getByRole('button',{name:'Explore with sample data'}).click();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 const [course]=await api('query',{sql:"SELECT id FROM courses WHERE code='PHIL 210'",params:[]});
 const imports=[['Reading.pdf',pdfFixture(['Introduction to ethics','Cultural relativism faces objections about moral progress.'])],['Objections.docx',docxFixture()],['Lecture.pptx',pptxFixture()],['Scanned.pdf',pdfFixture([''])],['Broken.pdf',Buffer.from('broken pdf')]] as const;
 const ids:Record<string,string>={};
 for(const [filename,bytes] of imports){const result=await api('import_file',{courseId:course.id,category:'Readings',filename,bytes:[...bytes]});ids[filename]=result.id;}
 await page.getByRole('button',{name:'PHIL 210',exact:true}).first().click();await page.getByRole('button',{name:'Materials',exact:true}).click();
 await expect.poll(async()=>{const [r]=await api('query',{sql:"SELECT count(*) n FROM documents WHERE file_id IN (?,?,?,?,?) AND status IN ('Indexed','Text unavailable','Failed')",params:Object.values(ids)});return r.n;},{timeout:60000}).toBe(5);
 await page.getByLabel('Search course materials',{exact:true}).fill('relativism');await expect(page.locator('.material-result')).toHaveCount(2);await expect(page.locator('.material-result').filter({hasText:'Reading.pdf'})).toContainText('Page 2');await expect(page.locator('.material-result').filter({hasText:'Objections.docx'})).toContainText('Section: Objections');
 await page.screenshot({path:'.local/review/phase4-material-search-light.png'});
 await page.getByRole('button',{name:'Reading.pdf',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Cultural relativism faces objections');await expect(page.getByRole('dialog').getByRole('region').filter({hasText:'Cultural relativism'})).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByLabel('Document scope',{exact:true}).selectOption(ids['Lecture.pptx']);await expect(page.getByText('No matching passages',{exact:true})).toBeVisible();await page.getByLabel('Search course materials',{exact:true}).fill('egoism');await expect(page.locator('.material-result')).toHaveCount(1);await expect(page.locator('.material-result')).toContainText('Slide 1');
 await page.getByLabel('Document scope',{exact:true}).selectOption('');await page.locator('.material-index summary').click();await expect(page.locator('.material-index-row').filter({hasText:'Scanned.pdf'})).toContainText('Text unavailable');await expect(page.locator('.material-index-row').filter({hasText:'Broken.pdf'})).toContainText('Failed');
 const [file]=await api('query',{sql:'SELECT absolute_path FROM files WHERE id=?',params:[ids['Reading.pdf']]});fs.writeFileSync(file.absolute_path,pdfFixture(['Introduction','Revised source introduces consequentialism.']));
 await page.getByLabel('Search course materials',{exact:true}).fill('consequentialism');await expect(page.locator('.material-result')).toContainText('Revised source introduces consequentialism',{timeout:45000});
 const [before]=await api('query',{sql:'SELECT indexed_at,content_hash FROM documents WHERE file_id=?',params:[ids['Reading.pdf']]});
 await page.reload();await page.getByRole('button',{name:'PHIL 210',exact:true}).first().click();await page.getByRole('button',{name:'Materials',exact:true}).click();await page.getByLabel('Search course materials',{exact:true}).fill('consequentialism');await expect(page.locator('.material-result')).toHaveCount(1);
 const [after]=await api('query',{sql:'SELECT indexed_at,content_hash FROM documents WHERE file_id=?',params:[ids['Reading.pdf']]});expect(after).toEqual(before);
 await api('batch',{statements:[{sql:"INSERT INTO settings(key,value) VALUES('theme','dark') ON CONFLICT(key) DO UPDATE SET value=excluded.value"}]});await page.reload();await page.getByRole('button',{name:'PHIL 210',exact:true}).first().click();await page.getByRole('button',{name:'Materials',exact:true}).click();await page.getByLabel('Search course materials',{exact:true}).fill('consequentialism');await expect(page.locator('.material-result')).toHaveCount(1);await page.screenshot({path:'.local/review/phase4-material-search-dark.png'});expect(errors).toEqual([]);
});
