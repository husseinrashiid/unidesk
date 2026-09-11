import type { Payload } from './protocol';
const safeFields=new Set(['title','name','color','notes','description','value']);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Remote server versions order writes; device wall clocks never decide a winner. */
export function mergeConflict(table:string,base:Payload|null,local:Payload|null,remote:Payload|null):Payload|null|undefined {
  if(!local||!remote) return undefined; // Deletion versus edit always needs review.
  if(equal(local,remote)) return remote;
  if(table==='files') return local._blob && local._blob===remote._blob ? {...remote,...local} : undefined;
  if(!base) return undefined;
  const changed=Object.keys(local).filter(key=>!equal(local[key],base[key])&&!['updated_at','created_at'].includes(key));
  const overlapping=changed.filter(key=>!equal(remote[key],base[key])&&!equal(remote[key],local[key]));
  if(overlapping.some(key=>!safeFields.has(key) || (key==='value'&&table!=='synced_preferences'))) return undefined;
  const merged={...remote};for(const key of changed) merged[key]=local[key];return merged;
}
