# Microsoft 365 setup

Enter your public Application (client) ID in **Settings → Email → Microsoft 365 Client ID**, then choose **Connect Microsoft 365**. The registration can belong to your own personal Entra tenant — you sign in on Microsoft's page with your university account. Both device authorization and token refresh use `https://login.microsoftonline.com/organizations/oauth2/v2.0`; no tenant-specific authority, redirect URI, or client secret is used. The only requested scopes are delegated `User.Read`, `Mail.Read`, and `offline_access`.

## Registering the app in Microsoft Entra

1. Configure the app registration for **Accounts in any organizational directory (multitenant)**. Its home tenant does not need to be your university's.
2. Enable **Allow public client flows** under Authentication → Advanced settings, for device-code authorization.
3. Add delegated Microsoft Graph **User.Read** and **Mail.Read** permissions. Sign-in also requests **offline_access**. Have IT grant admin consent if your organization's policy requires it.
4. Copy the Application (client) ID into UniDesk, select **Connect Microsoft 365**, open Microsoft's sign-in page, enter the displayed device code, and review the consent prompt.
5. UniDesk confirms the signed-in address via Graph `/me` and syncs recent Inbox messages automatically.

## Behavior

The Microsoft provider handles authentication outside the UI: it displays a verification URL/code, observes polling intervals, handles pending/slow-down/expiry/cancellation, confirms identity through Graph `/me`, and starts a recent Inbox delta sync. Refresh tokens are stored in Windows Credential Manager; access tokens stay in native process memory. Neither token ever reaches SQLite, the webview, or application logs. Sign-in always opens the fixed `https://microsoft.com/devicelogin` page, regardless of the address returned in a given device-code response.

If your organization blocks consent (errors like `AADSTS65001` or `AADSTS90094`), UniDesk shows:

> Your university does not allow this app to access your mailbox without administrator approval.

with Retry, Copy technical details, and Disconnect actions. Diagnostics are logged to `microsoft-email-diagnostics.jsonl` beside your local database as a safe error code, short description, timestamp, and correlation ID — never raw Microsoft response bodies, tokens, or email content.

See also: [Microsoft device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Graph mail delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0), [Windows credential storage](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew).
