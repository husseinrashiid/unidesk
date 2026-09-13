# Frontend polish — 13 September 2026

The pass preserves the dark academic identity and the existing responsive component trees. No storage schema, routing, native integration, or academic calculation changes were made.

## Changes

- Shared page bounds keep large-screen content and actions together; calendars retain more working width.
- Dashboard files have a useful full-width row, assignments remain near upcoming deadlines, and progress uses compact rows. Portrait reading order is retained.
- Course cards have tighter spacing, readable metadata, responsive columns, and a full-card click target with independent menus.
- Course overview metadata is grouped into course info, academic status, and instructors. Portrait layouts use one column.
- Empty lecture tracking becomes a single inline prompt with its existing editor.
- Mail has a wider search field, clearer sender/subject/preview hierarchy, one-line previews with URLs and Windows paths abbreviated, and stacked portrait rows. Original message text is preserved in detail views.
- Calendar text, today/weekend treatment, degree metrics, syllabus headings, and pressed/reduced-motion states receive restrained adjustments. Weekend styling follows the actual weekday for either week-start preference.

## Verification

- Prettier check passed on all changed frontend and browser-test files.
- Strict TypeScript and Vite production build passed.
- Existing unit/integration suite: 134 passed.
- Expanded responsive browser suite: 2 passed, covering 2560×1440, 1920×1080, 1440×900, 1280×800, 900×1200, 800×1280, 600×960, and 390×844.
- Checks include page overflow, portrait ordering, navigation drawer focus restoration, search focus, key touch targets, course tabs, stacked file metadata, calendar day dialogs, and editor bounds/action visibility after viewport reduction.
- Screenshots cover Dashboard, Courses, Assignments, Exams, Grades, Emails, Degree Progress, month/week calendars, all seven course sections, and populated email/empty dashboard states at each size. Images and command logs are in `.local/ui-review/`.
- Windows NSIS installer built at `src-tauri/target/release/bundle/nsis/UniDesk_0.5.6_x64-setup.exe`.
- Final Android ARM64 release packaging, release lint, ELF alignment, and APK 16 KB ZIP alignment passed. APK: `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`.

## Scope of validation

The browser suite uses its existing isolated SQLite fixtures, not the user's workspace database. Degree and syllabus visual captures cover their initial empty states; their parsing and data behavior remain covered by the existing unit/integration tests. No frontend lint script/configuration exists in this repository.

Android visual behavior was checked with browser viewport sizes and a reduced viewport to represent the keyboard. Physical-device status bars, cutouts, gesture areas, and the real software keyboard still require device verification. The native Android build used the project's existing Windows copy fallback when symbolic links were unavailable.

Build output retains existing chunk-size, Rust, and Android toolchain warnings. The in-app browser connection was unavailable, so the existing Playwright/Edge setup supplied visual verification. On Windows, test-server cleanup required stopping the owned Vite processes after the test assertions completed.
