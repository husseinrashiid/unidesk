import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile);
async function source(db:DatabaseSync,id:string) {
 const row=db.prepare('SELECT f.absolute_path,c.folder_path FROM files f JOIN courses c ON c.id=f.course_id WHERE f.id=?').get(id) as {absolute_path:string;folder_path:string}|undefined;
 if(!row)throw Error('This file reference no longer exists.');
 const [file,root]=await Promise.all([fs.realpath(row.absolute_path),fs.realpath(row.folder_path)]).catch(()=>{throw Error('The source file is missing or cannot be read.');});
 const relative=path.relative(root,file);if(relative.startsWith('..') || path.isAbsolute(relative))throw Error('The file is outside course storage. Locate it before indexing.');
 const stat=await fs.stat(file,{bigint:true});if(!stat.isFile())throw Error('The source is not a document file.');
 return {path:row.absolute_path,fingerprint:`${row.absolute_path}:${stat.size}:${stat.mtimeNs}`};
}
export async function documentCommand(db:DatabaseSync,name:string,args:Record<string,unknown>) {
 if(name==='document_preview') {
  const ext=path.extname(String(args.filename??args.source??'')).toLowerCase();
  if(!['.pdf','.docx','.txt'].includes(ext))throw Error('Choose a PDF, DOCX or text file.');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'unidesk-preview-'));
  try {
   const target=path.join(dir,`document${ext}`);
   if(typeof args.source==='string') {const stat=await fs.stat(args.source);if(!stat.isFile()||stat.size>30_000_000)throw Error('Choose a document smaller than 30 MB.');await fs.copyFile(args.source,target);}
   else {if(!Array.isArray(args.bytes)||args.bytes.length>30_000_000||args.bytes.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('Invalid document bytes.');await fs.writeFile(target,Buffer.from(args.bytes));}
   const {stdout}=await execute(path.resolve('src-tauri/target/release/examples/extract_document.exe'),[target],{windowsHide:true,timeout:120000,maxBuffer:45*1024*1024});
   return JSON.parse(stdout);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
 }
 if(name==='document_probe') {
  const ids=args.fileIds;if(!Array.isArray(ids) || ids.length>25 || ids.some(id=>typeof id!=='string'))throw Error('Check at most 25 documents at a time.');
  return Promise.all(ids.map(async id=>{try{return {file_id:id,fingerprint:(await source(db,id)).fingerprint};}catch(e){return {file_id:id,error:(e as Error).message};}}));
 }
 const id=String(args.fileId??'');const before=await source(db,id);
 const executable=path.resolve('src-tauri/target/release/examples/extract_document.exe');
 await fs.access(executable).catch(()=>{throw Error('Build the local extractor with npm run documents:build before using browser document indexing.');});
 try {
  const {stdout}=await execute(executable,[before.path],{windowsHide:true,timeout:120000,maxBuffer:45*1024*1024});
  if((await source(db,id)).fingerprint!==before.fingerprint)throw Error('The document changed during extraction. Re-index it after saving your edits.');
  return {file_id:id,fingerprint:before.fingerprint,extraction:JSON.parse(stdout)};
 }catch(e){
  const error=e as Error & {stderr?:string;killed?:boolean};
  if(error.killed)throw Error('Document extraction exceeded two minutes. The original file is unchanged.');
  throw Error(error.stderr?.trim().split('\n').at(-1) || error.message);
 }
}
