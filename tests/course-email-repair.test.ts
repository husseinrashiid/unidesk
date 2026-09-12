import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {openDatabase,batch} from '../server/storage';
import {refreshEmailCourseMatches} from '../src/features/email/repository';
import type {AcademicData,Statement,SqlValue} from '../src/types';

test('saved sender links survive upgrade and cached mail follows instructor changes without changing reviewed records', async()=>{
  fs.mkdirSync('.local/tests',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.local/tests/course-mail-'));
  const file=path.join(dir,'workspace.db');
  const before=new DatabaseSync(file);
  for(const name of fs.readdirSync('src/db').filter(f=>/^\d{3}_.*\.sql$/.test(f)&&Number(f.slice(0,3))<=12).sort())before.exec(fs.readFileSync(path.join('src/db',name),'utf8'));
  before.exec(`PRAGMA user_version=12;
    INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31','root');
    INSERT INTO courses(id,semester_id,code,name,professor,folder_path) VALUES('c','s','CMPS 262','Data Science','Dr Example','root/c'),('d','s','CMPS 218','Algorithms','Dr Example','root/d');
    INSERT INTO email_sender_rules(sender_email,course_id) VALUES('prof@aub.edu.lb','c');
    INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('a','microsoft','student@example.com','public');
    INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,body_text,received_at) VALUES('m','a','1','prof@aub.edu.lb','Welcome','Welcome to the course.','2026-09-07');
    INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,body_text,received_at,course_id,course_manual) VALUES('manual','a','2','prof@aub.edu.lb','Manual choice','Keep my course.','2026-09-07','d',1);
    INSERT INTO exams(id,course_id,title,date) VALUES('exam','c','Midterm','2026-10-17');
    INSERT INTO email_detected_actions(id,email_id,action_type,entity_type,entity_id,status,payload_json,confidence) VALUES('done','m','Exam change','exam','exam','Applied','{}','High');`);
  before.close();
  const db=openDatabase(file),originalFetch=globalThis.fetch;
  globalThis.fetch=async(_url,init)=>{
    const request=JSON.parse(String(init?.body)) as {command:string;args:{sql:string;params:SqlValue[];statements:Statement[]}};
    const value=request.command==='query'?db.prepare(request.args.sql).all(...request.args.params):batch(db,request.args.statements);
    return new Response(JSON.stringify({value}),{status:200});
  };
  try{
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,21);
    assert.equal(db.prepare('SELECT count(*) n FROM course_professors').get()?.n,1);
    assert.equal(db.prepare('SELECT name FROM professors').get()?.name,'Dr Example');
    assert.equal(fs.readdirSync(path.join(dir,'backups')).length,1);
    const data={courses:db.prepare('SELECT * FROM courses').all(),semesters:[],schedules:[],exams:[],assignments:[],events:[]} as unknown as AcademicData;
    await refreshEmailCourseMatches(data);
    assert.equal(db.prepare("SELECT course_id FROM emails WHERE id='m'").get()?.course_id,'c');
    assert.equal(db.prepare("SELECT course_id FROM emails WHERE id='manual'").get()?.course_id,'d');
    db.exec("UPDATE course_professors SET course_id='d'");
    await refreshEmailCourseMatches(data);
    assert.equal(db.prepare("SELECT course_id FROM emails WHERE id='m'").get()?.course_id,'d');
    assert.equal(db.prepare("SELECT status FROM email_detected_actions WHERE id='done'").get()?.status,'Applied');
    assert.equal(db.prepare("SELECT course_id FROM exams WHERE id='exam'").get()?.course_id,'c');
    db.exec("DELETE FROM course_professors");
    await refreshEmailCourseMatches(data);
    assert.equal(db.prepare("SELECT course_id FROM emails WHERE id='m'").get()?.course_id,null);
    assert.equal(db.prepare("SELECT course_id FROM emails WHERE id='manual'").get()?.course_id,'d');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {globalThis.fetch=originalFetch;db.close();}
  const reopened=openDatabase(file);
  assert.equal(reopened.prepare('SELECT count(*) n FROM course_professors').get()?.n,0,'migration must not restore a deliberately removed link on every launch');
  reopened.close();
});

