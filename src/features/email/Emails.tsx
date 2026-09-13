import { useState } from "react";
import { ExtendedReview } from "./ExtendedReview";
import { EmailContext } from "./EmailContext";
import { EmailAttachments } from "./EmailAttachments";
import { queueConversion } from "./repository";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Mail, Paperclip, Pin } from "lucide-react";
import {
  Button,
  Empty,
  ErrorText,
  Field,
  PageHeader,
  Section,
} from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch, query } from "../../services/platform";
import type { ActionPayload, Email, EmailAction } from "./types";
import {
  analyzeEmail,
  applyStatements,
  assignCourse,
  emailListQuery,
  ignoreAction,
  syncMailbox,
} from "./repository";
import { providerFor, openMailboxMessage } from "./provider";
import { useEmailAccounts } from "./EmailSettings";
import { ProfessorDirectory } from "./ProfessorDirectory";
import { refreshEmailCourseMatches } from "./repository";

export function Emails({
  courseId = "",
  initialId = "",
}: {
  courseId?: string;
  initialId?: string;
}) {
  const { data, navigate, refresh } = useWorkspace();
  const [selected, setSelected] = useState(initialId);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { data: accounts = [] } = useEmailAccounts();
  const { data: instructors = [] } = useQuery({
    queryKey: ["course-instructors", courseId],
    enabled: !!courseId,
    queryFn: () =>
      query<{ name: string; email: string }>(
        "SELECT p.name,p.email FROM professors p JOIN course_professors cp ON cp.professor_id=p.id WHERE cp.course_id=? ORDER BY p.name",
        [courseId],
      ),
  });
  const result = useQuery({
    queryKey: ["emails", search, courseId, offset, data.courses],
    queryFn: async () => {
      await refreshEmailCourseMatches(data);
      const q = emailListQuery(search, courseId, offset);
      return query<Email>(q.sql, q.params);
    },
  });
  if (selected)
    return (
      <EmailDetail
        key={selected}
        id={selected}
        onBack={() => setSelected("")}
        onSelect={setSelected}
      />
    );
  return (
    <>
      <PageHeader
        title="Emails"
        subtitle="Academic messages and changes awaiting your review."
      >
        <Button onClick={() => navigate("settings")}>Email settings</Button>
        <Button
          disabled={busy || !accounts.some((a) => a.connected)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              for (const account of accounts.filter((a) => a.connected))
                await syncMailbox(account, data);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Syncing…" : "Sync now"}
        </Button>
      </PageHeader>
      {!!accounts.length && (
        <p className="helper">
          {accounts.some((a) => a.connected)
            ? "Showing locally cached messages."
            : "Mailbox disconnected · showing cached messages."}{" "}
          Last sync:{" "}
          {accounts
            .map((a) => a.last_sync_at)
            .filter(Boolean)
            .sort()
            .at(-1)
            ? new Date(
                accounts
                  .map((a) => a.last_sync_at)
                  .filter(Boolean)
                  .sort()
                  .at(-1)!,
              ).toLocaleString()
            : "Never"}
        </p>
      )}
      {!accounts.length && (
        <div className="email-connect">
          <Mail size={24} />
          <div>
            <h2>Connect your university mailbox</h2>
            <p>
              Forward university mail to your dedicated Gmail account, then
              connect Gmail in Email settings. Academic changes always require
              your review.
            </p>
          </div>
          <Button onClick={() => navigate("settings")}>Connect Gmail</Button>
        </div>
      )}
      {courseId && (
        <p className="helper">
          {instructors.length
            ? instructors
                .map((i) => (i.name ? `${i.name} · ${i.email}` : i.email))
                .join(", ")
            : "No instructor email on file for this course yet. Add one in the Instructor Directory."}
        </p>
      )}
      {courseId && (
        <details className="email-registration">
          <summary>Manage course instructors</summary>
          <ProfessorDirectory courseId={courseId} />
        </details>
      )}
      <div className="email-filters">
        <Field label="Search email">
          <input
            data-page-search
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Subject, sender, cached body, course…"
          />
        </Field>
      </div>
      <ErrorText error={error || result.error?.message || ""} />
      {result.isPending ? (
        <p className="muted">Loading messages…</p>
      ) : !result.data?.length ? (
        <Empty
          title="No messages in this view"
          description={
            accounts.length
              ? "Sync your mailbox to fetch messages. Cached messages remain available offline."
              : "Your Inbox will appear here after you connect and sync."
          }
        />
      ) : (
        <div className="email-list">
          {result.data.slice(0, 50).map((email) => (
            <button
              key={email.id}
              className={`email-row ${email.is_read ? "read" : "unread"}`}
              onClick={() => setSelected(email.id)}
            >
              <span className="email-row-sender">
                {email.sender_name || email.sender_email}
                {email.sender_name && <small>{email.sender_email}</small>}
              </span>
              <span className="email-row-main">
                <strong>{email.subject}</strong>
                <small className="email-preview">
                  {email.snippet
                    .replace(/https?:\/\/\S+|\b[A-Za-z]:\\\S+/g, "[link]")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 160)}
                </small>
                <span className="email-row-tags">
                  {email.course_id && (
                    <span>
                      {data.courses.find((c) => c.id === email.course_id)?.code}
                    </span>
                  )}
                  <span>{email.academic_type}</span>
                  {email.requires_review ? (
                    <span className="email-review-label">Needs review</span>
                  ) : null}
                </span>
              </span>
              <span className="email-row-meta">
                <time>{new Date(email.received_at).toLocaleDateString()}</time>
                <span>
                  {email.pinned ? <Pin size={13} /> : null}
                  {email.has_attachments ? <Paperclip size={13} /> : null}
                  {email.importance === "Critical" ? "Critical" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="email-pagination">
        <Button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <span>Page {offset / 50 + 1}</span>
        <Button
          disabled={(result.data?.length ?? 0) <= 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
function EmailDetail({
  id,
  onBack,
  onSelect,
}: {
  id: string;
  onBack: () => void;
  onSelect: (id: string) => void;
}) {
  const { data, refresh } = useWorkspace();
  const { data: accounts = [] } = useEmailAccounts();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const result = useQuery({
    queryKey: ["email", id],
    queryFn: async () => {
      const rows = await query<Email>("SELECT * FROM emails WHERE id=?", [id]);
      return rows[0] ?? null;
    },
  });
  const actions = useQuery({
    queryKey: ["email-actions", id],
    queryFn: () =>
      query<EmailAction>(
        "SELECT * FROM email_detected_actions WHERE email_id=? ORDER BY created_at",
        [id],
      ),
  });
  const email = result.data;
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!email)
    return (
      <>
        <Button onClick={onBack}>Back to emails</Button>
        <Empty
          title={result.isPending ? "Loading message…" : "Message unavailable"}
          description={
            result.error?.message ??
            "The email may have been removed from your local cache."
          }
        />
      </>
    );
  const account = accounts.find((a) => a.id === email.account_id);
  return (
    <div className="email-detail">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to emails
      </Button>
      <PageHeader
        title={email.subject}
        subtitle={`${email.sender_name ? `${email.sender_name} · ` : ""}${email.sender_email}`}
      />
      <p className="muted">
        {new Date(email.received_at).toLocaleString()} · {email.academic_type} ·{" "}
        {email.importance}
      </p>
      <div className="email-actions">
        <Button
          disabled={busy}
          onClick={() =>
            void run(() =>
              batch([
                {
                  sql: "UPDATE emails SET is_read=? WHERE id=?",
                  params: [email.is_read ? 0 : 1, id],
                },
              ]),
            )
          }
        >
          {email.is_read ? "Mark unread" : "Mark read"}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(() =>
              batch([
                {
                  sql: "UPDATE emails SET pinned=? WHERE id=?",
                  params: [email.pinned ? 0 : 1, id],
                },
              ]),
            )
          }
        >
          {email.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(() =>
              batch([
                {
                  sql: "UPDATE emails SET archived=? WHERE id=?",
                  params: [email.archived ? 0 : 1, id],
                },
              ]),
            )
          }
        >
          {email.archived ? "Unarchive" : "Archive locally"}
        </Button>
        {email.web_url && account?.connected ? (
          <Button
            disabled={busy}
            onClick={() =>
              void run(() => openMailboxMessage(account, email.web_url))
            }
          >
            {account.mail_provider === "gmail"
              ? "Open in Gmail"
              : "Open in Outlook"}
          </Button>
        ) : null}
      </div>
      {email.forwarded_by && (
        <p className="helper">
          Forwarded by {email.forwarded_by}. Original sent:{" "}
          {email.original_sent_at
            ? new Date(email.original_sent_at).toLocaleString()
            : "Date unavailable; received date used"}
        </p>
      )}
      <div className="email-assignment">
        <Field label="Assigned course">
          <select
            value={email.course_id ?? ""}
            disabled={busy}
            onChange={(e) =>
              void run(async () => {
                await assignCourse(email, e.target.value);
                await analyzeEmail(
                  {
                    ...email,
                    course_id: e.target.value || null,
                    course_manual: 1,
                  },
                  data,
                );
              })
            }
          >
            <option value="">Unassigned</option>
            {data.courses.map((c) => (
              <option value={c.id} key={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="helper">
        {email.confidence} confidence · {email.explanation}
      </p>
      <ErrorText error={error || actions.error?.message || ""} />
      {email.body_text === null ? (
        <Section title="Message preview">
          <p className="email-body">{email.snippet}</p>
          <Button
            disabled={busy || !account?.connected}
            onClick={() =>
              void run(async () => {
                const body = await providerFor(account).body(
                  account!,
                  email.provider_message_id,
                );
                await batch([
                  {
                    sql: "UPDATE emails SET body_text=?,is_read=1 WHERE id=?",
                    params: [body, id],
                  },
                ]);
                await analyzeEmail({ ...email, body_text: body }, data);
              })
            }
          >
            {busy ? "Loading…" : "Load full text and analyze"}
          </Button>
          <p className="helper">
            The body is retrieved only when requested. Reconnect to load
            uncached text.
          </p>
        </Section>
      ) : (
        <>
          <Section
            title={
              actions.data?.length || email.requires_review
                ? "Detected actions"
                : "Message actions"
            }
          >
            {actions.data?.length ? (
              actions.data.map((action) =>
                action.status === "Pending" ? (
                  <ActionReview
                    key={`${action.id}:${action.payload_json}`}
                    email={email}
                    action={action}
                  />
                ) : (
                  <p key={action.id} className="helper">
                    {action.action_type} · {action.status}
                  </p>
                ),
              )
            ) : email.requires_review ? (
              <p className="muted">
                {email.requires_review
                  ? "This message needs review. Load or reanalyze the newest text to check for a supported change, or mark it reviewed after inspecting it."
                  : "No supported academic change detected."}
              </p>
            ) : null}
            <div className="email-actions">
              <Button
                disabled={
                  busy ||
                  actions.data?.some(
                    (a) => a.action_type === "Create calendar event",
                  )
                }
                onClick={() => void run(() => queueConversion(email))}
              >
                Add to calendar
              </Button>
              <Button
                disabled={busy}
                onClick={() => void run(() => analyzeEmail(email, data))}
              >
                Reanalyze
              </Button>
              {email.requires_review &&
                !actions.data?.some((a) => a.status === "Pending") && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        batch([
                          {
                            sql: "UPDATE emails SET requires_review=0 WHERE id=?",
                            params: [id],
                          },
                          {
                            sql: "UPDATE notifications SET read=1 WHERE type='email' AND entity_id=?",
                            params: [id],
                          },
                        ]),
                      )
                    }
                  >
                    Mark reviewed
                  </Button>
                )}
            </div>
          </Section>
          <Section title="Message">
            <div className="email-body">{email.body_text}</div>
          </Section>
        </>
      )}
      {email.has_attachments ? (
        <EmailAttachments email={email} account={account} />
      ) : null}
      <EmailContext email={email} onSelect={onSelect} />
    </div>
  );
}
function ActionReview({
  email,
  action,
}: {
  email: Email;
  action: EmailAction;
}) {
  return ["event", "grade", "schedule"].includes(action.entity_type) ? (
    <ExtendedReview email={email} action={action} />
  ) : (
    <BasicActionReview email={email} action={action} />
  );
}
function BasicActionReview({
  email,
  action,
}: {
  email: Email;
  action: EmailAction;
}) {
  const { data, refresh, report } = useWorkspace();
  const payload = JSON.parse(action.payload_json) as ActionPayload;
  const [course, setCourse] = useState(action.course_id ?? ""),
    [target, setTarget] = useState(action.entity_id ?? "");
  const [createNew, setCreateNew] = useState(false);
  const [values, setValues] = useState(payload.proposed),
    [expected, setExpected] = useState(payload.expected);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const records = action.entity_type === "exam" ? data.exams : data.assignments;
  const dateField = action.entity_type === "exam" ? "date" : "due_date";
  const timeField = action.entity_type === "exam" ? "start_time" : "due_time";
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectTarget(id: string) {
    setTarget(id);
    setCreateNew(false);
    const record = records.find((r) => r.id === id);
    const snapshot = Object.fromEntries(
      Object.entries(record ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    setExpected(snapshot);
    setValues({
      ...payload.proposed,
      ...(record ? { title: record.title } : {}),
    });
  }
  return (
    <article className="email-proposal">
      <h3>{action.action_type}</h3>
      <p>{payload.explanation}</p>
      <p className="helper">
        {action.confidence} confidence · From {email.sender_email},{" "}
        {new Date(email.received_at).toLocaleString()}
      </p>
      <Field label="Course for this change">
        <select
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            selectTarget("");
          }}
        >
          <option value="">Select a course</option>
          {data.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Existing academic record">
        <select value={target} onChange={(e) => selectTarget(e.target.value)}>
          <option value="">Select a record</option>
          {records
            .filter((r) => r.course_id === course)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
        </select>
      </Field>
      {!target && (
        <label className="email-checkbox">
          <input
            type="checkbox"
            checked={createNew}
            onChange={(e) => setCreateNew(e.target.checked)}
          />
          Create a new {action.entity_type} instead
        </label>
      )}
      <div className="email-change-grid">
        <div>
          <h4>Current</h4>
          <p>{target ? expected.title : "No record selected"}</p>
          <p>
            {expected[dateField] || "—"} {expected[timeField] || ""}
          </p>
          {expected.location && <p>{expected.location}</p>}
        </div>
        <div>
          <h4>Proposed</h4>
          <Field label="Proposed title">
            <input
              value={values.title ?? expected.title ?? ""}
              onChange={(e) => setValues({ ...values, title: e.target.value })}
            />
          </Field>
          <Field label="Proposed date">
            <input
              type="date"
              value={values[dateField] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [dateField]: e.target.value })
              }
            />
          </Field>
          <Field label="Proposed time">
            <input
              type="time"
              value={values[timeField] ?? expected[timeField] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [timeField]: e.target.value })
              }
            />
          </Field>
          <p className="helper">
            Unspecified fields keep their current values.
          </p>
          {action.entity_type === "exam" && (
            <>
              <Field label="Proposed location">
                <input
                  value={values.location ?? expected.location ?? ""}
                  onChange={(e) =>
                    setValues({ ...values, location: e.target.value })
                  }
                />
              </Field>
              <Field label="Assessment type">
                <select
                  value={values.type ?? expected.type ?? "Midterm"}
                  onChange={(e) =>
                    setValues({ ...values, type: e.target.value })
                  }
                >
                  {["Midterm", "Final", "Quiz", "Other"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {action.entity_type === "exam" && (
            <label className="email-checkbox">
              <input
                type="checkbox"
                checked={(values.cancelled ?? expected.cancelled) === "1"}
                onChange={(e) =>
                  setValues({
                    ...values,
                    cancelled: e.target.checked ? "1" : "0",
                  })
                }
              />
              Mark this exam cancelled
            </label>
          )}
          {"notes" in values && (
            <Field label="Proposed notes">
              <textarea
                value={values.notes}
                onChange={(e) =>
                  setValues({ ...values, notes: e.target.value })
                }
              />
            </Field>
          )}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="email-actions">
        <Button
          disabled={busy}
          onClick={() => void run(() => ignoreAction(action))}
        >
          Keep current / ignore
        </Button>
        <Button
          variant="primary"
          disabled={busy || !course || (!target && !createNew)}
          onClick={() =>
            void run(async () => {
              const merged = {
                ...values,
                title: values.title ?? expected.title ?? "",
              };
              await batch(
                applyStatements(
                  action,
                  email,
                  merged,
                  expected,
                  target || null,
                  course,
                ),
              );
              report(
                "Academic record updated. The source and previous values were saved in its history.",
              );
            })
          }
        >
          Apply reviewed change
        </Button>
      </div>
    </article>
  );
}

export function EmailAttention() {
  const { navigate } = useWorkspace();
  const { data: rows = [] } = useQuery({
    queryKey: ["email-attention"],
    queryFn: () =>
      query<Email & { attention_count: number }>(
        "SELECT id,subject,sender_name,sender_email,academic_type,requires_review,COUNT(*) OVER() AS attention_count FROM emails WHERE archived=0 AND (requires_review=1 OR (is_read=0 AND importance IN ('Critical','Important'))) ORDER BY received_at DESC LIMIT 2",
      ),
  });
  if (!rows.length) return null;
  return (
    <Section
      title={`Email needs attention${rows[0].attention_count > 2 ? ` (${rows[0].attention_count})` : ""}`}
      action={
        <Button variant="ghost" onClick={() => navigate("emails")}>
          View all
        </Button>
      }
    >
      {rows.map((e) => (
        <button
          key={e.id}
          className="email-attention-row"
          onClick={() => navigate(`email/${encodeURIComponent(e.id)}`)}
        >
          <Mail size={15} />
          <span>
            <small className="attention-sender">
              {e.sender_name || e.sender_email}
            </small>
            <strong>{e.subject}</strong>
            <small>
              {e.requires_review ? "Needs review" : e.academic_type}
            </small>
          </span>
        </button>
      ))}
    </Section>
  );
}
export function EmailHistory({ kind, id }: { kind: string; id: string }) {
  const { navigate } = useWorkspace();
  const { data: rows = [] } = useQuery({
    queryKey: ["email-history", kind, id],
    queryFn: () =>
      query<{
        id: string;
        field_name: string;
        old_value: string;
        new_value: string;
        source_email_id: string | null;
        source_sender: string;
        source_type: string;
        source_subject: string;
        source_received_at: string;
        created_at: string;
      }>(
        "SELECT * FROM academic_change_log WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 100",
        [kind, id],
      ),
  });
  if (!rows.length) return null;
  return (
    <Section title="Source change history">
      {rows.map((r) => (
        <div key={r.id} className="email-history">
          <strong>{r.field_name.replaceAll("_", " ")}</strong>
          <p>
            {r.old_value || "New"} → {r.new_value || "Empty"}
          </p>
          <small>
            {r.source_subject} · {r.source_sender} ·{" "}
            {new Date(r.source_received_at).toLocaleString()}
          </small>
          {r.source_email_id ? (
            <Button
              variant="ghost"
              onClick={() =>
                navigate(`email/${encodeURIComponent(r.source_email_id!)}`)
              }
            >
              Source email
            </Button>
          ) : (
            <small>
              {r.source_type === "Syllabus"
                ? "Source: locally imported syllabus."
                : "Source email was removed from the local cache."}
            </small>
          )}
        </div>
      ))}
    </Section>
  );
}
