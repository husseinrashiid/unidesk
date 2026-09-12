import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [library,apk]=process.argv.slice(2);if(!library)throw Error('Usage: node scripts/check-android-alignment.mjs <library.so> [app.apk]');
const fd=fs.openSync(library,'r');let count=0;
try{
 const header=Buffer.alloc(64);fs.readSync(fd,header,0,64,0);
 if(header.readUInt32LE(0)!==0x464c457f||header[4]!==2||header[5]!==1)throw Error('Expected little-endian ELF64 library');
 const offset=Number(header.readBigUInt64LE(32)),size=header.readUInt16LE(54),number=header.readUInt16LE(56);
 const entries=Buffer.alloc(size*number);fs.readSync(fd,entries,0,entries.length,offset);
 for(let index=0;index<number;index++){
  const entry=entries.subarray(index*size,(index+1)*size),type=entry.readUInt32LE(0);
  if(type===1){count++;if(entry.readBigUInt64LE(48)<16384n)throw Error('ELF LOAD segment is not 16 KB aligned');}
  if(type===0x6474e552&&(entry.readBigUInt64LE(16)+entry.readBigUInt64LE(40))%16384n!==0n)throw Error('ELF RELRO boundary is not 16 KB aligned');
 }
 if(!count)throw Error('No ELF LOAD segments found');console.log(`PASS: ${count} ELF LOAD segments and RELRO use 16 KB alignment`);
}finally{fs.closeSync(fd);}
if(apk){
 const sdk=process.env.ANDROID_HOME??path.resolve('.local/android-sdk'),base=path.join(sdk,'build-tools');
 const version=fs.readdirSync(base).filter(v=>fs.existsSync(path.join(base,v,process.platform==='win32'?'zipalign.exe':'zipalign'))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1);
 const result=spawnSync(path.join(base,version,process.platform==='win32'?'zipalign.exe':'zipalign'),['-c','-P','16','4',apk],{encoding:'utf8'});
 if(result.status!==0)throw Error(`APK ZIP alignment failed: ${result.stderr||result.stdout}`);console.log('PASS: APK uncompressed libraries are ZIP-aligned to 16 KB');
}
