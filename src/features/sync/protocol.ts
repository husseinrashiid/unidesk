import schemas from './schema.json';
import type { SqlValue } from '../../types';
export const syncSchema = schemas as Record<string, {columns:string[]; keys:string[]; local:string[]; foreign:{column:string;table:string;to:string}[]}>;
syncSchema.synced_preferences={columns:['id','value'],keys:['id'],local:[],foreign:[]};
export type Payload = Record<string, SqlValue>;
export interface Change { table: string; key: string; payload: Payload | null; base: number; mutation: string }
export interface RemoteRecord { table: string; key: string; payload: Payload | null; version: number }
export interface PushResult { accepted: RemoteRecord[]; conflicts: RemoteRecord[] }
export interface PullResult { records: RemoteRecord[]; cursor: number }
export function validateRecord(table: string, key: string, payload: unknown): asserts payload is Payload | null {
  const schema = Object.hasOwn(syncSchema, table) ? syncSchema[table] : undefined;
  if (!schema) throw Error('Unsupported sync entity');
  const keys: unknown = JSON.parse(key);
  if (!Array.isArray(keys) || keys.length !== schema.keys.length || keys.some(k=>typeof k !== 'string' || !k || k.length>300) || JSON.stringify(keys)!==key) throw Error('Invalid record key');
  if(table==='synced_preferences' && !['week_start','default_reminder_minutes'].includes(String(keys[0]))) throw Error('Device-only preference');
  if (payload === null) return;
  if (typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid record');
  const record = payload as Record<string,unknown>;
  if (schema.columns.some(c=>!Object.hasOwn(record,c))) throw Error('Incomplete record');
  for (const [column,value] of Object.entries(record)) {
    if (!schema.columns.includes(column) && !(table==='files' && column==='_blob')) throw Error('Unsupported field');
    if (value!==null && typeof value!=='string' && !(typeof value==='number' && Number.isFinite(value))) throw Error('Invalid field');
  }
  if (schema.keys.some((column,i)=>record[column]!==keys[i])) throw Error('Mismatched record identity');
  if(table==='synced_preferences' && !['week_start','default_reminder_minutes'].includes(String(record.id))) throw Error('Device-only preference');
  if (table==='files' && !/^[a-f0-9]{64}$/.test(String(record._blob))) throw Error('Missing file content');
}

// Source history can embed previous rows. Remove machine paths recursively.
export function portablePayload(payload: Payload | null): Payload | null {
  if (!payload) return null;
  const local = new Set(['absolute_path','relative_path','folder_path','storage_directory','source_path']);
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key])=>!local.has(key)).map(([key,value])=>[key,clean(value)]));
    return value;
  };
  return Object.fromEntries(Object.entries(payload).map(([key,value])=> {
    if (key.endsWith('_json') && typeof value==='string') { try { return [key,JSON.stringify(clean(JSON.parse(value)))]; } catch { /* retain non-JSON text */ } }
    return [key,value];
  }));
}
