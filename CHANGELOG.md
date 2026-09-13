# Changelog

Notable changes to UniDesk, newest first.

## 0.5.6 — Android, sync, and responsive UI

- Added a native Android build alongside Windows, sharing one React frontend and Rust/SQLite core.
- Added optional multi-device sync against a self-hosted Supabase project (accounts, conflict review, content-addressed file transfer). See [Architecture](docs/architecture.md) and [Sync](docs/sync.md).
- Reworked the shared frontend for touch and narrow screens: a responsive navigation drawer, stacked tables, and viewport-aware dialogs.
- Reorganized the dashboard around the next exam and today's agenda, with a compact study/email rail; tightened spacing and grouped metadata across course, mail, and calendar views.

## 0.5.4 — In-app PDF viewing

- Opening a registered PDF from any course file list, recent files, an academic attachment, or Materials now displays its original pages inside UniDesk, with page navigation, zoom, fit width, selectable text, and search.
- PDF.js and its assets are bundled locally — no online document service is used. Files larger than 150 MB fall back to the external viewer.

## 0.5.3 — Materials cleanup

- Removed the Study feature (navigation, sessions, timer, planner, exam-plan generation); existing stored records are preserved.
- Removed the course Resources tab — existing files remain accessible in Materials.
- Materials now lists each document once by default, and Read Document opens the complete extracted text with page references instead of short previews.

## 0.5.2 — Course navigation and instructor directory

- Course navigation reorganized into five sections: Overview, Materials, Assessments, Study, and Emails.
- Previously saved sender-to-course mappings migrated into a proper Instructor Directory, with existing links preserved.

## 0.5.1 — Gmail integration

- Added Gmail as the recommended email source, alongside Microsoft 365: desktop OAuth sign-in, read-only `gmail.readonly` scope, incremental history sync, and the same review-before-apply workflow for detected academic changes. See [Gmail setup](docs/gmail-setup.md).

## 0.4.2 — AI-assisted study tools ("Phase 4")

- Added local document extraction and search (PDF/DOCX/PPTX/TXT/Markdown) that works fully offline.
- Added optional, bring-your-own-key AI features on top of that local index: cited Q&A over course materials (Ask Course), deterministic routing for dates/grades (Ask UniDesk), syllabus import, past-exam topic tracking, and generated study guides/practice questions. See [AI features](docs/ai-features.md).

## 0.4.1 — Microsoft 365 sign-in hardening

- Structured, safe-to-display error handling for consent/expiry/network failures during Microsoft device-code sign-in, with a bounded local diagnostics log.
- Automatic single-retry refresh after a Graph 401, and sign-in cancellation scoped to the current device-code session.

## 0.3.0 — Display scaling and Microsoft 365 ("Phase 3")

- Added persistent interface scaling (100–200%) with automatic sizing on high-resolution displays.
- Added read-only Microsoft 365 email integration: device-code sign-in, native credential storage, incremental Inbox sync, deterministic classification and course matching, and reviewable proposals for exam/assignment changes. See [Microsoft 365 setup](docs/microsoft-365-setup.md).

## 0.2.0 — Academic tracking and study planning ("Phase 2")

- Added exam/assignment/reading tracking per course, weighted grade components with what-if and target scenarios, and credit-weighted GPA estimates.
- Added a deterministic study planner, study session history, and a persistent study timer.

## 0.1.0 — Initial workspace

- Semesters, courses, and course-scoped file storage on top of ordinary folders.
- Native file import/organization, calendars, global search, and command palette.
