# UniDesk platform expansion ? verification report

Build: 0.5.6. Deployment target: self-hosted Supabase. Verification dates: 11?12 September 2026.

## 1. Architecture

One React application and shared academic/domain services run on Windows, Android and the browser development adapter. Native clients use Rust with bundled SQLite. Sync is an optional service over local persistence; academic saves commit locally before network work. `SyncEngine`, `CloudSyncAdapter`, protocol validation, conflict handling, setup inspection and file transfers are separate modules under `src/features/sync`.

## 2. Platform boundaries

`services/interfaces.ts`, `capabilities.ts`, `platform.ts` and `nativeUi.ts` separate file access, notification delivery, device identity, secure native commands, drag/drop and zoom. Native no longer means Windows. Windows Explorer, Recycle Bin, window state and WebView zoom remain Windows capabilities. Android receives document-picker, share/export and Back handling. Browser development retains its loopback SQLite API. Android uses a bounded read-only IPC readiness probe before workspace queries; uncertain mutations are never automatically retried by this probe. Local React Query reads/mutations run even when the device reports no network.

## 3. Database migrations

Both native and browser SQLite apply migrations through version **19**. Migration 17 adds device identity, transaction-bound capture triggers, compacted outbox, local versions, tombstones and conflict state. Migration 18 adds account/file preferences, retry state, baselines and resolution history. Migration 19 adds per-file automatic-download preference. Existing records and foreign keys remain intact; initial backfill captures existing canonical records without replacing their IDs or wiping data. Generated capture and cloud entity descriptors share `scripts/sync-schema.mjs`.

## 4. Identity strategy

Existing stable text IDs, including existing UUIDs, remain unchanged. New application entities use UUIDs. Tables with composite primary keys retain canonical composite identities; migration does not renumber historical relationships. A random persistent 128-bit device identifier is generated once per installation. Sync uses entity identity plus device/mutation sequence and server version, not device paths or SQLite row numbers.

## 5. Sync algorithm

Local transactions update canonical rows and their outbox atomically. The outbox compacts repeated offline edits. Push uses expected server versions, durable mutation identity and idempotent replay. Pull validates entity schemas and applies ordered changes with capture suppressed; row changes and cursor advancement commit together. Rollback preserves the previous cursor. Tombstones and revisions remain durable. Workers run on startup, resume/focus, connectivity return, debounced local changes, manual request and periodic foreground polling, with bounded backoff. Account binding prevents accidentally uploading one workspace into another account.

## 6. Conflicts

Three-way merge preserves disjoint changes. Overlapping low-risk titles, names, colors, notes and descriptions use server acceptance order rather than trusting device clocks. Protected dates, schedules, weights, degree constraints, deletion/edit races and different binary hashes require review. Both snapshots and resolution history persist. Resolution updates history and local sync state transactionally. Missing/deleted parents keep dependent changes pending. First-link review shows counts and likely duplicates; different identities are not silently collapsed or discarded.

## 7. Supabase schema

Three ordered production migrations create owner-scoped devices, canonical records, revision history, entity descriptors, validated versioned RPC and a private `unidesk-files` bucket. Academic changes pass through the RPC with schema, identity, ownership, CAS, replay and parent checks. The third migration adds registered-session and device revocation. Auth uses email/password signup, sign-in, refresh and sign-out.

## 8. Security and RLS

Authenticated ownership policies isolate accounts. Direct academic writes bypassing RPC are denied. Storage permits owner-scoped reads/inserts and immutable hash objects. Removed device sessions lose UniDesk RPC, record and Storage access. Release clients require HTTPS and reject service-role/secret keys. Session secrets remain in native secure storage, not SQLite, renderer settings or logs. Sign-out preserves local academic data. This is TLS and server access control, **not end-to-end encryption**.

## 9. File synchronization

File metadata and byte transfers use separate durable queues. SHA-256 identifies immutable upload snapshots and deduplicates equal content. Downloads verify hashes before marking copies offline. Windows paths and Android URIs never sync. Small PDF/DOCX/text files up to 2 MB download automatically by default; other files download on demand, with an optional keep-all policy. Missing or oversized files retain individual errors while unrelated academic records proceed. Remove local copy verifies unchanged synchronized content, retains cloud metadata and disables automatic redownload until explicitly opened/downloaded. Delete everywhere propagates a tombstone. Historical cloud bytes are retained.

