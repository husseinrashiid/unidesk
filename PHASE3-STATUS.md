# UniDesk 0.3.0

The Phase 3 local workflows are implemented. The Microsoft integration is implemented but still requires live university acceptance testing after an OAuth application is registered.

## Included

- Persistent interface sizing from 100% to 200%, automatic 1440p sizing, and keyboard zoom shortcuts.
- Read-only Microsoft 365 sign-in, native Windows credential storage, bounded incremental Inbox sync, offline cache, and configurable sync intervals.
- Global/course email views, search, local read/pin/archive, attention review, manual classification, sender rules, professor directory, and cached threads.
- Reviewed exam/assignment changes, exam cancellation/location, one-meeting schedule exceptions, explicit grades, and task/calendar conversion.
- Transactional stale-record checks, source history, duplicate prevention, and retained academic records after cache clearing.
- On-demand attachment import, name-conflict decisions, and reading/lecture/exam links.
- Separate email notification preferences and disconnect with keep/remove cache choices.

## Validation

- 49 Node tests passed, including migration/reopen, a 5,000-message cache, proposal transactions, schedule exceptions, explicit scores, provider page limits, and file safety.
- Two Rust tests passed: Graph origin restrictions and an isolated Windows Credential Manager round trip.
- All four browser workflows passed across the combined run and a Phase 3 rerun. The combined run had one unexpected page reload; the 1440p workflow passed when rerun in isolation. A further combined run was blocked by automatic approval review reporting an account usage limit.
- The final 0.3.0 Windows build passed native startup, migration, course directories, file discovery/rename, theme, native 150% scaling, keyboard reset, email setup, timer recovery, session saving, and full process restart persistence using isolated test data.
- Schedule history, attachment conflict, light/dark email review, and 1440p screenshots are retained under `.local/review/`.

## Live setup and limits

Enter a registered public Microsoft application client ID in Settings > Email. No client secret or mailbox password belongs in UniDesk. University consent and device-code restrictions depend on the tenant. Live sign-in, actual Graph downloads, and tenant-specific recovery have not been verified. Attachment browser tests use a simulated provider with actual local file import.

Permanent recurring schedule changes require manual editing. Gmail/IMAP, tray operation, custom rule builders, and PDF previews are outside this release. See README.md for setup and behavior details.
