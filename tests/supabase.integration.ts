import type { SqlValue } from '../src/types';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {openDatabase,batch,importFile,handle} from '../server/storage';
import {SyncEngine,type SyncLocal} from '../src/features/sync/engine';
import {ensureOffline} from '../src/features/sync/transfers';
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
test('real Supabase Auth, two SQLite devices, private Storage, conflicts, tombstones and device revocation',{skip:!url||!key,timeout:120000},async()=>{
 const root=path.resolve('.local/supabase-integration',randomUUID());fs.mkdirSync(root,{recursive:true});
 const users:string[]=[],databases:ReturnType<typeof openDatabase>[]=[];
 async function api(route:string,token:string,body?:unknown,method='POST'){
  const response=await fetch(`${url}/${route}`,{method,headers:{apikey:key!,Authorization:`Bearer ${token}`,...(body instanceof Uint8Array?{'Content-Type':'application/octet-stream'}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof Uint8Array?body as BodyInit:JSON.stringify(body)});
  return response;
 }
 async function account(){const password=`UniDesk-${randomUUID()}-aA1!`,email=`unidesk-${randomUUID()}@example.com`;const r=await api('auth/v1/signup',key!,{email,password});assert.equal(r.status,200,'Test Supabase must allow email signup');const signup=await r.json();users.push(signup.user?.id??signup.id);assert.ok(signup.access_token,'Use a disposable test server with email auto-confirm enabled');const login=await api('auth/v1/token?grant_type=password',key!,{email,password});assert.equal(login.status,200);return {...await login.json(),secondSession:async()=>{const r=await api('auth/v1/token?grant_type=password',key!,{email,password});assert.equal(r.status,200);return r.json();}};}
 async function device(name:string,session:Record<string,any>){
  const folder=path.join(root,name);fs.mkdirSync(folder,{recursive:true});const dbPath=path.join(folder,'unidesk.db'),db=openDatabase(dbPath);databases.push(db);
  const token=session.access_token as string,owner=session.user.id as string;
  const blob=(hash:string)=>`storage/v1/object/unidesk-files/${owner}/${hash}`;
  const local:SyncLocal={query:async<T>(sql:string,params:SqlValue[]=[])=>db.prepare(sql).all(...params) as T[],batch:async s=>batch(db,s),command:async<T>(name:string,args:Record<string,unknown>={})=>{
   if(name==='sync_request'){const r=await api('rest/v1/rpc/unidesk_sync',token,{p_route:args.route,p_body:args.body});if(!r.ok)throw Error(`Sync request rejected (${r.status})`);return await r.json() as T;}
   if(name==='sync_file'){
    const file=db.prepare('SELECT * FROM files WHERE id=?').get(String(args.id));
    if(args.operation==='prepare'){const bytes=fs.readFileSync(String(file!.absolute_path));const hash=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(folder,hash),bytes);return {hash} as T;}
    if(args.operation==='upload'){if((await api(blob(String(args.hash)),token,undefined,'HEAD')).ok)return {} as T;const r=await api(blob(String(args.hash)),token,fs.readFileSync(path.join(folder,String(args.hash))));assert.ok(r.ok,`Storage upload HTTP ${r.status}`);return {} as T;}
    const target=path.join(folder,'downloads',String(args.id),String(args.hash),String(args.filename));
    if(args.operation==='path')return {path:target} as T;
    const r=await api(blob(String(args.hash)),token,undefined,'GET');assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),args.hash);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return {path:target} as T;
   }
   return handle(db,name,args,dbPath) as T;
  }};
  return {db,local,engine:new SyncEngine(local),token,id:String(db.prepare('SELECT device_id FROM sync_context').get()!.device_id)};
 }
 try {
  const session=await account(),other=await account();
  // Each installation has an independent Auth session, as native sign-in does.
  const secondAuth=await api('auth/v1/token?grant_type=refresh_token',key!,{refresh_token:session.refresh_token});assert.equal(secondAuth.status,200);
  // Sign in again for an independent device session; refresh itself retains session ID.
  const a=await device('windows',session),b=await device('tablet',await session.secondSession());
  a.db.prepare("INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('semester','Fall','2026-08-01','2026-12-31',?)").run(path.join(root,'semester'));
  a.db.prepare("INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('course','semester','CS101','Computing',?)").run(path.join(root,'course'));
  a.db.prepare("INSERT INTO tasks(id,course_id,title) VALUES('task','course','Offline task')").run();
  const file=importFile(a.db,{courseId:'course',category:'Resources',filename:'syllabus.txt',bytes:[65,66,67]});
  await a.engine.run();await b.engine.run();assert.equal(b.db.prepare('SELECT title FROM tasks').get()!.title,'Offline task');
  assert.equal(fs.readFileSync(String(b.db.prepare('SELECT absolute_path FROM files WHERE id=?').get(file.id!)!.absolute_path),'utf8'),'ABC');
  a.db.prepare("UPDATE tasks SET due_date='2026-10-14'").run();b.db.prepare("UPDATE tasks SET due_date='2026-10-15'").run();await a.engine.run();assert.equal((await b.engine.run()).conflicts,1);await b.engine.resolve('tasks','["task"]','remote');await b.engine.run();assert.equal(b.db.prepare('SELECT due_date FROM tasks').get()!.due_date,'2026-10-14');
  const hash=String(a.db.prepare('SELECT hash FROM sync_blobs WHERE file_id=?').get(file.id!)!.hash);
  assert.ok(!(await api(`storage/v1/object/unidesk-files/${session.user.id}/${hash}`,other.access_token,undefined,'GET')).ok,'Other user cannot read private bytes');
  const rows=await api('rest/v1/unidesk_records?select=*',other.access_token,undefined,'GET');assert.deepEqual(await rows.json(),[]);
  b.db.prepare("DELETE FROM tasks WHERE id='task'").run();await b.engine.run();await a.engine.run();assert.equal(a.db.prepare('SELECT COUNT(*) n FROM tasks').get()!.n,0);
  b.db.prepare("UPDATE sync_blobs SET state='cloud_available',direction='download',auto_download=0").run();await ensureOffline(b.local,file.id!);
  const remove=await api('rest/v1/rpc/unidesk_sync',a.token,{p_route:'remove-device',p_body:{protocol:1,device:a.id,target:b.id}});assert.equal(remove.status,200);
  await assert.rejects(b.engine.run(),/rejected/);await a.engine.run();
  assert.ok(!(await api(`storage/v1/object/unidesk-files/${session.user.id}/${hash}`,b.token,undefined,'GET')).ok,'Revoked session cannot fetch files');
 }finally{
  for(const db of databases)db.close();
  const admin=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(admin)for(const id of users.filter(Boolean)){await fetch(`${url}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:{apikey:admin,Authorization:`Bearer ${admin}`}});}
 }
});
