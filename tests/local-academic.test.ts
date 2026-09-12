import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase, batch } from "../server/storage";
import {
  emptyDegree,
  newCourse,
  newGroup,
  newRequirement,
  uid,
  normalizeTerm,
  code,
  type DegreeState,
} from "../src/features/degree/types";
import {
  degreeProgress,
  requirementProgress,
  groupProgress,
  graduationPlan,
  prerequisiteWarnings,
  degreeGpa,
  targetGpa,
} from "../src/features/degree/engine";
import {
  degreeSaveStatements,
  mergeEvaluation,
  mergeDetectedCourses,
  matchCourses,
} from "../src/features/degree/repository";
import { evaluationParser } from "../src/features/degree/parser";
import {
  syllabusParser,
  parseDate,
  parseDays,
  parseTimes,
  gradingWarnings,
} from "../src/features/syllabus/parser";
import {
  candidateValues,
  syllabusStatements,
  officeHoursOccurrences,
  officeHoursCalendarStatements,
  type SyllabusReview,
} from "../src/features/syllabus/repository";
import type { ExtractedDocument } from "../src/features/documents/localImport";
import type { SqlValue } from "../src/types";
import { syncPlannedHistory } from "../src/features/degree/plannedHistory";
const doc = (text: string): ExtractedDocument => ({
  filename: "example.txt",
  text,
  hash: "test",
  path: "",
});
const fixture = (name: string) =>
  doc(fs.readFileSync(path.resolve("tests/fixtures", name), "utf8"));
