# Platform expansion

## Inspection and implementation plan

The shared React application routes through `useWorkspace` and `AppShell`.
Academic, degree, syllabus, source-history and document repositories use SQL
through `services/platform.ts`. Both Rust and the Vite loopback backend apply
the same 16 SQL migrations, independently. Course files currently carry absolute
device paths. Notifications are generated locally. Windows credentials are used
by email and AI. Tests include Node domain/storage tests, Playwright workflows,
and native WebView2 smoke scripts. This workspace has no Git metadata/history.

Portability leaks: `isTauri` is called `desktop`; React imports webview drag/drop
and zoom APIs; Explorer and Recycle Bin actions are unconditional; onboarding
requires a user filesystem path; window-state, trash and Windows credential
dependencies are unconditional. Existing CSS assumes a desktop navigation shell.

1. Preserve existing SQLite and Windows behavior; introduce explicit capabilities
   and isolate native UI operations.
2. Add Android configuration, native storage/integration boundary and build scripts.
3. Add a responsive navigation drawer and touch layouts to the shared frontend.
4. Add durable SQLite sync metadata, transactional record capture, tombstones,
   conflict preservation, device registration and content-addressed file sync.
5. Provide a self-hosted authenticated service, opt-in settings and automatic retry.
6. Verify existing tests, migration upgrades, two-device sync, responsive UI and
   native builds. Record actual verification and remaining environment blockers.

Sync must exclude device paths, credentials, notification delivery state and local
index caches. A failed connection must never prevent a local edit. Remote records
must be validated and applied transactionally; a cursor advances only with commit.

## Implemented expansion

The shared frontend now has device capabilities, portrait navigation, touch sizing,
stacked semantic tables and scrollable portrait dialogs. Native Rust code supports
Windows and Android with separate credential/file handling. Both platforms apply
19 migrations. Android imports, opens, shares and exports scoped documents.

Sync targets self-hosted Supabase Auth/Postgres/Storage through a native adapter.
Durable local capture, CAS/replay, transactional pull, persisted conflict review,
device registry, separate blob queues, on-demand downloads and immutable SHA-256
content are implemented. Deployment and bounds are in SYNC.md.

Verification includes independent SQLite devices against real local Supabase Auth,
PostgREST and private Storage; Windows native regression; tablet browser layouts;
and native Android emulator acceptance. See [the detailed report](docs/platform-expansion-report.md)
for exact results, commands, package paths and remaining deployment/signing steps.
