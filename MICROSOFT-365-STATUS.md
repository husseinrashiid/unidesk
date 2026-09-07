# Microsoft 365 integration — UniDesk 0.4.1

Enter the public Application (client) ID in **Settings → Email → Microsoft 365 Client ID**, then choose **Connect Microsoft 365**. The registration can be owned by a personal Entra tenant. Both device authorization and token refresh use `https://login.microsoftonline.com/organizations/oauth2/v2.0`; sign in on Microsoft's page with the university account. No registration-owner tenant ID, client secret, or redirect URI is used. The only requested scopes are delegated User.Read, Mail.Read, and offline_access.

The Microsoft provider handles authentication outside React. It displays a verification URL/code, observes polling intervals, handles pending/slow-down/expiry/cancellation, confirms identity through Graph `/me`, and starts recent Inbox delta sync. Existing provider-ID deduplication, classification, review-before-apply, and database migrations remain intact. Reconnecting clears stale sync backoff. Refresh tokens remain in Windows Credential Manager; access tokens remain in native memory. Neither token crosses into the UI or SQLite.

Consent failures such as AADSTS65001 and AADSTS90094 display:

> Your university does not allow this app to access your mailbox without administrator approval.

The error offers Retry, Copy technical details, and Disconnect. If Microsoft shows the approval requirement only in its browser page while device polling remains pending, use **Microsoft says admin approval is required** in UniDesk's sign-in panel. Diagnostics retain a safe error code, predefined short description, timestamp, HTTP status, and validated correlation ID; they exclude raw Microsoft JSON, tokens, and email bodies. A bounded `microsoft-email-diagnostics.jsonl` log is stored beside the local database.

## Verification

- 19 native Rust tests passed, including mock protocol success, invalid/valid client IDs, pending/slow-down, expired/declined codes, consent blocks, network errors, refresh, revoked-auth reconnect, origin restrictions, and an isolated Windows Credential Manager round trip.
- 55 Node tests and all five Phase 1–4 browser workflows passed.
- The packaged Windows regression smoke passed, including native extraction/indexing, scaling, timer recovery, and restart persistence.
- `scripts/native-email-smoke.mjs` passed against the packaged app with simulated email IPC responses and a real isolated native database. It verified saved client ID, code/URL, cancel, expiry, consent error/actions/copy, network failure, confirmed test university identity, automatic sync, deduplication, reconnect, and disconnect with cache retention. Test instrumentation exists only in that script.
- Built and copied the Windows 0.4.1 installer to `UniDesk-Setup.exe` and `.dist/UniDesk_0.4.1_x64-setup.exe`.

No real AUB account was used. The user's actual registration configuration, AUB consent/Conditional Access policy, live `/me` identity, real Mail.Read access, refresh-token issuance/renewal, and real mailbox delta behavior must still be verified by signing in. Mock success is not evidence that AUB permits consent.

The above verification describes the 0.4.1 authentication release. Phase 4's core feature set was subsequently completed in 0.4.2; see PHASE4-STATUS.md.

## 0.4.3 verification-address fix

The exact-string check on Microsoft's `verification_uri` caused valid device-code responses with another address spelling to fail before displaying their code. The global Microsoft provider now always displays and opens the fixed HTTPS `https://microsoft.com/devicelogin` page. A response URL cannot choose a browser destination, and its spelling cannot block sign-in. The organizations authority, client ID, delegated scopes and token storage are unchanged. No migration is added.

All 11 Microsoft protocol tests passed, including HTTP/HTTPS/address-alias variants, untrusted response addresses, and subsequent simulated university sign-in. The user's actual returned URI was not captured; live AUB sign-in still needs retrying after installing 0.4.3.
