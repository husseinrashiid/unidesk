# UniDesk Gmail setup and implementation report — 0.5.1

Implemented in the existing UniDesk application. Live Google authorization and real forwarded AUB messages still require your sign-in; automated tests use simulated Google responses, not a real mailbox.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) using an account you control. Create or select a project named UniDesk.
2. In **APIs & Services → Library**, find **Gmail API** and enable it.
3. Open **Google Auth Platform**. Complete **Branding** with app name UniDesk and your support/contact email. Choose **External** under **Audience**. While publishing status is **Testing**, add your dedicated Gmail address under **Test users**.
4. Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`.
5. Under **Clients → Create client**, select **Desktop app**. Name it UniDesk Desktop. Download the client JSON and keep it private locally; do not put it in source control.
6. In UniDesk, open **Settings → Email**, choose **Gmail (recommended)**, and paste the downloaded configuration's `installed.client_id` into **Google OAuth Client ID**.
7. Expand **Google Desktop app configuration**. Paste `installed.client_secret` from the same downloaded JSON into the client secret field. Google desktop apps remain public clients because this value cannot be kept confidential, but Google includes it in the generated desktop configuration and may require it during token exchange. UniDesk stores it in Windows Credential Manager, not SQLite. It is NOT your Gmail password. Do not create a Web application client or a service account.
8. Click **Connect Gmail**. Your default browser opens Google's consent page. Choose your dedicated Gmail account, grant the requested read-only access, and return to UniDesk. The connected address and first sync status appear automatically.

The exact callback is `http://127.0.0.1:<temporary-port>/oauth2callback`. UniDesk binds a free loopback port for each sign-in and closes it when that sign-in finishes, expires or is cancelled. Desktop clients support this loopback flow; there is no fixed web redirect URI or hosted callback to configure. Sign-in uses authorization code + PKCE S256 and a random state value. Only the callback is local HTTP; Google authorization/API requests use HTTPS.

Google documents the desktop flow and optional client secret in [OAuth for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app). See also [desktop loopback support](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration).

### Daily use and Google's Testing status

Google's **Testing** publishing status normally makes refresh tokens for Gmail access expire after seven days. UniDesk will then ask you to reconnect. After testing your personal setup, review publishing the app to **In production** to avoid the testing-only expiry. Publishing is separate from verification. Google's personal-use exception permits limited personal apps without verification, but an unverified-app warning and user cap can remain. Only continue through such a warning for the app registration you created and recognize.

