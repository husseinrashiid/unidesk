import { useEffect, useState } from 'react';
import { batch, command, query, native, device } from '../../services/platform';
import { Button, Field, Section, ErrorText } from '../../components/ui';
import { useWorkspace } from '../../hooks/useWorkspace';
import { SyncEngine } from './engine';
import { transferTick } from './transfers';
import { inspectSetup, type SyncSetup } from './setup';
export const syncEngine=new SyncEngine({batch,command,query,scanFiles:()=>command('sync_scan'),deviceInfo:async()=>{const info=await device.getInfo();return {name:info.deviceName,platform:device.platform,appVersion:info.appVersion};}});
export const syncEvent='unidesk:sync';
export function SyncWorker() {
  const {refresh}=useWorkspace();
  useEffect(()=>{
    if(!native) return;
    let stopped=false,busy=false,filesBusy=false,failures=0,nextAttempt=0,debounce:ReturnType<typeof setTimeout>;
    const emit=(message:string)=>{if(!stopped)window.dispatchEvent(new CustomEvent(syncEvent,{detail:message}));};
    const run=async(force=false)=> {
      if(stopped||busy) return;
      if(!navigator.onLine){emit('Offline. Changes are saved locally.');return;}
      if(!force&&Date.now()<nextAttempt)return;
      busy=true;
      try {
        const config=await command<{configured:boolean}>('sync_configure',{action:'status'});
        await batch([{sql:"INSERT INTO sync_preferences VALUES('account_connected',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[String(config.configured)]}]);
        if(!config.configured){emit('Not signed in');return;}
        const [setting]=await query<{value:string}>("SELECT value FROM sync_preferences WHERE key='enabled'");
        if(setting?.value!=='true'){emit('Review sync setup');return;}
        emit('Syncing...');
        const result=await syncEngine.run(false);
        failures=0;nextAttempt=0;
        if(!result.conflicts&&!result.pending)await batch([{sql:"INSERT INTO sync_preferences VALUES('last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[new Date().toISOString()]}]);
        await batch([{sql:"DELETE FROM sync_preferences WHERE key='last_error'"}]);
        if(!stopped) {
          await refresh();emit(result.conflicts?`${result.conflicts} conflicts need review`:result.pending?`${result.pending} changes pending`:'Synced');
          if(!filesBusy){filesBusy=true;void transferTick({query,batch,command}).then(()=>refresh()).catch(()=>{}).finally(()=>{filesBusy=false;emit('File availability updated');});}
        }
      } catch(error) {
        failures++;nextAttempt=Date.now()+Math.min(300000,15000*2**Math.min(failures,5));
        const message=error instanceof Error?error.message:String(error);
        await batch([{sql:"INSERT INTO sync_preferences VALUES('last_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[message]},{sql:'UPDATE sync_outbox SET retry_count=retry_count+1,last_error=?',params:[message]}]).catch(()=>{});emit(message);
      }finally{busy=false;}
    };
    void run();const timer=setInterval(()=>void run(),30_000);
    const wake=()=>void run(true),resume=()=>{if(document.visibilityState==='visible')wake();};
    const changed=()=>{clearTimeout(debounce);debounce=setTimeout(()=>void run(),1500);};
    window.addEventListener('online',wake);window.addEventListener('offline',wake);window.addEventListener('focus',wake);window.addEventListener('unidesk:sync-now',wake);window.addEventListener('unidesk:local-change',changed);document.addEventListener('visibilitychange',resume);
    return ()=>{stopped=true;clearInterval(timer);clearTimeout(debounce);window.removeEventListener('online',wake);window.removeEventListener('offline',wake);window.removeEventListener('focus',wake);window.removeEventListener('unidesk:sync-now',wake);window.removeEventListener('unidesk:local-change',changed);document.removeEventListener('visibilitychange',resume);};
  },[]);return null;
}
export function SyncIndicator(){
 const {navigate}=useWorkspace();const [label,setLabel]=useState(native?'Local data':'Local mode');
 useEffect(()=>{
  let alive=true;const update=async(event?:Event)=>{
   const message=(event as CustomEvent<string>|undefined)?.detail;
   if(message==='Syncing...'){setLabel(message);return;}
   if(message==='Not signed in'){setLabel('Local data');return;}
   if(!navigator.onLine){setLabel('Offline');return;}
   try{const [counts]=await query<{pending:number;conflicts:number;errors:number;files:number;enabled:number}>("SELECT (SELECT COUNT(*) FROM sync_outbox) pending,(SELECT COUNT(*) FROM sync_conflicts) conflicts,((SELECT COUNT(*) FROM sync_preferences WHERE key='last_error')+(SELECT COUNT(*) FROM sync_blobs WHERE state='error')) errors,(SELECT COUNT(*) FROM sync_blobs WHERE state IN ('upload_pending','downloading')) files,((SELECT COUNT(*) FROM sync_preferences WHERE key='enabled' AND value='true')*(SELECT COUNT(*) FROM sync_preferences WHERE key='account_connected' AND value='true')) enabled");
    if(alive)setLabel(!counts.enabled?'Local data':counts.conflicts?`${counts.conflicts} conflicts`:counts.errors?'Sync needs attention':counts.pending?`${counts.pending} changes pending`:counts.files?`${counts.files} file transfers`:'Synced');
   }catch{if(alive)setLabel('Local data');}
  };void update();const listener=(e:Event)=>void update(e);window.addEventListener(syncEvent,listener);window.addEventListener('unidesk:local-change',listener);window.addEventListener('offline',listener);window.addEventListener('online',listener);
  return()=>{alive=false;window.removeEventListener(syncEvent,listener);window.removeEventListener('unidesk:local-change',listener);window.removeEventListener('offline',listener);window.removeEventListener('online',listener);};
 },[]);
 return <button className="sync-indicator" onClick={()=>{navigate('settings');setTimeout(()=>document.getElementById('sync-account')?.scrollIntoView({block:'start'}),100);}} aria-label={`Sync status: ${label}`}>{label === "Local data" || label === "Local mode" ? "Saved locally" : label}</button>;
}
interface Conflict {table_name:string;record_key:string;local_payload:string|null;remote_payload:string|null}
interface AccountStatus {configured:boolean;endpoint?:string;provider?:string;publicKey?:string;email?:string;message?:string}
interface RegisteredDevice {revokedAt?:string;id:string;name:string;platform?:string;appVersion?:string;lastSeenAt?:string}
export function SyncSettings() {
  const [setup,setSetup]=useState<SyncSetup|null>(null),[enabled,setEnabled]=useState(false),[reviewed,setReviewed]=useState(false),[currentId,setCurrentId]=useState('');
  async function deviceAccess(target:string,restore:boolean){setBusy(true);try{await command('sync_request',{route:restore?'restore-device':'remove-device',body:{protocol:1,device:currentId,target}});window.dispatchEvent(new Event('unidesk:sync-now'));}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function inspect(){setBusy(true);try{setSetup(await inspectSetup({batch,query,command},{exchange:(route,body)=>command('sync_request',{route,body})}));}catch(e){setError(String(e));}finally{setBusy(false);}}
  const [endpoint,setEndpoint]=useState(import.meta.env.VITE_SUPABASE_URL??''),[publicKey,setPublicKey]=useState(import.meta.env.VITE_SUPABASE_ANON_KEY??''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[configured,setConfigured]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflicts,setConflicts]=useState<Conflict[]>([]),[pending,setPending]=useState(0),[fileCount,setFileCount]=useState(0),[lastSuccess,setLastSuccess]=useState(''),[devices,setDevices]=useState<RegisteredDevice[]>([]),[deviceName,setDeviceName]=useState(''),[policy,setPolicy]=useState('on-demand');
  async function preference(key:string,value:string){await batch([{sql:'INSERT INTO sync_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',params:[key,value]}]);}
  async function load() {
    const [items,count,files,preferences]=await Promise.all([query<Conflict>('SELECT * FROM sync_conflicts'),query<{count:number}>('SELECT COUNT(*) AS count FROM sync_outbox'),query<{count:number}>("SELECT COUNT(*) AS count FROM sync_blobs b JOIN files f ON f.id=b.file_id WHERE state IN ('upload_pending','downloading','error')"),query<{key:string;value:string}>('SELECT * FROM sync_preferences')]);
    const values=Object.fromEntries(preferences.map(p=>[p.key,p.value]));
    setCurrentId((await device.getInfo()).deviceId);
    setEnabled(values.enabled==='true');setConflicts(items);setPending(count[0].count);setFileCount(files[0].count);setLastSuccess(values.last_success??'');setPolicy(values.file_policy??'on-demand');
    setDeviceName(values.device_name??`UniDesk (${device.platform})`);
    if(values.last_error)setError(values.last_error);
    try{setDevices(JSON.parse(values.devices??'[]'));}catch{setDevices([]);}
  }
  useEffect(()=>{
    void load().catch(e=>setError(String(e)));
    if(native) void command<AccountStatus>('sync_account',{action:'status'}).then(value=>{setConfigured(value.configured);setEndpoint(value.endpoint??import.meta.env.VITE_SUPABASE_URL??'');setEmail(value.email??'');setPublicKey(value.publicKey??import.meta.env.VITE_SUPABASE_ANON_KEY??'');}).catch(e=>setError(String(e)));
    const update=(event:Event)=>{setStatus((event as CustomEvent<string>).detail);setError('');void load().catch(e=>setError(String(e)));};
    window.addEventListener(syncEvent,update);return()=>window.removeEventListener(syncEvent,update);
  },[]);
  async function account(action:'signin'|'signup'|'signout') {
    setBusy(true);setError('');
    try {
      const result=await command<AccountStatus>('sync_account',{action,url:endpoint,publicKey,email,password});setPassword('');setConfigured(result.configured);await preference('account_connected',String(result.configured));setStatus(result.message??(result.configured?'Connecting...':'Signed out. Your local data is available.'));
      if(result.configured){await load();const [flag]=await query<{value:string}>("SELECT value FROM sync_preferences WHERE key='enabled'");if(flag?.value!=='true')await inspect();}else setSetup(null);
      window.dispatchEvent(new Event('unidesk:sync-now'));
    }catch(error){setError(String(error));}finally{setBusy(false);}
  }
  return <div id="sync-account"><Section title="Sync & Account">
    <p>Sign in to sync UniDesk across devices. Your database and downloaded files remain available offline. This account is separate from Microsoft 365 and Gmail.</p>
    {!native?<p>Connect your account in the installed Windows or Android app.</p>:<>
      {!configured?<>
        <Field label="Supabase server"><input type="url" placeholder="https://supabase.example.com/" value={endpoint} onChange={e=>setEndpoint(e.target.value)}/></Field>
        <Field label="Publishable / anon key"><input autoComplete="off" value={publicKey} onChange={e=>setPublicKey(e.target.value)}/></Field>
        <Field label="Account email"><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
        <Field label="Account password"><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field>
        <Button disabled={busy||!email||!password||!endpoint||!publicKey} onClick={()=>void account('signin')}>Sign in</Button>
        <Button disabled={busy||!email||!password||!endpoint||!publicKey} onClick={()=>void account('signup')}>Create account</Button>
      </>:<>
        <p><strong>{email||'Connected account'}</strong></p>
        <Button disabled={busy} onClick={()=>{setStatus('Syncing...');window.dispatchEvent(new Event('unidesk:sync-now'));}}>Sync now</Button>
        <Button disabled={busy} onClick={()=>void account('signout')}>Sign out</Button>
      </>}
      <p role="status">{status||(configured?'Automatic sync enabled':'Not signed in')} | {pending} pending records ? {fileCount} file transfers</p>
      {lastSuccess&&<p className="muted">Records last synced {new Date(lastSuccess).toLocaleString()}</p>}
      <Field label="This device"><input value={deviceName} onChange={e=>setDeviceName(e.target.value)} onBlur={()=>void preference('device_name',deviceName.trim().slice(0,100)||'UniDesk')}/></Field>
      <Field label="File sync"><select value={policy} onChange={e=>{setPolicy(e.target.value);void preference('file_policy',e.target.value).then(()=>window.dispatchEvent(new Event('unidesk:sync-now')));}}><option value="on-demand">Download files on demand</option><option value="all">Keep all course files offline</option></select></Field>
      <p className="muted">Small PDF, DOCX and text documents download automatically. Other files download when opened.</p>
      <details><summary>{devices.length} connected devices</summary>{devices.map(d=><p key={d.id}><strong>{d.name}</strong> {d.platform} {d.appVersion}{d.lastSeenAt&&<small> | Last seen {new Date(d.lastSeenAt).toLocaleString()}</small>}{d.revokedAt&&<small> Access removed</small>}{d.id!==currentId&&<Button disabled={busy} onClick={()=>void deviceAccess(d.id,!!d.revokedAt)}>{d.revokedAt?'Restore access':'Remove device'}</Button>}</p>)}</details>
    </>}
    {configured&&!enabled&&<div className="sync-setup"><h3>Set up sync</h3>{!setup?<Button disabled={busy} onClick={()=>void inspect()}>Review this workspace</Button>:<>
      <p>This device: {setup.local.courses} courses, {setup.local.assignments} assignments, {setup.local.files} files.</p>
      <p>Synced workspace: {setup.cloud.courses} courses, {setup.cloud.assignments} assignments, {setup.cloud.files} files.</p>
      {!!setup.duplicates.length&&<><p>These records have different IDs but look similar. Review them before continuing. Existing data is preserved.</p><ul>{setup.duplicates.map((item,i)=><li key={i}>{item}</li>)}</ul><label className="check-label"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Keep these as separate records; I will reconcile them in UniDesk.</label></>}
      <p>Records with the same identity merge through conflict review. Files download according to your file policy.</p>
      <Button disabled={busy||(!!setup.duplicates.length&&!reviewed)} onClick={()=>void preference('enabled','true').then(()=>{setEnabled(true);setSetup(null);window.dispatchEvent(new Event('unidesk:sync-now'));})}>{setup.local.courses?'Upload and enable sync':'Set up this device'}</Button>
    </>}</div>}
    <ErrorText error={error}/>
    {!!conflicts.length&&<details><summary>{conflicts.length} conflicts need review</summary>{conflicts.map(conflict=><ConflictCard key={conflict.table_name+conflict.record_key} conflict={conflict} onResolve={async(choice)=>{try{await syncEngine.resolve(conflict.table_name,conflict.record_key,choice);await load();window.dispatchEvent(new Event('unidesk:sync-now'));}catch(e){setError(String(e));}}}/>)}</details>}
  </Section></div>;
}
function ConflictCard({conflict,onResolve}:{conflict:Conflict;onResolve:(choice:'local'|'remote')=>Promise<void>}) {
  const local=conflict.local_payload?JSON.parse(conflict.local_payload) as Record<string,unknown>:null;
  const remote=conflict.remote_payload?JSON.parse(conflict.remote_payload) as Record<string,unknown>:null;
  const keys=Array.from(new Set([...Object.keys(local??{}),...Object.keys(remote??{})])).filter(k=>JSON.stringify(local?.[k])!==JSON.stringify(remote?.[k])&&!['id','created_at','updated_at'].includes(k));
  const title=String(local?.title??remote?.title??local?.name??remote?.name??conflict.table_name.replaceAll('_',' '));
  return <article className="sync-conflict"><h3>{title}</h3>{!local||!remote?<p>{!local?'Deleted on this device':'Deleted on the server'}</p>:keys.map(key=><div className="conflict-comparison" key={key}><strong>{key==='_blob'?'File content':key.replaceAll('_',' ')}</strong><span>This device: {String(local[key]??'Unavailable')}</span><span>Server: {String(remote[key]??'Unavailable')}</span></div>)}
    <Button onClick={()=>void onResolve('local')}>Keep this device</Button><Button onClick={()=>void onResolve('remote')}>Keep server version</Button></article>;
}
