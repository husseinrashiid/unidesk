import { nativeReadiness } from "./nativeReady";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AcademicFile, Category, SqlValue, Statement } from "../types";
import { capabilitiesFor, type DeviceOS } from './capabilities';
import type { DevicePlatform, FileSystemPlatform, NotificationPlatform, FileOperation } from './interfaces';
export const native = isTauri();
export const deviceOS: DeviceOS = !native ? 'browser' : /Android/i.test(navigator.userAgent) ? 'android' : /Windows/i.test(navigator.userAgent) ? 'windows' : 'other';
export const capabilities = capabilitiesFor(deviceOS);
export const desktop = native && deviceOS !== 'android';
const ready = nativeReadiness(() => invoke('query', { sql: 'SELECT 1 AS ready', params: [] }));
export async function command<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (deviceOS === 'android') await ready();
  if(native && ['read_pdf','document_extract'].includes(name)) {
    const id=String(args.id??args.fileId??'');
    if(id) await (await import('../features/sync/transfers')).ensureOffline({command,query,batch},id);
  }
  if (native) {
    try {
      const result=await invoke<T>(name,args);
      if(typeof window!=='undefined'&&isLocalMutation(name,args))window.dispatchEvent(new Event('unidesk:local-change'));
      return result;
    } catch (error) {
      if (error && typeof error==='object' && 'message' in error && typeof error.message==='string') {
        const failure=new Error(error.message);
        for(const key of ['code','kind','timestamp','correlation_id','http_status']) {
          if(key in error) Object.assign(failure,{[key]:(error as Record<string,unknown>)[key]});
        }
        throw failure;
      }
      throw new Error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "The local operation could not be completed.",
      );
    }
  }
  const response = await fetch("/api/local", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-UniDesk-Local": "1" },
    body: JSON.stringify({ command: name, args }),
  });
  const result = (await response.json()) as { value: T; error?: string };
  if (!response.ok)
    throw Error(result.error ?? "Could not access your local data.");
  if(typeof window!=='undefined'&&isLocalMutation(name,args))window.dispatchEvent(new Event('unidesk:local-change'));
  return result.value;
}
export const query = <T>(sql: string, params: SqlValue[] = []) =>
  command<T[]>("query", { sql, params });
export const batch = (statements: Statement[]) =>
  command<{ changes: number }[]>("batch", { statements });
export async function chooseFolder(): Promise<string | null> {
  if (!capabilities.chooseDirectory) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return (await open({
    directory: true,
    multiple: false,
    title: "Choose university folder",
  })) as string | null;
}
export async function chooseFiles(): Promise<string[]> {
  if (!capabilities.nativeFilePicker) return [];
  if (deviceOS === 'android') {
    const sources = await command<string[]>('pick_documents', { multiple: true });
    return Promise.all(sources.map(source => command<string>('stage_document', { source })));
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: true,
    directory: false,
    title: "Add course files",
  });
  const paths = result ? (Array.isArray(result) ? result : [result]) : [];
  return paths;
}
export const fileAction = async (
  id: string,
  action: FileOperation,
  options: Record<string, unknown> = {},
) => {
  if(action==='download')return (await import('../features/sync/transfers')).ensureOffline({command,query,batch},id);
  if(action==='evict')return command('sync_file',{operation:'evict',id});
  if (action === 'reveal' && !capabilities.revealFile) throw Error('Showing a folder is not supported on this device.');
  if (action === 'share' && !capabilities.shareFile) throw Error('Sharing is not supported on this device.');
  if(native && ['open','share','export'].includes(action)) await (await import('../features/sync/transfers')).ensureOffline({command,query,batch},id);
  if (action === 'open') {
    const [file] = await query<{filename:string;extension:string}>('SELECT filename,extension FROM files WHERE id=?',[id]);
    if (file && /^(?:\.?)pdf$/i.test(file.extension)) {
      window.dispatchEvent(new CustomEvent('unidesk:pdf',{detail:{id,filename:file.filename}}));
      return;
    }
  }
  return command("file_action", { id, action, ...options });
};
export interface ImportResult {
  id?: string;
  conflict?: boolean;
  filename?: string;
  cancelled?: boolean;
}
export async function importFile(
  courseId: string,
  category: Category,
  file: File | string,
  conflict?: string,
  folderId?: string,
): Promise<ImportResult> {
  if (typeof file === "string")
    return command("import_file", {
      courseId,
      category,
      source: file,
      conflict,
      folderId,
    });
  if (file.size > 30_000_000)
    throw Error("Use the desktop app to import files larger than 30 MB.");
  return command("import_file", {
    courseId,
    category,
    filename: file.name,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    conflict,
    folderId,
  });
}
export const createFileFolder = (courseId: string, category: Category, name: string) =>
  command<{ id: string; name: string }>("create_subfolder", { courseId, category, name });
