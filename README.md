## Gmail forwarding ? version 0.5.4

Gmail is now the recommended email source. See [Gmail setup and implementation report](GMAIL-SETUP.md) for the exact Google Desktop OAuth configuration, secure token storage, forwarded AUB mail workflow, tests and live sign-in limitations. Install `UniDesk-Setup.exe` from the project folder. Existing data and Phase 1?4 features are preserved.

# UniDesk

A single-user, offline university workspace for Windows. React 19, strict TypeScript, Tauri 2, and SQLite. Academic documents remain ordinary files in your chosen university folder.

## Run the Windows app

- Open `.dist/UniDesk.exe` directly, or use `UniDesk-Setup.exe` / `.dist/UniDesk_0.5.4_x64-setup.exe` to install it for your Windows user.
- Choose a university storage folder, then create a semester. Add your courses from the sidebar or the Add menu.
- The optional **Explore with sample data** action creates the Fall 2026 example semester and real text documents in the selected folder. Normal first launch is empty.
- Windows WebView2 Runtime is required. It is already present on this development machine. The installer uses Tauriâ€™s WebView2 bootstrapper when the runtime is missing; that one-time prerequisite installation may need a connection. Once installed, UniDesk works offline.

The executables are locally built and unsigned.

## What is included

- Dashboard with next-exam countdown, upcoming deadlines, todayâ€™s events, assignments, checkable tasks, and recent files.
- Semesters, archived semester browsing, compact courses, editable class schedules, and course workspaces.
- Exams with coverage and notes; assignments with four workflow statuses; tasks with priorities and optional course/assignment/exam relationships.
- Month, week, and agenda calendars derived from academic records and recurring class schedules. Standalone calendar events are editable and persistent.
- Native file picker and drag-and-drop imports, file opening, Explorer reveal, rename, category moves, locating moved files, sorting, and filename search.
- Copy conflicts offer **Keep both**, **Replace**, or **Cancel**. Source files are never moved during import.
- Files placed directly into a course category through Explorer are discovered when the file list refreshes. Missing references remain available for repair. Removing a reference preserves the document and prevents automatic rediscovery; explicitly importing it again restores it.
- Course deletion removes academic records while preserving course folders. File deletion is separate and uses the Windows Recycle Bin when explicitly selected. Course folders are never recursively deleted by UniDesk.
- Global search across semesters, keyboard command palette (`Ctrl+K`), page search (`Ctrl+F`), Quick Add, and accessible dialogs.
- System/light/dark appearance, university folder settings, persistent local reminders, optional Windows desktop notifications, and window size restoration.

## Data and recovery

The desktop database is `unidesk.db` in Tauriâ€™s application data directory for `local.unidesk.app`. Settings shows the exact resolved location. SQLite uses foreign keys, WAL journaling, a busy timeout, versioned transactional migrations, and indexed academic relationships.

Course files are stored as:

```text
<university folder>/<semester>/<course code without spaces>/
  Lectures/
  Assignments/
  Exams/
  Previous Exams/
  Readings/
  Recordings/
  Notes/
  Resources/
```

Import and move operations write the file before committing metadata. A failed metadata write restores an overwritten file or removes the newly created copy. Replacement recovery copies use `.unidesk-backup-` names if cleanup cannot finish. They are left available in Explorer rather than risking data loss.

For backups, close UniDesk and copy the entire database directory and your university storage folder. Reopen the app after copying. Restoring the database and documents to their original paths restores the workspace. A moved individual document can be repaired with **Locate file** in its row menu. Restore externally moved course folders to their original location; changing the base folder setting applies to future semesters and does not migrate existing folders.

## Reminders

Exams use 14-, 7-, 3-, 1-, and 0-day reminders; assignments use 7-, 3-, 1-, and 0-day reminders. IDs include the entity, deadline, and threshold to prevent duplicates. Reminders are checked on startup and every minute while the app is open. The app does not install a background service or continue running after its window closes.

