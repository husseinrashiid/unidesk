import type { SqlValue, Statement } from '../../types';
import { portablePayload, syncSchema, validateRecord, type Change, type Payload, type PushResult, type PullResult, type RemoteRecord } from './protocol';
import { mergeConflict } from './conflicts';
import { transferTick } from './transfers';

export interface SyncLocal {
  query<T>(sql:string,params?:SqlValue[]):Promise<T[]>;
  batch(statements:Statement[]):Promise<unknown>;
  command<T>(name:string,args?:Record<string,unknown>):Promise<T>;
  deviceInfo?:()=>Promise<{name:string;platform:string;appVersion:string}>;
  scanFiles?:()=>Promise<unknown>;
}
export interface CloudSyncAdapter {exchange<T>(route:string,body:Record<string,unknown>):Promise<T>}
interface Pending {table_name:string;record_key:string;seq:number;payload:string|null;base:number}
interface Context {device_id:string;clock:number;cursor:number}
const parse = (value:string|null):Payload|null => value===null?null:JSON.parse(value);
const identity = (r:{table:string;key:string}) => JSON.stringify([r.table,r.key]);
const versionStatement = (r:RemoteRecord):Statement => ({sql:'INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET version=MAX(version,excluded.version)',params:[r.table,r.key,r.version]});
const baselineStatement=(r:RemoteRecord):Statement=>({sql:'INSERT INTO sync_baselines VALUES(?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET payload=excluded.payload',params:[r.table,r.key,r.payload===null?null:JSON.stringify(r.payload)]});
const conflictsStatement = (remote:RemoteRecord,local:string|null):Statement => ({sql:"INSERT INTO sync_conflicts(table_name,record_key,local_payload,remote_payload,remote_version,detected_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(table_name,record_key) DO UPDATE SET local_payload=excluded.local_payload,remote_payload=excluded.remote_payload,remote_version=excluded.remote_version,detected_at=excluded.detected_at",params:[remote.table,remote.key,local,remote.payload===null?null:JSON.stringify(remote.payload),remote.version]});
export class SyncEngine {
  private running=false;
  constructor(private local:SyncLocal,private cloud:CloudSyncAdapter={exchange:(route,body)=>local.command('sync_request',{route,body})}) {}
  async run(withFiles=true):Promise<{pending:number;conflicts:number}> {
    if(this.running) return {pending:0,conflicts:0};
    this.running=true;
    try {
      let result=await this.cycle();
      for(let round=0;round<2 && result.pending>0 && result.conflicts===0;round++) result=await this.cycle();
      if(withFiles) await transferTick(this.local); return result;
    } finally { this.running=false; }
  }
  private async cycle() {
    const l=this.local;
    await l.scanFiles?.();
    const [context]=await l.query<Context>('SELECT * FROM sync_context WHERE id=1');
    const deviceIdentity=await l.deviceInfo?.()??{name:'UniDesk',platform:'test',appVersion:'development'};
    const [name]=await l.query<{value:string}>("SELECT value FROM sync_preferences WHERE key='device_name'");
    const request=<T>(route:string,body:Record<string,unknown>={}) => this.cloud.exchange<T>(route,{protocol:1,device:context.device_id,...deviceIdentity,name:name?.value??deviceIdentity.name,...body});
    const info=await request<{workspace:string;devices?:unknown[]}>('info');
    if(Array.isArray(info.devices))await l.batch([{sql:"INSERT INTO sync_preferences VALUES('devices',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[JSON.stringify(info.devices)]}]);
    if((info as {protocol?:number}).protocol!==undefined && (info as {protocol?:number}).protocol!==1) throw Error('Update UniDesk to continue syncing.');
    if(typeof info.workspace!=='string'||!/^[a-f0-9]{64}$/.test(info.workspace)) throw Error('Invalid sync workspace');
    const [binding]=await l.query<{value:string}>("SELECT value FROM sync_preferences WHERE key='workspace'");
    if(binding && binding.value!==info.workspace) throw Error('This local database is linked to a different sync workspace. Reconnect the original account.');
    if(!binding) await l.batch([{sql:"INSERT INTO sync_preferences VALUES('workspace',?)",params:[info.workspace]}]);
    const conflictCount=await l.query<{count:number}>('SELECT COUNT(*) AS count FROM sync_conflicts');
    if(conflictCount[0].count) return {pending:0,conflicts:conflictCount[0].count};
    let pending=await l.query<Pending>('SELECT o.*,COALESCE(v.version,0) AS base FROM sync_outbox o LEFT JOIN sync_versions v USING(table_name,record_key) ORDER BY seq');
    if(pending.length) {
      const changes:Change[]=[];
      for(const p of pending) {
        const payload=portablePayload(parse(p.payload));
        if(p.table_name==='files' && payload) {
          const [known]=await l.query<{hash:string;state:string;direction:string}>('SELECT * FROM sync_blobs WHERE file_id=?',[payload.id]);
          if(known?.direction==='download'&&known.state!=='available_offline') payload._blob=known.hash;
          else {
            try {
            const {hash,signature=''}=await l.command<{hash:string;signature?:string}>('sync_file',{operation:'prepare',id:payload.id});
            payload._blob=hash;
            await l.batch([{sql:"INSERT INTO sync_blobs(file_id,hash,local_signature,state,direction,updated_at) VALUES(?,?,?,'upload_pending','upload',?) ON CONFLICT(file_id) DO UPDATE SET hash=excluded.hash,local_signature=excluded.local_signature,direction='upload',state=CASE WHEN sync_blobs.hash=excluded.hash AND sync_blobs.state='available_offline' THEN 'available_offline' ELSE 'upload_pending' END,updated_at=excluded.updated_at",params:[payload.id,hash,signature,new Date().toISOString()]}]);
            }catch(error){await l.batch([{sql:'UPDATE sync_outbox SET last_error=?,retry_count=retry_count+1 WHERE table_name=? AND record_key=? AND seq=?',params:[String(error),p.table_name,p.record_key,p.seq]}]);continue;}
          }
        }
        changes.push({table:p.table_name,key:p.record_key,base:p.base,payload,mutation:`${p.seq}:${p.table_name}:${p.record_key}`});
      }
      // A missing local file keeps its own outbox entry, without blocking unrelated coursework.
      let filtered=true;
      while(filtered){filtered=false;for(let i=changes.length-1;i>=0;i--){const c=changes[i];if(c.payload&&syncSchema[c.table].foreign.some(f=>pending.some(p=>p.table_name===f.table&&p.record_key===JSON.stringify([c.payload![f.column]]))&&!changes.some(other=>other.table===f.table&&other.key===JSON.stringify([c.payload![f.column]])))){changes.splice(i,1);filtered=true;}}}
      pending=pending.filter(p=>changes.some(c=>c.table===p.table_name&&c.key===p.record_key));
      if(changes.length){
      const result=await request<PushResult>('push',{changes});
      if(!Array.isArray(result.accepted)||!Array.isArray(result.conflicts)) throw Error('Invalid sync response');
      for(const r of [...result.accepted,...result.conflicts]) { validateRecord(r.table,r.key,r.payload); if(!Number.isSafeInteger(r.version)||r.version<1) throw Error('Invalid sync version'); }
      if(result.conflicts.length) {
        const resolution:Statement[]=[];
        for(const r of result.conflicts) {
          const p=pending.find(p=>p.table_name===r.table&&p.record_key===r.key);
          if(!p) throw Error('Unexpected conflict');
          const [base]=await l.query<{payload:string|null}>('SELECT payload FROM sync_baselines WHERE table_name=? AND record_key=?',[r.table,r.key]);
          const localPayload=changes.find(c=>c.table===r.table&&c.key===r.key)!.payload;
          const merged=mergeConflict(r.table,base?parse(base.payload):null,localPayload,r.payload);
          if(merged) {
            const schema=syncSchema[r.table],columns=Object.keys(merged).filter(c=>schema.columns.includes(c)&&!schema.keys.includes(c));
            resolution.push({sql:'UPDATE sync_outbox SET seq=seq WHERE table_name=? AND record_key=? AND seq=?',params:[r.table,r.key,p.seq],expectChanges:1},
              {sql:`UPDATE "${r.table}" SET ${columns.map(c=>`"${c}"=?`).join(',')} WHERE ${schema.keys.map(c=>`"${c}"=?`).join(' AND ')}`,params:[...columns.map(c=>merged[c]),...JSON.parse(r.key)]},versionStatement(r),baselineStatement(r));
          } else resolution.push(conflictsStatement(r,localPayload===null?null:JSON.stringify(localPayload)));
        }
        await l.batch(resolution);
        return {pending:pending.length,conflicts:(await l.query<{count:number}>('SELECT COUNT(*) AS count FROM sync_conflicts'))[0].count};
      }
      if(result.accepted.length!==pending.length || new Set(result.accepted.map(identity)).size!==pending.length) throw Error('Incomplete sync acknowledgement');
      const ack:Statement[]=[];
      for(const r of result.accepted) {
        const p=pending.find(p=>p.table_name===r.table&&p.record_key===r.key);
        if(!p) throw Error('Unexpected sync acknowledgement');
        ack.push(versionStatement(r),baselineStatement(r),{sql:'DELETE FROM sync_outbox WHERE table_name=? AND record_key=? AND seq=?',params:[r.table,r.key,p.seq]});
      }
      await l.batch(ack);
      }
    }
    const remote=await request<PullResult>('pull',{cursor:context.cursor});
    if(!Array.isArray(remote.records)||!Number.isSafeInteger(remote.cursor)||remote.cursor<context.cursor) throw Error('Invalid sync cursor');
    await this.apply(remote);
    return {pending:(await l.query<{count:number}>('SELECT COUNT(*) AS count FROM sync_outbox'))[0].count,conflicts:0};
  }
  private async apply(remote:PullResult) {
    const l=this.local;
    const [context]=await l.query<Context>('SELECT * FROM sync_context WHERE id=1');
    const dirty=await l.query<Pending>('SELECT * FROM sync_outbox');
    const known=await l.query<{table_name:string;record_key:string;version:number}>('SELECT * FROM sync_versions');
    const records:RemoteRecord[]=[];
    const conflicts:Statement[]=[];
    for(const r of remote.records) {
      validateRecord(r.table,r.key,r.payload);
      if(!Number.isSafeInteger(r.version)||r.version<1||r.version>remote.cursor) throw Error('Invalid remote version');
      const base=known.find(k=>k.table_name===r.table&&k.record_key===r.key)?.version??0;
      if(r.version<=base) continue;
      const pending=dirty.find(p=>p.table_name===r.table&&p.record_key===r.key);
      if(pending) conflicts.push(conflictsStatement(r,pending.payload)); else records.push(r);
    }
    if(conflicts.length) { await l.batch(conflicts);throw Error('Concurrent edits need review in Settings.'); }
    // Do not let a parent deletion cascade through newer local edits.
    if(dirty.length && records.some(r=>r.payload===null)) throw Error('New local changes are waiting; remote deletions will retry after upload.');
    const statements:Statement[]=[{sql:'UPDATE sync_context SET applying=1 WHERE id=1 AND clock=?',params:[context.clock],expectChanges:1},{sql:'PRAGMA defer_foreign_keys=ON'}];
    const ordered=this.order(records);
    for(const r of ordered) {
      const schema=syncSchema[r.table];
      const keys=JSON.parse(r.key) as string[];
      const where=schema.keys.map(k=>`"${k}"=?`).join(' AND ');
      if(r.payload===null) statements.push({sql:`DELETE FROM "${r.table}" WHERE ${where}`,params:keys});
      else {
        const payload={...r.payload};delete payload._blob;
        const [existing]=await l.query<Payload>(`SELECT * FROM "${r.table}" WHERE ${where}`,keys);
        for(const column of schema.local) if(existing && Object.hasOwn(existing,column)) payload[column]=existing[column];
        if(r.table==='semesters' && !existing) {
          const location=await l.command<{defaultFolder:string}>('locations');
          payload.storage_directory=await l.command<string>('create_folder',{base:location.defaultFolder,name:`Synced-${payload.id}`,course:false});
        }
        if(r.table==='courses' && !existing) {
          const location=await l.command<{defaultFolder:string}>('locations');
          payload.folder_path=await l.command<string>('create_folder',{base:location.defaultFolder,name:`Course-${payload.id}`,course:true});
        }
        if(r.table==='files') {
          const [blob]=await l.query<{hash:string;state:string}>('SELECT hash,state FROM sync_blobs WHERE file_id=?',[r.payload.id]);
          if(!existing || blob?.hash!==r.payload._blob || blob.state!=='available_offline') {
            const placeholder=await l.command<{path:string}>('sync_file',{operation:'path',id:r.payload.id,courseId:r.payload.course_id,hash:r.payload._blob,filename:r.payload.filename});
            payload.absolute_path=placeholder.path;
            statements.push({sql:"INSERT INTO sync_blobs(file_id,hash,state,direction,updated_at) VALUES(?,?,'cloud_available','download',?) ON CONFLICT(file_id) DO UPDATE SET hash=excluded.hash,state='cloud_available',direction='download',retry_count=0,last_error='',updated_at=excluded.updated_at",params:[r.payload.id,r.payload._blob,new Date().toISOString()]});
          }
        }
        const columns=Object.keys(payload);
        statements.push({sql:`INSERT INTO "${r.table}" (${columns.map(c=>`"${c}"`).join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(${schema.keys.map(c=>`"${c}"`).join(',')}) DO UPDATE SET ${columns.filter(c=>!schema.keys.includes(c)).map(c=>`"${c}"=excluded."${c}"`).join(',') || `"${schema.keys[0]}"=excluded."${schema.keys[0]}"`}`,params:Object.values(payload)});
      }
      if(r.table==='synced_preferences') {
        if(r.payload) statements.push({sql:'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',params:[r.payload.id,r.payload.value]});
        else statements.push({sql:'DELETE FROM settings WHERE key=?',params:keys});
      }
      statements.push(versionStatement(r),baselineStatement(r));
    }
    statements.push({sql:'UPDATE sync_context SET applying=0,cursor=? WHERE id=1',params:[remote.cursor]});
    await l.batch(statements);
  }
  private order(records:RemoteRecord[]) {
    // Parent checks in degree triggers are immediate even with deferred FKs.
    const pending=[...records.filter(r=>r.payload!==null)],result:RemoteRecord[]=[];
    while(pending.length) {
      const index=pending.findIndex(r=>!syncSchema[r.table].foreign.some(f=>pending.some(other=>other!==r && other.table===f.table && other.payload?.[f.to]===r.payload?.[f.column])));
      // Nullable cross-links can be cyclic; SQLite's deferred constraints handle them.
      result.push(pending.splice(index<0?0:index,1)[0]);
    }
    return [...records.filter(r=>r.payload===null),...result.sort((a,b)=>a.table==='semesters'&&b.table==='semesters'?Number(a.payload?.status==='Active')-Number(b.payload?.status==='Active'):0)];
  }
  async resolve(table:string,key:string,choice:'local'|'remote') {
    const [conflict]=await this.local.query<{remote_version:number;remote_payload:string|null}>('SELECT * FROM sync_conflicts WHERE table_name=? AND record_key=?',[table,key]);
    if(!conflict) return;
    const history:Statement={sql:'INSERT INTO sync_resolution_history(id,table_name,record_key,local_payload,remote_payload,remote_version,resolution) SELECT ?,table_name,record_key,local_payload,remote_payload,remote_version,? FROM sync_conflicts WHERE table_name=? AND record_key=?',params:[crypto.randomUUID(),choice,table,key]};
    if(choice==='local') await this.local.batch([history,versionStatement({table,key,payload:null,version:conflict.remote_version}),{sql:'DELETE FROM sync_conflicts WHERE table_name=? AND record_key=?',params:[table,key]}]);
    else {
      // Discard only the pending marker; the canonical row is fetched atomically next cycle.
      // Reset cursor so this row is included even if an older page was already applied.
      await this.local.batch([history,{sql:'DELETE FROM sync_outbox WHERE table_name=? AND record_key=?',params:[table,key]},{sql:'DELETE FROM sync_conflicts WHERE table_name=? AND record_key=?',params:[table,key]},{sql:'DELETE FROM sync_versions WHERE table_name=? AND record_key=?',params:[table,key]},{sql:'UPDATE sync_context SET cursor=0 WHERE id=1'}]);
    }
  }
}
