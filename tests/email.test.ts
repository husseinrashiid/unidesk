import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, batch } from "../server/storage";
import {
  newestText,
  matchCourse,
  classify,
  detectDates,
  detectTime,
  proposedDate,
  entityAlias,
} from "../src/features/email/analysis";
import {
  actionProposal,
  applyStatements,
  emailListQuery,
  pageStatements,
} from "../src/features/email/repository";
import { resolveInterfaceScale } from "../src/hooks/useInterfaceScale";
import type {
  Email,
  EmailAccount,
  EmailAction,
} from "../src/features/email/types";
import type { AcademicData, Course } from "../src/types";
const courses = [
  {
    id: "c",
    semester_id: "s",
    code: "PHIL 210",
    name: "Introduction to Ethics",
    archived: 0,
  },
  {
    id: "c2",
    semester_id: "s",
    code: "MATH 201",
    name: "Calculus and Geometry",
    archived: 0,
  },
] as Course[];
const data: AcademicData = {
  semesters: [],
  courses,
  exams: [],
  assignments: [],
  events: [],
  schedules: [],
};
const account = {
  id: "account",
  provider: "microsoft",
  connected: 1,
} as EmailAccount;
const received = "2026-09-06T10:00:00";
const email = {
  id: "mail",
  account_id: "account",
  sender_email: "prof@university.edu",
  subject: "PHIL210 Assignment 2 deadline",
  body_text: "Assignment 2 is now due September 14 instead of September 11.",
  received_at: received,
  course_id: "c",
  confidence: "High",
} as Email;
function fixture() {
  const dir = fs.mkdtempSync(path.resolve(".local/tests/email-"));
  const filename = path.join(dir, "workspace.db");
  const db = openDatabase(filename);
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31','root'); INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL210','Ethics','root/c'); INSERT INTO email_accounts(id,provider,email_address,client_id,connected) VALUES('account','microsoft','student@example.edu','public-id',1); INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,received_at) VALUES('mail','account','message','prof@university.edu','Deadline','2026-09-06T10:00:00Z'); INSERT INTO assignments(id,course_id,title,due_date,due_time,notes) VALUES('a','c','Assignment 2','2026-09-11','23:59','Keep my notes');",
  );
  return { db, filename };
}
test("interface size respects explicit choices and existing Windows scaling", () => {
  assert.equal(resolveInterfaceScale(undefined, 2560), 150);
  assert.equal(resolveInterfaceScale("auto", 1707), 100);
  assert.equal(resolveInterfaceScale("125", 2560), 125);
  assert.equal(resolveInterfaceScale("broken", 1440), 100);
});
test("course matching tolerates code punctuation and handles conflicting instructors", () => {
  for (const code of ["PHIL210", "PHIL-210", "PHIL 210"])
    assert.equal(matchCourse("x", code, courses, [], []).courseId, "c");
  assert.equal(
    matchCourse(
      "prof",
      "PHIL210",
      courses,
      [],
      [{ sender_email: "prof", course_id: "c2" }],
    ).courseId,
    null,
  );
  assert.equal(
    matchCourse(
      "PROF",
      "MATH201",
      courses,
      [{ sender_email: "prof", course_id: "c" }],
      [],
    ).courseId,
    "c",
  );
  assert.equal(
    matchCourse(
      "prof",
      "Hi",
      courses,
      [],
      [
        { sender_email: "prof", course_id: "c" },
        { sender_email: "prof", course_id: "c2" },
      ],
    ).courseId,
    null,
  );
});
test("classification excludes quoted replies, signatures, negation and final chapter", () => {
  assert.equal(
    classify("Reading", "Please read the final chapter.").type,
    "Course material",
  );
  assert.equal(
    classify("Course update", "Class is not cancelled.").type,
    "General course",
  );
  assert.notEqual(
    classify("Update", "The exam date has not changed.").type,
    "Exam change",
  );
  assert.equal(
    classify("PHIL210", "Class is cancelled tomorrow.").type,
    "Class cancellation",
  );
  assert.equal(
    classify("Assignment 2", "The deadline is extended to September 20.").type,
    "Deadline change",
  );
  assert.equal(
    newestText("Thanks.\nOn Monday Alex wrote:\nExam moved to Sep 20."),
    "Thanks.",
  );
  assert.equal(
    newestText("New slides.\nBest regards,\nOffice hours: Monday 3PM"),
    "New slides.",
  );
});
test("date parsing uses received date, rejects ambiguity and follows change direction", () => {
  assert.equal(
    proposedDate("moved from October 15 to October 17", received).date,
    "2026-10-17",
  );
  assert.equal(
    proposedDate("now due Sep 14 instead of Sep 11", received).date,
    "2026-09-14",
  );
  assert.equal(proposedDate("due tomorrow", received).date, "2026-09-07");
  assert.equal(proposedDate("next Monday", received).date, "2026-09-07");
  assert.equal(proposedDate("09/10", received).date, null);
  assert.equal(proposedDate("17/09", received).date, "2026-09-17");
  assert.equal(proposedDate("09/17", received).date, "2026-09-17");
  assert.equal(proposedDate("17 September", received).date, "2026-09-17");
  assert.equal(proposedDate("Jan 2", "2026-12-30T12:00:00").date, "2027-01-02");
  assert.equal(
    proposedDate("tomorrow", "2026-12-31T12:00:00").date,
    "2027-01-01",
  );
  assert.equal(proposedDate("February 29 2028", received).date, "2028-02-29");
  assert.equal(proposedDate("February 29 2026", received).date, null);
  assert.equal(detectDates("Sep 12 or Sep 14", received).length, 2);
  assert.equal(proposedDate("Sep 12 or Sep 14", received).date, null);
});
test("time parsing handles noon, AM/PM, 24-hour and ambiguity", () => {
  for (const [text, time] of [
    ["noon", "12:00"],
    ["3PM", "15:00"],
    ["12:30 PM", "12:30"],
    ["15:00", "15:00"],
    ["12AM", "00:00"],
  ])
    assert.equal(detectTime(text), time);
  assert.equal(detectTime("25:70"), null);
  assert.equal(detectTime("from 12:30 to 15:00"), null);
  assert.equal(entityAlias("A2"), entityAlias("Assignment 2"));
});
test("proposal and transactional application preserve unspecified fields and reject repeats", () => {
  const { db } = fixture();
  try {
    const assignment = db
      .prepare("SELECT * FROM assignments WHERE id='a'")
      .get()!;
    const proposal = actionProposal(email, {
      ...data,
      assignments: [assignment as never],
    })!;
    assert.equal(proposal.entity_id, "a");
    const payload = JSON.parse(proposal.payload_json);
    assert.equal(payload.proposed.due_date, "2026-09-14");
    const action = {
      ...proposal,
      id: "action",
      status: "Pending",
    } as EmailAction;
    db.prepare(
      "INSERT INTO email_detected_actions(id,email_id,action_type,entity_type,payload_json,confidence) VALUES('action','mail',?,'assignment',?,'High')",
    ).run(proposal.action_type, proposal.payload_json);
    const statements = applyStatements(
      action,
      email,
      payload.proposed,
      payload.expected,
      "a",
      "c",
    );
    batch(db, statements);
    const updated = db.prepare("SELECT * FROM assignments WHERE id='a'").get()!;
    assert.equal(updated.due_date, "2026-09-14");
    assert.equal(updated.due_time, "23:59");
    assert.equal(updated.notes, "Keep my notes");
    assert.throws(() => batch(db, statements), /changed/);
    assert.equal(
      db.prepare("SELECT count(*) n FROM academic_change_log").get()?.n,
      1,
    );
    db.exec("DELETE FROM emails");
    assert.equal(
      db.prepare("SELECT source_email_id FROM academic_change_log").get()
        ?.source_email_id,
      null,
    );
    assert.equal(
      db.prepare("SELECT source_sender FROM academic_change_log").get()
        ?.source_sender,
      email.sender_email,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM assignments").get()?.n, 1);
  } finally {
    db.close();
  }
});
test("stale academic snapshot rolls back proposal state and change log", () => {
  const { db } = fixture();
  try {
    const assignment = db
      .prepare("SELECT * FROM assignments WHERE id='a'")
      .get()!;
    const proposal = actionProposal(email, {
      ...data,
      assignments: [assignment as never],
    })!;
    const payload = JSON.parse(proposal.payload_json);
    const action = {
      ...proposal,
      id: "action",
      status: "Pending",
    } as EmailAction;
    db.prepare(
      "INSERT INTO email_detected_actions(id,email_id,action_type,entity_type,payload_json,confidence) VALUES('action','mail',?,'assignment',?,'High')",
    ).run(proposal.action_type, proposal.payload_json);
    db.exec("UPDATE assignments SET due_date='2026-09-20' WHERE id='a'");
    assert.throws(
      () =>
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
        ),
      /changed/,
    );
    assert.equal(
      db.prepare("SELECT status FROM email_detected_actions").get()?.status,
      "Pending",
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM academic_change_log").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});
test("incremental pages deduplicate messages/notifications and persist cursors atomically", () => {
  const { db } = fixture();
  try {
    const page = {
      value: [
        {
          id: "msg",
          subject: "PHIL210 Exam moved",
          from: { emailAddress: { address: "prof@university.edu" } },
          receivedDateTime: received,
          bodyPreview: "Exam moved to September 17.",
        },
      ],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?token=x",
    };
    const statements = pageStatements(account, page, data, [], []);
    batch(db, statements);
    batch(db, statements);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM emails WHERE provider_message_id='msg'",
        )
        .get()?.n,
      1,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM notifications WHERE type='email'")
        .get()?.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT sync_cursor FROM email_accounts").get()?.sync_cursor,
      page["@odata.deltaLink"],
    );
    assert.throws(
      () => pageStatements(account, { value: [] }, data, [], []),
      /cursor/,
    );
    db.exec("UPDATE email_accounts SET connected=0");
    assert.throws(
      () =>
        batch(
          db,
          pageStatements(
            account,
            { ...page, value: [{ ...page.value[0], id: "new" }] },
            data,
            [],
            [],
          ),
        ),
      /changed/,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM emails WHERE provider_message_id='new'",
        )
        .get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});
test("5000-message cache uses bounded pagination and FTS with literal input", () => {
  const { db } = fixture();
  try {
    db.exec("BEGIN");
    const insert = db.prepare(
      "INSERT INTO emails(id,account_id,provider_message_id,sender_email,subject,body_text,received_at) VALUES(?,'account',?,'sender@example.edu',?,'uniqueSearchToken','2026-09-06T10:00:00Z')",
    );
    for (let i = 0; i < 5000; i++)
      insert.run(`perf${i}`, `perf${i}`, `Message ${i}`);
    db.exec("COMMIT");
    const q = emailListQuery("uniqueSearchToken", "", 4950);
    const rows = db.prepare(q.sql).all(...q.params);
    assert.equal(rows.length, 50);
    const malicious = emailListQuery('" OR *', "", 0);
    assert.doesNotThrow(() =>
      db.prepare(malicious.sql).all(...malicious.params),
    );
  } finally {
    db.close();
  }
});
test("Phase 2 database migration preserves tracked work and reopens at version 6", () => {
  const dir = fs.mkdtempSync(path.resolve(".local/tests/email-upgrade-")),
    filename = path.join(dir, "old.db");
  const old = new DatabaseSync(filename);
  for (const file of [
    "001_initial.sql",
    "002_file_discovery.sql",
    "003_academic_tracking.sql",
  ])
    old.exec(fs.readFileSync(path.resolve("src/db", file), "utf8"));
  old.exec(
    "PRAGMA user_version=3; INSERT INTO tasks(id,title) VALUES('keep','My existing task'); INSERT INTO settings VALUES('interface_scale','125');",
  );
  old.close();
  const db = openDatabase(filename);
  assert.equal(
    db.prepare("SELECT title FROM tasks WHERE id='keep'").get()?.title,
    "My existing task",
  );
  assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 21);
  db.close();
  const reopened = openDatabase(filename);
  assert.equal(
    reopened
      .prepare("SELECT value FROM settings WHERE key='interface_scale'")
      .get()?.value,
    "125",
  );
  reopened.close();
});

