import { query, batch } from "../../services/platform";
import { insert, update } from "../../db/repository";
import { officeHoursCalendarStatements, type OfficeHoursRow } from "./repository";
import type { SqlValue } from "../../types";
export interface CourseSyllabus {
  id: string;
  course_id: string;
  description: string;
  objectives: string;
  source_file_id: string | null;
  source_filename: string;
  parser_version: string;
  imported_at: string;
  updated_at: string;
}
export interface SyllabusPolicy {
  id: string;
  course_id: string;
  category: string;
  text: string;
  sort_order: number;
}
export interface SyllabusMaterial {
  id: string;
  course_id: string;
  kind: string;
  title: string;
  detail: string;
  sort_order: number;
}
export interface SyllabusOfficeHours {
  id: string;
  course_id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  location: string;
  note: string;
}
export interface Instructor {
  id: string;
  name: string;
  email: string;
  office: string;
  office_hours: string;
}
export interface SyllabusPageData {
  info: CourseSyllabus | null;
  policies: SyllabusPolicy[];
  materials: SyllabusMaterial[];
  officeHours: SyllabusOfficeHours[];
  instructors: Instructor[];
  sourceFile: { id: string; filename: string } | null;
  history: { id: string; filename: string; imported_at: string }[];
}
export async function loadCourseSyllabus(
  courseId: string,
): Promise<SyllabusPageData> {
  const [infoRows, policies, materials, officeHours, instructors, history] =
    await Promise.all([
      query<CourseSyllabus>("SELECT * FROM course_syllabus WHERE course_id=?", [
        courseId,
      ]),
      query<SyllabusPolicy>(
        "SELECT * FROM course_syllabus_policy WHERE course_id=? ORDER BY sort_order,category",
        [courseId],
      ),
      query<SyllabusMaterial>(
        "SELECT * FROM course_syllabus_material WHERE course_id=? ORDER BY sort_order,title",
        [courseId],
      ),
      query<SyllabusOfficeHours>(
        "SELECT * FROM course_syllabus_office_hours WHERE course_id=? ORDER BY day_of_week IS NULL,day_of_week",
        [courseId],
      ),
      query<Instructor>(
        "SELECT p.* FROM professors p JOIN course_professors cp ON cp.professor_id=p.id WHERE cp.course_id=? ORDER BY p.name",
        [courseId],
      ),
      query<{ id: string; filename: string; imported_at: string }>(
        "SELECT id,filename,imported_at FROM local_import_sources WHERE course_id=? AND kind='syllabus' ORDER BY imported_at DESC",
        [courseId],
      ),
    ]);
  const info = infoRows[0] ?? null;
  const sourceFile = info?.source_file_id
    ? ((
        await query<{ id: string; filename: string }>(
          "SELECT id,filename FROM files WHERE id=?",
          [info.source_file_id],
        )
      )[0] ?? null)
    : null;
  return { info, policies, materials, officeHours, instructors, sourceFile, history };
}
const remove = (table: string, id: string) =>
  batch([{ sql: `DELETE FROM ${table} WHERE id=?`, params: [id] }]);
export async function updateSyllabusInfo(
  id: string,
  values: { description?: string; objectives?: string },
) {
  await batch([
    update("course_syllabus", id, {
      ...values,
      updated_at: new Date().toISOString(),
    }),
  ]);
}
export async function savePolicy(
  courseId: string,
  values: { category: string; text: string },
  id?: string,
) {
  await batch([
    id
      ? update("course_syllabus_policy", id, values)
      : insert("course_syllabus_policy", {
          id: crypto.randomUUID(),
          course_id: courseId,
          ...values,
        }),
  ]);
}
export const removePolicy = (id: string) => remove("course_syllabus_policy", id);
export async function saveMaterial(
  courseId: string,
  values: { kind: string; title: string; detail: string },
  id?: string,
) {
  await batch([
    id
      ? update("course_syllabus_material", id, values)
      : insert("course_syllabus_material", {
          id: crypto.randomUUID(),
          course_id: courseId,
          ...values,
        }),
  ]);
}
export const removeMaterial = (id: string) =>
  remove("course_syllabus_material", id);
export async function saveOfficeHours(
  courseId: string,
  values: {
    day_of_week: number | null;
    start_time: string;
    end_time: string;
    location: string;
    note: string;
  },
  id?: string,
) {
  await batch([
    id
      ? update(
          "course_syllabus_office_hours",
          id,
          values as unknown as Record<string, SqlValue>,
        )
      : insert("course_syllabus_office_hours", {
          id: crypto.randomUUID(),
          course_id: courseId,
          ...values,
        }),
  ]);
}
export const removeOfficeHours = (id: string) =>
  remove("course_syllabus_office_hours", id);
export async function addOfficeHoursToCalendar(
  courseId: string,
  rows: SyllabusOfficeHours[],
  start: string,
  end: string,
  note: string,
) {
  const structured: OfficeHoursRow[] = rows
    .filter((r): r is SyllabusOfficeHours & { day_of_week: number } => r.day_of_week !== null)
    .map((r) => ({
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      location: r.location,
    }));
  await batch(officeHoursCalendarStatements(courseId, structured, start, end, note));
}
export async function officeHoursOnCalendar(courseId: string) {
  const rows = await query<{ n: number }>(
    "SELECT count(*) n FROM calendar_events WHERE course_id=? AND title='Office hours'",
    [courseId],
  );
  return (rows[0]?.n ?? 0) > 0;
}
export const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const dayAbbrev = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
