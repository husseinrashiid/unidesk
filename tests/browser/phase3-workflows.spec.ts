import {test,expect} from '@playwright/test';
import path from 'node:path';
test('Phase 3 schedule, grades, calendar, instructors, attachments and offline retention',async({page})=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const api=async(command:string,args:unknown)=>{
    const response=await page.request.post('/api/local',{headers:{'X-UniDesk-Local':'1'},data:{command,args}});
    expect(response.ok()).toBeTruthy();return (await response.json()).value;
  };
  const sql=(sql:string,params:unknown[]=[])=>api('query',{sql,params});
  const write=(statements:{sql:string;params?:unknown[]}[])=>api('batch',{statements});
  const nav=(name:string)=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true});
  await page.goto('/');
  await page.getByLabel('University folder',{exact:true}).fill(path.resolve('.local/phase3-workflow-files',String(Date.now())));
  await page.getByRole('button',{name:'Explore with sample data'}).click();
  await expect(nav('Emails')).toBeVisible();
  const course=(await sql("SELECT * FROM courses WHERE code='PHIL 210'"))[0];
  await write([
    {sql:"DELETE FROM course_schedules WHERE course_id=?",params:[course.id]},
    {sql:"INSERT INTO course_schedules VALUES('mail-meeting',?,1,'12:30','13:45')",params:[course.id]},
    {sql:"INSERT INTO email_accounts(id,provider,email_address,client_id,connected) VALUES('workflow','microsoft','test@example.edu','fixture-only',1)"},
    {sql:"INSERT INTO grade_categories(id,course_id,name,weight) VALUES('mail-component',?,'Email assessments',20)",params:[course.id]},
  ]);
  const bodies={cancel:"Tomorrow's lecture is cancelled.",reschedule:"Monday's lecture will instead be held Thursday at 2 PM.",grade:"You received 92/100.",calendar:"Advising on September 17 at noon in Nicely 212.",material:"Lecture 5 slides are attached."};
  await write(Object.entries(bodies).map(([id,body])=>({sql:"INSERT INTO emails(id,account_id,provider_message_id,provider_thread_id,sender_email,subject,snippet,body_text,received_at,course_id,importance,requires_review,has_attachments) VALUES(?,'workflow',?,'thread','prof@example.edu',?,? ,?,'2026-09-06T10:00:00Z',?,'Important',1,?)",params:[id,id,`PHIL210 ${id}`,body,body,course.id,id==='material' ? 1:0]})));
  // The fake provider serves only this isolated test mailbox; no external requests.
  await page.route('**/api/local',async route=>{
    const payload=route.request().postDataJSON();
    if(payload.command==='email_auth' && payload.args.action==='cancel')return route.fulfill({json:{value:null}});
    if(payload.command==='email_request' && payload.args.operation==='attachments') return route.fulfill({json:{value:{value:[{id:'attachment1',name:'Lecture5.txt',size:20,contentType:'text/plain','@odata.type':'#microsoft.graph.fileAttachment'}]}}});
    if(payload.command==='email_save_attachment') {
      const result=await api('import_file',{courseId:payload.args.courseId,category:payload.args.category,filename:'Lecture5.txt',bytes:[...Buffer.from('Email attachment content')],conflict:payload.args.conflict});
      return route.fulfill({json:{value:result}});
    }
    if(payload.command==='email_request' && payload.args.operation==='disconnect') {
      await write([{sql:"UPDATE email_accounts SET connected=0 WHERE id='workflow'"}]);return route.fulfill({json:{value:null}});
    }
    return route.continue();
  });
  const openMail=async(id:string)=>{await nav('Emails').click();await page.getByRole('button').filter({hasText:`PHIL210 ${id}`}).click();};
  await openMail('cancel');
  await page.getByRole('button',{name:'Reanalyze',exact:true}).click();
  await expect(page.getByLabel('Original class date')).toHaveValue('2026-09-07');
  await expect(page.getByLabel('Original weekly meeting')).toHaveValue('mail-meeting');
  await page.getByRole('button',{name:'Apply reviewed change'}).click();
  await expect(page.getByText('Class cancellation · Applied',{exact:true})).toBeVisible();
  expect((await sql('SELECT count(*) n FROM course_schedules WHERE course_id=?',[course.id]))[0].n).toBe(1);
  await openMail('reschedule');
  await page.getByRole('button',{name:'Reanalyze',exact:true}).click();
  await expect(page.getByLabel('Rescheduled date')).toHaveValue('2026-09-10');
  await page.getByRole('button',{name:'Apply reviewed change'}).click();
  await expect(page.getByText('Class reschedule · Applied',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'schedule · Class reschedule · Applied',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Class exceptions',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/review/phase3-schedule-history.png'});
  expect((await sql('SELECT exception_type,new_date FROM course_schedule_exceptions'))[0]).toEqual({exception_type:'Rescheduled',new_date:'2026-09-10'});
  await openMail('grade');await page.getByRole('button',{name:'Reanalyze',exact:true}).click();
  await expect(page.getByLabel('Points earned')).toHaveValue('92');
  await page.getByLabel('Grading component').selectOption('mail-component');
  await page.getByLabel('Create a new grade item instead').check();
  await page.getByRole('button',{name:'Apply reviewed change'}).click();
  await expect(page.getByText('Grade / feedback · Applied',{exact:true})).toBeVisible();
  expect((await sql("SELECT points_earned FROM grade_items WHERE category_id='mail-component'"))[0].points_earned).toBe(92);
  await openMail('calendar');await page.getByRole('button',{name:'Add to calendar',exact:true}).click();
  await page.getByLabel('Course for this change').selectOption('');
  await page.getByLabel('Create a new calendar event instead').check();
  await expect(page.getByLabel('Event start')).toHaveValue('2026-09-17T12:00');
  await page.getByRole('button',{name:'Apply reviewed change'}).click();
  await expect(page.getByText('Create calendar event · Applied',{exact:true})).toBeVisible();
  expect((await sql("SELECT course_id FROM calendar_events WHERE title='PHIL210 calendar'"))[0].course_id).toBeNull();
  await api('import_file',{courseId:course.id,category:'Lectures',filename:'Lecture5.txt',bytes:[...Buffer.from('Original course file')]});
  await openMail('material');await page.getByRole('button',{name:'Load attachment list'}).click();
  await page.getByRole('button',{name:'Save to course',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Also link material').selectOption('reading');
  await page.getByRole('dialog').getByLabel('Reading title').fill('Email lecture reading');
  await page.getByRole('dialog').getByRole('button',{name:'Save attachment',exact:true}).click();
  await expect(page.getByRole('button',{name:'Keep both',exact:true})).toBeVisible();
  await page.screenshot({path:'.local/review/phase3-attachment-conflict.png'});
  await page.getByRole('button',{name:'Keep both',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect((await sql("SELECT filename FROM files WHERE course_id=? AND filename LIKE 'Lecture5%'",[course.id])).length).toBe(2);
  expect((await sql("SELECT file_id FROM readings WHERE title='Email lecture reading'"))[0].file_id).toBeTruthy();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Add instructor',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Dr. Academic');
  await page.getByRole('dialog').getByLabel('Email',{exact:true}).fill('prof@example.edu');
  await page.getByRole('dialog').getByLabel('PHIL 210',{exact:true}).check();
  await page.getByRole('button',{name:'Save instructor',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Disconnect…',exact:true}).click();
  await expect(page.getByLabel('Local email cache')).toHaveValue('keep');
  await page.getByRole('button',{name:'Disconnect account',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();await nav('Emails').click();
  await expect(page.getByText('Mailbox disconnected · showing cached messages.',{exact:false})).toBeVisible();
  expect((await sql('SELECT count(*) n FROM emails'))[0].n).toBe(5);
  expect((await sql('SELECT count(*) n FROM professors'))[0].n).toBe(1);
  expect(errors).toEqual([]);
});
