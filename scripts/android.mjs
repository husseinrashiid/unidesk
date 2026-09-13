import { existsSync, readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = process.cwd();
const env = { ...process.env };
if (existsSync('.local/cargo/bin/cargo.exe')) {
  env.CARGO_HOME = path.join(root, '.local/cargo');
  env.RUSTUP_HOME = path.join(root, '.local/rustup');
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = path.join(env.CARGO_HOME, 'bin') + path.delimiter + env[pathKey];
}
env.ANDROID_HOME ||= path.join(root, '.local/android-sdk');
const ndks = path.join(env.ANDROID_HOME, 'ndk');
if (!env.NDK_HOME && existsSync(ndks)) env.NDK_HOME = path.join(ndks, readdirSync(ndks).sort().at(-1));
if (existsSync('.local/android-jdk')) env.JAVA_HOME = path.join(root, '.local/android-jdk', readdirSync('.local/android-jdk').find(name => name.startsWith('jdk-')));
env.GRADLE_USER_HOME ||= path.join(root, '.local/gradle');
if (!existsSync(env.ANDROID_HOME) || !env.NDK_HOME || !existsSync(env.NDK_HOME)) {
  console.error('Install the Android SDK and NDK, then set ANDROID_HOME, NDK_HOME and JAVA_HOME. See ANDROID.md.');
  process.exit(1);
}
const args=process.argv.slice(2);
function finish(code) {
  if(code!==0 || args[0]!=='build' || !args.includes('aarch64')) {process.exit(code??1);return;}
  const profile=args.includes('--debug')?'debug':'release';
  const apkName=profile==='debug'?'app-arm64-debug.apk':env.UNIDESK_ANDROID_KEYSTORE?'app-arm64-release.apk':'app-arm64-release-unsigned.apk';
  const check=spawn(process.execPath,['scripts/check-android-alignment.mjs',`src-tauri/target/aarch64-linux-android/${profile}/libunidesk_lib.so`,`src-tauri/gen/android/app/build/outputs/apk/arm64/${profile}/${apkName}`],{env,stdio:'inherit',windowsHide:true});
  check.on('exit',result=>process.exit(result??1));
}

const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'android', ...args], {env, stdio:['inherit','pipe','pipe'], windowsHide:true});
let output='';
child.stdout.on('data',chunk=>{process.stdout.write(chunk);output+=chunk;});
child.stderr.on('data',chunk=>{process.stderr.write(chunk);output+=chunk;});
child.on('exit', code => {
  // Tauri uses a symlink for its freshly built .so. Standard Windows accounts may
  // not have that privilege; package the same library with a real copy instead.
  if(code && process.platform==='win32' && args[0]==='build' && args.includes('aarch64') && output.includes('Creation symbolic link is not allowed')) {
    const profile=args.includes('--debug')?'debug':'release';
    const variant=profile==='debug'?'Debug':'Release';
    const project=path.join(root,'src-tauri/gen/android');
    const jni=path.join(project,'app/src/main/jniLibs/arm64-v8a');
    mkdirSync(jni,{recursive:true});
    copyFileSync(path.join(root,`src-tauri/target/aarch64-linux-android/${profile}/libunidesk_lib.so`),path.join(jni,'libunidesk_lib.so'));
    writeFileSync(path.join(project,'local.properties'),`sdk.dir=${env.ANDROID_HOME.replaceAll('\\','/')}\n`);
    console.log('Packaging the compiled ARM64 library using a file copy (Windows symlinks unavailable).');
    const gradle=spawn('cmd.exe',['/d','/c','.\\gradlew.bat',`assembleArm64${variant}`,'-x',`rustBuildArm64${variant}`,'--no-daemon'],{cwd:project,env,stdio:'inherit',windowsHide:true});
    gradle.on('exit',finish);
  } else finish(code);
});
