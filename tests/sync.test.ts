import { inspectSetup } from '../src/features/sync/setup';
import type { SqlValue } from '../src/types';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createSyncService } from '../server/sync-service';
import { openDatabase, batch, handle, importFile } from '../server/storage';
import { SyncEngine, type SyncLocal } from '../src/features/sync/engine';
import { portablePayload,validateRecord } from '../src/features/sync/protocol';
import { capabilitiesFor } from '../src/services/capabilities';
import { ensureOffline } from '../src/features/sync/transfers';
import { mergeConflict } from '../src/features/sync/conflicts';

const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root=path.resolve('.local/tests/sync',randomUUID());
  const token=randomBytes(32).toString('base64url');
  const server=createSyncService(path.join(root,'server'),{[sha(token)]:'test-workspace'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dbs:ReturnType<typeof openDatabase>[]=[];
  const request=async(route:string,body:unknown)=>{
    const response=await fetch(`${url}/v1/${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok) throw Error(JSON.stringify(data));return data;
  };
  function device(name:string) {
    const folder=path.join(root,name);const dbPath=path.join(folder,'unidesk.db');const db=openDatabase(dbPath);dbs.push(db);
    let failAfterPush=false;
    const local:SyncLocal={
      async query<T>(sql:string,params:SqlValue[]=[]) {return db.prepare(sql).all(...params) as T[];},
      async batch(statements) {return batch(db,statements);},
      async command<T>(command:string,args:Record<string,unknown>={}) {
        if(command==='sync_request') { const data=await request(String(args.route),args.body); if(failAfterPush&&args.route==='push'){failAfterPush=false;throw Error('Connection lost after server commit');} return data as T; }
        if(command==='locations') return {defaultFolder:path.join(folder,'University')} as T;
        if(command==='sync_file') {
          if(args.operation==='prepare') {
            const file=db.prepare('SELECT absolute_path FROM files WHERE id=?').get(String(args.id))!;
            return {hash:sha(fs.readFileSync(String(file.absolute_path))),signature:'fixture'} as T;
          }
          if(args.operation==='path') return {path:path.join(folder,'files',String(args.id),String(args.filename))} as T;
          if(args.operation==='upload') {
            const file=db.prepare('SELECT absolute_path FROM files WHERE id=?').get(String(args.id))!;
            const bytes=fs.readFileSync(String(file.absolute_path));const hash=sha(bytes);
            const result=await fetch(`${url}/v1/blobs/${hash}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:bytes});assert.equal(result.status,200);return {hash} as T;
          }
          const response=await fetch(`${url}/v1/blobs/${args.hash}`,{headers:{Authorization:`Bearer ${token}`}});
          assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),args.hash);
          const filename=path.join(folder,'files',String(args.id),String(args.filename));fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);return {path:filename} as T;
        }
        return handle(db,command,args,dbPath) as T;
      },
    };
    return {db,local,engine:new SyncEngine(local),losePushResponse(){failAfterPush=true;}};
  }
  return {device,url,token,request,async close(){for(const db of dbs)db.close();server.close();await once(server,'close');}};
}
function academic(db:ReturnType<typeof openDatabase>,suffix='') {
  db.prepare("INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES(?,?,?,?,?)").run('semester'+suffix,'Fall','2026-08-01','2026-12-31',path.resolve('.local/tests/sync-files',randomUUID()));
  db.prepare("INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES(?,?,?,?,?)").run('course'+suffix,'semester'+suffix,'CS101','Computer Science',path.resolve('.local/tests/sync-files',randomUUID()));
  db.prepare("INSERT INTO tasks(id,course_id,title) VALUES(?,?,?)").run('task'+suffix,'course'+suffix,'Study offline');
}
test('two offline SQLite devices exchange academic records, tombstones and validated file bytes',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);
    const file=importFile(a.db,{courseId:'course',category:'Lectures',filename:'notes.txt',bytes:[65,66,67]});
    await a.engine.run();await b.engine.run();
    assert.equal(b.db.prepare('SELECT title FROM tasks').get()?.title,'Study offline');
    const cached=b.db.prepare('SELECT * FROM files WHERE id=?').get(file.id!)!;
    assert.equal(fs.readFileSync(String(cached.absolute_path),'utf8'),'ABC');
    assert.notEqual(b.db.prepare('SELECT folder_path FROM courses').get()?.folder_path,a.db.prepare('SELECT folder_path FROM courses').get()?.folder_path);
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM sync_outbox').get()?.n,0);
    b.db.prepare("UPDATE tasks SET title='Edited on tablet' WHERE id='task'").run();await b.engine.run();await a.engine.run();
    assert.equal(a.db.prepare('SELECT title FROM tasks').get()?.title,'Edited on tablet');
    a.db.prepare("DELETE FROM tasks WHERE id='task'").run();await a.engine.run();await b.engine.run();
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM tasks').get()?.n,0);
  } finally {await f.close();}
});
test('a folder and its file replicate to another device, and deleting it nulls folder_id remotely',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);
    const folder=await a.local.command<{id:string;name:string}>('create_subfolder',{courseId:'course',category:'Readings',name:'Week 1'});
    const file=importFile(a.db,{courseId:'course',category:'Readings',filename:'reading.txt',bytes:[65],folderId:folder.id});
    await a.engine.run();await b.engine.run();
    const replicated=b.db.prepare('SELECT category,name FROM file_folders WHERE id=?').get(folder.id) as {category:string;name:string}|undefined;
    assert.equal(replicated?.name,'Week 1');
    assert.equal(replicated?.category,'Readings');
    assert.equal(b.db.prepare('SELECT folder_id FROM files WHERE id=?').get(file.id!)?.folder_id,folder.id);
    await a.local.command('delete_folder',{id:folder.id,mode:'keep'});
    await a.engine.run();await b.engine.run();
    assert.equal(b.db.prepare('SELECT folder_id FROM files WHERE id=?').get(file.id!)?.folder_id,null);
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM file_folders WHERE id=?').get(folder.id)?.n,0);
  } finally {await f.close();}
});
test('a lost acknowledgement replays idempotently without duplicating or losing local edits',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);a.losePushResponse();
    await assert.rejects(a.engine.run(),/Connection lost/);
    assert.ok(Number(a.db.prepare('SELECT COUNT(*) n FROM sync_outbox').get()?.n)>0);
    await a.engine.run();await b.engine.run();assert.equal(b.db.prepare('SELECT COUNT(*) n FROM courses').get()?.n,1);
  } finally {await f.close();}
});
test('concurrent edits are preserved for explicit resolution and sync resumes',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);await a.engine.run();await b.engine.run();
    a.db.prepare("UPDATE tasks SET due_date='2026-10-14'").run();b.db.prepare("UPDATE tasks SET due_date='2026-10-15'").run();
    await a.engine.run();const result=await b.engine.run();assert.equal(result.conflicts,1);
    assert.equal(b.db.prepare('SELECT due_date FROM tasks').get()?.due_date,'2026-10-15');
    await b.engine.resolve('tasks','["task"]','local');await b.engine.run();await a.engine.run();
    assert.equal(a.db.prepare('SELECT due_date FROM tasks').get()?.due_date,'2026-10-15');
  } finally {await f.close();}
});
test('failed remote transaction preserves cursor and pending work',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);await a.engine.run();
    const original=b.local.batch; b.local.batch=async statements=>{if(statements.some(s=>s.sql.includes('applying=1')))throw Error('Disk full');return original(statements);};
    await assert.rejects(b.engine.run(),/Disk full/);assert.equal(b.db.prepare('SELECT cursor FROM sync_context').get()?.cursor,0);
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM tasks').get()?.n,0);
    b.local.batch=original;await b.engine.run();assert.equal(b.db.prepare('SELECT COUNT(*) n FROM tasks').get()?.n,1);
  } finally {await f.close();}
});
test('service rejects unauthenticated requests, invalid table names and mismatched blob hashes',async()=>{
  const f=await fixture();try {
    assert.equal((await fetch(f.url+'/v1/info',{method:'POST'})).status,401);
    await assert.rejects(f.request('push',{protocol:1,device:'0123456789abcdef',changes:[{table:'settings',key:'["token"]',payload:null,base:0,mutation:'1'}]}),/Unsupported sync entity/);
    assert.equal((await fetch(f.url+'/v1/blobs/'+'0'.repeat(64),{method:'POST',headers:{Authorization:`Bearer ${f.token}`},body:'wrong bytes'})).status,400);
  } finally {await f.close();}
});
test('capabilities distinguish native Android and Windows; history omits machine paths',()=>{
  assert.equal(capabilitiesFor('android').native,true);assert.equal(capabilitiesFor('android').revealFile,false);assert.equal(capabilitiesFor('windows').recycleBin,true);
  assert.equal(portablePayload({before_json:'{"folder_path":"C:/private","notes":"Keep"}'})?.before_json,'{"notes":"Keep"}');
  assert.throws(()=>validateRecord('__proto__','["x"]',null),/Unsupported/);
});
test('low-risk text overlaps merge in server order while academic date overlaps require review',()=>{
  assert.deepEqual(mergeConflict('tasks',{title:'Base',due_date:'2026-10-01'},{title:'Tablet',due_date:'2026-10-01'},{title:'PC',due_date:'2026-10-03'}),{title:'Tablet',due_date:'2026-10-03'});
  assert.equal(mergeConflict('exams',{date:'2026-10-01'},{date:'2026-10-02'},{date:'2026-10-03'}),undefined);
  assert.equal(mergeConflict('files',null,{_blob:'a'},{_blob:'b'}),undefined);
});
test('large file metadata syncs before on-demand download; failed uploads do not block tasks',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);
    const file=importFile(a.db,{courseId:'course',category:'Resources',filename:'large.bin',bytes:Array.from(Buffer.alloc(2_100_000,7))});
    const original=a.local.command;
    a.local.command=async<T>(name:string,args:Record<string,unknown>={})=>{if(name==='sync_file'&&args.operation==='upload')throw Error('Upload offline');return original<T>(name,args);};
    await a.engine.run();await b.engine.run();
    assert.equal(b.db.prepare('SELECT title FROM tasks').get()?.title,'Study offline');
    assert.equal(b.db.prepare('SELECT state FROM sync_blobs WHERE file_id=?').get(file.id!)?.state,'cloud_available');
    assert.equal(fs.existsSync(String(b.db.prepare('SELECT absolute_path FROM files WHERE id=?').get(file.id!)?.absolute_path)),false);
    a.local.command=original;a.db.prepare("UPDATE sync_blobs SET updated_at='2000-01-01T00:00:00Z'").run();await a.engine.run();
    await ensureOffline(b.local,file.id!);
    assert.equal(b.db.prepare('SELECT state FROM sync_blobs WHERE file_id=?').get(file.id!)?.state,'available_offline');
  }finally{await f.close();}
});
test('a newly created child of a remotely deleted course stays pending instead of disappearing',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);await a.engine.run();await b.engine.run();
    a.db.prepare("DELETE FROM courses WHERE id='course'").run();await a.engine.run();
    b.db.prepare("INSERT INTO tasks(id,course_id,title) VALUES('new-child','course','Unsynced work')").run();
    await assert.rejects(b.engine.run(),/related record/i);
    assert.equal(b.db.prepare("SELECT title FROM tasks WHERE id='new-child'").get()?.title,'Unsynced work');
  }finally{await f.close();}
});

