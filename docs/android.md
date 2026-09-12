# Android builds

Android uses the same React frontend and bundled Rust SQLite database as Windows.
Tauri's generated Gradle project is in `src-tauri/gen/android`; the application ID
is `local.unidesk.app`, preserving the existing Windows identity. Minimum Android
version is API 26. The generated target/compile SDK is API 36.

Install JDK 17, Android SDK platform 36, build-tools 36, platform-tools, NDK
27.2.12479018, and Rust target `aarch64-linux-android`. Set `JAVA_HOME`,
`ANDROID_HOME` and `NDK_HOME`, or use the workspace-local installations under
`.local/android-jdk`, `.local/android-sdk` and `.local/cargo` supported by the
build script. Do not commit SDKs, caches, credentials or signing keys.

```powershell
npm.cmd run android:debug
npm.cmd run android:dev
npm.cmd run android:build
```

`android:debug` builds an ARM64 debug APK. `android:build` builds an ARM64 release
APK; without signing environment variables this is an unsigned, signing-ready
artifact. APK outputs are under `src-tauri/gen/android/app/build/outputs/apk`.
For a connected Samsung device with USB debugging enabled, use `adb install -r`
with the resulting signed APK. A debug APK uses the generated debug signing key.

The Windows build remains `npm.cmd run desktop:build`.

If Windows lacks symlink privileges, the Android script copies Tauri's compiled
ARM64 library into `jniLibs` and packages it with Gradle. It does not enable Windows
Developer Mode or change system policy. This fallback is ARM64/APK-specific.

## Release signing

Create and retain your own Android signing key with JDK `keytool`, store it outside
source control, then set these variables in your release environment:

```text
UNIDESK_ANDROID_KEYSTORE=<absolute path to keystore>
UNIDESK_ANDROID_STORE_PASSWORD=<secret>
UNIDESK_ANDROID_KEY_ALIAS=<alias>
UNIDESK_ANDROID_KEY_PASSWORD=<secret>
```

Gradle uses these for the release signing configuration. Keep the same signing
key for future upgrades. Verify signatures using SDK `apksigner verify` before
distribution. No release key or password is included in this repository.

## Device behavior

The Android welcome screen defaults to app-private storage. ACTION_OPEN_DOCUMENT picker URIs
are copied through ContentResolver into a local staging cache, preserving the
display name. Course import and local PDF/DOCX/text extraction then use ordinary
local files. Open/share uses FileProvider with temporary read permission. Save/export uses
ACTION_CREATE_DOCUMENT to copy the file to the user-selected document provider.
No broad external-storage permission is requested. Credentials are encrypted with
AES-GCM using an Android Keystore key; application backup is disabled to avoid
restoring credentials or device identity onto a different installation.

The shared layout retains a sidebar in landscape, uses a focus-managed dialog
drawer in portrait and on phones, and enlarges controls for coarse pointers.
Windows Explorer, Recycle Bin, drag/drop and webview zoom are capability-gated.
Android notifications use the existing Tauri notification plugin. Reminders and
sync run while the application is active and resume on return; exact/background
alarm delivery is not implemented. Microsoft 365 device-code sign-in shares the native secure token store on both
platforms. Gmail's desktop OAuth setup remains a Windows integration, independent of UniDesk sync.

Android development serves frontend assets on the LAN while disabling the Vite
loopback database backend. The running Android app accesses its own native SQLite
database through IPC. Use the desktop/browser `npm run dev` for loopback dev mode.

Setup references: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
[Tauri file dialogs](https://v2.tauri.app/plugin/dialog/),
[Android command-line tools](https://developer.android.com/studio).

## Emulator checks

Install `emulator` and `system-images;android-35;google_apis;x86_64` with sdkmanager. Create a tablet AVD; its image supports ARM64 translation, so the ARM64 debug APK can run on an x86 Windows host. The dedicated test AVD is kept under `.local/android-avd`. Use Android SDK adb to install the debug APK and launch `local.unidesk.app/.MainActivity`. `adb reverse tcp:54321 tcp:54321` connects the emulator to a local Supabase CLI stack; release apps still require HTTPS.

Android Back closes the active dialog/drawer, then returns through in-app navigation; at the root it backgrounds the activity. Notifications request permission only from the Settings action and use the Academic reminders channel. Local SQLite queries never wait for network connectivity.

See `scripts/native-cross-device-smoke.mjs` for repeatable native two-device checks. Screenshots and isolated test databases are saved under `.local/native-cross-device`. Do not run reset commands against a real user's Android installation.

Native startup uses a bounded, read-only readiness probe before initial SQLite queries. No mutation is replayed by that probe. See [the verification report](platform-expansion-report.md) for measured results.

## Focused acceptance checks (12 September 2026)

With the existing local Supabase test stack and a fresh **dedicated emulator** profile, set `SUPABASE_CLI` to the real CLI executable and `UNIDESK_CORE_ONLY=1`, then run `node --import tsx scripts/native-cross-device-smoke.mjs`. This verifies local eviction/redownload, cross-device file/task deletion, Back, secure sign-in, SQLite and pending offline changes across force-stop/restart. `node scripts/android-notification-smoke.mjs` separately verifies notification denial, grant, actual delivery and delivery after restart. Both passed; the external file-dialog flow remains independently verified. Never run emulator-reset commands against your personal tablet.

When using a `.cmd` Supabase shim on Windows, supply its underlying executable through `SUPABASE_CLI`; the native script spawns an executable directly.

## Native library compatibility

Android builds explicitly align ELF LOAD segments and RELRO boundaries to 16 KB. `scripts/check-android-alignment.mjs` checks the native library and SDK `zipalign -c -P 16 4` checks APK packaging; `scripts/android.mjs` runs both before reporting a successful ARM64 build. The NDK r27 linker flags follow [Android's native page-size guidance](https://developer.android.com/guide/practices/page-sizes#compile-r27). Physical tablet verification caught the previous misalignment warning before release.

## Physical tablet result

On 12 September 2026, the existing SM-X710 installation (Android 16) was updated with `adb -s <tablet-serial> install -r <debug-apk>` without uninstalling or clearing data. Workspace/device-identity/account-state fingerprints matched before and after. Portrait, landscape and visible Samsung-keyboard dialog checks passed, and the 16 KB compatibility warning was absent after installing the aligned build and restarting. Screenshots are recorded in the platform report. `scripts/tablet-readonly-smoke.mjs` requires `UNIDESK_TABLET_SERIAL` and restores the previous rotation settings; it never saves its draft assignment.
