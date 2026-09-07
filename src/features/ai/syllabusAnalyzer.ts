import { z } from "zod";
import {
  citationSchema,
  jsonSchema,
  rules,
  validateCitations,
} from "./prompts";
import { extractStructured } from "./extractionService";
import { query, batch } from "../../services/platform";
import type { SqlValue, Statement } from "../../types";
import type { AIResult } from "./results";
export const syllabusSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: z.enum([
              "course",
              "instructor",
              "schedule",
              "grade",
              "exam",
              "assignment",
              "policy",
              "reading",
            ]),
            title: z.string().min(1).max(200),
            fields: z
              .array(
                z
                  .object({ name: z.string(), value: z.string().max(5000) })
                  .strict(),
              )
              .max(12),
            citations: z.array(citationSchema).min(1).max(5),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type SyllabusItem = z.infer<typeof syllabusSchema>["items"][number];
export const syllabusFields: Record<string, string[]> = {
  course: ["code", "name", "professor", "room", "credits", "section"],
  instructor: ["name", "email", "office", "office_hours"],
  schedule: ["day_of_week", "start_time", "end_time"],
  grade: ["weight"],
  exam: ["date", "start_time", "end_time", "location", "type", "description"],
  assignment: ["due_date", "due_time", "description"],
  policy: ["notes"],
  reading: ["author", "due_date", "notes"],
};
export function syllabusValues(item: SyllabusItem): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const f of item.fields) {
    if (!syllabusFields[item.kind]?.includes(f.name) || f.name in out)
      throw Error("Unsupported or duplicate syllabus field.");
    let value: SqlValue = f.value.trim();
    if (["credits", "weight", "day_of_week"].includes(f.name)) {
      if (value === "") throw Error("Review the missing numeric value.");
      value = Number(value);
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (f.name === "weight" && value > 100) ||
        (f.name === "day_of_week" && (!Number.isInteger(value) || value > 6))
      )
        throw Error(`Invalid ${f.name}.`);
    }
    if (/date$/.test(f.name) && value) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
      )
        throw Error(
          "Use a complete valid date (YYYY-MM-DD). Missing years must be reviewed, not guessed.",
        );
    }
    if (
      /time$/.test(f.name) &&
      value &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))
    )
      throw Error("Use HH:MM for times.");
    if (
      f.name === "email" &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
    )
      throw Error("Invalid instructor email.");
    out[f.name] = value;
  }
  if (
    item.kind === "schedule" &&
    (!("day_of_week" in out) ||
      !out.start_time ||
      !out.end_time ||
      out.end_time <= out.start_time)
  )
    throw Error("A schedule needs a weekday, start time and later end time.");
  if (item.kind === "grade" && !("weight" in out))
    throw Error("Review the missing grading weight.");
  if (item.kind === "exam" && !out.date)
    throw Error("Review the missing exam date before importing.");
  if (item.kind === "assignment" && !out.due_date)
    throw Error("Review the missing assignment date before importing.");
  return out;
}
export function analyzeSyllabus(
  o: Omit<
    Parameters<typeof extractStructured<SyllabusItem>>[0],
    "kind" | "schema" | "instructions" | "parse"
  >,
) {
  return extractStructured({
    ...o,
    kind: "syllabus",
    schema: jsonSchema(syllabusSchema),
    instructions: `${rules}\nExtract syllabus records, not answers. Allowed fields by kind: ${JSON.stringify(syllabusFields)}. Use ISO dates only if a complete year is explicit; otherwise leave dates empty for review. Weekday is 0=Sunday to 6=Saturday. Times HH:MM. Grading weight is percentage 0–100. Keep policies/readings in notes. Do not infer missing exam dates or weights. Each item must cite an exact supporting quote. Repeated table headings are not new records.`,
    parse: (raw, sources) => {
      const parsed = syllabusSchema.parse(raw);
      for (const item of parsed.items) {
        if (
          item.fields.some((f) => !syllabusFields[item.kind].includes(f.name))
        )
          throw Error("Unknown field");
        validateCitations(item.citations, sources);
      }
      return parsed.items;
    },
  });
}
export interface ReviewItem {
  item: SyllabusItem;
  index: number;
  table: string | null;
  values: Record<string, SqlValue>;
  existing: Record<string, SqlValue> | null;
  state: string;
  error: string;
}
const tables: Record<string, string> = {
  course: "courses",
  instructor: "professors",
  schedule: "course_schedules",
  grade: "grade_categories",
  exam: "exams",
  assignment: "assignments",
  reading: "readings",
};
export async function reviewSyllabus(
  result: AIResult,
  items: SyllabusItem[],
): Promise<ReviewItem[]> {
  const applied = await query<{ item_index: number }>(
    "SELECT item_index FROM syllabus_imports WHERE result_id=?",
    [result.id],
  );
  const rows: ReviewItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index],
      table = tables[item.kind] ?? null;
    let values: Record<string, SqlValue> = {},
      error = "";
    try {
      values = syllabusValues(item);
    } catch (e) {
      error = (e as Error).message;
    }
    let matches: Record<string, SqlValue>[] = [];
    if (table) {
      const where =
        item.kind === "course"
          ? "id=?"
          : item.kind === "instructor"
            ? "lower(email)=lower(?)"
            : item.kind === "schedule"
              ? "course_id=? AND day_of_week=?"
              : `course_id=? AND lower(${item.kind === "grade" ? "name" : "title"})=lower(?)`;
      matches = await query<Record<string, SqlValue>>(
        `SELECT * FROM ${table} WHERE ${where}`,
        item.kind === "course"
          ? [result.course_id]
          : item.kind === "instructor"
            ? [String(values.email ?? "")]
            : item.kind === "schedule"
              ? [result.course_id, values.day_of_week ?? -1]
              : [result.course_id, item.title.trim()],
      );
    }
    if (item.kind === "instructor") {
      values.name = values.name || item.title;
      if (!values.email)
        error = "Review the instructor email before importing.";
    }
    if (!["course", "instructor", "schedule", "policy"].includes(item.kind))
      values[item.kind === "grade" ? "name" : "title"] = item.title.trim();
    const existing = matches[0] ?? null;
    const linked =
      item.kind !== "instructor" ||
      !existing ||
      (
        await query<{ n: number }>(
          "SELECT count(*) n FROM course_professors WHERE course_id=? AND professor_id=?",
          [result.course_id, existing.id],
        )
      )[0]?.n === 1;
    const same =
      linked &&
      existing &&
      Object.entries(values).every(
        ([k, v]) => String(existing[k] ?? "") === String(v ?? ""),
      );
    rows.push({
      item,
      index,
      table,
      values,
      existing,
      state: applied.some((a) => a.item_index === index)
        ? "Imported"
        : matches.length > 1
          ? "Ambiguous existing records"
          : error
            ? "Needs review"
            : same
              ? "Already exists"
              : existing
                ? "Possible update"
                : "New",
      error,
    });
  }
  return rows;
}
export function syllabusApplyStatements(
  result: AIResult,
  review: ReviewItem[],
  selected: number[],
): Statement[] {
  if (result.stale)
    throw Error(
      "The source changed. Re-analyze this syllabus before importing.",
    );
  const statements: Statement[] = [
    {
      sql: "UPDATE document_ai_results SET stale=stale WHERE id=? AND stale=0",
      params: [result.id],
      expectChanges: 1,
    },
  ];
  const seen = new Set<string>();
  for (const r of review.filter((r) => selected.includes(r.index))) {
    if (!["New", "Possible update"].includes(r.state) || r.error)
      throw Error(
        "Only reviewed new records or explicit updates can be imported.",
      );
    const fingerprint = `${r.table}:${r.existing?.id ?? r.item.kind + ":" + r.item.title.toLowerCase()}`;
    if (seen.has(fingerprint))
      throw Error(
        "Multiple selected items target the same record. Import one at a time.",
      );
    seen.add(fingerprint);
    const id = String(r.existing?.id ?? crypto.randomUUID());
    if (r.table) {
      const values = { ...r.values };
      if (r.existing) {
        const entries = Object.entries(values);
        if (!entries.length) throw Error("No fields selected for this item.");
        const guard = Object.entries(r.existing);
        statements.push({
          sql: `UPDATE ${r.table} SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE ${guard.map(([k]) => `${k} IS ?`).join(" AND ")}`,
          params: [...entries.map(([, v]) => v), ...guard.map(([, v]) => v)],
          expectChanges: 1,
        });
      } else {
        values.id = id;
        if (r.item.kind !== "instructor") values.course_id = result.course_id;
        const entries = Object.entries(values);
        const key =
          r.item.kind === "instructor"
            ? "email"
            : r.item.kind === "schedule"
              ? "day_of_week"
              : r.item.kind === "grade"
                ? "name"
                : "title";
        statements.push({
          sql: `INSERT INTO ${r.table}(${entries.map(([k]) => k).join(",")}) SELECT ${entries.map(() => "?").join(",")} WHERE NOT EXISTS(SELECT 1 FROM ${r.table} WHERE lower(${key})=lower(?)${r.item.kind === "instructor" ? "" : " AND course_id=?"})`,
          params: [
            ...entries.map(([, v]) => v),
            values[key],
            ...(r.item.kind === "instructor" ? [] : [result.course_id]),
          ],
          expectChanges: 1,
        });
      }
      if (r.item.kind === "instructor")
        statements.push({
          sql: "INSERT OR IGNORE INTO course_professors(course_id,professor_id) VALUES(?,?)",
          params: [result.course_id, id],
        });
    }
    statements.push({
      sql: "INSERT INTO syllabus_imports(id,result_id,item_index,course_id,payload_json) VALUES(?,?,?,?,?)",
      params: [
        crypto.randomUUID(),
        result.id,
        r.index,
        result.course_id,
        JSON.stringify(r.item),
      ],
    });
  }
  if (!selected.length) throw Error("Select at least one reviewed item.");
  return statements;
}
export async function applySyllabus(
  result: AIResult,
  review: ReviewItem[],
  selected: number[],
) {
  await batch(syllabusApplyStatements(result, review, selected));
}
