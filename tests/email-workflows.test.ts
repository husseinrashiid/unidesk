import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openDatabase,batch} from '../server/storage';
import {extendedApply,extendedProposal,explicitGrade,detectedRoom,meetingDates,conversionPayload} from '../src/features/email/extendedActions';
import {syncPages,actionProposal} from '../src/features/email/repository';
import {microsoftProvider} from '../src/features/email/provider';
import {occurrences} from '../src/utils/dates';
import {classify,proposedDate} from '../src/features/email/analysis';
import {suggestedCategory,unsafeToOpen} from '../src/features/email/attachments';
import type {AcademicData} from '../src/types';
import type {Email,EmailAccount,EmailAction} from '../src/features/email/types';
function fixture() {
  fs.mkdirSync(path.resolve('.local/tests'),{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.local/tests/email-flow-'));
  const db=openDatabase(path.join(dir,'workspace.db'));
  db.exec("INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31','root'); INSERT INTO courses(id,semester_id,code,name,folder_path,room) VALUES('c','s','PHIL210','Ethics','root/c','Nicely 103'); INSERT INTO course_schedules VALUES('meeting','c',1,'12:30','13:45'); INSERT INTO email_accounts(id,provider,email_address,client_id,connected) VALUES('account','microsoft','student@example.edu','test',1); INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,received_at) VALUES('mail','account','msg','prof@example.edu','PHIL210','2026-09-06T10:00:00Z'); INSERT INTO grade_categories(id,course_id,name,weight) VALUES('component','c','Assignments',20);");
  const data={semesters:db.prepare('SELECT * FROM semesters').all(),courses:db.prepare('SELECT * FROM courses').all(),schedules:db.prepare('SELECT * FROM course_schedules').all(),exams:[],assignments:[],tasks:[],events:[],scheduleExceptions:[]} as unknown as AcademicData;
  const email={id:'mail',subject:'PHIL210',body_text:'',account_id:'account',sender_email:'prof@example.edu',received_at:'2026-09-06T10:00:00',course_id:'c',confidence:'High'} as Email;
  function pending(proposal:Omit<EmailAction,'id'|'status'>) {
    const action={...proposal,id:crypto.randomUUID(),status:'Pending'} as EmailAction;
    db.prepare('INSERT INTO email_detected_actions(id,email_id,action_type,entity_type,payload_json,confidence) VALUES(?,?,?,?,?,?)').run(action.id,email.id,action.action_type,action.entity_type,action.payload_json,action.confidence);
    return action;
  }
  return {db,data,email,pending};
}
test('cancellation applies only to one meeting, is visible in calendar and retains weekly recurrence',()=>{
  const {db,data,email,pending}=fixture();
  try {
    email.body_text="Tomorrow's lecture is cancelled.";
    assert.equal(classify(email.subject,email.body_text).type,'Class cancellation');
    const proposal=extendedProposal(email,data)!;
    const action=pending(proposal),payload=JSON.parse(proposal.payload_json);
    batch(db,extendedApply(action,email,payload.proposed,payload.expected,null,'c'));
    assert.equal(db.prepare('SELECT count(*) n FROM course_schedules').get()?.n,1);
    const enriched={...data,scheduleExceptions:db.prepare('SELECT * FROM course_schedule_exceptions').all()} as unknown as AcademicData;
    const events=occurrences(enriched,'2026-09-07','2026-09-14');
    assert.equal(events.find(e=>e.date==='2026-09-07')?.cancelled,true);
    assert.equal(events.find(e=>e.date==='2026-09-14')?.cancelled,undefined);
    db.exec('DELETE FROM emails');
    assert.equal(db.prepare('SELECT count(*) n FROM course_schedule_exceptions').get()?.n,1);
    assert.equal(db.prepare('SELECT source_email_id FROM academic_change_log LIMIT 1').get()?.source_email_id,null);
  } finally{db.close();}
});
test('rescheduled occurrence appears even when its original date lies outside the visible range',()=>{
  const {db,data,email,pending}=fixture();
  try {
    email.body_text="Monday's lecture will instead be held Thursday at 2 PM.";
    const proposal=extendedProposal(email,data)!,payload=JSON.parse(proposal.payload_json),action=pending(proposal);
    assert.equal(payload.proposed.date,'2026-09-07');assert.equal(payload.proposed.new_date,'2026-09-10');
    assert.equal(payload.proposed.new_start_time,'14:00');assert.equal(payload.proposed.new_end_time,'15:15');
    batch(db,extendedApply(action,email,payload.proposed,payload.expected,null,'c'));
    const enriched={...data,scheduleExceptions:db.prepare('SELECT * FROM course_schedule_exceptions').all()} as unknown as AcademicData;
    const events=occurrences(enriched,'2026-09-10','2026-09-10');
    assert.equal(events.length,1);assert.equal(events[0].time,'14:00');
    assert.equal(db.prepare('SELECT start_time FROM course_schedules').get()?.start_time,'12:30');
  }finally{db.close();}
});
test('stale weekly schedule rolls back the proposal and exception transaction',()=>{
  const {db,data,email,pending}=fixture();try{
    email.body_text='Class is cancelled tomorrow.';
    const proposal=extendedProposal(email,data)!,payload=JSON.parse(proposal.payload_json),action=pending(proposal);
    db.exec("UPDATE course_schedules SET start_time='12:00'");
    assert.throws(()=>batch(db,extendedApply(action,email,payload.proposed,payload.expected,null,'c')),/changed/);
    assert.equal(db.prepare('SELECT count(*) n FROM course_schedule_exceptions').get()?.n,0);
    assert.equal(db.prepare('SELECT status FROM email_detected_actions').get()?.status,'Pending');
  }finally{db.close();}
});
test('room changes and permanent timetable changes are distinguished conservatively',()=>{
  const {db,data,email}=fixture();try{
    email.body_text='Tomorrow we will meet in Nicely 212 rather than Nicely 103.';
    assert.equal(detectedRoom(email.body_text),'Nicely 212');
    assert.equal(extendedProposal(email,data)?.entity_type,'schedule');
    assert.equal(classify('PHIL210 Midterm Room Change','The midterm moved to room Nicely 212.').type,'Exam change');
    email.body_text='Starting next week, all Wednesday lectures will be held at 2 PM.';
    email.subject='PHIL210 schedule change';
    assert.equal(JSON.parse(extendedProposal(email,data)!.payload_json).proposed.permanent,'true');
    assert.equal(meetingDates('Wednesday, September 9','2026-09-06T10:00:00').length,1);
  }finally{db.close();}
});
test('explicit grades require a component and preserve prior grades on stale review',()=>{
  const {db,data,email,pending}=fixture();try{
    assert.equal(explicitGrade('Your grade is now available.'),null);
    assert.equal(explicitGrade('09/10 is the deadline.'),null);
    assert.deepEqual(explicitGrade('You received 92/100.'),{points_earned:'92',points_possible:'100'});
    email.body_text='You received 92/100.';
    const proposal=extendedProposal(email,data)!,payload=JSON.parse(proposal.payload_json),action=pending(proposal);
    assert.throws(()=>extendedApply(action,email,payload.proposed,{},null,'c'),/component/);
    const values={...payload.proposed,category_id:'component',title:'Assignment 2 score'};
    batch(db,extendedApply(action,email,values,{},null,'c'));
    assert.equal(db.prepare('SELECT points_earned FROM grade_items').get()?.points_earned,92);
    assert.throws(()=>batch(db,extendedApply(action,email,values,{},null,'c')),/changed/);
    db.exec('DELETE FROM emails');
    assert.equal(db.prepare('SELECT points_earned FROM grade_items').get()?.points_earned,92);
  }finally{db.close();}
});
test('calendar conversion supports university-wide events and rejects duplicates',()=>{
  const {db,email,pending}=fixture();try{
    email.body_text='Advising on September 17 at noon in Nicely 212.';email.course_id=null;
    const payload=conversionPayload(email);
    const proposal={email_id:email.id,action_type:'Create calendar event',course_id:null,entity_type:'event',entity_id:null,confidence:'Low',payload_json:JSON.stringify(payload)} as Omit<EmailAction,'id'|'status'>;
    const action=pending(proposal);
    batch(db,extendedApply(action,email,payload.proposed,{},null,''));
    assert.equal(db.prepare('SELECT course_id FROM calendar_events').get()?.course_id,null);
    assert.equal(db.prepare('SELECT start_datetime FROM calendar_events').get()?.start_datetime,'2026-09-17T12:00');
    assert.equal(db.prepare('SELECT location FROM calendar_events').get()?.location,'Nicely 212');
  }finally{db.close();}
});
test('entity matching recognizes Midterm shorthand and never treats final chapter as an exam',()=>{
  assert.equal(proposedDate('Assignment 2 will now be due Monday, September 14 instead of Friday, September 11.','2026-09-06T10:00:00').date,'2026-09-14');
  assert.equal(detectedRoom('The room has changed from Nicely 103 to Nicely 212.'),'Nicely 212');
  const {db,data,email}=fixture();try{
    data.exams=[{id:'e',course_id:'c',title:'PHIL Midterm Exam',type:'Midterm',date:'2026-10-15',start_time:'12:30',end_time:'13:30',location:'103'}] as AcademicData['exams'];
    email.body_text='The midterm has moved from October 15 to October 17.';
    assert.equal(actionProposal(email,data)?.entity_id,'e');
    assert.equal(classify('Re: Exam moved','Thanks.\nOn Monday Alex wrote:\nExam moved to October 20.').actionable,false);
    assert.equal(classify('Reading','The final chapter will be discussed next Monday.').actionable,false);
  }finally{db.close();}
});
test('sync resumes next/delta links, remains bounded, and preserves committed pages on network failure',async()=>{
  const {db,data}=fixture();try{
    const cursors:string[]=[];
    const account={id:'account',connected:1,sync_cursor:null} as EmailAccount;
    const provider={...microsoftProvider,initialCursor:()=> 'initial',page:async(_account:EmailAccount,cursor:string)=>{cursors.push(cursor);return {value:[], '@odata.nextLink':`page${cursors.length}`};}};
    await syncPages(account,data,[],[],provider,async statements=>batch(db,statements));
    assert.equal(cursors.length,5);assert.equal(cursors[1],'page1');
    const resumed=db.prepare('SELECT * FROM email_accounts').get() as unknown as EmailAccount;
    assert.equal(resumed.sync_cursor,'page5');
    await assert.rejects(syncPages(resumed,data,[],[],{...provider,page:async()=>{throw Error('Network unavailable');}},async statements=>batch(db,statements)),/Network unavailable/);
    assert.equal(db.prepare('SELECT sync_cursor FROM email_accounts').get()?.sync_cursor,'page5');
    await syncPages(resumed,data,[],[],{...provider,page:async()=>({value:[], '@odata.deltaLink':'delta'})},async statements=>batch(db,statements));
    assert.equal(db.prepare('SELECT sync_cursor FROM email_accounts').get()?.sync_cursor,'delta');
  }finally{db.close();}
});
test('attachment categories and executable-open warnings use deterministic filenames',()=>{
  assert.equal(suggestedCategory('Lecture5.pdf'),'Lectures');
  assert.equal(suggestedCategory('Midterm2025.pdf'),'Previous Exams');
  assert.equal(suggestedCategory('Assignment3.pdf'),'Assignments');
  assert.equal(suggestedCategory('reading.pdf'),'Readings');
  assert.equal(unsafeToOpen('lecture.pdf.exe'),true);assert.equal(unsafeToOpen('lecture.pdf'),false);
});
