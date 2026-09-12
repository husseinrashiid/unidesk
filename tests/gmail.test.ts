import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, batch } from "../server/storage";
import {
  normalizeForward,
  mimeText,
  htmlText,
  decodeHeader,
  type GmailMessage,
} from "../src/features/email/normalization";
import {
  convertGmail,
  gmailProvider,
} from "../src/features/email/gmailProvider";
import {
  classify,
  matchCourse,
  proposedDate,
  entityAlias,
} from "../src/features/email/analysis";
import {
  pageStatements,
  actionProposal,
  applyStatements,
} from "../src/features/email/repository";
import type {
  EmailAccount,
  Email,
  EmailAction,
} from "../src/features/email/types";
import type { AcademicData } from "../src/types";
const forward =
  "---------- Forwarded message ---------\nFrom: Dr. Smith <smith@aub.edu.lb>\nDate: Mon, 7 Sep 2026 10:32:00 +0300\nSubject: PHIL 210 Assignment 2\nTo: student@aub.edu.lb\n\nAssignment 2 deadline extended to tomorrow.\n\nBest regards\nOffice hours: Monday 3 PM";
const envelope = "Student <forwarder@gmail.com>";
function gmail(id = "abc", body = forward): GmailMessage {
  return {
    id,
    threadId: "thread",
    internalDate: String(Date.parse("2026-09-10T10:00:00Z")),
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: envelope },
        { name: "Subject", value: "Fwd: PHIL 210 Assignment 2" },
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from(body).toString("base64url") },
        },
      ],
    },
  };
}
const account: EmailAccount = {
  id: "g",
  provider: "microsoft",
  mail_provider: "gmail",
  email_address: "dedicated@gmail.com",
  display_name: "",
  client_id: "test.apps.googleusercontent.com",
  connected: 1,
  last_sync_at: null,
  sync_cursor: null,
};
function fixture() {
  fs.mkdirSync(".local/tests", { recursive: true });
  const dir = fs.mkdtempSync(path.resolve(".local/tests/gmail-"));
  const db = openDatabase(path.join(dir, "app.db"));
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31','root'); INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL 210','Ethics','root/c'); INSERT INTO email_accounts(id,provider,mail_provider,email_address,client_id,connected) VALUES('g','microsoft','gmail','dedicated@gmail.com','test',1); INSERT INTO assignments(id,course_id,title,due_date,due_time) VALUES('a','c','Assignment 2','2026-09-11','23:59');",
  );
  const data = {
    courses: db.prepare("SELECT * FROM courses").all(),
    semesters: [],
    exams: [],
    assignments: db.prepare("SELECT * FROM assignments").all(),
    schedules: [],
    events: [],
    tasks: [],
  } as unknown as AcademicData;
  return { db, data, dir };
}
test("Gmail and Outlook forwards use original professor, subject, date and newest body", () => {
  for (const body of [
    forward,
    forward
      .replace("---------- Forwarded message ---------\n", "")
      .replace("Date:", "Sent:"),
  ]) {
    const n = normalizeForward("Fwd: Assignment 2", body, envelope);
    assert.equal(n.sender, "smith@aub.edu.lb");
    assert.equal(n.subject, "PHIL 210 Assignment 2");
    assert.equal(n.forwardedBy, "forwarder@gmail.com");
    assert.equal(n.originalSentAt, "2026-09-07T07:32:00.000Z");
    assert.equal(n.body, "Assignment 2 deadline extended to tomorrow.");
    assert.equal(proposedDate(n.body, n.originalSentAt!).date, "2026-09-08");
  }
});
test("HTML-only forwards become inert text, plain alternatives are preferred, encoded headers decode", () => {
  const html =
    "<script>Exam moved tomorrow</script><iframe>unsafe</iframe><div>" +
    forward
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\n", "<br>") +
    '</div><img src="https://tracker.invalid/pixel" onerror="alert(1)">';
  const m = gmail();
  m.payload.parts = [
    {
      mimeType: "text/html",
      body: { data: Buffer.from(html).toString("base64url") },
    },
  ];
  assert.equal(convertGmail(m).from?.emailAddress?.address, "smith@aub.edu.lb");
  assert(!mimeText(m.payload).includes("unsafe"));
  assert(!htmlText(html).includes("<img"));
  m.payload.parts.push({
    mimeType: "text/plain",
    body: { data: Buffer.from("Plain text wins").toString("base64url") },
  });
  assert.equal(mimeText(m.payload), "Plain text wins");
  assert.equal(decodeHeader("=?UTF-8?B?U21pdGg=?="), "Smith");
  assert.equal(decodeHeader("=?UTF-8?Q?Dr._Smith?="), "Dr. Smith");
});
test("reply chains, negations, signature dates and final chapters do not invent changes", () => {
  const n = normalizeForward(
    "Re: Midterm moved",
    "Thanks.\n\nOn Monday, Professor wrote:\n> Midterm moved to Oct 17.",
    envelope,
  );
  assert.equal(n.body, "Thanks.");
  assert.equal(classify(n.subject, n.body).actionable, false);
  for (const body of [
    "The exam date has not changed.",
    "Class is not cancelled tomorrow.",
    "The final chapter will be discussed.",
  ])
    assert.equal(classify("", body).actionable, false);
  const n2 = normalizeForward(
    "Fwd: update",
    forward + "\nOn Tuesday, Professor wrote:\nExam moved to Oct 1.",
    envelope,
  );
  assert(!n2.body.includes("Oct 1"));
  assert.equal(entityAlias("Assignment #2"), entityAlias("A2"));
  assert.equal(
    proposedDate(
      "Assignment deadline extended to Monday",
      "2026-09-06T10:00:00",
    ).date,
    "2026-09-07",
  );
  assert.equal(proposedDate("Due 09/10", "2026-09-06T10:00:00").date, null);
});
test("course matching disambiguates professors and recognizes code variants", () => {
  const { db, data } = fixture();
  try {
    const c = data.courses[0];
    for (const code of ["PHIL 210", "PHIL210", "PHIL-210"])
      assert.equal(
        matchCourse(
          "smith@aub.edu.lb",
          code,
          data.courses,
          [],
          [{ sender_email: "smith@aub.edu.lb", course_id: "c" }],
        ).courseId,
        "c",
      );
    const courses = [c, { ...c, id: "d", code: "PHIL 211" }];
    const professors = courses.map((c) => ({
      sender_email: "smith@aub.edu.lb",
      course_id: c.id,
    }));
    assert.equal(
      matchCourse("smith@aub.edu.lb", "Hello", courses, [], professors)
        .courseId,
      null,
    );
    assert.equal(
      matchCourse("smith@aub.edu.lb", "PHIL 211", courses, [], professors)
        .courseId,
      "d",
    );
    assert.equal(
      matchCourse("forwarder@gmail.com", "random 210", courses, [], professors)
        .courseId,
      null,
    );
  } finally {
    db.close();
  }
});
test("Gmail initial/history paging deduplicates IDs, saves one email/notification, and review preserves time", async () => {
  const { db, data } = fixture();
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const { args } = JSON.parse(String(init?.body)) as {
      args: { operation: string; value?: string };
    };
    calls.push(args.operation);
    let value: unknown;
    if (args.operation === "profile") value = { historyId: "100" };
    else if (args.operation === "list") value = { messages: [{ id: "abc" }] };
    else if (args.operation === "history")
      value = {
        historyId: "102",
        history: [
          {
            messagesAdded: [
              { message: { id: "abc" } },
              { message: { id: "abc" } },
            ],
          },
        ],
      };
    else if (args.operation === "message") value = gmail(args.value);
    else throw Error("Unexpected request");
    return new Response(JSON.stringify({ value }), { status: 200 });
  };
  try {
    const page = await gmailProvider.page(
      account,
      gmailProvider.initialCursor("2026-09-01T00:00:00Z"),
    );
    batch(
      db,
      pageStatements(
        account,
        page,
        data,
        [],
        [{ sender_email: "smith@aub.edu.lb", course_id: "c" }],
      ),
    );
    const second = await gmailProvider.page(account, page["@odata.deltaLink"]!);
    batch(db, pageStatements(account, second, data, [], []));
    assert.equal(calls.filter((c) => c === "list").length, 1);
    assert.equal(calls.filter((c) => c === "message").length, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM emails").get()?.n, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM notifications").get()?.n,
      1,
    );
    const email = db.prepare("SELECT * FROM emails").get() as unknown as Email;
    assert.equal(email.sender_email, "smith@aub.edu.lb");
    const proposal = actionProposal(email, data)!;
    const payload = JSON.parse(proposal.payload_json);
    assert.equal(payload.proposed.due_date, "2026-09-08");
    const action = {
      ...proposal,
      id: "action",
      status: "Pending",
    } as EmailAction;
    db.prepare(
      "INSERT INTO email_detected_actions(id,email_id,action_type,entity_type,payload_json,confidence) VALUES(?,?,?,?,?,?)",
    ).run(
      "action",
      email.id,
      action.action_type,
      action.entity_type,
      action.payload_json,
      action.confidence,
    );
    batch(
      db,
      applyStatements(
        action,
        email,
        payload.proposed,
        payload.expected,
        "a",
        "c",
      ),
    );
    assert.equal(
      db.prepare("SELECT due_time FROM assignments").get()?.due_time,
      "23:59",
    );
    assert.equal(
      db.prepare("SELECT due_date FROM assignments").get()?.due_date,
      "2026-09-08",
    );
    assert.equal(
      db.prepare("SELECT status FROM email_detected_actions").get()?.status,
      "Applied",
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM academic_change_log").get()?.n,
      1,
    );
    const duplicate = {
      ...page,
      value: page.value.map((m) => ({ ...m, id: "forwarded-again" })),
    };
    batch(db, pageStatements(account, duplicate, data, [], []));
    assert.equal(db.prepare("SELECT count(*) n FROM emails").get()?.n, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM notifications").get()?.n,
      1,
    );
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});
test("populated version 11 upgrades additively with backup, old mail and applied history intact", () => {
  fs.mkdirSync(".local/tests", { recursive: true });
  const dir = fs.mkdtempSync(path.resolve(".local/tests/upgrade-gmail-"));
  const filename = path.join(dir, "app.db");
  const old = new DatabaseSync(filename);
  for (const file of fs
    .readdirSync("src/db")
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 11)
    .sort())
    old.exec(fs.readFileSync(path.join("src/db", file), "utf8"));
  old.exec(
    "PRAGMA user_version=11; INSERT INTO tasks(id,title) VALUES('keep','Retain my work'); INSERT INTO email_accounts(id,provider,email_address,client_id) VALUES('m','microsoft','student@example.edu','public'); INSERT INTO emails(id,account_id,provider_message_id,subject,sender_email,received_at) VALUES('old','m','1','Keep mail','prof@example.edu','2026-09-01');",
  );
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(
      upgraded.prepare("PRAGMA user_version").get()?.user_version,
      21,
    );
    assert.equal(
      upgraded.prepare("SELECT title FROM tasks").get()?.title,
      "Retain my work",
    );
    assert.equal(
      upgraded.prepare("SELECT mail_provider FROM email_accounts").get()
        ?.mail_provider,
      "microsoft",
    );
    assert.equal(
      upgraded.prepare("SELECT subject FROM emails").get()?.subject,
      "Keep mail",
    );
    assert.equal(upgraded.prepare("PRAGMA foreign_key_check").all().length, 0);
    const backups = fs.readdirSync(path.join(dir, "backups"));
    assert.equal(backups.length, 1);
    const snapshot = new DatabaseSync(path.join(dir, "backups", backups[0]));
    assert.equal(
      snapshot.prepare("PRAGMA user_version").get()?.user_version,
      11,
    );
    snapshot.close();
  } finally {
    upgraded.close();
  }
  const reopened = openDatabase(filename);
  assert.equal(reopened.prepare("SELECT count(*) n FROM emails").get()?.n, 1);
  reopened.close();
});

