import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openDatabase, batch, importFile } from "../server/storage";
import { retrievalQuery, type Source } from "../src/features/ai/retrieval";
import { validateAnswer } from "../src/features/ai/prompts";
import { resultStatements } from "../src/features/ai/results";
import {
  syllabusValues,
  syllabusApplyStatements,
  type SyllabusItem,
} from "../src/features/ai/syllabusAnalyzer";
import {
  parseExamQuestions,
  topicFrequency,
  type StoredQuestion,
} from "../src/features/ai/examAnalyzer";
import { validatePractice } from "../src/features/ai/practiceGenerator";
test("practice sets require complete cited questions and valid MCQ answers", () => {
  const q = {
    type: "MCQ",
    question: "Which claim is supported?",
    choices: ["Disagreement is insufficient", "Disagreement proves relativism"],
    answer: "Disagreement is insufficient",
    explanation: "The excerpt states this.",
    citations: [{ source: source.label, quote: source.text }],
  };
  assert.equal(
    validatePractice(
      { insufficient: false, questions: [q] },
      [source],
      1,
      "MCQ",
    ).questions.length,
    1,
  );
  assert.throws(() =>
    validatePractice(
      { insufficient: false, questions: [q] },
      [source],
      5,
      "MCQ",
    ),
  );
  assert.throws(() =>
    validatePractice(
      { insufficient: false, questions: [{ ...q, answer: "No option" }] },
      [source],
      1,
      "MCQ",
    ),
  );
  assert.throws(() =>
    validatePractice({ insufficient: false, questions: [q] }, [], 1, "MCQ"),
  );
});
test("past exams retain verbatim questions and count distinct uploads rather than question frequency", () => {
  const q = {
    number: "1",
    text: source.text,
    type: "Essay",
    year: 2025,
    topics: ["Ethics", "Ethics"],
    citations: [{ source: source.label, quote: source.text }],
  };
  const parsed = parseExamQuestions({ items: [q] }, [source]);
  assert.equal(parsed[0].year, null);
  assert.deepEqual(parsed[0].topics, ["ethics"]);
  assert.throws(() =>
    parseExamQuestions(
      { items: [{ ...q, text: "Invented exam question instead of original" }] },
      [source],
    ),
  );
  const rows = [
    { file_id: "a", year: 2024, topics_json: '["ethics"]' },
    { file_id: "a", year: 2024, topics_json: '["ethics"]' },
    { file_id: "b", year: 2025, topics_json: '["ethics"]' },
  ] as StoredQuestion[];
  assert.deepEqual(topicFrequency(rows), [
    { topic: "ethics", exams: 2, questions: 3, years: [2024, 2025] },
  ]);
});
test("syllabus rejects missing dates, invalid dates, blank weights and stale or duplicate-target application", () => {
  const item: SyllabusItem = {
    kind: "exam",
    title: "Midterm",
    fields: [],
    citations: [{ source: "SOURCE_1", quote: source.text }],
  };
  assert.throws(() => syllabusValues(item));
  assert.throws(() =>
    syllabusValues({
      ...item,
      fields: [{ name: "date", value: "2026-02-30" }],
    }),
  );
  assert.deepEqual(
    syllabusValues({
      ...item,
      fields: [{ name: "date", value: "2026-10-17" }],
    }),
    { date: "2026-10-17" },
  );
  assert.throws(() =>
    syllabusValues({
      ...item,
      kind: "grade",
      fields: [{ name: "weight", value: "" }],
    }),
  );
  const result = { id: "r", course_id: "c", stale: 0 } as Parameters<
    typeof syllabusApplyStatements
  >[0];
  const reviewed = {
    item,
    index: 0,
    table: "exams",
    values: { date: "2026-10-17", title: "Midterm" },
    existing: null,
    state: "New",
    error: "",
  };
  assert.throws(() =>
    syllabusApplyStatements({ ...result, stale: 1 }, [reviewed], [0]),
  );
  assert.throws(() =>
    syllabusApplyStatements(
      result,
      [reviewed, { ...reviewed, index: 1 }],
      [0, 1],
    ),
  );
  const statements = syllabusApplyStatements(result, [reviewed], [0]);
  assert.ok(statements.some((s) => s.sql.includes("NOT EXISTS")));
  assert.ok(statements.every((s) => !s.sql.includes("DELETE")));
});
const source: Source = {
  label: "SOURCE_1",
  id: "chunk",
  documentId: "doc",
  fileId: "doc",
  emailId: null,
  courseId: "c",
  hash: "hash",
  title: "Original.pdf",
  location: "Page 4",
  text: "Cultural disagreement does not demonstrate moral relativism.",
};
test("citations require retrieved IDs and actual quotes, with explicit general-knowledge separation", () => {
  const good = {
    sections: [
      {
        title: "Argument",
        text: "Disagreement is insufficient.",
        citations: [
          {
            source: "SOURCE_1",
            quote:
              "Cultural disagreement does not demonstrate moral relativism.",
          },
        ],
      },
    ],
    general: "",
    insufficient: false,
  };
  assert.deepEqual(validateAnswer(good, [source]), good);
  assert.throws(() => validateAnswer(good, []));
  assert.throws(() =>
    validateAnswer({ ...good, general: "Outside claim" }, [source]),
  );
  assert.doesNotThrow(() =>
    validateAnswer({ ...good, general: "Outside claim" }, [source], true),
  );
  assert.throws(() =>
    validateAnswer(
      {
        ...good,
        sections: [
          {
            ...good.sections[0],
            citations: [
              { source: "SOURCE_1", quote: "Fabricated quotation here." },
            ],
          },
        ],
      },
      [source],
    ),
  );
});
test("retrieval respects course, selected files, exam attachments, current index and bounded results", () => {
  fs.mkdirSync(".local/tests", { recursive: true });
  const dir = fs.mkdtempSync(path.resolve(".local/tests/ai-"));
  const db = openDatabase(path.join(dir, "db"));
  try {
    db.prepare(
      "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES('s','Fall','2026-09-01','2026-12-31',?)",
    ).run(dir);
    db.prepare(
      "INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('c','s','PHIL','Ethics',?)",
    ).run(dir);
    fs.mkdirSync(path.join(dir, "Readings"));
    const file = importFile(db, {
      courseId: "c",
      category: "Readings",
      filename: "Source.txt",
      bytes: [...Buffer.from(source.text)],
    }) as { id: string };
    db.prepare(
      "UPDATE documents SET status='Indexed',content_hash='hash' WHERE id=?",
    ).run(file.id);
    db.prepare(
      "INSERT INTO document_chunks(id,document_id,course_id,chunk_index,text) VALUES(?,?,?,?,?)",
    ).run("chunk", file.id, "c", 0, source.text);
    let q = retrievalQuery(
      "What does cultural disagreement demonstrate?",
      { courseId: "c" },
      10,
    );
    assert.equal(db.prepare(q.sql).all(...q.params).length, 1);
    for (const scope of [
      { courseId: "other" },
      { courseId: "c", fileIds: [] },
      { courseId: "c", fileIds: ["other"] },
      { courseId: "c", examId: "missing" },
    ]) {
      q = retrievalQuery("cultural", scope, 10);
      assert.equal(db.prepare(q.sql).all(...q.params).length, 0);
    }
    const s = { ...source, fileId: file.id, documentId: file.id };
    const result = {
      id: "r",
      course_id: "c",
      exam_id: null,
      conversation_id: null,
      kind: "summary",
      title: "Summary",
      model: "fixture",
      cache_key: "key",
      payload_json: "{}",
      sources_json: JSON.stringify([s]),
    };
    batch(db, resultStatements(result, [s]));
    db.prepare("UPDATE documents SET status='Stale' WHERE id=?").run(file.id);
    assert.equal(
      db.prepare("SELECT stale FROM document_ai_results WHERE id='r'").get()
        ?.stale,
      1,
    );
    assert.throws(() =>
      batch(db, resultStatements({ ...result, id: "stale" }, [s])),
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM document_ai_results WHERE id='stale'")
        .get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});