The alignment build flags follow [Android?s NDK guidance](https://developer.android.com/guide/practices/page-sizes#compile-r27). Both maximum and common ELF page size are set to 16384 for the Android shared library only.

## 10. Android filesystem

Course files reside under application-private `files/University`, with device-specific SQLite/cache locations. ACTION_OPEN_DOCUMENT selects provider URIs, which are copied through ContentResolver to a staging cache, then imported into course storage. FileProvider grants temporary read access for open/share. ACTION_CREATE_DOCUMENT exports a copy to the chosen provider. No broad external-storage permission is requested. Built-in PDF viewing and native document extraction operate on downloaded local copies.

## 11. Secure storage

The shared Rust `SecureStorage` interface preserves Windows Credential Manager target names. Android encrypts preferences with AES-GCM using a key held by Android Keystore. Application backup is disabled to avoid restoring credentials/device identity to another installation. Supabase, Microsoft and other sensitive native secrets share this boundary. Windows debug acceptance tests use an isolated credential namespace that production builds ignore.

## 12. Notifications

Shared reminder logic produces native notifications on both platforms. Android permission is requested from the Settings action, with an Academic reminders channel. Delivery flags remain local; canonical academic dates and supported reminder preferences sync. Foreground/resume delivery is implemented. Exact alarms and suspended/background execution are not promised.

## 13. Tablet and responsive UI

Landscape retains the productive sidebar. Portrait tablets and narrow screens use a focus-managed navigation drawer; coarse pointers receive larger controls. Semantic tables gain labeled stacked cells, dialogs fit the viewport and scroll, native Android system-bar/keyboard insets and CSS safe-area padding keep controls accessible, and calendar defaults to agenda in compact layouts. Android Back closes dialogs/drawers, follows navigation history and backgrounds the app at the root. The global sync indicator opens account/status details. Ask Course routing is restored so document question actions reach the existing implementation.

## 14. Windows verification

Browser regression checks cover local workspace creation, import, collision handling, rename/move, metadata-only removal preserving bytes, assignments, exams, calendar, search, archive, notification records, theme and persistence. Native tests additionally cover real filesystem import, rename/move, Explorer reveal, Recycle Bin removal, 150% zoom/reset, local extraction/search, mail setup and process restart. Real Supabase native testing exercises Windows Credential Manager-backed account setup and cross-device transfer. Microsoft tenant authorization and real mailbox synchronization require the user's own tenant/client registration and were not claimed as live verified.

## 15. Android verification

The ARM64 debug APK was installed on a dedicated API 35 Google APIs x86_64 tablet emulator using ARM64 translation, at 1600?2560 pixels. Verified native startup, SQLite version 19, account setup, Windows-to-Android records/files, offline edit/reconnect, course/syllabus/degree/calendar screens, SAF picker/import, Android-to-Windows download, share and export. Focused native acceptance now also verifies notification denial/grant and real delivery after restart; local eviction and hash-verified redownload; file/task tombstones on Windows; Android Back; Keystore/SQLite persistence; and an offline outbox surviving force-stop and syncing afterward. Physical acceptance also passed on the user?s SM-X710 tablet running Android 16: data-preserving APK update, retained workspace/device identity/account state, portrait/landscape course/syllabus/degree/calendar navigation, visible Samsung keyboard and accessible unsaved-dialog actions. No records were saved by the hardware checks; original rotation settings were restored. Screenshots exposed an ELF alignment warning, fixed through Android-specific 16 KB linker settings. The installed APK hash matches the corrected build, and clean startup no longer shows the warning.

## 16. Tests added and updated

- `tests/sync.test.ts`: 13 scenarios covering independent SQLite devices, compacted outbox, replay, cursor rollback, authorization/schema validation, tombstones, safe/protected conflicts, binary resolution, file retry/on-demand behavior, orphan protection, first-link duplicate review and persistent identity.
- `tests/native-ready.test.ts`: lost initial read-only IPC, shared readiness, bounded failure and recovery.
- `tests/supabase.integration.ts`: real Auth/session refresh, PostgREST RPC, two SQLite clients, private Storage, conflict/deletion, account isolation and device/session revocation.
- `scripts/supabase-sql-test.mjs`: production SQL/RLS/RPC against an isolated temporary database.
- `tests/browser/platform.spec.ts`: landscape, two portrait tablet sizes, phone, navigation focus, tables, dialogs and network-independent startup.
- `scripts/native-cross-device-smoke.mjs`: real Windows/Android clients, file picker, sync, offline changes, eviction/redownload/deletion and secure/offline-outbox restart persistence; preserves user-provided export-focus polling and permission-dump retry fixes.
- `scripts/android-notification-smoke.mjs`: independent real permission denial/grant, native delivery and restart delivery checks.
- `scripts/tablet-readonly-smoke.mjs`: existing-data fingerprint, physical rotation/keyboard/dialog checks and restored device settings.
- `scripts/check-android-alignment.mjs`: ELF LOAD/RELRO checks and SDK APK ZIP alignment verification, enforced by Android builds.
- Existing browser/native regression scripts updated to current course sections, syllabus/PDF UI and supported grade workflows. Retired Study/timer navigation is not reintroduced; its domain/storage tests remain.

## 17. Commands

Run from `D:\App` (PowerShell). Test data/logs use `.local`; native scripts must only target the dedicated test emulator.

```powershell
node node_modules/typescript/bin/tsc -b
node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts
# With CARGO_HOME=.local/cargo, RUSTUP_HOME=.local/rustup and cargo/bin on PATH:
cargo test --manifest-path src-tauri/Cargo.toml --lib
node node_modules/playwright/cli.js test --config playwright.config.ts
node node_modules/playwright/cli.js test --config playwright.platform.config.ts
node node_modules/playwright/cli.js test --config playwright.course-fixes.config.ts
node node_modules/playwright/cli.js test --config playwright.local-academic.config.ts
# SUPABASE_CLI identifies the locally installed CLI; it reads credentials into memory:
node scripts/test-supabase-local.mjs
# UNIDESK_TEST_POSTGRES_CONTAINER identifies the local PostgreSQL test container:
node scripts/supabase-sql-test.mjs
node --import tsx scripts/native-smoke.mjs
node node_modules/playwright/cli.js install android
# Set UNIDESK_CORE_ONLY=1 to run core sync/persistence independently of external dialogs:
node --import tsx scripts/native-cross-device-smoke.mjs
node scripts/android-notification-smoke.mjs
# UNIDESK_TABLET_SERIAL identifies the user-authorized physical tablet; this never resets it:
node scripts/tablet-readonly-smoke.mjs
node scripts/check-android-alignment.mjs src-tauri/target/aarch64-linux-android/debug/libunidesk_lib.so src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
node scripts/check-android-alignment.mjs src-tauri/target/aarch64-linux-android/release/libunidesk_lib.so src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk
npm.cmd run desktop:build
npm.cmd run android:debug
npm.cmd run android:build
```

The local CLI stack was started with `start --workdir .local/supabase-runtime --exclude studio,imgproxy,inbucket,realtime,edge-runtime,logflare,vector,supavisor`. All three production migrations were applied. `adb reverse tcp:54321 tcp:54321` connects only the test emulator to that stack. No production credentials are required for ordinary unit tests.

## 18. Results

| Check | Result | Evidence |
| --- | --- | --- |
| Strict TypeScript / production frontend | Pass | Final native builds run `tsc -b` and Vite |
| Unit suite | 129 passed, 0 failed | `.local/platform-unit-final.log` |
| Rust library suite | 33 passed, 0 failed | `.local/platform-rust-final.log` |
| Main browser regression | 6 passed | `.local/platform-browser-full-final.log` |
| Tablet/phone/offline browser | 2 passed | `.local/platform-responsive-final.log` |
| Course navigation/documents/instructors | 1 passed | `.local/platform-course-fixes-final.log` |
| Degree PDF/planner/syllabus browser | 1 passed | `.local/platform-academic-final.log` |
| Real Supabase Auth/RPC/Storage integration | 1 passed | `.local/supabase-integration-final.log` |
| Production SQL/RLS checks | Pass | `.local/supabase-sql-final.log` |
| Windows native filesystem/zoom/documents/restart | Pass, including move/reveal/Recycle Bin | `.local/platform-native-windows-final.log` |
| Focused real Windows/Android acceptance | Pass: eviction, hash-verified redownload, file/task tombstones, Back, Keystore/SQLite/outbox restart | `.local/android-core-acceptance.log` |
| Android native notifications | Pass: denial, grant, channel/delivery and delivery after restart | `.local/android-notification-acceptance.log` |
| Debug APK signature / manifest | Pass: APK v2 signature, ARM64, min SDK 26, target 36 | `.local/platform-apk-signature.log`, `.local/platform-apk-manifest.log` |
| Windows NSIS build | Pass | `.local/platform-desktop-release-final.log` |

The focused core run deliberately skips already-verified external picker/share/export dialogs (`UNIDESK_CORE_ONLY=1`). Those flows have separate prior native evidence and user-confirmed repeated runs. Notification acceptance runs separately without the competing Android automation driver. This is combined evidence from real runs, not a claim that every dialog passed in a single uninterrupted combined run.

Debug and release builds pass ELF LOAD/RELRO and APK ZIP 16 KB alignment checks. The negative check reproduced the old misaligned library before the fix. The corrected debug APK was installed over the existing physical-tablet app without clearing data. Release packaging succeeded; the release APK remains unsigned pending an owner-managed release key.

| Additional acceptance | Result | Evidence |
| --- | --- | --- |
| Physical SM-X710 / Android 16 | Pass: upgrade preservation, portrait/landscape, native keyboard and dialog fit, no compatibility warning | `.local/tablet-acceptance.log`, `.local/tablet-acceptance/1789217405931/` |
| Android debug build + alignment | Pass | `.local/android-debug-16kb.log` |
| Android release build + alignment | Pass | `.local/android-release-acceptance.log` |

The hardware kernel reports 4 KB pages. The binaries and APK packaging are verified for 16 KB alignment; a true 16 KB kernel runtime was not available.

## 19. APK and installer paths

- Signed ARM64 debug: `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.
- Signed ARM64 release: `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk` (signed with the `.local/keystore/unidesk-release.keystore` key; supersedes the earlier unsigned build).
- Windows installer: `src-tauri/target/release/bundle/nsis/UniDesk_0.5.6_x64-setup.exe`.

### Final package inventory

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Installable debug APK | 459,743,102 | `e399373c7ab8507da03ddc55144de41ce938e3bf00cc5063d048df6e27f1dce8` |
| Signed release APK | 25,638,277 | `a5e4b4800f0e8dd6c35a98069ff57ff787d4f0eba70478ff6268467e9fdb6baa` |
| Windows NSIS installer | 7,339,899 | `4f9172cfbe691c0f61b8a3726049347b8c023ef7df4ebd3503aacd69c79f65ea` |

## 20. Supabase setup still required

Deploy the official self-hosted Supabase stack on your server, configure HTTPS, SMTP/account confirmation and persistent Postgres/Storage volumes. Apply the three files in `supabase/migrations` in filename order. Enter the API URL and public/anon key in each native client, or supply optional build defaults `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Review/upload the existing Windows workspace, then sign in and set up the tablet. Back up database and Storage together; retain revision/tombstone history. See [supabase-setup.md](supabase-setup.md). A local disposable test server has been used; your production server has not been deployed.

## 21. Android signing

A release keystore (`unidesk-release`, RSA 4096, PKCS12, valid to 2056) was generated under `.local/keystore/` and used to build and sign `app-arm64-release.apk` via `npm.cmd run android:build` with `UNIDESK_ANDROID_KEYSTORE`, `UNIDESK_ANDROID_STORE_PASSWORD`, `UNIDESK_ANDROID_KEY_ALIAS`, and `UNIDESK_ANDROID_KEY_PASSWORD` set. `apksigner verify --verbose --print-certs` confirms v2-scheme verification against that key. The keystore and its passwords (`.local/keystore/README-KEEP-THIS.txt`) are gitignored and exist only on this machine; keep an independent backup, since losing them makes future updates to this app identity impossible. Production hosting/deployment was intentionally deferred by the project owner and remains an external setup step. See [android.md](android.md).

## 22. Limits

Foreground/resume sync and reminders; no always-running Android service or exact background alarm. No E2EE, resumable large-file uploads or historical blob garbage collection. Current limits are 100 MB/file, 10,000 records/push and 32 MB structured request/response. Larger deployments need pagination/retention work before increasing bounds. Independently created duplicate identities require explicit acknowledgement/manual reconciliation. Native sync/account setup is unavailable in browser UI development; injectable HTTP adapters support headless sync tests. Gmail OAuth remains Windows-only; Microsoft device-code support uses the shared native vault but live tenant authorization remains unverified. Real SMTP confirmation and user-owned production deployment/signing remain external setup steps. Physical Samsung acceptance is complete for the checks listed above; live cloud access on that personal tablet was not configured or changed. Build warnings include existing Rust unused code and frontend bundle-size warnings.
