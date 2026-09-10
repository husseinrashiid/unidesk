import { query, batch } from "../../services/platform";
import { insert } from "../../db/repository";
import type { SqlValue, Statement } from "../../types";
import type { ExtractedDocument } from "../documents/localImport";
import {
  SYLLABUS_PARSER_VERSION,
  type SyllabusCandidate,
  type ItemKind,
} from "./parser";
export const fieldsByKind: Record<ItemKind, string[]> = {
  course: ["code", "name", "section", "room"],
  instructor: ["name", "email", "office", "office_hours"],
  schedule: ["day_of_week", "start_time", "end_time"],
  grade: ["weight"],
  exam: ["date", "start_time", "end_time", "location", "description"],
  assignment: ["due_date", "due_time", "description"],
  info: ["description", "objectives"],
  policy: ["text"],
  material: ["kind", "detail"],
  office_hours: ["day_of_week", "start_time", "end_time", "location", "note"],
};
const tables: Record<ItemKind, string> = {
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
/** Kinds matched by a day_of_week (nullable for office_hours) rather than a title/name column. */
const dayKeyed = (kind: ItemKind) => kind === "schedule" || kind === "office_hours";
/** The natural-key column used to detect an existing row for kinds that aren't course/instructor/schedule/office_hours-special-cased. */
const matchColumn: Partial<Record<ItemKind, string>> = {
  grade: "name",
  exam: "title",
  assignment: "title",
  policy: "category",
  material: "title",
};
export type ConflictChoice = "keep" | "update" | "both";
export interface SyllabusReview {
  item: SyllabusCandidate;
  table: string;
  values: Record<string, SqlValue>;
  existing: Record<string, SqlValue> | null;
  matches: Record<string, SqlValue>[];
  same: boolean;
  error: string;
  choice: ConflictChoice;
}
export function candidateValues(
  item: SyllabusCandidate,
): Record<string, SqlValue> {
  const values: Record<string, SqlValue> = {};
  if (!item.title.trim()) throw Error("Enter a title.");
  for (const [key, raw] of Object.entries(item.fields)) {
    if (!fieldsByKind[item.kind].includes(key))
      throw Error("Unsupported field.");
    let value: SqlValue = raw.trim();
    if (["weight", "day_of_week"].includes(key)) {
      value = Number(value);
      if (
        raw.trim() === "" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (key === "weight" && value > 100) ||
        (key === "day_of_week" && (value > 6 || !Number.isInteger(value)))
      )
        throw Error(`Invalid ${key}.`);
    }
    if (/date$/.test(key) && value) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
        !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
      )
        throw Error("Choose a valid date using YYYY-MM-DD.");
    }
    if (
      /time$/.test(key) &&
      value &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))
    )
      throw Error("Use HH:MM for time.");
    values[key] = value;
  }
  if (
    (item.kind === "exam" && !values.date) ||
    (item.kind === "assignment" && !values.due_date)
  )
    throw Error("Choose the assessment date before importing.");
  if (
    item.kind === "schedule" &&
    (!("day_of_week" in values) ||
      !values.start_time ||
      !values.end_time ||
      values.end_time <= values.start_time)
  )
    throw Error("Enter a weekday and a valid time range.");
  if (
    item.kind === "instructor" &&
    (!values.name ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email ?? "")))
  )
    throw Error("Enter an instructor name and valid email.");
  if (item.kind === "grade" && !("weight" in values))
    throw Error("Enter a grading weight.");
  if (
    item.kind === "office_hours" &&
    !(
      "day_of_week" in values &&
      values.start_time &&
      values.end_time
    ) &&
    !String(values.note ?? "").trim()
  )
    throw Error("Enter office-hours days and times, or a note.");
  if (item.kind === "policy" && !String(values.text ?? "").trim())
    throw Error("Enter the policy text.");
  if (["exam", "assignment", "material"].includes(item.kind))
    values.title = item.title.trim();
  if (item.kind === "grade") values.name = item.title.trim();
  if (item.kind === "policy") values.category = item.title.trim();
  return values;
}
export async function reviewLocalSyllabus(
  courseId: string,
  items: SyllabusCandidate[],
): Promise<SyllabusReview[]> {
  const rows: SyllabusReview[] = [];
  for (const item of items) {
    let values: Record<string, SqlValue> = {},
      error = "";
    try {
      values = candidateValues(item);
    } catch (e) {
      error = (e as Error).message;
    }
    const table = tables[item.kind];
    const where =
      item.kind === "course"
        ? "id=?"
        : item.kind === "info"
          ? "course_id=?"
          : item.kind === "instructor"
            ? "lower(email)=lower(?)"
            : dayKeyed(item.kind)
              ? "course_id=? AND day_of_week IS ?"
              : `course_id=? AND lower(trim(${matchColumn[item.kind]}))=lower(trim(?))`;
    const params: SqlValue[] =
      item.kind === "course" || item.kind === "info"
        ? [courseId]
        : item.kind === "instructor"
          ? [values.email ?? ""]
          : dayKeyed(item.kind)
            ? [courseId, values.day_of_week ?? null]
            : [courseId, item.title];
    const matches = await query<Record<string, SqlValue>>(
        `SELECT * FROM ${table} WHERE ${where}`,
        params,
      ),
      existing = matches[0] ?? null;
    const same =
      !!existing &&
      Object.entries(values).every(
        ([k, v]) => String(existing[k] ?? "") === String(v ?? ""),
      );
    rows.push({
      item,
      table,
      values,
      existing,
      matches,
      same,
      error,
      choice:
        existing &&
        !same &&
        Object.entries(values).every(
          ([k, v]) =>
            !String(existing[k] ?? "").trim() ||
            String(existing[k]) === String(v),
        )
          ? "update"
          : "keep",
    });
  }
  return rows;
}
function guardUpdate(
  table: string,
  existing: Record<string, SqlValue>,
  values: Record<string, SqlValue>,
): Statement {
  return {
    sql: `UPDATE ${table} SET ${Object.keys(values)
      .map((k) => `${k}=?`)
      .join(",")} WHERE ${Object.keys(existing)
      .map((k) => `${k} IS ?`)
      .join(" AND ")}`,
    params: [...Object.values(values), ...Object.values(existing)],
    expectChanges: 1,
  };
}
export function syllabusStatements(
  courseId: string,
  document: ExtractedDocument,
  review: SyllabusReview[],
  gradeMode: "merge" | "replace" | "ignore",
  existingGrades: Record<string, SqlValue>[],
  sourceId = crypto.randomUUID(),
): Statement[] {
  const selected = review.filter(
    (r) =>
      r.item.selected && !(r.item.kind === "grade" && gradeMode === "ignore"),
  );
  /** The course_syllabus row (source file/metadata) always exists after any syllabus import, whether or
   * not a description/objectives section was detected — the Syllabus page needs it to link the source file. */
  const infoRow = selected.find((r) => r.item.kind === "info");
  if (infoRow?.error) throw Error(infoRow.error);
  if (infoRow?.choice === "both")
    throw Error("This record must be merged or kept, not duplicated.");
  const applyInfoText =
    !!infoRow && !(infoRow.existing && infoRow.choice === "keep");
  const syllabusRowId = infoRow?.existing?.id
    ? String(infoRow.existing.id)
    : crypto.randomUUID();
  const out: Statement[] = [
      insert("local_import_sources", {
        id: sourceId,
        kind: "syllabus",
        course_id: courseId,
        filename: document.filename,
        parser_version: SYLLABUS_PARSER_VERSION,
        source_path: document.path,
        file_id: document.fileId ?? null,
        content_hash: document.hash,
      }),
      {
        sql: `INSERT INTO course_syllabus (id,course_id,description,objectives,source_file_id,source_filename,parser_version,imported_at,updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now')) ON CONFLICT(course_id) DO UPDATE SET source_file_id=excluded.source_file_id,source_filename=excluded.source_filename,parser_version=excluded.parser_version,updated_at=excluded.updated_at${applyInfoText ? ",description=excluded.description,objectives=excluded.objectives" : ""}`,
        params: [
          syllabusRowId,
          courseId,
          applyInfoText ? String(infoRow!.values.description ?? "") : "",
          applyInfoText ? String(infoRow!.values.objectives ?? "") : "",
          document.fileId ?? null,
          document.filename,
          SYLLABUS_PARSER_VERSION,
        ],
      },
      ...(applyInfoText
        ? [
            insert("local_import_records", {
              source_id: sourceId,
              entity_table: "course_syllabus",
              entity_id: syllabusRowId,
              before_json: infoRow!.existing
                ? JSON.stringify(infoRow!.existing)
                : null,
              after_json: JSON.stringify(infoRow!.values),
            }),
          ]
        : []),
    ],
    seen = new Set<string>();
  if (
    gradeMode === "replace" &&
    selected.some((r) => r.item.kind === "grade")
  ) {
    for (const g of existingGrades)
      out.push({
        sql: `DELETE FROM grade_categories WHERE ${Object.keys(g)
          .map((k) => `${k} IS ?`)
          .join(
            " AND ",
          )} AND NOT EXISTS(SELECT 1 FROM grade_items WHERE category_id=?)`,
        params: [...Object.values(g), g.id],
        expectChanges: 1,
      });
  }
  for (const r of selected) {
    if (r.item.kind === "info") continue;
    if (r.error) throw Error(r.error);
    const replace = r.item.kind === "grade" && gradeMode === "replace";
    if (r.matches.length > 1 && !replace)
      throw Error(
        `Multiple existing matches for ${r.item.title}. Resolve them in the course before importing.`,
      );
    if (!replace && r.existing && (r.same || r.choice === "keep")) {
      if (r.item.kind === "instructor")
        out.push({
          sql: "INSERT OR IGNORE INTO course_professors(course_id,professor_id) VALUES(?,?)",
          params: [courseId, r.existing.id],
        });
      continue;
    }
    if (
      r.choice === "both" &&
      ["course", "instructor", "grade"].includes(r.item.kind)
    )
      throw Error("This record must be merged or kept, not duplicated.");
    const fingerprint = `${r.table}:${
      dayKeyed(r.item.kind)
        ? r.values.day_of_week
        : r.item.kind === "course"
          ? courseId
          : r.item.title.trim().toLowerCase()
    }`;
    if (seen.has(fingerprint))
      throw Error(`Multiple selected rows target ${r.item.title}. Select one.`);
    seen.add(fingerprint);
    const values = candidateValues(r.item),
      existing = replace ? null : r.existing,
      id =
        existing && r.choice !== "both"
          ? String(existing.id)
          : crypto.randomUUID();
    if (existing && r.choice === "update" && !replace)
      out.push(guardUpdate(r.table, existing, values));
    else {
      const row = {
        id,
        ...values,
        ...(r.item.kind === "instructor" ? {} : { course_id: courseId }),
      };
      const entries = Object.entries(row);
      const key = dayKeyed(r.item.kind)
        ? "day_of_week"
        : r.item.kind === "instructor"
          ? "email"
          : (matchColumn[r.item.kind] ?? "title");
      if (r.choice === "both" && existing) {
        out.push({
          sql: `UPDATE ${r.table} SET id=id WHERE ${Object.keys(existing)
            .map((k) => `${k} IS ?`)
            .join(" AND ")}`,
          params: Object.values(existing),
          expectChanges: 1,
        });
        out.push(insert(r.table, row));
      } else
        out.push({
          sql: `INSERT INTO ${r.table} (${entries.map(([k]) => k).join(",")}) SELECT ${entries.map(() => "?").join(",")} WHERE NOT EXISTS (SELECT 1 FROM ${r.table} WHERE ${dayKeyed(r.item.kind) ? "day_of_week IS ?" : `lower(${key})=lower(?)`}${r.item.kind === "instructor" ? "" : " AND course_id=?"})`,
          params: [
            ...entries.map(([, v]) => v),
            (row as Record<string, SqlValue>)[key] ?? null,
            ...(r.item.kind === "instructor" ? [] : [courseId]),
          ],
          expectChanges: 1,
        });
    }
    if (r.item.kind === "instructor")
      out.push({
        sql: "INSERT OR IGNORE INTO course_professors(course_id,professor_id) VALUES(?,?)",
        params: [courseId, id],
      });
    out.push(
      insert("local_import_records", {
        source_id: sourceId,
        entity_table: r.table,
        entity_id: id,
        before_json: existing ? JSON.stringify(existing) : null,
        after_json: JSON.stringify(values),
      }),
    );
    if (["exam", "assignment", "course"].includes(r.item.kind))
      out.push(
        insert("academic_change_log", {
          id: crypto.randomUUID(),
          entity_type: r.item.kind,
          entity_id: id,
          field_name: "syllabus import",
          old_value: existing ? JSON.stringify(existing) : null,
          new_value: JSON.stringify(values),
          source_type: "Syllabus",
          source_sender: "Local import",
          source_subject: document.filename,
          source_received_at: new Date().toISOString(),
        }),
      );
  }
  return out;
}
export interface OfficeHoursRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  location?: string;
}
/** Expands weekly office-hours rows into one dated {start,end} occurrence per matching day between start/end (inclusive). */
export function officeHoursOccurrences(
  rows: OfficeHoursRow[],
  start: string,
  end: string,
) {
  if (!rows.length) return [];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    end < start
  )
    throw Error("Set valid semester dates first.");
  const byDay = new Map<number, OfficeHoursRow[]>();
  for (const r of rows)
    byDay.set(r.day_of_week, [...(byDay.get(r.day_of_week) ?? []), r]);
  const out: { start: string; end: string; location: string }[] = [];
  const day = new Date(`${start}T12:00:00Z`);
  for (let n = 0; day.toISOString().slice(0, 10) <= end; n++) {
    if (n > 370)
      throw Error("Office-hour imports support semesters up to one year.");
    const date = day.toISOString().slice(0, 10);
    for (const r of byDay.get(day.getUTCDay()) ?? [])
      out.push({
        start: `${date}T${r.start_time}`,
        end: `${date}T${r.end_time}`,
        location: r.location ?? "",
      });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}
