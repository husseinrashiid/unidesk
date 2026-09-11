import { GmailSettings } from "./GmailSettings";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorText, Field, Modal, Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { saveSetting } from "../../db/repository";
import {
  batch,
  native,
  query,
  enableNotifications,
} from "../../services/platform";
import type { EmailAccount } from "./types";
import { syncMailbox } from "./repository";
import {
  microsoftAuthentication,
  validateMicrosoftClientId,
  microsoftErrorDetails,
  MICROSOFT_APPROVAL_MESSAGE,
  type DeviceSignIn,
} from "./provider";

export function useEmailAccounts() {
  return useQuery({
    queryKey: ["email-accounts"],
    queryFn: () =>
      query<EmailAccount>("SELECT * FROM email_accounts ORDER BY created_at"),
  });
}
export function EmailSettings() {
  const { data, preferences, refresh, report } = useWorkspace();
  const { data: accounts = [] } = useEmailAccounts();
  const [provider, setProvider] = useState(
    preferences.email_provider ?? "gmail",
  );
  const [clientId, setClientId] = useState(preferences.email_client_id ?? "");
  const [device, setDevice] = useState<DeviceSignIn | null>(null);
  const [technical, setTechnical] = useState(""),
    [showTechnical, setShowTechnical] = useState(false),
    [errorAccountId, setErrorAccountId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clearAccount, setClearAccount] = useState<EmailAccount | null>(null);
  const [disconnectAccount, setDisconnectAccount] =
      useState<EmailAccount | null>(null),
    [removeOnDisconnect, setRemoveOnDisconnect] = useState(false);
  const { data: cacheCounts = [] } = useQuery({
    queryKey: ["email-cache-count"],
    queryFn: () =>
      query<{ count: number }>("SELECT count(*) count FROM emails"),
  });
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setTechnical("");
    setShowTechnical(false);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setTechnical(microsoftErrorDetails(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function beginLogin(id = clientId, accountId: string | null = null) {
    setErrorAccountId(accountId);
    await microsoftAuthentication.cancel(device?.sessionId);
    setDevice(null);
    validateMicrosoftClientId(id);
    await saveSetting("email_client_id", id.trim());
    setClientId(id.trim());
    const next = await microsoftAuthentication.begin(id);
    if (!mounted.current) {
      await microsoftAuthentication.cancel(next.sessionId);
      return;
    }
    setDevice(next);
  }
  async function copyDetails(details = technical) {
    try {
      await navigator.clipboard.writeText(details);
      report("Technical details copied.");
    } catch {
      setTechnical(details);
      setShowTechnical(true);
    }
  }
  useEffect(() => {
    if (!device) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await microsoftAuthentication.poll(device!.sessionId);
        if (stopped) return;
        if (result.connected) {
          setDevice(null);
          await refresh();
          report(
            `Connected as ${result.emailAddress}. Syncing recent Inbox messages…`,
          );
          const [account] = await query<EmailAccount>(
            "SELECT * FROM email_accounts WHERE id=?",
            [result.accountId!],
          );
          setErrorAccountId(account?.id ?? null);
          if (account) {
            try {
              await syncMailbox(account, data);
              await refresh();
              report(
                `Connected as ${result.emailAddress}. Recent Inbox sync finished.`,
              );
            } catch (e) {
              setError((e as Error).message);
              setTechnical(microsoftErrorDetails(e));
              await refresh();
            }
          }
        } else
          timer = setTimeout(
            () => void poll(),
            Math.max(5, result.interval ?? device!.interval) * 1000,
          );
      } catch (e) {
        if (!stopped) {
          setDevice(null);
          setError((e as Error).message);
          setTechnical(microsoftErrorDetails(e));
        }
      }
    }
    timer = setTimeout(() => void poll(), Math.max(5, device.interval) * 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      void microsoftAuthentication.cancel(device.sessionId).catch(() => {});
    };
  }, [device?.sessionId]);
  return (
    <Section title="Email">
      <p className="muted">
        Connect Gmail or Microsoft 365 to keep academic messages on this device.
        UniDesk reads mail and never sends messages. Academic changes require
        your review.
      </p>
      <p className="helper">
        Email content is processed locally. Only requests to your connected
        email provider leave this device. {cacheCounts[0]?.count ?? 0} messages
        cached. Remote images are blocked, attachments never download
        automatically, and read/archive states are local to UniDesk.
      </p>
      <Field label="Email source">
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            void run(() => saveSetting("email_provider", e.target.value));
          }}
        >
          <option value="gmail">Gmail (recommended)</option>
          <option value="microsoft">Microsoft 365</option>
        </select>
      </Field>
      {provider === "gmail" && (
        <GmailSettings
          accounts={accounts.filter((a) => a.mail_provider === "gmail")}
        />
      )}
      {provider === "microsoft" && (
        <>
          <Field label="Microsoft 365 Client ID">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Application (client) ID"
              disabled={!!device || busy}
            />
          </Field>
          <p className="helper">
            The app registration can belong to your own Entra tenant. Sign in
            with your AUB work/school account on Microsoft's page. UniDesk uses
            the multitenant organizations authority.
          </p>
          <Button
            disabled={busy || !!device || !clientId.trim()}
            onClick={() =>
              void run(async () => {
                validateMicrosoftClientId(clientId);
                await saveSetting("email_client_id", clientId.trim());
                report("Microsoft 365 Client ID saved.");
              })
            }
          >
            Save client ID
          </Button>
          <details className="email-registration">
            <summary>I don't have an application client ID</summary>
            <p>
              Microsoft requires an app registration before UniDesk can request
              mailbox access. It may be registered in your own tenant; AUB
              decides whether its users may consent to mailbox access.
            </p>
            <ol>
              <li>
                In Microsoft Entra, register an application named UniDesk with
                support for accounts in any organizational directory
                (multitenant).
              </li>
              <li>
                Under Authentication → Advanced settings, enable public client
                flows for device-code sign-in.
              </li>
              <li>
                Add delegated Microsoft Graph permissions: User.Read and
                Mail.Read. UniDesk also requests offline_access to refresh your
                sign-in.
              </li>
              <li>
                Copy the Application (client) ID here. No client secret or
                university password belongs in UniDesk.
              </li>
            </ol>
            <p>
              No redirect URI or client secret is required for this installed
              public client. If AUB blocks consent or device-code sign-in,
              forward university mail to Gmail and connect that mailbox instead.
            </p>
          </details>
          <Button
            disabled={busy || !!device || !native || !clientId.trim()}
            onClick={() => void run(() => beginLogin())}
          >
            Connect Microsoft 365
          </Button>
          {!native && (
            <p className="helper">
              Secure mailbox sign-in is available in the installed Windows or Android app.
            </p>
          )}
          {device && (
            <div className="email-signin" role="status">
              <p>Open {device.verificationUrl} and enter this code:</p>
              <strong>{device.userCode}</strong>
              <p className="helper">
                Choose your AUB university account, even though you registered
                UniDesk in your own tenant. If Microsoft selects your other
                account, choose Use another account. This code expires in
                approximately {Math.ceil(device.expiresIn / 60)} minutes.
              </p>
              <div className="email-actions">
                <Button
                  onClick={() => void run(() => microsoftAuthentication.open())}
                >
                  Open Microsoft sign-in
                </Button>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await microsoftAuthentication.cancel(device.sessionId);
                      setDevice(null);
                      report("Microsoft sign-in cancelled.");
                    })
                  }
                >
                  Cancel
                </Button>
              </div>
              <p className="helper">Waiting for Microsoft authorization…</p>
              <Button
                variant="ghost"
                onClick={() =>
                  void run(async () => {
                    await microsoftAuthentication.cancel(device.sessionId);
                    setDevice(null);
                    throw Object.assign(new Error(MICROSOFT_APPROVAL_MESSAGE), {
                      code: "admin_approval_reported_on_microsoft_page",
                      timestamp: new Date().toISOString(),
                    });
                  })
                }
              >
                Microsoft says admin approval is required
              </Button>
            </div>
          )}
        </>
      )}
      <div className="email-accounts">
        {accounts
          .filter((a) => a.mail_provider !== "gmail")
          .map((account) => (
            <div className="email-account" key={account.id}>
              <strong>{account.email_address}</strong>
              <p className="muted">
                {account.connected
                  ? "Connected"
                  : "Disconnected · cached email available"}{" "}
                · Last sync:{" "}
                {account.last_sync_at
                  ? new Date(account.last_sync_at).toLocaleString()
                  : "Never"}
              </p>
              <div className="email-actions">
                <Button
                  disabled={busy || !account.connected}
                  onClick={() => {
                    setErrorAccountId(account.id);
                    void run(() => syncMailbox(account, data));
                  }}
                >
                  Sync now
                </Button>
                <Button
                  disabled={busy || !!device || !native}
                  onClick={() =>
                    void run(() => beginLogin(account.client_id, account.id))
                  }
                >
                  Reconnect
                </Button>
                <Button
                  disabled={busy || !account.connected}
                  onClick={() => {
                    setDisconnectAccount(account);
                    setRemoveOnDisconnect(false);
                  }}
                >
                  Disconnect…
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setClearAccount(account)}
                >
                  Clear cached email…
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
                <>
                  <p role="status" className="helper">
                    Last sync failed: {account.sync_error} Cached messages are
                    still available.
                  </p>
                  <Button
                    disabled={busy || !native}
                    onClick={() =>
                      void run(() => beginLogin(account.client_id, account.id))
                    }
                  >
                    Retry connection
                  </Button>
                  <Button
                    onClick={() =>
                      void microsoftAuthentication
                        .diagnostics()
                        .then((d) =>
                          copyDetails(d.details || account.sync_error),
                        )
                        .catch(() => copyDetails(account.sync_error))
                    }
                  >
                    Copy technical details
                  </Button>
                </>
              )}
            </div>
          ))}
      </div>
      <Field label="Check for new email">
        <select
          value={preferences.email_sync_minutes ?? "10"}
          onChange={(e) =>
            void run(() => saveSetting("email_sync_minutes", e.target.value))
          }
        >
          {[5, 10, 15, 30, 0].map((n) => (
            <option key={n} value={n}>
              {n ? `Every ${n} minutes while UniDesk is open` : "Manual only"}
            </option>
          ))}
        </select>
      </Field>
      <div className="settings-row">
        <div>
          <strong>Desktop email alerts</strong>
          <p>
            Critical and Important messages only. Normal messages stay in-app;
            Low messages are silent.
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (preferences.email_notifications === "true")
                await saveSetting("email_notifications", "false");
              else if (await enableNotifications())
                await saveSetting("email_notifications", "true");
              else
                throw Error(
                  "Allow notifications on this device to enable email alerts.",
                );
            })
          }
        >
          {preferences.email_notifications === "true"
            ? "Turn off"
            : "Enable alerts"}
        </Button>
      </div>
      <ErrorText error={error} />
      {error && /approval|consent/i.test(error) && (
        <div className="email-actions">
          <p>{MICROSOFT_APPROVAL_MESSAGE}</p>
          <Button
            onClick={() => {
              setProvider("gmail");
              setError("");
            }}
          >
            Connect Gmail
          </Button>
          <Button onClick={() => setError("")}>Close</Button>
        </div>
      )}
      {error && !/approval|consent/i.test(error) && (
        <div className="email-actions">
          <Button
            disabled={busy || !native}
            onClick={() => void run(() => beginLogin(clientId, errorAccountId))}
          >
            Retry
          </Button>
          <Button onClick={() => void copyDetails()}>
            Copy technical details
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await microsoftAuthentication.cancel(device?.sessionId);
                setDevice(null);
                if (errorAccountId)
                  await microsoftAuthentication.disconnect(errorAccountId);
                setErrorAccountId(null);
                report("Microsoft sign-in disconnected. Cached email is kept.");
              })
            }
          >
            Disconnect
          </Button>
        </div>
      )}
      {showTechnical && (
        <Field label="Technical details">
          <textarea readOnly value={technical} rows={7} />
        </Field>
      )}
      {disconnectAccount && (
        <Modal
          title="Disconnect university email?"
          onClose={() => setDisconnectAccount(null)}
        >
          <div className="modal-body">
            <p>
              Your courses, grades, exams, assignments, and approved calendar
              changes will remain.
            </p>
            <Field label="Local email cache">
              <select
                value={removeOnDisconnect ? "remove" : "keep"}
                onChange={(e) =>
                  setRemoveOnDisconnect(e.target.value === "remove")
                }
              >
                <option value="keep">Keep cached email (default)</option>
                <option value="remove">
                  Remove cached email and pending suggestions
                </option>
              </select>
            </Field>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setDisconnectAccount(null)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await microsoftAuthentication.cancel(device?.sessionId);
                  setDevice(null);
                  await microsoftAuthentication.disconnect(
                    disconnectAccount.id,
                  );
                  if (removeOnDisconnect)
                    await batch([
                      {
                        sql: "DELETE FROM emails WHERE account_id=?",
                        params: [disconnectAccount.id],
                      },
                      {
                        sql: "UPDATE email_accounts SET sync_cursor=NULL,last_sync_at=NULL WHERE id=?",
                        params: [disconnectAccount.id],
                      },
                    ]);
                  setDisconnectAccount(null);
                })
              }
            >
              Disconnect account
            </Button>
          </div>
        </Modal>
      )}
      {clearAccount && (
        <Modal
          title="Clear cached email?"
          onClose={() => setClearAccount(null)}
        >
          <div className="modal-body">
            <p>
              This removes cached messages and pending suggestions for{" "}
              {clearAccount.email_address}. Approved academic records and their
              change history remain. Synced mail can be retrieved again while
              the account is connected.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setClearAccount(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await batch([
                    {
                      sql: "DELETE FROM emails WHERE account_id=?",
                      params: [clearAccount.id],
                    },
                    {
                      sql: "UPDATE email_accounts SET sync_cursor=NULL,last_sync_at=NULL WHERE id=?",
                      params: [clearAccount.id],
                    },
                  ]);
                  setClearAccount(null);
                })
              }
            >
              Clear cache
            </Button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

export function EmailSync() {
  const { data, preferences, refresh, report } = useWorkspace();
  const { data: accounts = [] } = useEmailAccounts();
  const ids = accounts
    .filter((a) => a.connected)
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    const minutes = Number(preferences.email_sync_minutes ?? "10");
    if (!native || !ids || !minutes) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    async function tick() {
      try {
        if (!navigator.onLine) {
          timer = setTimeout(() => void tick(), minutes * 60000);
          return;
        }
        const current = await query<EmailAccount>(
          "SELECT * FROM email_accounts WHERE connected=1",
        );
        for (const account of current) {
          if (stopped) return;
          await syncMailbox(account, data);
        }
        failures = 0;
        await refresh();
      } catch (e) {
        failures++;
        if (!stopped && failures === 1)
          report(`Email sync: ${(e as Error).message}`);
      }
      if (!stopped)
        timer = setTimeout(
          () => void tick(),
          Math.min(60, minutes * Math.pow(2, failures)) * 60000,
        );
    }
    timer = setTimeout(() => void tick(), 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ids, preferences.email_sync_minutes, data.courses, data.semesters]);
  return null;
}
