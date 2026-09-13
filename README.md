# UniDesk

A single-user, offline-first university workspace. Academic records live in a local SQLite database; your course documents stay as ordinary files on disk. Runs as a native Windows desktop app (Tauri) and Android app, with an optional self-hosted Supabase sync layer for keeping multiple devices in step.

## Highlights

- **Academic tracking** — semesters, courses, exams, assignments, tasks, weighted grade components with what-if/target scenarios, and credit-weighted GPA.
- **Planning** — month/week/agenda calendars, a deterministic study planner, study session history, and a globally accessible study timer.
- **Documents** — native file picker and drag-and-drop import into per-course folders (Lectures, Assignments, Exams, Readings, Recordings, Notes, Resources), with conflict-safe copy/replace and moved-file repair.
- **Email integration** — read-only Gmail and Microsoft 365 (Graph) sync with deterministic classification, course matching, and reviewable proposals for exam/assignment changes. No AI, no HTML rendering, tokens never touch the database.
- **Search & navigation** — global search, command palette (`Ctrl+K`), page search (`Ctrl+F`), Quick Add.
- **Cross-platform** — shared React frontend across Windows (Tauri) and Android, with a responsive/touch-adapted UI.
- **Multi-device sync** — optional, opt-in sync against a self-hosted Supabase project; local edits always work offline first.

Academic data stays local by default. There is no cloud processing of your academic data and no transcription — see the platform docs below for what each optional integration actually does.

## Tech stack

- **Frontend:** React 19, strict TypeScript, Tailwind CSS, Vite
- **Desktop:** Tauri 2 (Rust) with native SQLite, filesystem, and Windows Credential Manager integration
- **Mobile:** Android via Tauri's Android target
- **Backend (optional sync):** Supabase (Postgres, Auth, Storage) + a small Node/TypeScript sync service
- **Testing:** Node's built-in test runner, Playwright

## Getting started

Requires Node 22.13+, Rust (stable), Visual Studio C++ build tools, and the WebView2 runtime (Windows).

```powershell
npm install
npm run dev            # Browser development on 127.0.0.1:1420
npm run desktop        # Native Tauri development
npm run build          # Type-check and build the frontend
npm run desktop:build  # Windows executable + NSIS installer
npm test               # Unit/integration tests
npx playwright test    # Browser workflow and visual tests
```

Browser development runs against a real local SQLite database (`.local/unidesk.db`) through a loopback-only Vite API — not browser storage. The desktop build talks to SQLite directly over Rust IPC and has no HTTP server; browser and desktop data are intentionally kept separate.

## Project structure

```text
src/components/   Shared UI primitives
src/db/           SQL migrations, repository operations, sample data
src/features/     Forms, files, calendar, tasks, search, notifications
src/hooks/        Query-backed workspace context
src/layouts/      Persistent app shell
src/pages/        Academic views and settings
src/services/     Typed desktop/browser platform boundary
src/utils/        Local-date and event derivation logic
src-tauri/src/    Rust: SQLite, filesystem, desktop/Android integration
server/           Loopback development adapter + sync service
supabase/         Optional sync backend: migrations and schema
tests/            Database, filesystem, and workflow tests
scripts/          Build, dev, and platform tooling
```

## Data, sync, and platform docs

Each device keeps its own local SQLite database; nothing above the file-storage layer is required to leave your machine.

- [ANDROID.md](ANDROID.md) — APK builds, signing, and Android-specific behavior
- [SYNC.md](SYNC.md) — optional multi-device sync design and setup
- [PLATFORM-EXPANSION.md](PLATFORM-EXPANSION.md) — cross-platform architecture and verification status
- [GMAIL-SETUP.md](GMAIL-SETUP.md) — Gmail OAuth setup and token handling
- [MICROSOFT-365-STATUS.md](MICROSOFT-365-STATUS.md) — Microsoft Graph device-code sign-in setup

## Testing

- `npm test` — database, grading, scheduling, and email-classification logic
- `npx playwright test` — end-to-end workflows across isolated SQLite databases, including dark mode and multiple viewport sizes
- `node scripts/native-smoke.mjs` — exercises the built Windows executable with an isolated data directory, including a full process restart

## Status

This is an actively developed personal project, currently in daily use rather than a finished 1.0. See [PHASE3-STATUS.md](PHASE3-STATUS.md) and [PHASE4-STATUS.md](PHASE4-STATUS.md) for feature-by-feature verification notes, and the `RELEASE-*.md` files for release history.
