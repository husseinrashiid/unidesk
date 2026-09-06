import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const env={...process.env};
const local=path.resolve('.local/cargo/bin/cargo.exe');
if(fs.existsSync(local)){env.CARGO_HOME=path.resolve('.local/cargo');env.RUSTUP_HOME=path.resolve('.local/rustup');}
const child=spawn(fs.existsSync(local)?local:'cargo',['build','--manifest-path','src-tauri/Cargo.toml','--example','extract_document','--release','--offline'],{env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);
