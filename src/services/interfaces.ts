import type { AcademicFile, Category } from '../types';
import type { ImportResult } from './platform';
import type { DeviceOS } from './capabilities';

export type FileOperation='open'|'rename'|'move'|'remove'|'locate'|'reveal'|'share'|'export'|'download'|'evict';
export interface FileSystemPlatform {
  chooseFile():Promise<string|null>;
  chooseFiles():Promise<string[]>;
  chooseDirectory?:()=>Promise<string|null>;
  importFile(courseId:string,category:Category,file:File|string,conflict?:string,folderId?:string):Promise<ImportResult>;
  getFileMetadata(id:string):Promise<AcademicFile|undefined>;
  openFile(id:string):Promise<unknown>;
  revealFile?: (id:string)=>Promise<unknown>;
  shareFile?: (id:string)=>Promise<unknown>;
}
export interface NotificationPlatform {
  showNotification(title:string,body:string):Promise<boolean>;
  requestPermission():Promise<boolean>;
}
export interface DevicePlatform {
  platform:DeviceOS;
  getInfo():Promise<{deviceId:string;deviceName:string;appVersion:string}>;
}
