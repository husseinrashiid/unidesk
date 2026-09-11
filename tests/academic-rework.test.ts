import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluationParser } from "../src/features/degree/parser";
import {
  applyCatalogue,
  catalogueGroups,
  coreCourses,
  requirementRows,
} from "../src/features/degree/catalogue";
import {
  degreeProgress,
  requirementProgress,
  prerequisiteWarnings,
  graduationPlan,
} from "../src/features/degree/engine";
import {
  mergeEvaluation,
  degreeSaveStatements,
} from "../src/features/degree/repository";
import { code } from "../src/features/degree/types";
import { syllabusParser, parseTimes } from "../src/features/syllabus/parser";
import { representativeSyllabus, pdfFixture } from "./document-fixtures";
import { openDatabase, batch } from "../server/storage";
const raw = fs.readFileSync(
  "tests/fixtures/degree-evaluation-pdf-raw.txt",
  "utf8",
);
const parse = () =>
  evaluationParser.parse({
    text: raw,
    filename: "Degree evaluation record.pdf",
    path: "",
    hash: "fixture",
  }).state;
test("actual evaluation PDF extraction: program, 10 areas, canonical 36 used records, 6 current and 3 failed attempts", () => {
  const s = parse(),
    p = degreeProgress(s);
  assert.equal(s.program.name, "Bachelor in Computer Science");
  assert.equal(s.program.degree_type, "Bachelor of Science");
  assert.equal(s.program.major, "Computer Science");
  assert.equal(s.program.catalog_term, "Fall 2024-2025");
  assert.equal(s.program.evaluation_term, "Fall 2026-2027");
  assert.equal(s.program.reported_gpa, 3.06);
  assert.equal(s.program.minimum_gpa, 2.3);
  assert.equal(s.groups.length, 10);
  assert.equal(s.courses.length, 39);
  assert.equal(p.credits, 85);
  assert.equal(p.inProgressCredits, 17);
  assert.equal(p.expectedCredits, 102);
  assert.equal(p.auditUsedCredits, 102);
  assert.equal(p.projectedRemaining, 18);
  assert.deepEqual(
    s.courses
      .filter((c) => c.status === "in_progress")
      .map((c) => code(c.subject, c.number))
      .sort(),
    ["CMPS 215", "CMPS 243", "CMPS 262", "MATH 218", "PHIL 200B", "PHIL 210"],
  );
  assert.deepEqual(
    s.courses
      .filter((c) => c.excluded)
      .map((c) => code(c.subject, c.number))
      .sort(),
    ["CMPS 201", "CMPS 214", "MATH 218"],
  );
  for (const [name, required, used] of [
    ["Major Req. Cmps", 42, 33],
    ["CMPS Required", 12, 9],
    ["CMPS GE Requirements", 33, 30],
  ] as const) {
    const g = s.groups.find((g) => g.name === name)!;
    assert.equal(g.credits_required, required);
    assert.equal(g.reported_used_credits, used);
  }
});
test("catalogue core, slots, choices, GE 36 and credit 120 structure without invented progress", () => {
  const s = applyCatalogue(parse()),
    gs = catalogueGroups(s);
  assert.equal(
    gs.reduce((n, g) => n + g.credits_required, 0),
    120,
  );
  assert.equal(
    gs
      .filter(
        (g) =>
          ![
            "Major requirements",
            "CMPS electives",
            "Math / Statistics",
            "Technical elective",
            "Freshman / Baccalaureate",
          ].includes(g.name),
      )
      .reduce((n, g) => n + g.credits_required, 0),
    36,
  );
  const core = gs.find((g) => g.name === "Major requirements")!,
    electives = gs.find((g) => g.name === "CMPS electives")!;
  assert.equal(s.requirements.filter((r) => r.group_id === core.id).length, 8);
  assert.equal(
    s.requirements.filter((r) => r.group_id === electives.id).length,
    6,
  );
  assert.equal(
    s.requirements.filter(
      (r) =>
        r.group_id === electives.id && requirementProgress(s, r, true).complete,
    ).length,
    3,
  );
  assert.equal(
    requirementRows(s)
      .filter((r) => !requirementProgress(s, r, true).complete)
      .reduce(
        (n, r) =>
          n + r.credits_required - requirementProgress(s, r, true).credits,
        0,
      ),
    18,
  );
  assert.equal(s.courses.length, 39);
  assert.equal(applyCatalogue(s).requirements.length, s.requirements.length);
  for (const [number, , pre, min] of coreCourses)
    if (pre) {
      const p = s.prerequisites.find((p) => p.number === number)!;
      assert.equal(p.prerequisite_number, pre);
      assert.equal(p.minimum_grade, min);
    }
  const math = s.requirements.find((r) => r.name === "Discrete Structures")!;
  assert.equal(math.kind, "one_of");
  assert.equal(requirementProgress(s, math).courses.length, 1);
  assert.equal(degreeProgress(s).credits, 85);
});
test("reimport preserves identities, plans and prerequisite rules without accumulating slot usage", () => {
  const old = applyCatalogue(parse()),
    incoming = applyCatalogue(parse());
  const c = incoming.courses.find((c) => c.number === "215" && !c.excluded)!;
  c.status = "completed";
  c.grade = "B";
  old.plans = graduationPlan(old, ["Spring 2027"], 18).plans;
  const merged = mergeEvaluation(old, incoming).state;
  assert.equal(merged.courses.length, old.courses.length);
  assert.equal(merged.allocations.length, incoming.allocations.length);
  assert.equal(merged.prerequisites.length, old.prerequisites.length);
  assert.equal(merged.plans.length, old.plans.length);
  assert.equal(
    merged.courses.find(
      (c) => c.id === old.courses.find((c) => c.number === "215")!.id,
    )?.grade,
    "B",
  );
  const db = openDatabase(":memory:");
  batch(
    db,
    degreeSaveStatements(old, null, {
      id: "source",
      filename: "eval.pdf",
      parser_version: "test",
      source_path: "",
      content_hash: "a",
    }),
  );
  batch(
    db,
    degreeSaveStatements(merged, old, {
      id: "update",
      filename: "eval2.pdf",
      parser_version: "test",
      source_path: "",
      content_hash: "b",
    }),
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM degree_import_snapshots").get()!.n,
    2,
  );
  db.close();
});
test("catalogue prerequisite minimum C+ blocks an earlier C attempt", () => {
  const s = applyCatalogue(parse());
  const c = s.courses.find((c) => c.number === "202")!;
  c.grade = "C";
  const r = s.requirements.find((r) => r.name.startsWith("CMPS 214"))!;
  assert.match(
    prerequisiteWarnings(s, [
      {
        id: "p",
        requirement_id: r.id,
        subject: "CMPS",
        number: "214",
        term: "Spring 2027",
        credits: 3,
        semester_id: null,
        override_prerequisites: 0,
      },
    ])[0].message,
    /C\+/,
  );
});
test("real DOCX paragraph, heading and table extraction feeds syllabus parser", () => {
  fs.mkdirSync(".local/rework-tests", { recursive: true });
  const file = ".local/rework-tests/syllabus.docx";
  fs.writeFileSync(file, representativeSyllabus());
  const extraction = JSON.parse(
    execFileSync(
      "src-tauri/target/release/examples/extract_document.exe",
      [file],
      { encoding: "utf8" },
    ),
  );
  assert.ok(
    extraction.segments.some(
      (s: any) => s.cells?.[0] === "Midterm" && s.cells[1] === "30%",
    ),
  );
  assert.ok(extraction.segments.some((s: any) => s.heading === "Grading"));
  const parsed = syllabusParser.parse({
    filename: "syllabus.docx",
    text: extraction.segments.map((s: any) => s.text).join("\n"),
    segments: extraction.segments,
    path: "",
    hash: "docx",
  });
  assert.equal(
    parsed.items.find((i) => i.kind === "course")?.fields.section,
    "3",
  );
  assert.equal(
    parsed.items.find((i) => i.kind === "course")?.fields.name,
    "Ethics",
  );
  assert.equal(parsed.items.filter((i) => i.kind === "schedule").length, 2);
  assert.equal(parsed.items.filter((i) => i.kind === "grade").length, 4);
  assert.equal(parsed.items.filter((i) => i.kind === "exam").length, 2);
  assert.equal(
    parsed.items.find((i) => i.kind === "assignment")?.fields.due_date,
    "2026-10-14",
  );
  assert.equal(
    parsed.items.find((i) => i.kind === "instructor")?.fields.office_hours,
    "MW 2:00-3:00 PM",
  );
  assert.equal(
    parsed.items.find((i) => i.kind === "schedule")?.fields.start_time,
    "12:30",
  );
  assert.equal(
    parsed.items.find((i) => i.kind === "schedule")?.fields.end_time,
    "13:45",
  );
});
test("representative PDF syllabus retains pages and aligned grading lines", () => {
  const file = ".local/rework-tests/syllabus.pdf";
  fs.mkdirSync(".local/rework-tests", { recursive: true });
  fs.writeFileSync(
    file,
    pdfFixture([
      "PHIL 210 - Ethics\nFall 2026\nGrading\nParticipation: 15%\nMidterm Exam - 30%\nFinal 55%\nCourse Calendar\nReflection paper: 10/11/2026",
    ]),
  );
  const ex = JSON.parse(
    execFileSync(
      "src-tauri/target/release/examples/extract_document.exe",
      [file],
      { encoding: "utf8" },
    ),
  );
  const parsed = syllabusParser.parse({
    filename: "syllabus.pdf",
    text: ex.segments.map((s: any) => s.text).join("\n"),
    segments: ex.segments,
    path: "",
    hash: "pdf",
  });
  assert.equal(ex.segments[0].page, 1);
  assert.equal(parsed.items.filter((i) => i.kind === "grade").length, 3);
  assert.ok(
    parsed.items
      .find((i) => i.kind === "assignment")
      ?.warnings.some((w) => w.includes("Ambiguous")),
  );
  assert.deepEqual(parseTimes("12:30–1:45 PM"), {
    start: "12:30",
    end: "13:45",
  });
});
