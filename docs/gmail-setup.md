# Gmail setup

Gmail is the recommended email source. Live Google authorization and real forwarded mail require your own sign-in — automated tests use simulated Google responses, not a real mailbox.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) with an account you control. Create or select a project named UniDesk.
2. In **APIs & Services → Library**, find **Gmail API** and enable it.
3. Open **Google Auth Platform**. Complete **Branding** with app name UniDesk and your support/contact email. Choose **External** under **Audience**. While publishing status is **Testing**, add your dedicated Gmail address under **Test users**.
4. Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`.
5. Under **Clients → Create client**, select **Desktop app**, name it UniDesk Desktop, and download the client JSON. Keep it private locally — do not put it in source control.
6. In UniDesk, open **Settings → Email**, choose **Gmail (recommended)**, and paste the downloaded configuration's `installed.client_id` into **Google OAuth Client ID**.
7. Expand **Google Desktop app configuration** and paste `installed.client_secret` from the same JSON into the client secret field. Google desktop apps remain public clients — this value can't be kept truly confidential, but Google includes it in the generated desktop configuration and may require it during token exchange. UniDesk stores it in Windows Credential Manager, not SQLite. It is **not** your Gmail password. Don't create a Web application client or a service account.
8. Click **Connect Gmail**. Your default browser opens Google's consent page — choose your dedicated Gmail account, grant the requested read-only access, and return to UniDesk. The connected address and first sync status appear automatically.

The callback is `http://127.0.0.1:<temporary-port>/oauth2callback`. UniDesk binds a free loopback port for each sign-in and closes it when that sign-in finishes, expires, or is cancelled — there's no fixed web redirect URI to configure. Sign-in uses authorization code + PKCE (S256) and a random state value; only the local callback is HTTP, all Google requests are HTTPS.

Reference: [OAuth for Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app), [desktop loopback support](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration).

## Daily use and Google's "Testing" status

While your Google Auth Platform app is in **Testing**, refresh tokens for Gmail access expire after seven days and UniDesk will ask you to reconnect. After validating your setup, consider publishing the app to **In production** to avoid that expiry — publishing is separate from Google's app verification process. Google's personal-use exception permits limited personal apps without full verification, but an unverified-app warning and user cap can remain; only continue past that warning for an app registration you created yourself.

Reference: [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [personal-use verification exception](https://support.google.com/cloud/answer/13464323?hl=en).

## Troubleshooting a failed connection

UniDesk never shows Google's raw OAuth error text in the app, since it can contain provider-generated content. If **Connect Gmail** fails, use **Copy technical details** for a safe code/HTTP status, then check `gmail-diagnostics.jsonl` next to your UniDesk database (same folder as `unidesk.db`, under the OS app-data directory) for the exact error Google returned. Common causes: the desktop client secret wasn't entered, your Gmail account isn't listed as a Test user while the app is in Testing, or a Workspace administrator is blocking third-party app access (`admin_policy_enforced`).

## Testing a forwarded email end to end

1. Confirm a fresh forwarded email arrives in your dedicated Gmail account.
2. Link the sender's exact email address to the appropriate course, or include that course's code in a test message.
3. Forward a message with ordinary From/Date/Subject headers and a clear academic statement, e.g. `PHIL 210: Assignment 2 is now due September 14 instead of September 11.`
4. Click **Sync now**, then open **Emails → Needs review** and confirm the original sender, course, message date, and proposed change.
5. Apply only if correct, or Ignore. Repeated sync must not re-create the same email, notification, or resolved suggestion.
6. Test an attachment through **Load attachment list → Save to course**; filename conflicts offer Keep both / Replace / Cancel.
7. Disconnect Gmail and reopen UniDesk — cached messages and academic records remain available; reconnecting resumes sync.

Email HTML is never rendered as active HTML: scripts, remote images, tracking pixels, and forms can't execute. Attachment downloads are capped at 30 MB per file; larger files can be saved from Gmail and imported normally.
