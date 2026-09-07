import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, Field } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { saveSetting } from "../../db/repository";
import { batch, desktop, query } from "../../services/platform";
import type { EmailAccount } from "./types";
import { gmailAuthentication } from "./gmailProvider";
import { syncMailbox } from "./repository";
export function GmailSettings({ accounts }: { accounts: EmailAccount[] }) {
  const { preferences, data, refresh, report } = useWorkspace();
  const [id, setId] = useState(preferences.gmail_client_id ?? ""),
    [secret, setSecret] = useState(""),
    [session, setSession] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [details, setDetails] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      const err = e as Error & {
        code?: string;
        timestamp?: string;
        http_status?: number;
      };
      setError(err.message);
      setDetails(
        `Provider: Gmail\nTimestamp: ${err.timestamp ?? new Date().toISOString()}\nCode: ${err.code ?? "local_operation"}\nHTTP status: ${err.http_status ?? "Not available"}\nDescription: ${err.message}\nGoogle's exact error is not shown here for safety; if this persists, check gmail-diagnostics.jsonl next to your UniDesk database.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect(clientId = id) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId.trim()))
      throw Error("Enter your Google Desktop app client ID.");
    await saveSetting("gmail_client_id", clientId.trim());
    setId(clientId);
    const result = await gmailAuthentication.begin(clientId, secret);
    setSecret("");
    if (mounted.current) setSession(result.sessionId);
    else await gmailAuthentication.cancel(result.sessionId);
  }
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await gmailAuthentication.status(session!);
        if (stopped) return;
        if (result.connected) {
          setSession(null);
          await refresh();
          report(`Connected Gmail: ${result.emailAddress}`);
          const [account] = await query<EmailAccount>(
            "SELECT * FROM email_accounts WHERE id=?",
            [result.accountId!],
          );
          if (account) await run(() => syncMailbox(account, data));
        } else timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (!stopped) {
          setSession(null);
          await run(async () => {
            throw e;
          });
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      void gmailAuthentication.cancel(session).catch(() => {});
    };
  }, [session]);
  return (
    <div className="email-registration">
      <h3>Gmail · Recommended</h3>
      <p className="helper">
        Forward your university mail to a dedicated Gmail account, then connect
        that account here. UniDesk reads mail locally and proposes academic
        updates for your review.
      </p>
      <Field label="Google OAuth Client ID">
        <input
          value={id}
          disabled={busy || !!session}
          onChange={(e) => setId(e.target.value)}
          placeholder="…apps.googleusercontent.com"
        />
      </Field>
      <details>
        <summary>Google Desktop app configuration</summary>
        <p className="helper">
          Enable Gmail API in Google Cloud, configure an External OAuth
          audience, add your dedicated Gmail as a test user, and create an OAuth
          client of type Desktop app. UniDesk uses a temporary 127.0.0.1
          callback; no web redirect registration is needed.
        </p>
        <Field label="Google Desktop app client secret">
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            disabled={busy || !!session}
          />
        </Field>
        <p className="helper">
          Copy <code>installed.client_secret</code> from the same downloaded
          Desktop app JSON file. It is kept in Windows Credential Manager and is
          not your Gmail password. No credential is embedded in source code.
        </p>
        <p className="helper">
          With Google's Testing publishing status, Gmail refresh access normally
          expires after 7 days. Reconnect when prompted, or publish your
          personal app after reviewing Google's requirements.
        </p>
      </details>
      <div className="email-actions">
        <Button
          disabled={busy || !!session || !id.trim()}
          onClick={() =>
            void run(() => saveSetting("gmail_client_id", id.trim()))
          }
        >
          Save Google client ID
        </Button>
        <Button
          variant="primary"
          disabled={busy || !!session || !desktop || !id.trim()}
          onClick={() => void run(() => connect())}
        >
          Connect Gmail
        </Button>
      </div>
      {!desktop && (
        <p className="helper">
          Secure Google sign-in is available in the installed Windows app.
        </p>
      )}
      {session && (
        <div role="status">
          <p>
            Finish Google sign-in in your browser. Select your dedicated Gmail
            account and allow read-only mailbox access.
          </p>
          <Button
            onClick={() =>
              void run(async () => {
                await gmailAuthentication.cancel(session);
                setSession(null);
                report("Google sign-in cancelled.");
              })
            }
          >
            Cancel Google sign-in
          </Button>
        </div>
      )}
      {!accounts.length && <p className="helper">Gmail · Not connected</p>}
      {accounts.map((account) => (
        <div className="email-account" key={account.id}>
          <strong>{account.email_address}</strong>
          <p className="muted">
            {account.connected
              ? "Connected"
              : "Disconnected · Cached mail available"}{" "}
            · Last sync:{" "}
            {account.last_sync_at
              ? new Date(account.last_sync_at).toLocaleString()
              : "Never"}
          </p>
          <div className="email-actions">
            <Button
              disabled={busy || !account.connected}
              onClick={() => void run(() => syncMailbox(account, data))}
            >
              Sync now
            </Button>
            <Button
              disabled={busy || !!session || !desktop}
              onClick={() => void run(() => connect(account.client_id))}
            >
              Reconnect Gmail
            </Button>
            <Button
              disabled={busy || !account.connected}
              onClick={() =>
                void run(async () => {
                  await gmailAuthentication.disconnect(account.id);
                  report(
                    "Gmail disconnected. Cached mail, course mappings and academic changes are kept.",
                  );
                })
              }
            >
              Disconnect Gmail
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  batch([
                    {
                      sql: "UPDATE email_accounts SET sync_cursor=NULL,retry_after=NULL,sync_error='' WHERE id=?",
                      params: [account.id],
                    },
                  ]),
                )
              }
            >
              Reset sync
            </Button>
          </div>
          {account.sync_error && (
            <p role="status">
              {account.sync_error} Cached mail remains available.
            </p>
          )}
        </div>
      ))}
      <ErrorText error={error} />
      {error && (
        <div className="email-actions">
          <Button
            disabled={busy || !!session || !desktop}
            onClick={() => void run(() => connect())}
          >
            Retry Gmail connection
          </Button>
          <Button
            onClick={() =>
              void navigator.clipboard
                .writeText(details)
                .then(() => report("Technical details copied."))
                .catch(() => report(details))
            }
          >
            Copy technical details
          </Button>
          <Button onClick={() => setError("")}>Close</Button>
        </div>
      )}
    </div>
  );
}
