import { batch, query } from "../../services/platform";
import {
  extendedProposal,
  extendedApply,
  detectedRoom,
  conversionPayload,
} from "./extendedActions";
import { insert, loadAcademicData } from "../../db/repository";
import type { AcademicData, SqlValue, Statement } from "../../types";
import type { Email, EmailAccount, EmailAction, SenderMatch } from "./types";
import {
  classify,
  detectTime,
  entityAlias,
  matchCourse,
  newestText,
  proposedDate,
} from "./analysis";
import { providerFor, type MailPage, type MailProvider } from "./provider";

export async function matchingRules() {
  const professors = await query<SenderMatch>(
    "SELECT p.email AS sender_email,cp.course_id FROM professors p JOIN course_professors cp ON cp.professor_id=p.id",
  );
  return { rules: [] as SenderMatch[], professors };
}
let matchedConfiguration = "";
let matchingInProgress: Promise<void> | null = null;
/** Revisit cached mail when instructor links change; academic records still require review. */
export async function refreshEmailCourseMatches(data: AcademicData): Promise<void> {
  if (matchingInProgress) await matchingInProgress;
  const { rules, professors } = await matchingRules();
  const signature = JSON.stringify([data.courses, professors]);
  if (signature === matchedConfiguration) return;
  matchingInProgress = (async () => {
    let cursor = "";
    const courseIds = new Set(data.courses.map(c => c.id));
    while (true) {
      const rows = await query<Email>("SELECT * FROM emails WHERE id>? AND course_manual=0 ORDER BY id LIMIT 100", [cursor]);
      if (!rows.length) break;
      for (const email of rows) {
        // Do not remap another semester's already assigned messages.
        if (email.course_id && !courseIds.has(email.course_id)) continue;
        const match = matchCourse(email.sender_email, `${email.subject}\n${newestText(email.body_text ?? email.snippet)}`, data.courses, rules, professors);
        if (match.courseId !== email.course_id) await analyzeEmail(email, data);
      }
      cursor = rows[rows.length - 1].id;
    }
    matchedConfiguration = signature;
  })();
  try { await matchingInProgress; } finally { matchingInProgress = null; }
}
export async function queueConversion(email: Email) {
  await batch([
    {
      sql: "INSERT OR IGNORE INTO email_detected_actions(id,email_id,action_type,course_id,entity_type,payload_json,confidence) VALUES(?,?,?,?,?,?,'Low')",
      params: [
        crypto.randomUUID(),
        email.id,
        "Create calendar event",
        email.course_id,
        "event",
        JSON.stringify(conversionPayload(email)),
      ],
    },
    {
      sql: "UPDATE emails SET requires_review=1 WHERE id=?",
      params: [email.id],
    },
  ]);
}
export async function syncUniversityMail(data: AcademicData) {
  const accounts = await query<EmailAccount>(
    "SELECT * FROM email_accounts WHERE connected=1",
  );
  if (!accounts.length)
    throw Error("Connect Gmail or Microsoft 365 in Email settings first.");
  for (const account of accounts) await syncMailbox(account, data);
}
export function pageStatements(
  account: EmailAccount,
  page: MailPage,
  data: AcademicData,
  rules: SenderMatch[],
  professors: SenderMatch[],
): Statement[] {
  if (!Array.isArray(page.value))
    throw Error(
      "The email provider returned an invalid mail page. Cached data was preserved.",
    );
  const statements: Statement[] = [];
  for (const m of page.value) {
    if (typeof m?.id !== "string" || !m.id) continue;
    // Preserve locally cached mail and approved-source links if moved/deleted remotely.
    if (m["@removed"]) continue;
    const received = m.receivedDateTime;
    if (
      !received ||
      !Number.isFinite(Date.parse(received)) ||
      typeof m.from?.emailAddress?.address !== "string" ||
      (m.subject !== undefined && typeof m.subject !== "string") ||
      (m.bodyPreview !== undefined && typeof m.bodyPreview !== "string")
    )
      continue;
    const sender = m.from.emailAddress.address.toLowerCase();
    const text = `${m.subject ?? ""}\n${m.bodyText ?? m.bodyPreview ?? ""}`;
    const match = matchCourse(sender, text, data.courses, rules, professors);
    const classification = classify(m.subject ?? "", m.bodyText ?? m.bodyPreview ?? "");
    const id = `${account.id}:${m.id}`;
    statements.push({
      sql: "INSERT INTO emails(id,account_id,provider_message_id,provider_thread_id,sender_email,sender_name,subject,snippet,received_at,is_read,has_attachments,web_url,course_id,importance,academic_type,confidence,explanation,requires_review,original_message_key) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM emails WHERE account_id=? AND original_message_key=? AND provider_message_id<>?) ON CONFLICT(account_id,provider_message_id) DO UPDATE SET has_attachments=excluded.has_attachments,web_url=excluded.web_url",
      params: [
        id,
        account.id,
        m.id,
        m.conversationId ?? "",
        sender,
        m.from.emailAddress.name ?? "",
        m.subject ?? "(No subject)",
        m.bodyPreview ?? "",
        received,
        m.isRead ? 1 : 0,
        m.hasAttachments ? 1 : 0,
        m.webLink ?? "",
        match.courseId,
        classification.importance,
        classification.type,
        match.confidence,
        match.reason,
        classification.actionable ? 1 : 0,
        m.originalKey ?? null,
        account.id,
        m.originalKey ?? null,
        m.id,
      ],
    });
    if (m.bodyText !== undefined)
      statements.push({
        sql: "UPDATE emails SET body_text=COALESCE(body_text,?),envelope_sender_email=?,envelope_subject=?,original_sent_at=?,forwarded_by=? WHERE id=? AND body_text IS NULL",
        params: [
          m.bodyText,
          m.normalized?.envelopeSender ?? sender,
          m.normalized?.envelopeSubject ?? m.subject ?? "",
          m.normalized?.originalSentAt ?? null,
          m.normalized?.forwardedBy ?? "",
          id,
        ],
      });
    if (
      classification.importance !== "Low" &&
      (classification.type !== "Unknown" || match.courseId)
    )
      statements.push({
        sql: "INSERT OR IGNORE INTO notifications(id,type,title,description,entity_id,priority,delivered) SELECT ?,'email',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM emails WHERE id=?)",
        params: [
          `email:${id}`,
          classification.type,
          m.subject ?? "New academic email",
          id,
          classification.importance === "Critical" ? "High" : "Normal",
          classification.importance === "Normal" ? 1 : 0,
          id,
        ],
      });
  }
  const cursor = page["@odata.nextLink"] ?? page["@odata.deltaLink"];
  if (!cursor)
    throw Error(
      "The email provider omitted the sync cursor. This page was not saved; retry sync.",
    );
  statements.push({
    sql: "UPDATE email_accounts SET sync_cursor=?,last_sync_at=?,sync_error='',retry_after=NULL WHERE id=? AND connected=1",
    params: [cursor, new Date().toISOString(), account.id],
    expectChanges: 1,
  });
  return statements;
}
let syncing = false;
export async function syncPages(
  account: EmailAccount,
  data: AcademicData,
  rules: SenderMatch[],
  professors: SenderMatch[],
  provider: MailProvider,
  persist: (statements: Statement[]) => Promise<unknown>,
) {
  const semester = data.semesters.find((s) => s.status === "Active");
  const start = semester
    ? new Date(`${semester.start_date}T00:00:00`)
    : new Date(Date.now() - 30 * 86400000);
  start.setDate(start.getDate() - 14);
  let cursor =
    account.sync_cursor ?? provider.initialCursor(start.toISOString());
  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    const page = await provider.page(account, cursor);
    await persist(pageStatements(account, page, data, rules, professors));
    if (!page["@odata.nextLink"]) break;
    cursor = page["@odata.nextLink"];
  }
}
export async function syncMailbox(
  account: EmailAccount,
  data: AcademicData,
  provider: MailProvider = providerFor(account),
) {
  if (syncing) return;
  syncing = true;
  try {
    const latest = (
      await query<EmailAccount>("SELECT * FROM email_accounts WHERE id=?", [
        account.id,
      ])
    )[0];
    if (!latest?.connected) throw Error("Reconnect your mailbox to sync.");
    if (latest.retry_after && Date.parse(latest.retry_after) > Date.now())
      throw Error(
        `Please retry after ${new Date(latest.retry_after).toLocaleTimeString()}.`,
      );
    account = latest;
    data = await loadAcademicData();
    const { rules, professors } = await matchingRules();
    await syncPages(
      account,
      data,
      rules,
      professors,
      provider,
      async (statements) => {
        await batch(statements);
        const waiting = await query<Email>(
          "SELECT * FROM emails WHERE account_id=? AND body_text IS NOT NULL AND analyzed_at IS NULL ORDER BY received_at LIMIT 150",
          [account.id],
        );
        for (const email of waiting) await analyzeEmail(email, data);
      },
    );
  } catch (error) {
    const message = (error as Error).message;
    if (!message.startsWith("Please retry after")) {
      const delay = Math.min(
        86400,
        Math.max(60, Number(message.match(/after (\d+) seconds/)?.[1] ?? 60)),
      );
      await batch([
        {
          sql: "UPDATE email_accounts SET sync_error=?,retry_after=? WHERE id=?",
          params: [
            message,
            new Date(Date.now() + delay * 1000).toISOString(),
            account.id,
          ],
        },
      ]);
    }
    throw error;
  } finally {
    syncing = false;
  }
}
export function actionProposal(
  email: Email,
  data: AcademicData,
): Omit<EmailAction, "id" | "status"> | null {
  if (email.body_text === null) return null;
  const extended = extendedProposal(email, data);
  if (extended) return extended;
  const text = `${email.subject}\n${newestText(email.body_text)}`;
  const classification = classify(email.subject, email.body_text);
  const entityType = ["Exam change", "Exam announcement", "Quiz"].includes(
    classification.type,
  )
    ? "exam"
    : ["Deadline change", "Assignment announcement"].includes(
          classification.type,
        )
      ? "assignment"
      : null;
  if (!entityType) return null;
  const candidates = (
    entityType === "exam" ? data.exams : data.assignments
  ).filter((e) => e.course_id === email.course_id);
  const alias = ` ${entityAlias(text)} `;
  const matches = candidates.filter((e) => {
    if (alias.includes(` ${entityAlias(e.title)} `)) return true;
    if (entityType !== "exam") return false;
    return ["midterm", "final", "quiz"].some(
      (t) =>
        new RegExp(`\\b${t}\\b`).test(alias) &&
        new RegExp(`\\b${t}\\b`).test(entityAlias(e.title)),
    );
  });
  const target = matches.length === 1 ? matches[0] : undefined;
  const date = proposedDate(text, email.original_sent_at ?? email.received_at);
  const dateField = entityType === "exam" ? "date" : "due_date";
  const timeField = entityType === "exam" ? "start_time" : "due_time";
  const expected: Record<string, string> = {};
  if (target) {
    for (const [key, value] of Object.entries(target))
      if (typeof value === "string") expected[key] = value;
    if (entityType === "exam")
      expected.cancelled = String(
        ("cancelled" in target ? target.cancelled : 0) ?? 0,
      );
  }
  const proposed: Record<string, string> = { [dateField]: date.date ?? "" };
  const room = detectedRoom(text);
  if (
    entityType === "exam" &&
    /\bcancell?ed\b/i.test(newestText(email.body_text))
  ) {
    proposed.cancelled = "1";
    if (target && !date.date) proposed[dateField] = expected[dateField];
  }
  if (entityType === "exam" && room) proposed.location = room;
  if (entityType === "exam" && !target)
    proposed.type =
      classification.type === "Quiz"
        ? "Quiz"
        : /\bfinal exam\b/i.test(text)
          ? "Final"
          : "Midterm";
  if (
    target &&
    !date.date &&
    (room || detectTime(text)) &&
    !/\b(?:date|postponed|deadline)\b/i.test(newestText(email.body_text))
  )
    proposed[dateField] = expected[dateField];
  const time = detectTime(text);
  if (time) proposed[timeField] = time;
  if (!target)
    proposed.title = (
      text.match(/\bAssignment\s*#?\s*\d+\b/i)?.[0] ??
      (entityType === "exam"
        ? text.match(/\b(?:midterm|final exam|quiz)(?:\s+\d+)?\b/i)?.[0]
        : null) ??
      email.subject
    )
      .replace(/^(?:re|fw|fwd):\s*/gi, "")
      .slice(0, 200);
  const explanation = `${date.reason} ${target ? "Matched the existing title. Unspecified fields stay unchanged." : "No unique existing title matched. Select an existing record or explicitly create a new one."}`;
  return {
    email_id: email.id,
    action_type: classification.type,
    course_id: email.course_id,
    entity_type: entityType,
    entity_id: target?.id ?? null,
    confidence:
      date.date && target && email.confidence === "High" ? "High" : "Low",
    payload_json: JSON.stringify({ expected, proposed, explanation }),
  };
}
export async function analyzeEmail(email: Email, data: AcademicData) {
  const { rules, professors } = await matchingRules();
  const match = matchCourse(
    email.sender_email,
    `${email.subject}\n${newestText(email.body_text ?? email.snippet)}`,
    data.courses,
    rules,
    professors,
  );
  const courseId = email.course_manual ? email.course_id : match.courseId;
  const classification = classify(
    email.subject,
    email.body_text ?? email.snippet,
  );
  const proposal = actionProposal(
    {
      ...email,
      course_id: courseId,
      confidence: email.course_manual ? "High" : match.confidence,
    },
    data,
  );
  const statements: Statement[] = [
    {
      sql: "UPDATE emails SET course_id=?,importance=CASE WHEN classification_manual=1 THEN importance ELSE ? END,academic_type=CASE WHEN classification_manual=1 THEN academic_type ELSE ? END,confidence=?,explanation=?,requires_review=?,analyzed_at=datetime('now') WHERE id=?",
      params: [
        courseId,
        classification.importance,
        classification.type,
        email.course_manual ? "High" : match.confidence,
        email.course_manual ? "Course selected by you." : match.reason,
        classification.actionable || proposal ? 1 : 0,
        email.id,
      ],
    },
  ];
  if (proposal) {
    // Reanalysis may refine a pending proposal; resolved suggestions remain resolved.
    statements.push({
      sql: "INSERT INTO email_detected_actions(id,email_id,action_type,course_id,entity_type,entity_id,payload_json,confidence) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(email_id,action_type) DO UPDATE SET course_id=excluded.course_id,entity_id=excluded.entity_id,payload_json=excluded.payload_json,confidence=excluded.confidence WHERE status='Pending'",
      params: [
        crypto.randomUUID(),
        proposal.email_id,
        proposal.action_type,
        proposal.course_id,
        proposal.entity_type,
        proposal.entity_id,
        proposal.payload_json,
        proposal.confidence,
      ],
    });
    if (proposal.entity_id)
      statements.push({
        sql: "UPDATE email_detected_actions AS a SET status='Superseded',resolved_at=datetime('now') WHERE a.status='Pending' AND a.entity_id=? AND a.entity_type=? AND EXISTS(SELECT 1 FROM email_detected_actions newer JOIN emails ne ON ne.id=newer.email_id JOIN emails old ON old.id=a.email_id WHERE newer.entity_id=a.entity_id AND newer.entity_type=a.entity_type AND newer.status IN ('Pending','Applied') AND ne.received_at>old.received_at AND EXISTS(SELECT 1 FROM json_each(a.payload_json,'$.proposed') p JOIN json_each(newer.payload_json,'$.proposed') n ON n.key=p.key WHERE p.value IS NOT json_extract(a.payload_json,'$.expected.' || p.key) AND n.value IS NOT json_extract(newer.payload_json,'$.expected.' || n.key)))",
        params: [proposal.entity_id, proposal.entity_type],
      });
  }
  statements.push({
    sql: "UPDATE emails SET requires_review=0 WHERE EXISTS(SELECT 1 FROM email_detected_actions WHERE email_id=emails.id AND status IN ('Applied','Ignored','Superseded')) AND NOT EXISTS(SELECT 1 FROM email_detected_actions WHERE email_id=emails.id AND status='Pending')",
  });
  await batch(statements);
}
export function applyStatements(
  action: EmailAction,
  email: Email,
  values: Record<string, string>,
  expected: Record<string, string>,
  entityId: string | null,
  courseId: string,
): Statement[] {
  if (["event", "grade", "schedule"].includes(action.entity_type))
    return extendedApply(action, email, values, expected, entityId, courseId);
  if (action.status !== "Pending")
    throw Error("This suggestion has already been resolved.");
  if (!courseId) throw Error("Choose a course before applying.");
  const table = action.entity_type === "exam" ? "exams" : "assignments";
  const dateField = table === "exams" ? "date" : "due_date";
  const timeField = table === "exams" ? "start_time" : "due_time";
  const fields = [
    "title",
    dateField,
    timeField,
    "notes",
    ...(table === "exams"
      ? ["location", "coverage", "type", "end_time", "cancelled"]
      : []),
  ];
  const selected = Object.fromEntries(
    Object.entries(values).filter(([key]) => fields.includes(key)),
  );
  const date = selected[dateField];
  const check = new Date(`${date}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
    Number.isNaN(check.getTime()) ||
    check.getFullYear() !== Number(date.slice(0, 4)) ||
    check.getMonth() + 1 !== Number(date.slice(5, 7)) ||
    check.getDate() !== Number(date.slice(8))
  )
    throw Error("Enter a valid date before applying.");
  if (
    selected[timeField] &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(selected[timeField])
  )
    throw Error("Enter a valid time.");
  if ((!entityId || "title" in selected) && !selected.title?.trim())
    throw Error("Enter a title.");
  if (
    entityId &&
    (expected.id !== entityId || (expected.course_id ?? "") !== courseId)
  )
    throw Error("Reopen the selected record before applying.");
  const id = entityId ?? crypto.randomUUID();
  const statements: Statement[] = [
    {
      sql: "UPDATE email_detected_actions SET status='Applied',entity_id=?,course_id=?,resolved_at=datetime('now') WHERE id=? AND status='Pending' AND payload_json=?",
      params: [id, courseId || null, action.id, action.payload_json],
      expectChanges: 1,
    },
  ];
  if (entityId) {
    const guard = Object.entries(expected).filter(([key]) =>
      [
        ...fields,
        "id",
        "course_id",
        "updated_at",
        "end_time",
        "location",
        "description",
        "notes",
        "coverage",
        "status",
        "assigned_date",
      ].includes(key),
    );
    statements.push({
      sql: `UPDATE ${table} SET ${Object.keys(selected)
        .map((k) => `${k}=?`)
        .join(
          ",",
        )},updated_at=datetime('now') WHERE course_id IS ? AND ${guard.map(([k]) => `${k}=?`).join(" AND ")}`,
      params: [
        ...Object.values(selected),
        courseId || null,
        ...guard.map(([, v]) => v),
      ],
      expectChanges: 1,
    });
  } else {
    statements.push({
      sql: `INSERT INTO ${table}(id,course_id,${Object.keys(selected).join(",")}) SELECT ?,?,${Object.keys(
        selected,
      )
        .map(() => "?")
        .join(
          ",",
        )} WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE course_id IS ? AND lower(title)=lower(?) AND ${dateField}=?)`,
      params: [
        id,
        courseId || null,
        ...Object.values(selected),
        courseId || null,
        selected.title,
        date,
      ],
      expectChanges: 1,
    });
  }
  for (const [field, value] of Object.entries(selected)) {
    if (entityId && expected[field] === value) continue;
    statements.push(
      insert("academic_change_log", {
        id: crypto.randomUUID(),
        entity_type: action.entity_type,
        entity_id: id,
        field_name: field,
        old_value: expected[field] ?? null,
        new_value: value,
        source_email_id: email.id,
        source_sender: email.sender_email,
        source_subject: email.subject,
        source_received_at: email.received_at,
      }),
    );
  }
  statements.push(...resolveStatements(email.id));
  return statements;
}
function resolveStatements(emailId: string): Statement[] {
  return [
    {
      sql: "UPDATE emails SET requires_review=EXISTS(SELECT 1 FROM email_detected_actions WHERE email_id=? AND status='Pending') WHERE id=?",
      params: [emailId, emailId],
    },
    {
      sql: "UPDATE notifications SET read=1 WHERE type='email' AND entity_id=?",
      params: [emailId],
    },
  ];
}
export async function ignoreAction(action: EmailAction) {
  await batch([
    {
      sql: "UPDATE email_detected_actions SET status='Ignored',resolved_at=datetime('now') WHERE id=? AND status='Pending'",
      params: [action.id],
      expectChanges: 1,
    },
    ...resolveStatements(action.email_id),
  ]);
}
export async function assignCourse(email: Email, courseId: string) {
  await batch([
    {
      sql: "UPDATE emails SET course_id=?,course_manual=1 WHERE id=?",
      params: [courseId || null, email.id],
    },
  ]);
}
export function emailListQuery(
  search: string,
  courseId: string,
  offset: number,
) {
  const clauses = ["e.archived=0"];
  const params: SqlValue[] = [];
  if (courseId) {
    clauses.push("e.course_id=?");
    params.push(courseId);
  }
  const tokens = search.trim().split(/\s+/).filter(Boolean).slice(0, 12);
  if (tokens.length) {
    clauses.push(
      "(e.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?) OR e.academic_type LIKE ? OR e.course_id IN (SELECT id FROM courses WHERE code LIKE ?))",
    );
    params.push(
      tokens.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" AND "),
      `%${search}%`,
      `%${search}%`,
    );
  }
  return {
    sql: `SELECT e.id,e.account_id,e.provider_message_id,e.subject,e.sender_email,e.sender_name,e.received_at,e.is_read,e.course_id,e.importance,e.academic_type,e.confidence,e.requires_review,e.pinned,e.has_attachments,e.snippet FROM emails e WHERE ${clauses.join(" AND ")} ORDER BY e.pinned DESC,e.received_at DESC,e.id LIMIT 51 OFFSET ?`,
    params: [...params, offset],
  };
}
