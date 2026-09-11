import {batch,command,query} from '../../services/platform';
import type {Statement} from '../../types';
import {chunkDocument} from './chunking';
import {supportedDocument,type DocumentRecord,type ExtractedFile} from './types';

export function queueStatements(fileId:string):Statement[] {return [
 {sql:"UPDATE documents SET enabled=1,status='Pending',last_error='',updated_at=datetime('now') WHERE file_id=?",params:[fileId]},
 {sql:"INSERT INTO document_index_jobs(file_id,request_id) SELECT file_id,? FROM documents WHERE file_id=? ON CONFLICT(file_id) DO UPDATE SET request_id=excluded.request_id,status='Queued',requested_at=datetime('now'),started_at=NULL,finished_at=NULL",params:[crypto.randomUUID(),fileId]},
];}
export function removeStatements(fileId:string):Statement[] {return [
 {sql:'DELETE FROM document_index_jobs WHERE file_id=?',params:[fileId]},
 {sql:'DELETE FROM document_chunks WHERE document_id=(SELECT id FROM documents WHERE file_id=?)',params:[fileId]},
 {sql:"UPDATE documents SET enabled=0,status='Removed',content_hash='',word_count=0,indexed_at=NULL,last_error='' WHERE file_id=?",params:[fileId]},
];}
export const queueDocument=(id:string)=>batch(queueStatements(id));
export const removeDocument=(id:string)=>batch(removeStatements(id));

export function completeStatements(fileId:string,courseId:string,requestId:string,result:ExtractedFile):Statement[] {
 const e=result.extraction;
 if(result.file_id!==fileId || !e.content_hash || !Array.isArray(e.segments))throw Error('Invalid document extraction result.');
 const chunks=chunkDocument(fileId,courseId,e.segments);
 return [
  {sql:"UPDATE document_index_jobs SET status='Done',finished_at=datetime('now') WHERE file_id=? AND request_id=? AND status='Running' AND EXISTS(SELECT 1 FROM documents d JOIN files f ON f.id=d.file_id WHERE d.file_id=? AND d.enabled=1 AND f.course_id=?)",params:[fileId,requestId,fileId,courseId],expectChanges:1},
  {sql:'DELETE FROM document_chunks WHERE document_id=?',params:[fileId]},
  ...chunks.map(c=>({sql:'INSERT INTO document_chunks(id,document_id,course_id,chunk_index,text,page_start,page_end,slide_start,slide_end,heading,line_start,line_end) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',params:[c.id,c.document_id,c.course_id,c.chunk_index,c.text,c.page_start,c.page_end,c.slide_start,c.slide_end,c.heading,c.line_start,c.line_end]})),
  {sql:"UPDATE documents SET status=?,content_hash=?,fingerprint=?,extractor_version=?,word_count=?,page_count=?,slide_count=?,indexed_at=datetime('now'),updated_at=datetime('now'),last_error='' WHERE file_id=?",params:[chunks.length?'Indexed':'Text unavailable',e.content_hash,result.fingerprint,e.extractor_version,e.word_count,e.page_count,e.slide_count,fileId]},
 ];
}
let running=false;
let recovery:Promise<unknown>|undefined;
let probeCursor='';
let lastProbe=0;
export async function indexTick():Promise<boolean> {
 if(running)return false;running=true;
 try {
  // A renderer restart requeues only interrupted jobs; completed/failed jobs remain settled.
  recovery??=batch([{sql:"UPDATE document_index_jobs SET status='Queued' WHERE status='Running'"}]);await recovery;
  let changed=false;
  if(Date.now()-lastProbe>10000){changed=await detectChanges();lastProbe=Date.now();}
  const [job]=await query<{file_id:string;request_id:string;course_id:string;extension:string;category:string}>("SELECT j.file_id,j.request_id,f.course_id,f.extension,f.category FROM document_index_jobs j JOIN files f ON f.id=j.file_id JOIN documents d ON d.file_id=f.id WHERE NOT EXISTS(SELECT 1 FROM sync_blobs b WHERE b.file_id=j.file_id AND b.direction='download' AND b.state<>'available_offline') AND j.status='Queued' AND d.enabled=1 ORDER BY j.requested_at,j.file_id LIMIT 1");
  if(!job)return changed;
  await batch([{sql:"UPDATE document_index_jobs SET status='Running',started_at=datetime('now') WHERE file_id=? AND request_id=? AND status='Queued'",params:[job.file_id,job.request_id],expectChanges:1},{sql:"UPDATE documents SET status='Indexing',last_error='' WHERE file_id=?",params:[job.file_id]}]);
  window.dispatchEvent(new Event('unidesk:document-index'));
  let fingerprint='unavailable';
  try {
   const [probe]=await command<{fingerprint?:string;error?:string}[]>('document_probe',{fileIds:[job.file_id]});
   if(probe.error)throw Error(probe.error);fingerprint=probe.fingerprint!;
   if(!supportedDocument(job.extension) || job.category==='Recordings')throw Error('This file type or category is not indexed. The original file remains available.');
   const result=await command<ExtractedFile>('document_extract',{fileId:job.file_id});
   await batch(completeStatements(job.file_id,job.course_id,job.request_id,result));
  }catch(e){
   // Do not overwrite a newer request or a user's removal while extraction was running.
   await batch([{sql:"UPDATE documents SET status='Failed',last_error=?,fingerprint=?,updated_at=datetime('now') WHERE file_id=? AND enabled=1 AND EXISTS(SELECT 1 FROM document_index_jobs WHERE file_id=? AND request_id=? AND status='Running')",params:[(e as Error).message,fingerprint,job.file_id,job.file_id,job.request_id]},
    {sql:"UPDATE document_index_jobs SET status='Failed',finished_at=datetime('now') WHERE file_id=? AND request_id=? AND status='Running'",params:[job.file_id,job.request_id]}]);
  }
  return true;
 }finally{running=false;}
}
async function detectChanges() {
 const rows=await query<DocumentRecord>("SELECT * FROM documents WHERE enabled=1 AND NOT EXISTS(SELECT 1 FROM sync_blobs b WHERE b.file_id=documents.file_id AND b.direction='download' AND b.state<>'available_offline') AND file_id>? ORDER BY file_id LIMIT 25",[probeCursor]);
 probeCursor=rows.length===25?rows.at(-1)!.file_id:'';if(!rows.length)return false;
 const probes=await command<{file_id:string;fingerprint?:string;error?:string}[]>('document_probe',{fileIds:rows.map(d=>d.file_id)});
 const statements:Statement[]=[];
 for(const probe of probes){
  const d=rows.find(d=>d.file_id===probe.file_id)!;
  if(['Pending','Indexing'].includes(d.status))continue;
  if(probe.error && (d.fingerprint!=='unavailable' || d.last_error!==probe.error)){statements.push({sql:"UPDATE documents SET status='Failed',fingerprint='unavailable',last_error=? WHERE file_id=? AND enabled=1",params:[probe.error,d.file_id]});}
  else if(!probe.error && d.fingerprint!==probe.fingerprint){statements.push(...queueStatements(d.file_id));}
 }
 if(statements.length)await batch(statements);
 return statements.length>0;
}