Sources: [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [personal-use verification exception](https://support.google.com/cloud/answer/13464323?hl=en).

### Troubleshooting a failed connection

UniDesk never shows Google's raw OAuth error text in the app, since it can contain provider-generated content. If **Connect Gmail** fails, use **Copy technical details** for the safe code/HTTP status, then open `gmail-diagnostics.jsonl` next to your UniDesk database (same folder as `unidesk.db`, under the OS app-data directory) for the exact `error`/`error_description` Google returned on the failing request. Common causes: the Desktop app client secret was not entered, the dedicated Gmail account is not listed as a Test user while the app is in Testing, or a Google Workspace administrator is blocking third-party app access (`admin_policy_enforced`).

## Test a forwarded AUB email

1. Confirm a fresh AUB email arrives in your dedicated Gmail account. UniDesk does not configure forwarding in AUB or change AUB tenant policy.
2. Link the professor's exact email address to the appropriate course, or include that course's code in a test message.
3. Forward a message with ordinary From/Date/Subject headers and a clear academic statement, for example `PHIL 210: Assignment 2 is now due September 14 instead of September 11.`
4. Click **Sync now**. Open **Emails → Needs review**. Confirm the original professor, course, message date, existing record and proposed date.
5. Apply only if correct, or Ignore. An existing due time stays unchanged if the message only changes the date. Repeating sync must not re-create the same email, notification or resolved suggestion.
6. Test an attachment through **Load attachment list → Save to course**. Choose a category; filename conflicts offer Keep both / Replace / Cancel. Open saved file uses the existing local file controls.
7. Disconnect Gmail and reopen UniDesk. Cached messages and academic records remain available; reconnect to resume new sync.

## A–O implementation report

| Item | Result |
| --- | --- |
| A. What changed | Gmail is the recommended provider. Browser OAuth, secure refresh, account display, manual/interval sync, Gmail history cursors, forwarded-message normalization and existing review/apply workflows are wired. Microsoft remains optional with a Gmail alternative for admin-consent failures. |
| B. Main modules | `src-tauri/src/gmail.rs`; `src/features/email/gmailProvider.ts`, `normalization.ts`, `GmailSettings.tsx`; existing `EmailSettings`, `Emails`, `provider`, `repository`, `analysis`, `attachments`, native `email.rs`, migration bootstraps and command palette. |
| C. Migration | Additive `012_gmail.sql`. Adds authoritative `email_accounts.mail_provider` and original/envelope message metadata plus a deduplication index. The old Microsoft-only `provider` column remains solely for compatibility with its existing CHECK constraint. No tables, IDs, foreign keys, academic records or previous email history are recreated. Existing version 7–11 databases get a pre-Gmail snapshot; older upgrades already receive the earlier migration safety snapshot. |
| D/E. Cloud configuration/type | Enable Gmail API; External audience; dedicated Gmail as test user while Testing; OAuth **Desktop app** client. Detailed steps above. |
| F. Exact scope | Only `https://www.googleapis.com/auth/gmail.readonly`. Gmail's profile endpoint identifies the mailbox; no separate profile, sending, deletion, modification, Drive or application mailbox scope is requested. |
| G. Callback | `http://127.0.0.1:<temporary-port>/oauth2callback`, handled by the native app with PKCE/state. No hosted redirect setup. |
| H. Client ID location | Settings → Email → Gmail → Google OAuth Client ID. Public ID persists in settings/account metadata. |
| I. Client secret | No hardcoded secret. Enter the desktop `installed.client_secret` supplied by Google under Google Desktop app configuration. It is public-client configuration stored in Windows Credential Manager, never a Gmail password. |
| J. Token storage | Refresh tokens and supplied client configuration use Windows Credential Manager under UniDesk/Google. Access tokens stay in native memory. Tokens never enter SQLite or the webview. Disconnect removes the account's refresh credential and access cache while preserving local mail. |
| K. Connect account | Enter configuration, Connect Gmail, choose the dedicated Gmail in your browser, consent and return. The app confirms the address using Gmail profile before marking it connected. |
| L. Test forwarding | Follow the seven-step forwarded-mail check above. |
| M. Original professor | Decode Gmail MIME data; prefer plain text; reduce HTML to inert text; recognize common Gmail/Outlook forwarding header blocks; use original sender/subject/date and newest body for matching. Envelope sender/subject and forwarding identity are retained separately. Direct automatic forwards retaining the original From header work as normal messages. |
| N. Live-only checks | Actual Google client acceptance, browser consent for your account, real token issuance/long-term refresh, your specific AUB forwarding formats and real attachment downloads, Windows notification delivery under your desktop settings. |
| O. Limits | No known placeholder primary control. Actual Google authorization remains unverified until you sign in. Testing status can require weekly reconnect. Attachment downloads are capped at 30 MB; larger files can be saved from Gmail and imported normally. Unusual/nested forwarding formats may require manual course correction. Probable repeated forwards are merged only with exact original sender/subject/date/body and no attachments; distinct provider IDs with attachments are retained conservatively. |

## Reliability and validation

- 66 Node tests passed, including original sender/date parsing, HTML/plain alternatives, reply/negation safety, code variants, incremental history/deduplication, preserving time during reviewed changes, and a populated version-11 upgrade with backup/reopen.
- 31 native tests passed. Native OAuth tests use mocked token responses and isolated Windows Credential Manager entries. They cover PKCE, state/callback validation, invalid configuration, expired/cancelled/denied/error messages, successful token exchange, secure refresh, revoked/offline refresh, reconnect and credential removal.
- Native attachment tests check byte preservation for PDF/DOCX/PPTX/ZIP payloads, inline MIME parts, missing/corrupt data and the size limit. Existing file tests verify conflict choices and rollback.
- All six existing browser suites passed for Phases 1–4: academic tracking, file operations, email review, calendar exceptions, local document extraction/search, AI citations, syllabus review and practice workflows.
- Packaged Gmail UI test passed with simulated Google responses and a real isolated native database: invalid ID, cancel/expiry, connection/account, initial/history sync, original professor, duplicate prevention, review/apply, Gmail link, revoked/reconnect/disconnect, cached navigation and reload.
- Email HTML is never rendered as active HTML. Scripts, remote images, tracking pixels and forms cannot execute; the app displays text. Cloud AI only receives relevant excerpts when the existing opt-in question workflow requests them.
- Sync runs every 10 minutes by default while UniDesk is open; 5/15/30 minutes and Manual only remain available. Pages are bounded, bodies are cached locally, attachment payloads download only on request, and failed sync backs off.
- Existing persistent application data stays under the OS app-data directory. The installer replaces binaries, not the user's SQLite database, Windows credentials or course files. No updater service was added.

Gmail synchronization follows [Google's full/partial sync guidance](https://developers.google.com/workspace/gmail/api/guides/sync): establish a recent baseline, retain a history cursor and recover an expired cursor through a bounded recent resync.