test("multiline alternatives remain one requirement without invented in-progress attempts", () => {
  const s = evaluationParser.parse(
    doc(
      "Program: Example\nArea: Core Requirements\nOne of:\nCMPS 211\nMATH 211\n",
    ),
  ).state;
  assert.equal(s.requirements.length, 1);
  assert.equal(s.requirements[0].kind, "one_of");
  assert.equal(s.options.length, 2);
  assert.equal(s.courses.length, 0);
});
test("planned history synchronizes edits without duplicate course attempts", () => {
  const s = degree();
  s.courses = [];
  s.plans = graduationPlan(s, ["Fall 2026"], 18).plans;
  const next = syncPlannedHistory(s);
  assert.equal(next.courses.length, 1);
  assert.equal(next.courses[0].status, "planned");
  assert.equal(syncPlannedHistory(next).courses.length, 1);
  next.plans[0].term = "Spring 2027";
  assert.equal(syncPlannedHistory(next).courses[0].term, "Spring 2027");
  next.plans = [];
  assert.equal(syncPlannedHistory(next).courses.length, 0);
});
function degree() {
  const s = emptyDegree();
  s.program.total_credits = 120;
  const g = newGroup(s.program.id);
  s.groups.push(g);
  const r = { ...newRequirement(g.id), name: "CS 101" };
  s.requirements.push(r);
  s.options.push({
    id: uid(),
    requirement_id: r.id,
    subject: "CS",
    number: "101",
  });
  s.courses.push({
    ...newCourse(s.program.id),
    subject: "CS",
    number: "101",
    grade: "A",
    term: "Fall 2025",
  });
  return s;
}
test("degree credit, overlapping groups, repeated attempts and failed courses", () => {
  const s = degree();
  s.courses.push({
    ...s.courses[0],
    id: uid(),
    status: "failed",
    grade: "F",
    term: "Spring 2025",
  });
  assert.equal(degreeProgress(s).credits, 3);
  assert.equal(requirementProgress(s, s.requirements[0]).complete, true);
  s.courses[0].status = "failed";
  s.courses[0].grade = "F";
  assert.equal(degreeProgress(s).credits, 0);
  assert.equal(requirementProgress(s, s.requirements[0]).complete, false);
});
test("in-progress counts only as expected, plans never inflate earned credit", () => {
  const s = degree();
  s.courses[0].status = "in_progress";
  s.courses[0].grade = "";
  assert.equal(degreeProgress(s).credits, 0);
  assert.equal(degreeProgress(s).expectedCredits, 3);
  assert.equal(requirementProgress(s, s.requirements[0]).complete, false);
  assert.equal(requirementProgress(s, s.requirements[0], true).complete, true);
  s.courses[0].status = "planned";
  assert.equal(degreeProgress(s).expectedCredits, 0);
});
test("one-of, choose-N, elective allocations and minimum grade", () => {
  const s = degree(),
    r = s.requirements[0];
  r.kind = "one_of";
  s.options.push({
    id: uid(),
    requirement_id: r.id,
    subject: "MATH",
    number: "101",
  });
  assert.equal(requirementProgress(s, r).complete, true);
  r.kind = "choose_n";
  r.count_required = 2;
  assert.equal(requirementProgress(s, r).complete, false);
  r.kind = "elective";
  assert.equal(requirementProgress(s, r).complete, false);
  s.allocations.push({ requirement_id: r.id, course_id: s.courses[0].id });
  assert.equal(requirementProgress(s, r).complete, true);
  r.minimum_grade = 70;
  assert.equal(requirementProgress(s, r).complete, false);
  s.courses[0].grade = "80";
  assert.equal(requirementProgress(s, r).complete, true);
});
test("nested groups deduplicate the same course and respect child requirements", () => {
  const s = degree(),
    parent = newGroup(s.program.id, "Parent");
  parent.credits_required = 3;
  s.groups.push(parent);
  s.groups[0].parent_id = parent.id;
  assert.equal(groupProgress(s, parent.id).credits, 3);
  assert.equal(groupProgress(s, parent.id).complete, true);
  s.groups[0].parent_id = s.groups[0].id;
  assert.throws(() => degreeSaveStatements(s, null), /cycle/);
});
test("manual, attribute and level requirements", () => {
  const s = degree(),
    r = s.requirements[0];
  r.kind = "manual";
  assert.equal(requirementProgress(s, r).complete, false);
  r.manual_complete = 1;
  assert.equal(requirementProgress(s, r).complete, true);
  r.kind = "attribute";
  r.attribute = "writing";
  s.courses[0].attributes = "writing, arts";
  assert.equal(requirementProgress(s, r).complete, true);
  r.kind = "level";
  r.minimum_level = 200;
  assert.equal(requirementProgress(s, r).complete, false);
  r.minimum_level = 100;
  assert.equal(requirementProgress(s, r).complete, true);
});
test("pass grades give credits without GPA, custom scales and target projection", () => {
  const s = degree();
  assert.equal(degreeGpa(s).value, 4);
  s.courses[0].status = "transferred";
  s.courses[0].grade = "P";
  assert.equal(degreeGpa(s).value, null);
  assert.equal(degreeProgress(s).credits, 3);
  s.courses[0].status = "planned";
  assert.equal(degreeGpa(s, undefined, { [s.courses[0].id]: 3 }).value, 3);
  assert.deepEqual(targetGpa(3, 90, 30, 3.2, 4), {
    required: 3.8,
    reachable: true,
  });
  assert.equal(targetGpa(2, 110, 10, 3.5, 4).reachable, false);
  assert.equal(targetGpa(3, 120, 0, 3, 4).required, null);
});
test("planner preserves placements and schedules prerequisites earlier", () => {
  const s = degree();
  s.courses = [];
  const second = { ...newRequirement(s.groups[0].id), name: "CS 102" };
  s.requirements.push(second);
  s.options.push({
    id: uid(),
    requirement_id: second.id,
    subject: "CS",
    number: "102",
  });
  s.prerequisites.push({
    id: uid(),
    program_id: s.program.id,
    subject: "CS",
    number: "102",
    prerequisite_subject: "CS",
    prerequisite_number: "101",
    relation: "all",
  });
  const plan = graduationPlan(s, ["Fall 2026", "Spring 2027"], 3);
  assert.equal(plan.unscheduled.length, 0);
  assert.equal(plan.plans.find((p) => p.number === "101")?.term, "Fall 2026");
  assert.equal(plan.plans.find((p) => p.number === "102")?.term, "Spring 2027");
  assert.equal(prerequisiteWarnings(s, plan.plans).length, 0);
  const invalid = plan.plans.map((p) => ({ ...p, term: "Fall 2026" }));
  assert.equal(prerequisiteWarnings(s, invalid).length, 1);
  assert.equal(
    graduationPlan({ ...s, plans: plan.plans }, ["Fall 2026"], 3).plans.length,
    2,
  );
  assert.equal(graduationPlan(s, ["Fall 2026"], 3).unscheduled.length, 1);
});
test("ANY prerequisites, cycles and capacity remain unscheduled", () => {
  const s = degree();
  s.courses = [];
  s.prerequisites.push({
    id: uid(),
    program_id: s.program.id,
    subject: "CS",
    number: "101",
    prerequisite_subject: "CS",
    prerequisite_number: "102",
    relation: "any",
  });
  assert.equal(graduationPlan(s, ["Fall 2026"], 18).unscheduled.length, 1);
  s.courses.push({
    ...newCourse(s.program.id),
    subject: "CS",
    number: "102",
    grade: "A",
    term: "Spring 2026",
  });
  assert.equal(graduationPlan(s, ["Fall 2026"], 18).unscheduled.length, 0);
  assert.throws(() => graduationPlan(s, ["Fall 2026"], 0));
});
test("synthetic degree example preserves stated metadata and separates unused attempts", () => {
  const { state: s } = evaluationParser.parse(
    fixture("degree-evaluation-example.txt"),
  );
  assert.equal(s.program.name, "Bachelor in Computer Science");
  assert.equal(s.program.degree_type, "Bachelor of Science");
  assert.equal(s.program.total_credits, 120);
  assert.equal(s.program.reported_used_credits, 102);
  assert.equal(s.program.reported_gpa, 3.06);
  const major = s.groups.find((g) => g.name === "Major Req. Cmps")!;
  assert.equal(major.credits_required, 42);
  assert.equal(major.reported_used_credits, 33);
  for (const name of [
    "Arabic Communication Skills",
    "CMPS Required",
    "CMPS GE Requirements",
  ])
    assert.ok(s.groups.some((g) => g.name === name));
  for (const num of ["215", "243", "262", "218", "200B", "210"])
    assert.ok(
      s.courses.some((c) => c.number === num && c.status === "in_progress"),
    );
  assert.equal(
    s.courses.filter((c) => c.number === "201" && c.subject === "CMPS").length,
    1,
  );
  assert.ok(s.courses.some((c) => c.grade === "F" && c.excluded));
  assert.equal(degreeProgress(s).credits, 9);
});
test("real AUB degree evaluation fixture: fused term codes, two-column headers, double-counted areas and one-of alternatives", () => {
  const { state: s } = evaluationParser.parse(
    fixture("degree-evaluation-aub-real.txt"),
  );
  assert.equal(s.program.name, "Bachelor in Computer Science");
  assert.equal(s.program.degree_type, "Bachelor of Science");
  assert.equal(s.program.major, "Computer Science");
  assert.equal(s.program.catalog_term, "Fall 2024-2025");
  assert.equal(s.program.total_credits, 120);
  assert.equal(s.program.reported_used_credits, 102);
  assert.equal(s.program.reported_gpa, 3.06);
  assert.equal(s.program.minimum_gpa, 2.3);
  const byName = (name: string) => s.groups.find((g) => g.name === name)!;
  const major = byName("Major Req. Cmps");
  assert.equal(major.credits_required, 42);
  assert.equal(major.reported_used_credits, 33);
  assert.equal(major.reported_gpa, 2.83);
  for (const name of [
    "Arabic Communication Skills",
    "CMPS Required",
    "CMPS GE Requirements",
    "30 Crs Freshman/Bacc",
    "English Placement/Arabic Exemption",
    "50 cr.with a grade of 70&above",
  ])
    assert.ok(s.groups.some((g) => g.name === name), `missing group ${name}`);
  assert.equal(byName("CMPS Required").credits_required, 12);
  assert.equal(byName("CMPS Required").reported_used_credits, 9);
  assert.equal(byName("CMPS GE Requirements").credits_required, 33);
  assert.equal(byName("CMPS GE Requirements").reported_used_credits, 30);
  // A requirement group that only double-counts courses satisfied elsewhere
  // contributes no additional credits of its own.
  assert.equal(byName("History of Ideas").contributes_credits, 0);
  assert.equal(byName("Social Inequalities").contributes_credits, 0);
  assert.equal(major.contributes_credits, 1);
  for (const num of ["215", "243", "262", "218", "200B", "210"])
    assert.ok(
      s.courses.some((c) => c.number === num && c.status === "in_progress"),
      `expected ${num} in progress`,
    );
  // "Courses Not Used" attempts are parsed separately from completed/in-progress
  // attempts of the same course, never merged into them.
  const cmps201 = s.courses.filter((c) => code(c.subject, c.number) === "CMPS 201");
  assert.equal(cmps201.length, 2);
  assert.ok(cmps201.some((c) => c.status === "completed" && c.grade === "C+" && !c.excluded));
  assert.ok(cmps201.some((c) => c.status === "failed" && c.grade === "F" && c.excluded));
  const math218 = s.courses.filter((c) => code(c.subject, c.number) === "MATH 218");
  assert.equal(math218.length, 2);
  assert.ok(math218.some((c) => c.status === "in_progress" && !c.excluded));
  assert.ok(math218.some((c) => c.status === "failed" && c.excluded));
  // A resolved "One of" keeps its own alternatives distinct from an unrelated
  // requirement that happens to follow it in the table.
  const cmpsRequired = s.requirements.filter((r) => r.group_id === byName("CMPS Required").id);
  const mathCmps211 = cmpsRequired.find((r) =>
    s.options.some(
      (o) => r.id === o.requirement_id && code(o.subject, o.number) === "CMPS 211",
    ),
  )!;
  assert.equal(mathCmps211.kind, "one_of");
  assert.equal(
    s.options.filter((o) => o.requirement_id === mathCmps211.id).length,
    2,
  );
  assert.ok(
    cmpsRequired.some(
      (r) =>
        r.id !== mathCmps211.id &&
        s.options.some(
          (o) => r.id === o.requirement_id && code(o.subject, o.number) === "MATH 201",
        ),
    ),
    "MATH 201 must not be folded into the earlier one-of alternative",
  );
  assert.ok(
    !s.courses.some((c) => code(c.subject, c.number) === "STAT 233"),
    "an unresolved one-of alternative must not become a phantom course",
  );
  // The elective-bucket requirement ("CMPS ELEC. 18 crs CMPS Elective") is parsed
  // out of the Major group's course table with its own credit total, not treated
  // as a separate top-level area.
  const elective = s.requirements.find(
    (r) => r.group_id === major.id && r.kind === "course_set",
  )!;
  assert.equal(elective.credits_required, 18);
  assert.equal(
    s.options.filter((o) => o.requirement_id === elective.id).length,
    3,
  );
  // Restricted-subject noise rows ("AVSC 279 None 0 0") must never be recorded as courses.
  assert.ok(!s.courses.some((c) => c.subject === "AVSC" || c.subject === "NFSC"));
  // The engine's own "expected" (actual + in-progress) rollup for each group matches
  // the audit's own reported used-credit snapshot, cross-checking the parse end to end.
  assert.equal(groupProgress(s, major.id, true).credits, 33);
  assert.equal(groupProgress(s, byName("CMPS GE Requirements").id, true).credits, 30);
  assert.equal(
    groupProgress(s, byName("50 cr.with a grade of 70&above").id, true).credits,
    51,
  );
  assert.equal(degreeProgress(s).expectedCredits, 102);
});
test("degree duplicate merge, matching and stable update identities", () => {
  const s = degree(),
    copy = structuredClone(s.courses[0]);
  copy.id = uid();
  s.courses.push(copy);
  assert.equal(mergeDetectedCourses(s).courses.length, 1);
  assert.throws(() => degreeSaveStatements(s, null), /Duplicate attempt/);
  s.courses.pop();
  matchCourses(s, [
    { id: "workspace", code: "CS101", name: "Computing", term: "Fall 2025" },
  ]);
  assert.equal(s.courses[0].course_id, "workspace");
  const newer = degree();
  newer.courses[0].grade = "B";
  const merged = mergeEvaluation(s, newer);
  assert.equal(merged.state.courses[0].id, s.courses[0].id);
  assert.equal(merged.state.requirements[0].id, s.requirements[0].id);
  assert.ok(merged.changes.some((c) => c.startsWith("~")));
  assert.equal(normalizeTerm("Spring 2024-2025"), "Spring 2025");
});
test("SQLite degree import rolls back, optimistic updates and migration persistence", () => {
  const dir = path.resolve(".local/tests", uid());
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, "degree.db");
  let db = openDatabase(filename);
  const s = degree();
  batch(db, degreeSaveStatements(s, null));
  assert.equal(db.prepare("SELECT count(*) n FROM degree_courses").get()!.n, 1);
  const old = structuredClone(s),
    next = structuredClone(s);
  next.program.name = "Updated";
  batch(db, degreeSaveStatements(next, old));
  assert.throws(() => batch(db, degreeSaveStatements(next, old)), /changed/);
  const invalid = degree();
  invalid.options[0].requirement_id = "missing";
  assert.throws(() => batch(db, degreeSaveStatements(invalid, null)));
  assert.equal(
    db.prepare("SELECT count(*) n FROM degree_programs").get()!.n,
    1,
  );
  db.close();
  db = openDatabase(filename);
  assert.equal(
    db.prepare("SELECT name FROM degree_programs").get()!.name,
    "Updated",
  );
  assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 21);
  db.close();
});
for (const [input, expected] of [
  ["October 14, 2026", "2026-10-14"],
  ["Oct. 14", "2026-10-14"],
  ["14 October", "2026-10-14"],
  ["10/14/2026", "2026-10-14"],
  ["14/10/2026", "2026-10-14"],
  ["2026-10-14", "2026-10-14"],
])
  test(`date ${input}`, () =>
    assert.equal(parseDate(input, 2026).value, expected));
