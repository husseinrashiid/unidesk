import type { SyncLocal, CloudSyncAdapter } from './engine';
import { validateRecord, type PullResult } from './protocol';
export interface SyncSetup {local:Record<string,number>;cloud:Record<string,number>;duplicates:string[];workspace:string}
export async function inspectSetup(local:SyncLocal,cloud:CloudSyncAdapter):Promise<SyncSetup> {
  const [context]=await local.query<{device_id:string}>('SELECT device_id FROM sync_context');
  const info=await local.deviceInfo?.()??{name:'UniDesk',platform:'unknown',appVersion:'development'};
  const base={protocol:1,device:context.device_id,...info};
  const identity=await cloud.exchange<{protocol:number;workspace:string}>('info',base);
  if(identity.protocol!==1)throw Error('Update UniDesk to continue syncing.');
  const remote=await cloud.exchange<PullResult>('pull',{...base,cursor:0});
  for(const r of remote.records)validateRecord(r.table,r.key,r.payload);
  const result:SyncSetup={local:{},cloud:{},duplicates:[],workspace:identity.workspace};
  for(const table of ['courses','assignments','files']) {
    result.local[table]=(await local.query<{count:number}>(`SELECT COUNT(*) count FROM ${table}`))[0].count;
    result.cloud[table]=remote.records.filter(r=>r.table===table&&r.payload).length;
  }
  const localCourses=await local.query<{id:string;code:string;name:string;semester:string}>(`SELECT c.id,c.code,c.name,s.name semester FROM courses c JOIN semesters s ON s.id=c.semester_id`);
  for(const r of remote.records.filter(r=>r.table==='courses'&&r.payload)) {
    const p=r.payload!;
    const semester=remote.records.find(s=>s.table==='semesters'&&s.payload?.id===p.semester_id)?.payload?.name;
    if(localCourses.some(c=>c.id!==p.id&&c.code.trim().toLowerCase()===String(p.code).trim().toLowerCase()&&c.semester.trim().toLowerCase()===String(semester).trim().toLowerCase()))result.duplicates.push(`${p.code} — ${semester}`);
  }
  const assignments=await local.query<{id:string;title:string;due_date:string;code:string}>(`SELECT a.id,a.title,a.due_date,c.code FROM assignments a LEFT JOIN courses c ON c.id=a.course_id`);
  for(const r of remote.records.filter(r=>r.table==='assignments'&&r.payload)) {
    const p=r.payload!,code=remote.records.find(c=>c.table==='courses'&&c.payload?.id===p.course_id)?.payload?.code;
    if(assignments.some(a=>a.id!==p.id&&a.title.trim().toLowerCase()===String(p.title).trim().toLowerCase()&&a.due_date===p.due_date&&a.code===code))result.duplicates.push(`${p.title} — ${code??'Assignment'}`);
  }
  return result;
}
