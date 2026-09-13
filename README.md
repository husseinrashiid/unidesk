<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="88" height="88" alt="UniDesk icon" />

# UniDesk

**An offline-first university workspace for Windows and Android.**

Academic records live in a local SQLite database. Course documents stay as ordinary files on disk. Nothing leaves the device unless you turn on an optional integration.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-4c5b73)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111111)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-active%20development-yellow)

</div>

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Data, sync, and platform docs](#data-sync-and-platform-docs)
- [Testing](#testing)
- [Status](#status)
- [License](#license)

## Overview

UniDesk is a single-user academic workspace built around one idea: your semester's data and documents should be yours, on your disk, readable without the app. It runs natively on Windows (Tauri) and Android from one React codebase, and can optionally sync between your own devices through a self-hosted Supabase project.

## Features

| Area | What it does |
|---|---|
| **Academic tracking** | Semesters, courses, exams, assignments, and tasks; weighted grade components with what-if/target scenarios; credit-weighted GPA. |
| **Planning** | Month, week, and agenda calendars driven by academic records and recurring class schedules. |
| **Documents** | Native file picker and drag-and-drop import into per-course folders (Lectures, Assignments, Exams, Readings, Recordings, Notes, Resources); in-app PDF viewing; conflict-safe copy/replace; moved-file repair. |
| **AI-assisted study** *(optional)* | Local, offline document search plus bring-your-own-key cited Q&A, syllabus import, and generated study guides/practice questions. See [AI features](docs/ai-features.md). |
| **Email integration** | Read-only Gmail and Microsoft 365 (Graph) sync with deterministic classification and course matching, and reviewable proposals for exam/assignment changes. No AI, no HTML rendering; tokens never touch the database. |
| **Search & navigation** | Global search, command palette (`Ctrl+K`), page search (`Ctrl+F`), Quick Add. |
| **Cross-platform** | One React frontend across Windows and Android, with a responsive, touch-adapted UI. |
| **Multi-device sync** *(optional)* | Opt-in sync against a self-hosted Supabase project. Local edits always work offline first. |

Academic data stays local by default — there is no cloud processing of it unless you explicitly enable AI features with your own API key. See [Data, sync, and platform docs](#data-sync-and-platform-docs) for exactly what each optional integration does.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, strict TypeScript, Tailwind CSS, Vite |
| Desktop | Tauri 2 (Rust), native SQLite, filesystem, Windows Credential Manager |
| Mobile | Android via Tauri's Android target |
| Optional sync backend | Supabase (Postgres, Auth, Storage) + a small Node/TypeScript sync service |
| Testing | Node's built-in test runner, Playwright |

## Getting started

**Prerequisites:** Node 22.13+, Rust (stable), Visual Studio C++ build tools, and the WebView2 runtime (Windows).

```powershell
npm install
npm run dev            # Browser development on 127.0.0.1:1420
npm run desktop        # Native Tauri development
npm run build           # Type-check and build the frontend
npm run desktop:build   # Windows executable + NSIS installer
npm test                # Unit/integration tests
npx playwright test     # Browser workflow and visual tests
```

Browser development runs against a real local SQLite database (`.local/unidesk.db`) through a loopback-only Vite API, not browser storage. The desktop build talks to SQLite directly over Rust IPC and has no HTTP server — browser and desktop data are intentionally kept separate.

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

| Doc | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Cross-platform architecture, sync design, security model |
| [docs/android.md](docs/android.md) | APK builds, signing, Android-specific behavior |
| [docs/sync.md](docs/sync.md) | Self-hosted Supabase sync: deploy steps, conflicts, file transfer |
| [docs/supabase-setup.md](docs/supabase-setup.md) | Deploying the self-hosted Supabase stack |
| [docs/ai-features.md](docs/ai-features.md) | Local document search and optional bring-your-own-key AI features |
| [docs/gmail-setup.md](docs/gmail-setup.md) | Gmail OAuth setup and token handling |
| [docs/microsoft-365-setup.md](docs/microsoft-365-setup.md) | Microsoft Graph device-code sign-in setup |

## Testing

- `npm test` — database, grading, scheduling, and email-classification logic
- `npx playwright test` — end-to-end workflows across isolated SQLite databases, including dark mode and multiple viewport sizes
- `node scripts/native-smoke.mjs` — exercises the built Windows executable with an isolated data directory, including a full process restart

## Status

Actively developed and in daily personal use rather than a finished 1.0. See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

No license has been added yet, which under GitHub's terms means all rights are reserved by default — others may view and fork the repository but have no rights to reuse the code. Open an issue if you'd like to discuss licensing.