test('concurrent binary edits preserve both snapshots and choosing remote downloads verified content',async()=>{
  const f=await fixture();try {
    const a=f.device('a'),b=f.device('b');academic(a.db);
    const file=importFile(a.db,{courseId:'course',category:'Resources',filename:'conflict.txt',bytes:[65]});
    await a.engine.run();await b.engine.run();
    for(const [device,bytes] of [[a,'Windows'],[b,'Tablet']] as const) {
      const row=device.db.prepare('SELECT absolute_path FROM files WHERE id=?').get(file.id!);
      fs.writeFileSync(String(row?.absolute_path),bytes);
      device.db.prepare('UPDATE files SET size=?,modified_at=? WHERE id=?').run(bytes.length,bytes,file.id!);
    }
    await a.engine.run();assert.equal((await b.engine.run()).conflicts,1);
    const conflict=b.db.prepare("SELECT * FROM sync_conflicts WHERE table_name='files'").get()!;
    assert.notEqual(JSON.parse(String(conflict.local_payload))._blob,JSON.parse(String(conflict.remote_payload))._blob);
    await b.engine.resolve('files',JSON.stringify([file.id]),'remote');await b.engine.run();
    assert.equal(fs.readFileSync(String(b.db.prepare('SELECT absolute_path FROM files WHERE id=?').get(file.id!)?.absolute_path),'utf8'),'Windows');
    assert.equal(b.db.prepare('SELECT resolution FROM sync_resolution_history').get()?.resolution,'remote');
    assert.equal(b.db.prepare('SELECT COUNT(*) n FROM sync_conflicts').get()?.n,0);
  }finally{await f.close();}
});

