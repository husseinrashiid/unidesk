import { test, expect } from '@playwright/test';
import path from 'node:path';
import {pdfFixture} from '../document-fixtures';

test('grouped course navigation and adding an instructor rematches cached mail immediately', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('University folder', {exact:true}).fill(path.resolve('.local/course-fixes-files', String(Date.now())));
  await page.getByRole('button', {name:'Explore with sample data'}).click();
  await expect(page.getByRole('navigation', {name:'Main navigation'})).toBeVisible();
  const response = await page.request.post('/api/local', {headers:{'X-UniDesk-Local':'1'},data:{command:'batch',args:{statements:[
    {sql:"INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('repair','microsoft','student@example.com','fixture')"},
    {sql:"INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,body_text,received_at) VALUES('repair-mail','repair','1','instructor@example.com','Welcome to our class','Welcome everyone.','2026-09-07')"},
  ]}}});
  expect(response.ok()).toBeTruthy();
  await page.getByRole('button', {name:'PHIL 210',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Study',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Start study',exact:true})).toHaveCount(0);
  const sections = page.getByRole('navigation', {name:'Course sections',exact:true});
  await expect(sections.getByRole('button')).toHaveText(['Overview','Materials','Assessments','Schedule','Syllabus','Emails','Ask Course']);
  await expect(page.getByRole('navigation',{name:'Overview views'})).toHaveCount(0);
  await sections.getByRole('button',{name:'Syllabus',exact:true}).click();
  await expect(page.getByRole('button',{name:'Import syllabus',exact:true})).toBeVisible();
  for (const [group,views] of [
    ['Materials',['Search materials','Lectures','Readings','Recordings','Notes']],
    ['Assessments',['Assignments','Exams','Previous Exams','Grades']],
  ] as const) {
    await sections.getByRole('button',{name:group,exact:true}).click();
    const subnav=page.getByRole('navigation',{name:`${group} views`,exact:true});
    await expect(subnav.getByRole('button')).toHaveText([...views]);
    for(const view of views) {
      await subnav.getByRole('button',{name:view,exact:true}).click();
      await expect(subnav.getByRole('button',{name:view,exact:true})).toHaveAttribute('aria-current','page');
    }
  }
  await sections.getByRole('button',{name:'Emails',exact:true}).click();
  await expect(page.getByText('Welcome to our class',{exact:true})).toHaveCount(0);
  await page.getByText('Manage course instructors',{exact:true}).click();
  await page.getByRole('button',{name:'Add instructor',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Dr Example');
  await page.getByLabel('Email',{exact:true}).fill('instructor@example.com');
  await expect(page.getByRole('checkbox',{name:'PHIL 210',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Save instructor',exact:true}).click();
  await expect(page.getByText('Welcome to our class',{exact:true})).toBeVisible();
  for(const width of [2560,1440,1024]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.locator("main").evaluate(el=>el.scrollWidth <= el.clientWidth+1)).toBeTruthy();
    await expect(sections.getByRole("button",{name:"Schedule",exact:true})).toBeAttached();
  }
  await page.setViewportSize({width:2560,height:1440});
  await page.getByText('Manage course instructors',{exact:true}).click();
  await page.screenshot({path:'.local/review/course-fixes-email.png'});
  await sections.getByRole('button',{name:'Materials',exact:true}).click();
  await page.getByRole('navigation',{name:'Materials views'}).getByRole('button',{name:'Lectures',exact:true}).click();
  const syllabus=Array.from({length:90},(_,i)=>`Requirement ${i}: Read the assigned chapter before class and complete all coursework on time.`).join('\n');
  await page.locator('input[type=file]').setInputFiles({name:'Clear syllabus.txt',mimeType:'text/plain',buffer:Buffer.from(syllabus)});
  await sections.getByRole('button',{name:'Materials',exact:true}).click();
  const documentRow=page.locator('.material-result').filter({hasText:'Clear syllabus.txt'});
  await expect(documentRow).toHaveCount(1);
  await expect(page.getByText(/indexed · Index up to date/)).toBeVisible({timeout:30000});
  await documentRow.getByRole('button',{name:'Read document',exact:true}).click();
  await expect(page.locator('.document-reader')).toContainText('Requirement 89:');
  expect((await page.locator('.document-reader').innerText()).match(/Requirement 50:/g)?.length).toBe(1);
  await page.screenshot({path:'.local/review/continuous-document-reader.png'});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await sections.getByRole('button',{name:'Assessments',exact:true}).click();
  await page.getByRole('navigation',{name:'Assessments views'}).getByRole('button',{name:'Previous Exams',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'Previous exam.pdf',mimeType:'application/pdf',buffer:pdfFixture(['First exam page','Second page answer'])});
  await page.getByRole('button',{name:'Previous exam.pdf',exact:true}).click();
  const pdf=page.getByRole('dialog',{name:'Previous exam.pdf',exact:true});
  await expect(pdf.locator('canvas').first()).toBeVisible({timeout:30000});
  await pdf.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(pdf.getByLabel('PDF page',{exact:true})).toHaveValue('2');
  await pdf.getByRole('button',{name:'Zoom in',exact:true}).click();
  await pdf.getByLabel('Find in PDF',{exact:true}).fill('answer');
  await pdf.getByRole('button',{name:'Find next',exact:true}).click();
  await expect(pdf.getByRole('status')).toContainText('1 / 1');
  await page.screenshot({path:'.local/review/pdf-viewer.png'});
  await pdf.getByRole('button',{name:'Close dialog',exact:true}).click();
  await sections.getByRole('button',{name:'Materials',exact:true}).click();
  await page.locator('.material-result').filter({hasText:'Previous exam.pdf'}).getByRole('button',{name:'Read document',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Previous exam.pdf',exact:true}).locator('canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