In-app reminders work immediately. Enable Windows notifications in Settings. Tauriâ€™s [Windows notification support](https://v2.tauri.app/plugin/notification/) requires an installed app. Actual Windows toast delivery depends on OS notification permissions and Do Not Disturb; it is not covered by the automated native smoke test.

## Development

Requires Node 22.13+ (Node 24 used here), Rust stable, Visual Studio C++ build tools, and WebView2.

```powershell
npm.cmd install
npm.cmd run dev            # Local browser development on 127.0.0.1:1420
npm.cmd run desktop        # Native Tauri development
npm.cmd run build          # TypeScript and production frontend
npm.cmd run desktop:build  # Windows executable and NSIS installer
npm.cmd test               # SQLite, filesystem, date, and reminder tests
npx.cmd playwright test    # Browser workflows and visual captures using Edge
node scripts/native-smoke.mjs # Built Windows executable with isolated data
```

`scripts/desktop.mjs` automatically uses `.local/cargo` and `.local/rustup` when the project-local toolchain is present; otherwise it uses Rust from PATH. The installer is generated under `src-tauri/target/release/bundle/nsis/`.

Browser development has a loopback-only Vite API backed by a real SQLite database at `.local/unidesk.db`. It uses real local files, not browser storage. Browser uploads are limited to 30 MB; use the desktop file picker or native drag-and-drop for large materials. The desktop app uses Rust IPC directly and has no HTTP server. Browser and desktop profiles are intentionally separate.

`UNIDESK_DEV_DB` selects an isolated browser database for tests. `UNIDESK_DATA_DIR` can select an absolute desktop data directory for diagnostics and isolated native tests. Test documents are created only under `.local/`.

## Structure

Version 0.4.2 completes the **Phase 4 core feature set**: local extraction/search, cited Ask Course, deterministic Ask UniDesk, reviewed syllabus import, previous-exam questions/topics, and exam study guides/practice. Configure your OpenAI API key in **Settings â†’ AI** and enable Cloud AI for new generations. Local search and cached results work offline. See [Phase 4 status](PHASE4-STATUS.md) for workflows, verification and limits. Browser developers should run `npm.cmd run documents:build` before testing extraction; installed Windows builds include the extractor. Live OpenAI account access remains unverified until you configure a key.

```text
src/components/       Shared UI primitives
src/db/               SQL migrations, repository operations, optional sample data
src/features/         Forms, files, calendar rows, tasks, search, notifications
src/hooks/            Query-backed workspace context
src/layouts/          Persistent desktop shell
src/pages/            Academic views and settings
src/services/         Typed desktop/development platform boundary
src/utils/            Local-date and event derivation logic
src-tauri/src/        Rust SQLite, filesystem, and desktop integration
server/               Loopback development adapter
tests/                Database/file safety and browser workflow tests
scripts/              Desktop build launcher and native smoke test
```

Academic data stays local. There is no AI processing, cloud academic-data sync, or transcription. Version 0.3.0 adds Microsoft email integration described below.


## Phase 2: Academic tracking and study planning

Version 0.2.0 extends the existing workspace and upgrades the database through migration 003. Existing course folders and file references are preserved. Browser and native desktop builds use the same SQL migration.

- **Courses > Lectures / Readings / Previous Exams:** create metadata records and link existing files. Change review or completion states directly in the compact list. Lecture records support multiple attached files, review dates, confidence, notes, and study history. File import and discovery continue to work below each tracker.
- **Courses > Grades:** add weighted components, then planned or scored assessments. Scores can link to existing assignments or exams without changing their workflow status. An empty earned score is ungraded; zero is a real score. Exclude an item to drop it manually. Component order and weights remain editable.
- **Current grade:** each component distributes its weight by assessment points possible, or optional relative item weights. The current result normalizes only the covered weight of graded assessments. Enter future assessments too so coverage represents the grading structure accurately. Incomplete weighting can be saved; final projections require 100% total weight.
- **What-if / target:** scenarios are temporary and never overwrite scores. Fill every remaining assessment to calculate a projected final grade, or enter a target to see the required average on remaining work. Impossible targets show the highest attainable grade.
- **Grades:** credit-weighted semester GPA estimates, temporary letter-grade scenarios, completion progress, and editable percentage/letter/GPA mappings. Course overrides take precedence over the semester mapping. Missing grades and zero-credit courses do not contribute to GPA.
- **Exams > Preparation:** manually tracked topics, confidence, and optional lecture/reading/previous-exam links. Preparation is based on checklist completion, independently controlled from general course review status. Generated plans evenly distribute unfinished items, place practice exams later, and put full review immediately before a future exam. Nothing is added to the calendar until the preview is confirmed. Saved blocks remain editable.
- **Study:** explained, deterministic priorities; exam preparation; unreviewed materials; daily, weekly, and semester study totals; approximate workload and deadline clusters. Course workspaces include scoped Study views and custom course topics.
- **Study > Planner:** recurring classes, academic deadlines, tasks, and editable study blocks. Checking a block does not create fictitious study time. Log actual time separately. Calendar filters include study blocks.
- **Study > History:** manually enter, edit, or delete sessions. History is paginated in groups of 50; aggregate totals include all saved sessions.
- **Start study:** globally accessible timer with Start, Pause, Resume, Finish, and Cancel. Timestamp-based state is stored in SQLite. Saving the finished session and clearing the timer happen in one transaction. Correct duration and add notes before saving. Corrupt saved timer state offers a discard/recovery path.
- **Settings:** default block duration, Monday/Sunday week start, separate study reminders, and semester grading/GPA scale. Search and Quick Add include the new academic records.

Completion percentages describe tracked work, not academic mastery. Recommendations and workload labels are local rules, not AI. Grade estimates depend on the grading structure and scale entered by the user. Course deletion still requires the existing explicit confirmation, removes related academic records, and preserves course documents; archive a course to retain all records.

## Phase 2 verification

`npm.cmd test` covers grade weighting, partial and missing scores, zero and decimal scores, excluded items, item overrides, target and what-if calculations, incomplete weights, credit-weighted GPA, custom scales, plan date boundaries, timer recovery, completion, conflict rules, and upgrading an actual Phase 1 schema while retaining records and file references.

`npx.cmd playwright test` runs separate Phase 1 and Phase 2 projects against isolated SQLite databases. The Phase 2 workflow covers tracking, grade entry/scenarios, GPA scenarios, exam preparation, plan preview/save, blocks, manual sessions, timer reload/recovery, search, calendar filters, dark mode, and a 1000px desktop viewport. Visual captures are in `.local/review/phase2-*.png`.

`node scripts/native-smoke.mjs` exercises the built Windows app with an isolated data directory, including filesystem behavior, a full process restart, timer recovery, and saved study-session persistence. Test data stays under `.local/`.

The development and production commands use Vite's runner config loader to avoid the bundled config loader's parent-directory access under restricted Windows environments.

## Version 0.3.0: Display scaling and Phase 3

Install with the visible `UniDesk-Setup.exe` in the project root. The versioned installer is also retained under `.dist/`. Existing Phase 1/2 records and course documents are preserved by migrations 004 and 005. The local Phase 3 workflows are implemented; real university mailbox acceptance testing remains pending Microsoft application registration.

### Readable interface on 2560 Ã— 1440 displays

Settings â†’ Appearance â†’ Interface size offers Automatic, 100%, 110%, 125%, 150%, 175%, and 200%. Automatic chooses 150% for screens at least 2400 CSS pixels wide, 125% from 1900, and 100% below that. CSS screen dimensions account for Windows scaling, avoiding a second resolution-based enlargement on an already scaled display. Native WebView zoom enlarges text, icons, and controls together and adapts the viewport layout. Ctrl + and Ctrl âˆ’ adjust the saved size; Ctrl 0 restores 100%. The development browser uses CSS zoom as a fallback.

### Email capabilities

- Microsoft 365 public-client device-code sign-in in the installed Windows app; read-only `Mail.Read`, `User.Read`, and `offline_access`. Refresh tokens use Windows Credential Manager; access tokens stay in native process memory. Tokens never enter SQLite, browser storage, renderer responses, or application logs. Disconnect removes local sign-in credentials and keeps cached messages by default.
- Recent Inbox metadata via Graph delta pages, starting two weeks before the active semester. Each run is capped at five pages of 50 and saves the continuation cursor transactionally. Sync runs only while the app is open at 5/10/15/30-minute intervals, or manually. Failures retain cached data and automatic retries back off. Full message text is fetched only when the user requests it in the detail view.
- Emails navigation and course Emails tab; compact paginated feed, attention count, dashboard attention rows, Important/academic/review/unread/attachment/unassigned/archive filters, course filtering, FTS search over cached bodies, and global search. Local read/unread, pin, archive, manual course assignment, and saved exact-sender rules.
- Deterministic classification and course matching. Newest-message extraction excludes quoted replies and common signatures. Explicit dates, received-date-relative dates, AM/PM/noon/24-hour times, and from/to direction are supported. Ambiguous numeric dates require user input. There is no AI.
- Review panels for exam/assignment date changes or explicit new records, plus conversion to a task. User chooses a course, target record or explicit creation, edits proposed values, and applies or ignores. A single transaction checks proposal status and the original academic snapshot, updates the record, writes field-level source history, and resolves the suggestion. Stale changes roll back. Unspecified time, room, descriptions, and notes remain unchanged. Resolved proposals are not recreated during reanalysis. Newer pending proposals for a uniquely matched target supersede older pending ones.
- Safe plain-text display, no HTML rendering or automatic remote image loading. Cache clearing removes pending email data but preserves approved academic records and copied source metadata in change history.

### Microsoft setup required before live use

Enter the public Application (client) ID in Settings â†’ Email â†’ Microsoft 365 Client ID. The registration may belong to your own Entra tenant; sign in using your AUB organizational account. UniDesk uses `https://login.microsoftonline.com/organizations/oauth2/v2.0` for both device authorization and refresh, with no tenant-specific authority, redirect URI, or client secret. Live mailbox sign-in and provider behavior **have not been verified against AUB**.

1. In Microsoft Entra, configure UniDesk for **Accounts in any organizational directory (multitenant)**. The registration's home tenant does not need to be AUB.
2. Enable **Allow public client flows** under Authentication â†’ Advanced settings for device-code authorization.
3. Add delegated Microsoft Graph **User.Read** and **Mail.Read** permissions. The sign-in flow also requests **offline_access**. Have IT grant consent if university policy requires it.
4. Copy the Application (client) ID into UniDesk. Select Connect Microsoft 365, open Microsoft's sign-in page, enter the displayed code, and review Microsoft's consent prompt.
5. UniDesk confirms the signed-in address through Graph `/me` and automatically syncs recent Inbox messages. Sync now remains available. If AUB blocks consent, UniDesk shows an administrator-approval message with Retry, Copy technical details, and Disconnect. If the approval block appears only on Microsoft's browser page, use the matching notice below the device code to stop waiting. Registration in your own tenant does not override AUB consent policy.

Version 0.4.1 adds structured consent/expiry/network errors, cancellation scoped to the current device session, one refresh retry after Graph HTTP 401, and sanitized diagnostics. Errors are logged as code, short safe description, timestamp, and optional correlation ID in `microsoft-email-diagnostics.jsonl` beside the local database; tokens and raw Microsoft response bodies are excluded. No schema change is required for this authentication update.

Official references: [Microsoft device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Graph mail delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0), [Windows credential storage](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew).

### Additional Phase 3 workflows and scope

- Attachment lists load on demand. Save files into course categories through the existing conflict-safe import flow, then create a reading or link a lecture/exam. Saved files remain independent of email cache. Downloads are limited to 30 MB per file; embedded Outlook items open through Outlook.
- Cancel or reschedule one class meeting, change its room, inspect source history, or restore the original meeting from the course Schedule tab. Weekly recurrence remains intact. Permanent recurring changes are explicitly directed to manual schedule editing.
- Review exam locations and cancellations, convert messages to tasks or calendar events, and review explicit scores such as 92/100 against a selected grade component. Grade availability alone does not fabricate a score. Existing grades and schedule snapshots are checked transactionally before applying.
- Manage professors, contact details, office hours, department, notes, and multiple course associations. Review cached conversation threads and related academic records, move to the next pending email, and retain manual classification corrections.
- Important/Critical email desktop alerts are separately opt-in in Settings. Normal notices stay in-app and Low messages are silent. Disconnect offers keep-cache (default) or remove-cache options; approved academic changes and imported documents remain.

Gmail/IMAP, tray operation, custom rule builders, PDF preview, and effective-dated automatic permanent schedule changes are outside this release. Live university sign-in, consent restrictions, actual Graph attachment downloads, and tenant-specific recovery still need acceptance testing with a registered application. Browser attachment tests use a simulated provider and real local file imports, not a live mailbox.

### Verification

`npm.cmd test` covers the existing features and email classification/date ambiguity, original-field preservation, stale-apply rollback, repeated-sync deduplication, cache-clear history retention, Phase 2 migration/reopen, and paginated FTS search over 5,000 cached messages. `npx.cmd playwright test` includes isolated Phase 1, Phase 2, and Phase 3 projects. New screenshots are saved under `.local/review/phase3-*.png`. `node scripts/native-smoke.mjs` checks the actual Windows build with isolated data, including native scaling and persistence after a full restart. These local checks do not substitute for a real Microsoft sign-in test.


## Windows, Android and device sync

See [ANDROID.md](ANDROID.md) for APK builds and signing, [SYNC.md](SYNC.md) for
optional device synchronization, and [PLATFORM-EXPANSION.md](PLATFORM-EXPANSION.md)
for the audit and verification status. Each device keeps its own SQLite database.
