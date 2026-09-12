import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  courseGrade,
  targetGrade,
  semesterGpa,
  letterGrade,
  parseScale,
} from "../src/features/academic/grades";
import {
  generatePlan,
  weekDates,
  courseProgress,
  prepProgress,
  conflicts,
  recommendations,
} from "../src/features/academic/planning";
import {
  recoverTimer,
  elapsedSeconds,
  pauseTimer,
} from "../src/features/academic/timing";
import {
  emptyTracking,
  type TrackRecord,
} from "../src/features/academic/types";
import type { AcademicData } from "../src/types";
import { openDatabase } from "../server/storage";
const row = (id: string, extra: Partial<TrackRecord> = {}): TrackRecord => ({
  id,
  course_id: "c",
  title: id,
  notes: "",
  ...extra,
});
const cats = [
  row("quiz", { name: "Quizzes", weight: 20 }),
  row("final", { name: "Final", weight: 80 }),
];
const items = [
  row("q1", { category_id: "quiz", points_earned: 8, points_possible: 10 }),
  row("q2", { category_id: "quiz", points_earned: null, points_possible: 10 }),
  row("f", { category_id: "final", points_earned: null, points_possible: 100 }),
];
const close = (a: number | null, b: number) =>
  assert.ok(a !== null && Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("weighted partial course reports actual covered share and omits missing scores", () => {
  const r = courseGrade(cats, items);
  close(r.current, 80);
  close(r.gradedWeight, 10);
  close(r.earned, 8);
  assert.equal(r.projected, null);
});
test("zero is a real grade; missing grade is not zero", () => {
  const r = courseGrade(cats, [
    { ...items[0], points_earned: 0 },
    ...items.slice(1),
  ]);
  close(r.current, 0);
  close(r.gradedWeight, 10);
});
test("what-if fills remaining scores without mutating actual data", () => {
  const before = JSON.stringify(items);
  const r = courseGrade(cats, items, { q2: 100, f: 90 });
  close(r.projected, 90);
  close(r.current, 80);
  assert.equal(JSON.stringify(items), before);
});
test("target solver accounts for remaining assessments in a partially graded category", () => {
  const r = courseGrade(cats, items);
  close(targetGrade(r, 90).required ?? null, (82 / 90) * 100);
  assert.match(targetGrade(r, 99).message, /highest final grade is 98.0/);
});
test("excluded items redistribute the component and decimal points remain precise", () => {
  const r = courseGrade(cats, [
    { ...items[0], points_earned: 8.75 },
    { ...items[1], excluded: 1 },
    items[2],
  ]);
  close(r.current, 87.5);
  close(r.gradedWeight, 20);
});
test("relative item override controls share within a component", () => {
  const r = courseGrade(cats, [
    { ...items[0], weight_override: 30 },
    items[1],
    items[2],
  ]);
  close(r.gradedWeight, 15);
});
test("incomplete and overweight course setups cannot produce final projections", () => {
  for (const weight of [70, 95]) {
    const r = courseGrade([cats[0], { ...cats[1], weight }], items, {
      q2: 100,
      f: 100,
    });
    assert.equal(r.projected, null);
    assert.match(targetGrade(r, 90).message, /100%/);
  }
});
test("empty categories and no grades never fabricate current grade", () => {
  const r = courseGrade(cats, []);
  assert.equal(r.current, null);
  close(r.gradedWeight, 0);
  close(courseGrade(cats, [], { quiz: 90, final: 80 }).projected, 82);
});
test("all graded target and already secured target explain edge cases", () => {
  const r = courseGrade(
    [row("x", { weight: 100 })],
    [row("a", { category_id: "x", points_possible: 100, points_earned: 85 })],
  );
  assert.match(targetGrade(r, 80).message, /All work is graded/);
  close(targetGrade(courseGrade(cats, items), 5).required ?? null, 0);
});
test("GPA weights eligible credits, excludes missing grades and zero credits", () => {
  const r = semesterGpa([
    { credits: 3, points: 4 },
    { credits: 4, points: 3.7 },
    { credits: 2, points: 3.3 },
    { credits: 0, points: 0 },
    { credits: 3, points: null },
  ]);
  close(r.value, (12 + 14.8 + 6.6) / 9);
  assert.equal(r.credits, 9);
  assert.equal(semesterGpa([{ credits: 0, points: 4 }]).value, null);
  assert.equal(semesterGpa([]).value, null);
});
test("custom grading boundaries and GPA mappings are respected", () => {
  assert.equal(letterGrade(93)?.letter, "A+");
  assert.equal(letterGrade(87)?.letter, "A");
  assert.equal(letterGrade(79)?.letter, "B+");
  assert.equal(letterGrade(61)?.letter, "D+");
  const scale = parseScale(
    JSON.stringify([
      { letter: "Pass", min: 60, points: 5 },
      { letter: "Fail", min: 0, points: 0 },
    ]),
  );
  assert.equal(letterGrade(65, scale)?.points, 5);
  assert.throws(() => parseScale('[{"letter":"A","min":90,"points":4}]'));
});
test("plan handles today, tomorrow, long horizon and more items than days", () => {
  for (const exam of ["2026-09-06", "2026-09-07", "2026-10-17"]) {
    const plan = generatePlan(
      exam,
      Array.from({ length: 20 }, (_, i) => row(String(i))),
      "2026-09-06",
    );
    assert.equal(plan.length, 21);
    assert.ok(
      plan.every(
        (b) => b.scheduled_date >= "2026-09-06" && b.scheduled_date <= exam,
      ),
    );
    assert.equal(plan.at(-1)?.title, "Full review");
  }
});
test("plan rejects empty and past exams, skips finished items, places practice later", () => {
  assert.throws(
    () => generatePlan("2026-09-05", [row("a")], "2026-09-06"),
    /past/,
  );
  assert.throws(
    () => generatePlan("2026-10-01", [], "2026-09-06"),
    /unfinished/,
  );
  const plan = generatePlan(
    "2026-09-10",
    [
      row("practice", { previous_exam_id: "p" }),
      row("lecture"),
      row("done", { status: "Reviewed" }),
    ],
    "2026-09-06",
  );
  assert.deepEqual(
    plan.map((x) => x.title),
    ["lecture", "practice", "Full review"],
  );
});
test("week dates cross year and DST boundaries without elapsed-hour arithmetic", () => {
  assert.deepEqual(weekDates("2027-01-01"), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
  assert.equal(weekDates("2026-03-29", 0)[6], "2026-04-04");
});
test("timer uses timestamps, survives reload and excludes pauses", () => {
  const t = {
    id: "t",
    course_id: "c",
    title: "Review",
    started_at: "2026-09-06T08:00:00Z",
    running_since: 1000,
    elapsed_ms: 2000,
  };
  assert.equal(elapsedSeconds(t, 61000), 62);
  const paused = pauseTimer(t, 61000);
  assert.equal(elapsedSeconds(paused, 9999999), 62);
  assert.deepEqual(recoverTimer(JSON.stringify(paused)), paused);
  assert.throws(() => recoverTimer("{broken"));
  assert.throws(() => recoverTimer(JSON.stringify({ ...t, elapsed_ms: -1 })));
});
const academic: AcademicData = {
  semesters: [],
  courses: [],
  schedules: [],
  exams: [],
  assignments: [],
  events: [],
};
test("progress is completion-based, empty preparation remains unset", () => {
  assert.equal(prepProgress([]).percentage, null);
  assert.equal(courseProgress(academic, emptyTracking, "c").percentage, null);
  const p = {
    ...emptyTracking,
    lectures: [
      row("l", { status: "Reviewed" }),
      row("l2", { status: "Not reviewed" }),
    ],
  };
  close(courseProgress(academic, p, "c").percentage, 50);
});
test("deadline clusters and manual priority recommendations explain their reason", () => {
  const data = {
    ...academic,
    exams: [
      {
        id: "e1",
        course_id: "c",
        title: "Exam",
        date: "2026-09-07",
        start_time: "10:00",
      },
      {
        id: "e2",
        course_id: "c",
        title: "Exam 2",
        date: "2026-09-08",
        start_time: "09:00",
      },
    ],
  } as AcademicData;
  assert.equal(conflicts(data, "2026-09-06").length, 1);
  const p = {
    ...emptyTracking,
    exam_topics: [row("topic", { exam_id: "e1", status: "Not started" })],
  };
  assert.match(recommendations(data, p, "2026-09-06")[0].reason, /in 1 day/);
});
test("actual Phase 1 schema upgrades transactionally and preserves records, file references, and Phase 2 data after reopen", () => {
  const dir = path.resolve(".local/tests/phase2", crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, "upgrade.db");
  let db = new DatabaseSync(filename);
  db.exec(fs.readFileSync("src/db/001_initial.sql", "utf8"));
  db.exec(fs.readFileSync("src/db/002_file_discovery.sql", "utf8"));
  db.exec(
    "PRAGMA user_version=2; INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31','root'); INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL','Ethics','root/c'); INSERT INTO tasks(id,course_id,title) VALUES('task','c','Keep me'); INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at) VALUES('file','c','s','notes.pdf','notes.pdf','Lectures','root/c/notes.pdf','pdf',10,'2026-09-01','2026-09-01');",
  );
  db.close();
  db = openDatabase(filename);
  assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 21);
  assert.equal(db.prepare("SELECT title FROM tasks").get()?.title, "Keep me");
  assert.equal(
    db.prepare("SELECT absolute_path FROM files").get()?.absolute_path,
    "root/c/notes.pdf",
  );
  db.exec(
    "INSERT INTO lectures(id,course_id,title) VALUES('l','c','Lecture'); INSERT INTO lecture_files VALUES('l','file'); INSERT INTO study_sessions(id,course_id,lecture_id,task_id,title,started_at,ended_at,duration_seconds) VALUES('ss','c','l','task','Study','2026-09-06T09:00:00Z','2026-09-06T10:00:00Z',3600); DELETE FROM tasks WHERE id='task';",
  );
  assert.equal(
    db.prepare("SELECT task_id FROM study_sessions").get()?.task_id,
    null,
  );
  assert.throws(() =>
    db.exec(
      "INSERT INTO study_blocks(id,course_id,title,scheduled_date,start_time) VALUES('bad','c','Bad','2026-09-06','25:00')",
    ),
  );
  db.close();
  db = openDatabase(filename);
  assert.equal(
    db.prepare("SELECT duration_seconds FROM study_sessions").get()
      ?.duration_seconds,
    3600,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test('full review is scheduled immediately before a future exam even with one topic',()=>{assert.equal(generatePlan('2026-10-17',[row('topic')],'2026-09-06').at(-1)?.scheduled_date,'2026-10-16');});