test("ambiguous, multiple, missing-year and invalid dates stay unresolved", () => {
  assert.match(parseDate("10/11/2026").warning!, /Ambiguous/);
  assert.equal(parseDate("October 14").value, "");
  assert.equal(parseDate("February 30, 2026").value, "");
  assert.match(parseDate("Oct 14 and Nov 18", 2026).warning!, /Multiple/);
});
for (const input of ["CMPS 215", "CMPS215", "Course Code: CMPS 215"])
  test(`course code ${input}`, () =>
    assert.equal(
      syllabusParser.parse(doc(input)).items[0].fields.code,
      "CMPS 215",
    ));
for (const [input, days] of [
  ["MWF", [1, 3, 5]],
  ["TR", [2, 4]],
  ["TTh", [2, 4]],
  ["Tue/Thu", [2, 4]],
  ["Tuesday and Thursday", [2, 4]],
] as const)
  test(`days ${input}`, () => assert.deepEqual(parseDays(input), days));
test("schedule times and random weekday letters", () => {
  assert.deepEqual(parseTimes("12:30 PM - 1:45 PM"), {
    start: "12:30",
    end: "13:45",
  });
  assert.deepEqual(parseTimes("12:30-13:45"), { start: "12:30", end: "13:45" });
  assert.deepEqual(parseTimes("2:00-3:00 PM"), {
    start: "14:00",
    end: "15:00",
  });
  assert.deepEqual(parseDays("random letters"), []);
  assert.equal(parseTimes("25:00-26:00"), null);
});
test("syllabus sections, grading weights, office hours and policy exclusions", () => {
  const parsed = syllabusParser.parse(fixture("syllabus-local.txt"));
  assert.equal(parsed.items.filter((i) => i.kind === "schedule").length, 2);
  assert.equal(parsed.items.filter((i) => i.kind === "grade").length, 4);
  assert.equal(gradingWarnings(parsed.items).length, 0);
  assert.equal(
    parsed.items.find((i) => i.kind === "instructor")!.fields.office_hours,
    "MW 2:00-3:00 PM, Building 304",
  );
  assert.equal(parsed.items.filter((i) => i.kind === "exam").length, 2);
  assert.equal(
    parsed.items.find((i) => i.title === "Homework 1")!.selected,
    false,
  );
  assert.ok(!parsed.items.some((i) => /revision|Missing 20%/.test(i.title)));
  const officeHours = parsed.items.filter((i) => i.kind === "office_hours");
  assert.equal(officeHours.length, 2);
  assert.deepEqual(
    officeHours.map((o) => o.fields.day_of_week).sort(),
    ["1", "3"],
  );
  for (const o of officeHours) {
    assert.equal(o.fields.start_time, "14:00");
    assert.equal(o.fields.end_time, "15:00");
    assert.equal(o.fields.location, "Building 304");
  }
  const policies = parsed.items.filter((i) => i.kind === "policy");
  assert.equal(policies.length, 1);
  assert.equal(policies[0].title, "Attendance");
  assert.match(policies[0].fields.text, /Missing 20% of classes/);
});
test("description, objectives, materials and multiple policy categories are captured verbatim", () => {
  const parsed = syllabusParser.parse(
    doc(
      [
        "PHIL 210 - Ethics",
        "Fall 2026",
        "Course Description",
        "This course surveys major ethical theories and their application to contemporary moral problems.",
        "Learning Outcomes",
        "- Identify major ethical frameworks",
        "- Apply theories to case studies",
        "Required Text",
        "James Rachels, The Elements of Moral Philosophy",
        "Other Readings",
        "Provided on Moodle",
        "Attendance Policy",
        "Missing more than 3 classes results in a grade reduction.",
        "Late Work Policy",
        "Late submissions lose 10% per day.",
        "Academic Integrity",
        "All work must be your own.",
      ].join("\n"),
    ),
  );
  const info = parsed.items.find((i) => i.kind === "info");
  assert.ok(info);
  assert.match(
    info!.fields.description,
    /surveys major ethical theories/,
  );
  assert.match(info!.fields.objectives, /Identify major ethical frameworks/);
  assert.match(info!.fields.objectives, /Apply theories to case studies/);
  const materials = parsed.items.filter((i) => i.kind === "material");
  assert.equal(materials.length, 2);
  assert.equal(materials[0].title, "Required Text");
  assert.equal(materials[0].fields.kind, "textbook");
  assert.match(materials[0].fields.detail, /Elements of Moral Philosophy/);
  assert.equal(materials[1].title, "Other Readings");
  assert.equal(materials[1].fields.kind, "reading");
  assert.match(materials[1].fields.detail, /Provided on Moodle/);
  const policies = parsed.items.filter((i) => i.kind === "policy");
  assert.equal(policies.length, 3);
  assert.deepEqual(
    policies.map((p) => p.title).sort(),
    ["Academic integrity", "Attendance", "Late work"],
  );
  assert.match(
    policies.find((p) => p.title === "Attendance")!.fields.text,
    /grade reduction/,
  );
});
test("office hours by appointment are captured as a note without a day or time", () => {
  const parsed = syllabusParser.parse(
    doc("Office Hours: By appointment only, email to schedule"),
  );
  const officeHours = parsed.items.filter((i) => i.kind === "office_hours");
  assert.equal(officeHours.length, 1);
  assert.equal("day_of_week" in officeHours[0].fields, false);
  assert.match(officeHours[0].fields.note, /appointment/);
});
test("grading sum and duplicate warnings do not normalize percentages", () => {
  const parsed = syllabusParser.parse(
    doc("Grading\nMidterm 30%\nFinal 60%\nMidterm 20%"),
  );
  assert.ok(gradingWarnings(parsed.items).some((w) => w.includes("110")));
  assert.ok(gradingWarnings(parsed.items).some((w) => w.includes("Duplicate")));
});
test("selected invalid syllabus values cannot be saved", () => {
  const item = syllabusParser.parse(doc("Midterm: 10/11/2026")).items[0];
  assert.throws(() => candidateValues(item), /date/);
  item.fields.date = "2026-10-11";
  assert.equal(candidateValues(item).date, "2026-10-11");
  item.fields.date = "2026-02-30";
  assert.throws(() => candidateValues(item), /date/);
});
test("syllabus atomic import, source metadata, duplicate guard and stale conflicts", () => {
  const dir = path.resolve(".local/tests", uid());
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "syllabus.db"));
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall 2026','2026-08-01','2026-12-31','dir');INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','CS101','Intro','folder')",
  );
  const document = doc("Midterm: October 14, 2026"),
    item = syllabusParser.parse(document).items[0];
  const row: SyllabusReview = {
    item,
    table: "exams",
    values: candidateValues(item),
    existing: null,
    matches: [],
    same: false,
    error: "",
    choice: "keep",
  };
  batch(db, syllabusStatements("c", document, [row], "merge", []));
  assert.equal(db.prepare("SELECT count(*) n FROM exams").get()!.n, 1);
  assert.equal(
    db.prepare("SELECT count(*) n FROM local_import_records").get()!.n,
    1,
  );
  assert.throws(
    () => batch(db, syllabusStatements("c", document, [row], "merge", [])),
    /changed/,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM local_import_sources").get()!.n,
    1,
  );
  const existing = db.prepare("SELECT * FROM exams").get()!;
  row.existing = existing as SyllabusReview["existing"];
  row.matches = [row.existing!];
  row.choice = "update";
  row.item.fields.date = "2026-10-15";
  db.exec("UPDATE exams SET date='2026-10-16'");
  assert.throws(
    () => batch(db, syllabusStatements("c", document, [row], "merge", [])),
    /changed/,
  );
  assert.equal(db.prepare("SELECT date FROM exams").get()!.date, "2026-10-16");
  db.close();
});
const syllabusTables: Record<string, string> = {
  course: "courses",
  instructor: "professors",
  schedule: "course_schedules",
  grade: "grade_categories",
  exam: "exams",
  assignment: "assignments",
  info: "course_syllabus",
  policy: "course_syllabus_policy",
  material: "course_syllabus_material",
  office_hours: "course_syllabus_office_hours",
};
function syllabusRow(
  item: ReturnType<typeof syllabusParser.parse>["items"][number],
): SyllabusReview {
  return {
    item,
    table: syllabusTables[item.kind],
    values: candidateValues(item),
    existing: null,
    matches: [],
    same: false,
    error: "",
    choice: "keep",
  };
}
test("course syllabus page data (description, policies, materials, office hours) persists without duplicating on reimport", () => {
  const dir = path.resolve(".local/tests", uid());
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "syllabus-page.db"));
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall 2026','2026-08-01','2026-12-31','dir');INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL210','Ethics','folder')",
  );
  const document = doc(
    [
      "Course Description",
      "This course surveys major ethical theories.",
      "Attendance Policy",
      "Missing classes affects your grade.",
      "Required Text",
      "James Rachels, The Elements of Moral Philosophy",
      "Office Hours: MW 2:00-3:00 PM, Building 304",
    ].join("\n"),
  );
  const parsed = syllabusParser.parse(document);
  const info = parsed.items.find((i) => i.kind === "info")!,
    policy = parsed.items.find((i) => i.kind === "policy")!,
    material = parsed.items.find((i) => i.kind === "material")!,
    officeHours = parsed.items.filter((i) => i.kind === "office_hours");
  assert.equal(officeHours.length, 2);
  const rows = [info, policy, material, ...officeHours].map(syllabusRow);
  batch(db, syllabusStatements("c", document, rows, "merge", []));
  assert.equal(db.prepare("SELECT count(*) n FROM course_syllabus").get()!.n, 1);
  assert.equal(
    db.prepare("SELECT description FROM course_syllabus").get()!.description,
    "This course surveys major ethical theories.",
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_policy").get()!.n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_material").get()!.n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_office_hours").get()!
      .n,
    2,
  );
  // Reimporting the same parsed syllabus must update in place, not duplicate.
  const existingInfo = db.prepare("SELECT * FROM course_syllabus").get()!,
    existingPolicy = db
      .prepare("SELECT * FROM course_syllabus_policy")
      .get()!,
    existingMaterial = db
      .prepare("SELECT * FROM course_syllabus_material")
      .get()!,
    existingHours = db
      .prepare("SELECT * FROM course_syllabus_office_hours")
      .all() as Record<string, unknown>[];
  const asRow = (r: unknown) => r as Record<string, SqlValue>;
  const reimportRows = [
    {
      ...syllabusRow(info),
      existing: asRow(existingInfo),
      matches: [asRow(existingInfo)],
      choice: "update" as const,
    },
    {
      ...syllabusRow(policy),
      existing: asRow(existingPolicy),
      matches: [asRow(existingPolicy)],
      choice: "update" as const,
    },
    {
      ...syllabusRow(material),
      existing: asRow(existingMaterial),
      matches: [asRow(existingMaterial)],
      choice: "update" as const,
    },
    ...officeHours.map((o, i) => ({
      ...syllabusRow(o),
      existing: asRow(existingHours[i]),
      matches: [asRow(existingHours[i])],
      choice: "update" as const,
    })),
  ];
  batch(db, syllabusStatements("c", document, reimportRows, "merge", []));
  assert.equal(db.prepare("SELECT count(*) n FROM course_syllabus").get()!.n, 1);
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_policy").get()!.n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_material").get()!.n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM course_syllabus_office_hours").get()!
      .n,
    2,
  );
  db.close();
});
test("course_syllabus row (and its source file link) is created even when no description/objectives section is detected", () => {
  const dir = path.resolve(".local/tests", uid());
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "syllabus-no-info.db"));
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall 2026','2026-08-01','2026-12-31','dir');INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','CMPS215','Theory','folder')",
  );
  const document = doc("Midterm: October 14, 2026");
  const item = syllabusParser.parse(document).items[0];
  assert.equal(item.kind, "exam");
  const rows = [syllabusRow(item)];
  batch(db, syllabusStatements("c", document, rows, "merge", []));
  const row = db.prepare("SELECT * FROM course_syllabus WHERE course_id='c'").get() as
    | { source_filename: string; description: string }
    | undefined;
  assert.ok(row, "course_syllabus row should always be created on import");
  assert.equal(row!.source_filename, "example.txt");
  assert.equal(row!.description, "");
});
test("office hours expand into one dated calendar occurrence per matching weekday and stay idempotent", () => {
  const occurrences = officeHoursOccurrences(
    [{ day_of_week: 1, start_time: "14:00", end_time: "15:00" }],
    "2026-08-01",
    "2026-08-31",
  );
  assert.equal(occurrences.length, 5);
  assert.equal(occurrences[0].start, "2026-08-03T14:00");
  const dir = path.resolve(".local/tests", uid());
  fs.mkdirSync(dir, { recursive: true });
  const db = openDatabase(path.join(dir, "office-hours.db"));
  db.exec(
    "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall 2026','2026-08-01','2026-08-31','dir');INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL210','Ethics','folder')",
  );
  const rows = [{ day_of_week: 1, start_time: "14:00", end_time: "15:00" }];
  batch(
    db,
    officeHoursCalendarStatements("c", rows, "2026-08-01", "2026-08-31", "note"),
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM calendar_events WHERE course_id='c' AND title='Office hours'",
      )
      .get()!.n,
    5,
  );
  batch(
    db,
    officeHoursCalendarStatements("c", rows, "2026-08-01", "2026-08-31", "note"),
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM calendar_events WHERE course_id='c' AND title='Office hours'",
      )
      .get()!.n,
    5,
  );
  db.close();
});