export const renameFileFolder = (id: string, name: string) =>
  command<void>("rename_folder", { id, name });
export const deleteFileFolder = (id: string, mode: "keep" | "delete", disk?: boolean) =>
  command<void>("delete_folder", { id, mode, disk });
export async function notify(title: string, body: string): Promise<boolean> {
  if (!capabilities.notifications) return false;
  const api = await import("@tauri-apps/plugin-notification");
  if (await api.isPermissionGranted()) {
    if(deviceOS==='android') await api.createChannel({id:'academic-reminders',name:'Academic reminders',description:'Upcoming coursework and exams',importance:api.Importance.Default});
    api.sendNotification({ title, body, ...(deviceOS==='android'?{channelId:'academic-reminders'}:{}) });
    return true;
  }
  return false;
}
export async function enableNotifications(): Promise<boolean> {
  if (!capabilities.notifications) return false;
  const api = await import("@tauri-apps/plugin-notification");
  return (
    (await api.isPermissionGranted()) ||
    (await api.requestPermission()) === "granted"
  );
}
export async function recentFiles(courseId?: string) {
  return query<AcademicFile>(
    `SELECT f.* FROM files f JOIN courses c ON c.id=f.course_id JOIN semesters s ON s.id=c.semester_id WHERE ${courseId ? "c.id=?" : "s.status='Active' AND c.archived=0"} ORDER BY COALESCE(f.accessed_at,f.added_at) DESC LIMIT 5`,
    courseId ? [courseId] : [],
  );
}

export const fileSystem:FileSystemPlatform={
  chooseFile:async()=>(await chooseFiles())[0]??null,
  chooseFiles,
  ...(capabilities.chooseDirectory?{chooseDirectory:chooseFolder}:{}),
  importFile,
  getFileMetadata:async(id)=>(await query<AcademicFile>('SELECT * FROM files WHERE id=?',[id]))[0],
  openFile:id=>fileAction(id,'open'),
  ...(capabilities.revealFile?{revealFile:(id:string)=>fileAction(id,'reveal')}:{}),
  ...(capabilities.shareFile?{shareFile:(id:string)=>fileAction(id,'share')}:{}),
};
export const notifications:NotificationPlatform={showNotification:notify,requestPermission:enableNotifications};
export const device:DevicePlatform={platform:deviceOS,getInfo:async()=>{
  const [row]=await query<{device_id:string}>('SELECT device_id FROM sync_context WHERE id=1');
  return {deviceId:row.device_id,deviceName:`UniDesk (${deviceOS})`,appVersion:native?await (await import('@tauri-apps/api/app')).getVersion():'development'};
}};

function isLocalMutation(name:string,args:Record<string,unknown>){
 if(name==='batch'){const statements=args.statements as Statement[];return Array.isArray(statements)&&!statements.some(s=>/sync_context|sync_outbox|sync_blobs|sync_preferences|sync_versions|sync_conflicts|sync_baselines|sync_resolution_history/.test(s.sql));}
 return ['import_file','file_action','create_course','create_semester','create_subfolder','rename_folder','delete_folder'].includes(name);
}
