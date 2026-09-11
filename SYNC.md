# Self-hosted Supabase sync

UniDesk uses local SQLite and course files for immediate interaction. Sync is optional. Local writes and their outbox entries commit together, without waiting for a server. The worker retries while the app is open, on reconnect and on return from suspension. It cannot promise background execution when Android suspends the app.

## Deploy

1. Install the official [self-hosted Supabase Docker stack](https://supabase.com/docs/guides/self-hosting/docker) on your server. Set its deployment secrets, public HTTPS URL and SMTP settings for account confirmation according to that guide. UniDesk needs Auth, PostgREST and Storage.
2. Apply all SQL files in `supabase/migrations` in filename order as the database administrator, once per installation. Use Studio's SQL editor or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <migration.sql>`. These create the sync RPC, entity allowlist, per-account records/revisions/device registry, RLS policies and private `unidesk-files` bucket. Do not run the test bootstrap against your deployment.
3. In UniDesk, open **Settings ? Sync & Account**, enter the HTTPS Supabase API URL and its public/anon API key, then create an account or sign in with email/password. Never enter a service-role/secret key. See Supabase's [self-hosted key configuration](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys).
4. On a fresh device, choose **Connect an existing UniDesk workspace** on the welcome screen and sign in before creating a semester. Sync downloads the existing records into its local SQLite database. Choose a device name in Settings.

Release apps require HTTPS. Debug builds permit HTTP loopback for development. No Supabase endpoint or administrator credential is bundled. No production server is deployed automatically. UniDesk accounts are independent of Microsoft 365/Gmail integration.

Passwords are used only for authentication. Access/refresh tokens are retained in Windows Credential Manager or Android Keystore-backed encrypted storage; they never enter SQLite or frontend settings. Sign-out removes this device's saved session and preserves local work. A database remains bound to its first account workspace to prevent accidental uploads into another account. Reconnect that account to resume.

## Records and conflicts

Migrations 17?19 preserve existing academic records and add transaction-bound capture, compacted outbox entries, monotonic local versions, baselines, conflicts and tombstones. Stable existing text/composite identities travel between devices; local row IDs do not. Academic data, schedules/exceptions, grades, study records, file metadata/links, degree and syllabus data, source history, week-start and reminder-lead preferences sync. Paths, credentials, UI layout, mail caches, extraction indexes, notification delivery flags and running timers remain device-local.

Each accepted write uses expected server versions and a durable mutation identity. Lost acknowledgements replay safely. Remote batches and their cursor commit in one SQLite transaction; failed applies roll back. Server revisions and tombstones are retained indefinitely, preventing stale devices from resurrecting deletions.

Disjoint field edits merge from a shared baseline. Overlapping low-risk titles, colors and notes use server acceptance order, without trusting device clocks. Dates, weights, schedules, degree constraints, delete/edit races and different binary hashes require review in Settings. Both snapshots and resolution history are retained. A missing/deleted parent prevents acceptance of an orphaned child: restore the parent or remove the pending child and retry. Constraint errors retain local data and the previous cursor.

## Files

Metadata and binary transfers have separate durable queues. Metadata can arrive before its blob; a failed upload does not undo an accepted record. Immutable upload snapshots and SHA-256 object names deduplicate content. Downloads verify SHA-256 before marking a file available offline. Absolute paths never travel to the server. Copies use each device's local course folder and `.sync` cache.

The default policy downloads small PDF/DOCX/text files (up to 2 MB) automatically and larger files when opened. **Keep all course files offline** is optional. The file list exposes cloud/offline/upload/downloading/error states. Open, Share, Export and document extraction request missing content first. Download retries remain independent of record saves. Changed local files are detected by file metadata during sync; hashing occurs when preparing a changed file, never on render.

Logical deletion propagates; cached bytes and historical blobs remain until an explicit safe retention policy is implemented. Windows retains Recycle Bin behavior for explicit local file removal. Android uses app-private storage, document-picker imports, FileProvider open/share and document-provider export.

Bounds: 100 MB per file, 10,000 records per push, 32 MB per structured request/response. Larger workspaces need pagination before increasing these bounds. Missing or oversized local files retain their own pending entries until corrected; unrelated academic changes can still sync. Back up Supabase Postgres and Storage together; do not reset server history while clients retain old cursors. HTTPS protects transport; server-side content is not end-to-end encrypted.

## Validation and reference service

`npm test` exercises two SQLite devices against the authenticated Node HTTP reference adapter: replay, tombstones, conflicts, file policies, interrupted transfer and failed transactional apply. `scripts/supabase-sql-test.mjs` validates the production SQL/RPC/RLS against a disposable PostgreSQL container with minimal auth/storage schema stand-ins. Set `UNIDESK_TEST_POSTGRES_CONTAINER` to that container and run the script. It tests replay, CAS, tombstones, owner isolation and storage policies; it does not substitute for a full GoTrue/Storage deployment test.

`server/sync-service.ts` and `scripts/sync-account.mjs` remain protocol fixtures for testing and legacy compatibility. The app's account UI targets Supabase. See [Android builds](docs/android.md) for builds and device behavior.

## First sync, devices and offline use

Sign-in does not immediately upload an existing database. Review local/cloud counts and likely duplicate courses or assignments, then enable sync. Equal stable identities use the normal merge rules. Similar records with different IDs require explicit acknowledgement to keep separately; no guessed identity merges or deletion occur. Reconcile those records through the existing academic editors.

The global status button opens Sync & Account. Local changes trigger a debounced sync; record retries back off up to five minutes. File transfers run separately. All local query hooks run even when the device reports no network. Sign-out retains local data.

Device removal revokes that device ID and its registered Supabase session's access to UniDesk RPC, record reads and private Storage. Another active device can restore access. This does not revoke unrelated applications using the same Supabase account, and does not erase the removed device's local files.

Remove local copy evicts only a synchronized, unchanged copy. It retains the file record, hash and remote content, and disables that file's automatic download until opened/downloaded again. On Windows the local copy goes through the Recycle Bin. Delete everywhere removes the logical record and synchronizes a tombstone.

## Test configuration

Optional build defaults: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Users can also enter these in Settings. Only the public/anon key belongs in a client build.

Separate real integration tests use `SUPABASE_URL` and `SUPABASE_ANON_KEY`; optional `SUPABASE_SERVICE_ROLE_KEY` is confined to the test process for disposable-account cleanup. Run `node --import tsx --test tests/supabase.integration.ts`. Ordinary `npm test` needs no cloud credentials. For a local CLI stack, `SUPABASE_CLI` identifies the installed executable and `node scripts/test-supabase-local.mjs` reads ephemeral CLI credentials into memory.

`node --import tsx scripts/native-cross-device-smoke.mjs` targets an isolated Windows debug profile and the dedicated `emulator-5554` test installation. It requires the local Supabase CLI stack, a freshly installed Android test app and the Windows debug executable. The Windows test vault is explicitly namespaced; production builds ignore the test-vault environment variable.
