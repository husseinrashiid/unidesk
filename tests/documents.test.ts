import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {batch,openDatabase,importFile} from '../server/storage';
import {documentCommand} from '../server/documents';
import {completeStatements,queueStatements,removeStatements} from '../src/features/documents/indexer';
import {chunkDocument} from '../src/features/documents/chunking';
import {materialSearchQuery} from '../src/features/documents/search';
import type {ExtractedFile,Segment} from '../src/features/documents/types';
import {pdfFixture,docxFixture,pptxFixture} from './document-fixtures';
function fixture(){fs.mkdirSync(path.resolve('.local/tests'),{recursive:true});const root=fs.mkdtempSync(path.resolve('.local/tests/docs-'));const filename=path.join(root,'unidesk.db');const db=openDatabase(filename);fs.mkdirSync(path.join(root,'Readings'));db.prepare("INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31',?)").run(root);db.prepare("INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL210','Ethics',?)").run(root);return {db,root,filename};}
function importFixture(db:DatabaseSync,filename:string,bytes:Buffer){return importFile(db,{courseId:'c',category:'Readings',filename,bytes:[...bytes]}) as {id:string};}
function start(db:DatabaseSync,id:string){db.prepare("UPDATE document_index_jobs SET status='Running' WHERE file_id=?").run(id);return String(db.prepare('SELECT request_id FROM document_index_jobs WHERE file_id=?').get(id)?.request_id);}
test('6000 indexed passages use bounded full-text pagination, literal query handling and category isolation',()=>{
 const {db}=fixture();try{
  const {id}=importFixture(db,'Book.txt',Buffer.from('Book'));db.prepare("UPDATE documents SET status='Indexed' WHERE file_id=?").run(id);
  db.exec('BEGIN');const insert=db.prepare('INSERT INTO document_chunks(id,document_id,course_id,chunk_index,text,page_start,page_end) VALUES(?,?,?,?,?,?,?)');
  for(let i=0;i<6000;i++)insert.run(`chunk${i}`,id,'c',i,`Academic ethics and moral relativism passage ${i}`,i+1,i+1);db.exec('COMMIT');
  const first=materialSearchQuery('ethics',{courseId:'c'}),second=materialSearchQuery('ethics',{courseId:'c',offset:30});assert.equal(db.prepare(first.sql).all(...first.params).length,31);assert.equal(db.prepare(second.sql).all(...second.params)[0].chunk_index,30);
  const filtered=materialSearchQuery('ethics',{courseId:'c',category:'Lectures'});assert.equal(db.prepare(filtered.sql).all(...filtered.params).length,0);
  for(const text of ['" OR *','NEAR(ethics)','💡']){const q=materialSearchQuery(text,{courseId:'c'});assert.doesNotThrow(()=>db.prepare(q.sql).all(...q.params));}
  db.prepare("UPDATE documents SET status='Stale' WHERE file_id=?").run(id);assert.equal(db.prepare(first.sql).all(...first.params).length,0);
 }finally{db.close();}
});
test('actual PDF, DOCX and PPTX extract locally, index and search by provenance without altering source',async()=>{
 const {db,root}=fixture();try{
  for(const [name,bytes,location] of [['Reading.pdf',pdfFixture(['First page','Cultural relativism objections']),2],['Notes.docx',docxFixture(),'Objections'],['Lecture.pptx',pptxFixture(),1]] as const){
   const {id}=importFixture(db,name,bytes);const request=start(db,id);const result=await documentCommand(db,'document_extract',{fileId:id}) as ExtractedFile;batch(db,completeStatements(id,'c',request,result));
   const chunk=db.prepare('SELECT * FROM document_chunks WHERE document_id=? ORDER BY chunk_index DESC LIMIT 1').get(id)!;assert.equal(name.endsWith('pdf')?chunk.page_start:name.endsWith('pptx')?chunk.slide_start:chunk.heading,location);assert.deepEqual(fs.readFileSync(path.join(root,'Readings',name)),bytes);
  }
  const q=materialSearchQuery('relativism',{courseId:'c'});assert.equal(db.prepare(q.sql).all(...q.params).length,2);
  const foreign=materialSearchQuery('relativism',{courseId:'other'});assert.equal(db.prepare(foreign.sql).all(...foreign.params).length,0);
 }finally{db.close();}
});
test('chunking bounds long paragraphs, combines small sections, preserves Unicode and page boundaries',()=>{
 const segment=(text:string,page:number|null=null):Segment=>({text,page,slide:null,heading:'Topic',line_start:null,line_end:null});
 const text=('A meaningful sentence about ethics. مرحبا 🌍 ').repeat(300);const chunks=chunkDocument('d','c',[segment(text,1),segment('Another page',2)]);assert(chunks.length>3);assert(chunks.every(c=>c.text.length<=3000));assert(chunks.every(c=>!c.text.includes('\ufffd')));assert(chunks.slice(0,-1).every(c=>c.page_start===1 && c.page_end===1));assert.equal(chunks.at(-1)?.page_start,2);
 assert.equal(chunkDocument('d','c',[segment('One paragraph.'),segment('Second paragraph.')]).length,1);assert.equal(chunkDocument('d','c',[segment('')]).length,0);
});
test('re-index is atomic, newer requests and removing an index prevent stale completion',async()=>{
 const {db}=fixture();try{
  const {id}=importFixture(db,'Notes.txt',Buffer.from('Original important material'));const result=await documentCommand(db,'document_extract',{fileId:id}) as ExtractedFile;
  const old=start(db,id);batch(db,queueStatements(id));assert.throws(()=>batch(db,completeStatements(id,'c',old,result)),/changed/);const current=start(db,id);batch(db,completeStatements(id,'c',current,result));assert.equal(db.prepare('SELECT count(*) n FROM document_chunks').get()?.n,1);
  batch(db,queueStatements(id));const pending=start(db,id);batch(db,removeStatements(id));assert.throws(()=>batch(db,completeStatements(id,'c',pending,result)),/changed/);assert.equal(db.prepare('SELECT count(*) n FROM document_chunks').get()?.n,0);assert.equal(db.prepare('SELECT enabled FROM documents').get()?.enabled,0);assert.equal(db.prepare('SELECT count(*) n FROM files').get()?.n,1);
  db.prepare("UPDATE files SET modified_at='changed' WHERE id=?").run(id);assert.equal(db.prepare('SELECT count(*) n FROM document_index_jobs').get()?.n,0);
 }finally{db.close();}
});
test('changed source detection, corrupt and missing files fail without losing the original file record',async()=>{
 const {db,root}=fixture();try{
  const {id}=importFixture(db,'Notes.txt',Buffer.from('One'));const before=await documentCommand(db,'document_probe',{fileIds:[id]}) as {fingerprint:string}[];fs.writeFileSync(path.join(root,'Readings','Notes.txt'),'Two words');const after=await documentCommand(db,'document_probe',{fileIds:[id]}) as {fingerprint:string}[];assert.notEqual(before[0].fingerprint,after[0].fingerprint);
  const broken=importFixture(db,'Broken.pdf',Buffer.from('not a pdf'));await assert.rejects(()=>documentCommand(db,'document_extract',{fileId:broken.id}),/PDF/);fs.unlinkSync(path.join(root,'Readings','Notes.txt'));await assert.rejects(()=>documentCommand(db,'document_extract',{fileId:id}),/missing/);assert.equal(db.prepare('SELECT count(*) n FROM files').get()?.n,2);
 }finally{db.close();}
});
test('populated Phase 3 migration creates a readable backup and preserves academic and email records on reopen',()=>{
 const {db,root,filename}=fixture();db.close();const legacy=path.join(root,'phase3.db');const old=new DatabaseSync(legacy);for(const migration of ['001_initial.sql','002_file_discovery.sql','003_academic_tracking.sql','004_email.sql','005_email_workflows.sql'])old.exec(fs.readFileSync(path.resolve('src/db',migration),'utf8'));
 old.exec("PRAGMA user_version=5; INSERT INTO tasks(id,title) VALUES('task','Retain my task'); INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('a','microsoft','s@example.edu','public-id'); INSERT INTO emails(id,account_id,provider_message_id,subject,sender_email,received_at) VALUES('m','a','provider','Keep this email','p@example.edu','2026-09-06');");old.close();
 const upgraded=openDatabase(legacy);assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version,21);assert.equal(upgraded.prepare('SELECT subject FROM emails').get()?.subject,'Keep this email');upgraded.close();const backups=fs.readdirSync(path.join(root,'backups'));assert.equal(backups.length,1);const backup=new DatabaseSync(path.join(root,'backups',backups[0]),{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version,5);assert.equal(backup.prepare('SELECT title FROM tasks').get()?.title,'Retain my task');backup.close();const reopened=openDatabase(legacy);assert.equal(reopened.prepare('SELECT count(*) n FROM emails').get()?.n,1);reopened.close();assert(fs.existsSync(filename));
});

