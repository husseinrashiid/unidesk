# UniDesk UI refresh

The dashboard now leads with the next exam, followed by upcoming academic work. Desktop gives roughly 77% of the grid to academic content and a compact Today/email rail. Portrait uses one content tree in this order: exam, Today, Upcoming, assignments, email, recent files, progress.

Changes include:
- Clear exam countdown, wrapped location/time, direct preparation action, and an existing working study timer in Today.
- Two email previews with sender/status, total attention count, and View all.
- Compact empty assignment/tracking states, real completion data, and no duplicate dashboard course list.
- Recent-file opening, platform-supported Reveal, category/course, and available last-opened times.
- Shared portrait navigation, searchable overlay with initial focus, readable scrolling course tabs, and a first-level Schedule tab.
- Stacked academic/file tables without fixed desktop cell heights, readable grade scenarios, and improved shared touch targets.
- Agenda defaults for compact screens, compact Month counts with day details, and contained horizontal scrolling for Week.
- Content-height dialogs/bottom sheets, sticky dialog actions, safe-area padding, and visual-viewport height tracking for the software keyboard.
- Sync status moved into the desktop header / portrait drawer, keeping study content clear.

## Responsive behavior

- Large desktop: sidebar, academic content plus narrow dashboard rail.
- Landscape tablets over 900px: narrower sidebar and adaptive dashboard rows.
- Screens at or below 900px, plus portrait screens up to 1200px: drawer navigation, search button, stacked dashboard and study rows. The 900px width rule keeps the compact layout when the software keyboard reduces the viewport height.
- Phones at or below 500px: tighter padding, stacked planner fields, bottom sheets.

The compact query is shared by navigation and calendar state. CSS uses the matching query in `src/styles/workspace.css` and the existing responsive-table styles.

## Verification

- `npm.cmd run build`: passed strict TypeScript and production Vite build.
- `npm.cmd test`: 134 passed.
- All 10 existing browser workflows passed, including touch/offline navigation, file lifecycle, grades, email, documents, degree imports and course workflows. The file-menu test locator was updated from the retired Move to category label to Move..., and the course-navigation assertions now include Schedule and permit scrolling tabs.
- Two new browser regressions passed with `playwright.ui.config.ts`: academic ordering, touch target sizes, drawer focus, search focus, calendar details, preparation navigation, compact keyboard-height dialogs, file metadata, real empty progress, and two-email limits/counts.
- Visual/layout review at 2560x1440, 1920x1080, 1440x900, 1280x800, 900x1200, 800x1280, 600x960 and 390x844. Reviewed dashboard, courses and their main tabs, assignments, exams/details/preparation, grades, email, degree views, calendar Month/Week/Agenda, settings, archive, search, navigation and dialogs. Also reviewed populated degree/grade views. No page-level horizontal overflow or browser page errors in the main screen sweep.
- No lint script is defined in package.json. Edited core components and the new stylesheet/test configuration were formatted with the installed Prettier.

Existing Vite chunk-size/dynamic-import warnings remain. Tests and previews use isolated local databases, including existing application sample fixtures; no demo data or data migrations were added to the app. Native Android and Tauri device execution were not available for this review; browser layout and platform tests cover their shared frontend, but physical-device verification remains a limitation.

Screenshots and detailed test logs are in `.local/ui-review/`. The Windows Playwright-managed Vite servers required explicit cleanup after their tests finished; external-server reruns produced normal exit summaries.
