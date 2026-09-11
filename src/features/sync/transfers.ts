import type { SyncLocal } from './engine';
interface Transfer {auto_download?:number;file_id:string;hash:string;state:string;direction:string;retry_count:number;updated_at:string;filename:string;course_id:string;size:number;extension:string}
const downloads=new Map<string,Promise<void>>();
export async function ensureOffline(local:SyncLocal,id:string):Promise<void> {
  const [file]=await local.query<Transfer>('SELECT b.*,f.filename,f.course_id,f.size,f.extension FROM sync_blobs b JOIN files f ON f.id=b.file_id WHERE file_id=?',[id]);
  if(!file||file.direction==='upload'||file.state==='available_offline') return;
  const active=downloads.get(id);if(active) return active;
  const promise=(async()=>{
    try {
      await local.batch([{sql:"UPDATE sync_blobs SET state='downloading',last_error='' WHERE file_id=? AND hash=?",params:[id,file.hash]}]);
      const result=await local.command<{path:string;signature?:string}>('sync_file',{operation:'download',id,hash:file.hash,filename:file.filename,courseId:file.course_id});
      await local.batch([{sql:'UPDATE files SET absolute_path=? WHERE id=?',params:[result.path,id]},
        {sql:"UPDATE sync_blobs SET state='available_offline',auto_download=1,local_signature=?,last_error='',retry_count=0,updated_at=? WHERE file_id=? AND hash=?",params:[result.signature??'',new Date().toISOString(),id,file.hash],expectChanges:1}]);
    } catch(error) {
      await local.batch([{sql:"UPDATE sync_blobs SET state='error',retry_count=retry_count+1,last_error=?,updated_at=? WHERE file_id=? AND hash=?",params:[error instanceof Error?error.message:String(error),new Date().toISOString(),id,file.hash]}]);throw error;
    }
  })();downloads.set(id,promise);
  try {await promise;}finally{downloads.delete(id);}
}
export async function transferTick(local:SyncLocal) {
  const [preference]=await local.query<{value:string}>("SELECT value FROM sync_preferences WHERE key='file_policy'");
  const files=await local.query<Transfer>("SELECT b.*,f.filename,f.course_id,f.size,f.extension FROM sync_blobs b JOIN files f ON f.id=b.file_id WHERE b.state<>'available_offline' LIMIT 100");
  for(const file of files) {
    if(file.state==='error' && Date.now()-Date.parse(file.updated_at)<Math.min(300000,10000*2**Math.min(file.retry_count,5))) continue;
    try {
      if(file.direction==='upload') {
        await local.command('sync_file',{operation:'upload',id:file.file_id,hash:file.hash});
        await local.batch([{sql:"UPDATE sync_blobs SET state='available_offline',retry_count=0,last_error='',updated_at=? WHERE file_id=? AND hash=?",params:[new Date().toISOString(),file.file_id,file.hash]}]);
      }else if(file.auto_download!==0 && (preference?.value==='all'||(file.size<=2_000_000 && /^(pdf|docx|txt)$/i.test(file.extension.replace(/^\./,''))))) await ensureOffline(local,file.file_id);
    }catch(error){
      if(file.direction==='upload') await local.batch([{sql:"UPDATE sync_blobs SET state='error',last_error=?,retry_count=retry_count+1,updated_at=? WHERE file_id=? AND hash=?",params:[String(error),new Date().toISOString(),file.file_id,file.hash]}]);
    }
  }
}