/** Idempotent (guarded by course/title/start uniqueness): safe to call again for the same rows without duplicating events. */
export function officeHoursCalendarStatements(
  courseId: string,
  rows: OfficeHoursRow[],
  start: string,
  end: string,
  note: string,
  sourceId?: string,
): Statement[] {
  const out: Statement[] = [];
  for (const event of officeHoursOccurrences(rows, start, end)) {
    const id = crypto.randomUUID();
    out.push({
      sql: "INSERT INTO calendar_events(id,course_id,title,type,start_datetime,end_datetime,location,description) SELECT ?,?,'Office hours','Office hours',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM calendar_events WHERE course_id=? AND title='Office hours' AND start_datetime=?)",
      params: [
        id,
        courseId,
        event.start,
        event.end,
        event.location,
        note,
        courseId,
        event.start,
      ],
    });
    if (sourceId)
      out.push({
        sql: "INSERT INTO local_import_records(source_id,entity_table,entity_id,after_json) SELECT ?,'calendar_events',?,? WHERE EXISTS(SELECT 1 FROM calendar_events WHERE id=?)",
        params: [sourceId, id, JSON.stringify(event), id],
      });
  }
  return out;
}
export async function applyLocalSyllabus(
  courseId: string,
  document: ExtractedDocument,
  review: SyllabusReview[],
  gradeMode: "merge" | "replace" | "ignore",
  existingGrades: Record<string, SqlValue>[],
  office?: { rows: OfficeHoursRow[]; start: string; end: string },
) {
  const sourceId = crypto.randomUUID(),
    statements = syllabusStatements(
      courseId,
      document,
      review,
      gradeMode,
      existingGrades,
      sourceId,
    );
  if (office)
    statements.push(
      ...officeHoursCalendarStatements(
        courseId,
        office.rows,
        office.start,
        office.end,
        `Imported from ${document.filename}`,
        sourceId,
      ),
    );
  await batch(statements);
  return sourceId;
}