test('first-sync inspection preserves local data and flags likely duplicates with different identities',async()=>{
 const f=await fixture();try{
  const a=f.device('a'),b=f.device('b');academic(a.db,'-a');academic(b.db,'-b');await a.engine.run();
  const before=b.db.prepare('SELECT COUNT(*) n FROM sync_outbox').get()!.n;
  const setup=await inspectSetup(b.local,{exchange:(route,body)=>b.local.command('sync_request',{route,body})});
  assert.equal(setup.local.courses,1);assert.equal(setup.cloud.courses,1);assert.equal(setup.duplicates.length,1);
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM sync_outbox').get()!.n,before);
  assert.equal(b.db.prepare('SELECT id FROM courses').get()!.id,'course-b');
 }finally{await f.close();}
});
test('outbox compacts offline edits, device identity survives reopen, incompatible protocol retains work',async()=>{
 const f=await fixture();try{
  const a=f.device('a');academic(a.db);a.db.prepare("UPDATE tasks SET title='First'").run();a.db.prepare("UPDATE tasks SET title='Latest'").run();
  assert.equal(a.db.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE table_name='tasks'").get()!.n,1);
  const dbPath=String(a.db.prepare('PRAGMA database_list').get()!.file),id=a.db.prepare('SELECT device_id FROM sync_context').get()!.device_id;
  const reopened=openDatabase(dbPath);try{assert.equal(reopened.prepare('SELECT device_id FROM sync_context').get()!.device_id,id);}finally{reopened.close();}
  const engine=new SyncEngine(a.local,{exchange:async<T>()=>({protocol:999,workspace:'a'.repeat(64)}) as T});
  await assert.rejects(engine.run(),/Update UniDesk/);assert.equal(a.db.prepare('SELECT title FROM tasks').get()!.title,'Latest');
 }finally{await f.close();}
});

test('a missing local file stays queued without blocking unrelated academic edits',async()=>{
 const f=await fixture();try{
  const a=f.device('a'),b=f.device('b');academic(a.db);
  const file=importFile(a.db,{courseId:'course',category:'Resources',filename:'missing.txt',bytes:[65]});
  const original=a.local.command;
  a.local.command=async<T>(name:string,args:Record<string,unknown>={})=>{if(name==='sync_file'&&args.operation==='prepare')throw Error('Local file missing');return original<T>(name,args);};
  await a.engine.run();await b.engine.run();assert.equal(b.db.prepare('SELECT title FROM tasks').get()!.title,'Study offline');
  assert.ok(a.db.prepare("SELECT last_error FROM sync_outbox WHERE table_name='files'").get()!.last_error);
  a.local.command=original;await a.engine.run();await b.engine.run();assert.equal(b.db.prepare('SELECT COUNT(*) n FROM files WHERE id=?').get(file.id!)!.n,1);
 }finally{await f.close();}
});
