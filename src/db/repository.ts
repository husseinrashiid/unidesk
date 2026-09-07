import { batch, query, command } from "../services/platform";
import type {
  AcademicData,
  Course,
  Semester,
  Schedule,
  Exam,
  Assignment,
  CalendarEvent,
  Setting,
  Statement,
  SqlValue,
  Table,
} from "../types";
export const insert = (
  table: string,
  values: Record<string, SqlValue>,
): Statement => ({
  sql: `INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(
    values,
  )
    .map(() => "?")
    .join(",")})`,
  params: Object.values(values),
});
export const update = (
  table: string,
  id: string,
  values: Record<string, SqlValue>,
): Statement => ({
  sql: `UPDATE ${table} SET ${Object.keys(values)
    .map((k) => `${k}=?`)
    .join(",")} WHERE id=?`,
  params: [...Object.values(values), id],
});
export async function loadAcademicData(
  semesterId?: string,
): Promise<AcademicData> {
  const semesters = await query<Semester>(
    "SELECT * FROM semesters ORDER BY start_date DESC",
  );
  const selected =
    semesterId ?? semesters.find((s) => s.status === "Active")?.id ?? "";
  const [courses, schedules, exams, assignments, events] =
    await Promise.all([
      query<Course>("SELECT * FROM courses WHERE semester_id=? ORDER BY code", [
        selected,
      ]),
      query<Schedule>(
        "SELECT s.* FROM course_schedules s JOIN courses c ON c.id=s.course_id WHERE c.semester_id=?",
        [selected],
      ),
      query<Exam>(
        "SELECT e.* FROM exams e JOIN courses c ON c.id=e.course_id WHERE c.semester_id=? ORDER BY date,start_time",
        [selected],
      ),
      query<Assignment>(
        "SELECT a.* FROM assignments a JOIN courses c ON c.id=a.course_id WHERE c.semester_id=? ORDER BY due_date,due_time",
        [selected],
      ),
      query<CalendarEvent>(
        "SELECT e.* FROM calendar_events e LEFT JOIN courses c ON c.id=e.course_id WHERE (c.semester_id=?) OR (e.course_id IS NULL AND EXISTS(SELECT 1 FROM semesters WHERE id=? AND status='Active')) ORDER BY start_datetime",
        [selected, selected],
      ),
    ]);
  const studyBlocks: import("../features/academic/types").TrackRecord[] = [];
  const scheduleExceptions = await query<import("../features/email/types").ScheduleException>("SELECT e.* FROM course_schedule_exceptions e JOIN courses c ON c.id=e.course_id WHERE c.semester_id=?",[selected]);
  return {
    semesters,
    courses,
    schedules,
    exams,
    assignments,
    events,
    studyBlocks,
    scheduleExceptions,
  };
}
export async function settings() {
  return Object.fromEntries(
    (await query<Setting>("SELECT * FROM settings")).map((s) => [
      s.key,
      s.value,
    ]),
  );
}
export const saveSetting = (key: string, value: string) =>
  batch([
    {
      sql: "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      params: [key, value],
    },
  ]);
export const removeEntity = (table: Table, id: string) =>
  batch([{ sql: `DELETE FROM ${table} WHERE id=?`, params: [id] }]);
export async function createSemester(values: {
  name: string;
  start_date: string;
  end_date: string;
  base: string;
}) {
  const folder = await command<string>("create_folder", {
    base: values.base,
    name: values.name,
    course: false,
  });
  const id = crypto.randomUUID();
  await batch([
    { sql: "UPDATE semesters SET status='Archived' WHERE status='Active'" },
    insert("semesters", {
      id,
      name: values.name,
      start_date: values.start_date,
      end_date: values.end_date,
      storage_directory: folder,
      status: "Active",
    }),
    {
      sql: "INSERT INTO settings(key,value) VALUES ('university_folder',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      params: [values.base],
    },
  ]);
  return id;
}
