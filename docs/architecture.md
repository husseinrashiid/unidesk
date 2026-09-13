# Architecture

One React application and a shared set of domain services run on Windows, Android, and a browser development adapter. Native clients use Rust with bundled SQLite. Sync is an optional layer over local persistence — academic saves commit locally before any network work. `SyncEngine`, `CloudSyncAdapter`, protocol validation, conflict handling, setup inspection, and file transfers are separate modules under `src/features/sync`.

## Platform boundaries

`services/interfaces.ts`, `capabilities.ts`, `platform.ts`, and `nativeUi.ts` separate file access, notification delivery, device identity, secure native commands, and drag/drop and zoom behavior from the shared UI. Windows Explorer integration, Recycle Bin, window state, and WebView zoom remain Windows capabilities. Android receives document-picker, share/export, and Back-button handling. Browser development keeps its loopback SQLite API. Local React Query reads and mutations run even when the device reports no network.

## Database migrations

Native and browser SQLite apply the same versioned migrations. Sync-related migrations add device identity, transaction-bound capture triggers, a compacted outbox, local versions, tombstones, and conflict state, plus account/file preferences and per-file download preferences. Existing records and foreign keys are preserved across upgrades; backfill captures existing canonical records without replacing their IDs.

## Identity strategy

Existing stable text IDs, including UUIDs already in use, are never changed by migration. New entities use UUIDs. Tables with composite primary keys keep their canonical composite identities. Each installation generates a random persistent 128-bit device identifier once. Sync addresses records by entity identity plus device/mutation sequence and server version — never by device paths or SQLite row numbers.

## Sync algorithm

Local transactions update canonical rows and their outbox entry atomically; the outbox compacts repeated offline edits. Pushing a change uses its expected server version and a durable mutation identity, so replays are idempotent. Pulling validates the entity schema and applies ordered changes with local capture suppressed; row changes and cursor advancement commit together, and a failed apply rolls back to the previous cursor. Workers run on startup, on resume/focus, on connectivity return, on a debounce after local changes, on manual request, and on bounded periodic polling. Each local database is bound to one account workspace to prevent accidentally uploading into another account.

## Conflict resolution

Three-way merge preserves disjoint field edits. Overlapping low-risk fields (titles, names, colors, notes, descriptions) resolve by server acceptance order rather than device clocks. Protected fields — dates, schedules, weights, degree constraints, delete/edit races, and differing binary hashes — require manual review in Settings, with both snapshots and resolution history retained. A missing or deleted parent holds a dependent change pending rather than orphaning it.

## Supabase schema

Ordered migrations create owner-scoped devices, canonical records, revision history, entity descriptors, a validated versioned RPC surface, and a private storage bucket. Academic changes pass through the RPC with schema, identity, ownership, compare-and-swap, replay, and parent checks. Auth uses email/password sign-up, sign-in, refresh, and sign-out; device/session revocation is supported.

## Security and row-level security

Authenticated ownership policies isolate accounts, and direct writes that bypass the RPC are denied. Storage permits owner-scoped reads/inserts and immutable hash-named objects only. Removing a device session revokes its RPC, record, and storage access. Release builds require HTTPS and reject service-role/secret keys. Session secrets live in native secure storage (Windows Credential Manager / Android Keystore), never in SQLite, renderer settings, or logs. This provides transport security and server-side access control — it is **not end-to-end encryption**.

## File synchronization

File metadata and byte transfers use separate durable queues, so metadata can arrive before its blob without leaving an inconsistent record. SHA-256 identifies immutable upload snapshots and deduplicates identical content; downloads verify the hash before marking a file available offline. Windows paths and Android content URIs never leave the device. Small documents (up to 2 MB) download automatically by default; larger files download on demand, with an optional "keep everything offline" setting. Removing a local copy retains the cloud record and hash and disables auto-redownload until the file is opened again; deleting a record everywhere propagates a tombstone rather than an immediate hard delete.

## Android filesystem

Course files live under the app's private storage, with device-specific SQLite and cache locations. `ACTION_OPEN_DOCUMENT` picker results are copied through `ContentResolver` into a local staging cache before import. `FileProvider` grants temporary read access for open/share, and `ACTION_CREATE_DOCUMENT` exports a copy to the user's chosen location. No broad external-storage permission is requested.

## Secure storage

A shared Rust `SecureStorage` interface preserves Windows Credential Manager target names; Android encrypts the same class of preferences with AES-GCM under an Android Keystore key. Application backup is disabled so credentials and device identity can't be restored onto a different installation. Email and sync credentials share this boundary.

## Notifications

Shared reminder logic produces native notifications on both platforms. Android requests permission explicitly from the Settings action, under a dedicated reminders channel. Delivery is foreground/resume-based on both platforms — exact alarms and background execution while the app is fully suspended are intentionally not promised.

## Responsive and tablet UI

Landscape keeps the desktop-style sidebar; portrait and narrow screens switch to a focus-managed navigation drawer with larger touch targets. Tables collapse into labeled stacked cells, dialogs fit and scroll within the viewport, and calendar defaults to an agenda view on compact layouts. Android's Back button closes dialogs/drawers, follows in-app navigation history, and backgrounds the app at the root.
