export type Table =
  | "semesters"
  | "courses"
  | "exams"
  | "assignments"
  | "calendar_events"
  | "files";

export type EntityKind =
  "course" | "exam" | "assignment" | "event" | "semester";

export const tables: Record<EntityKind, Table> = {
  course: "courses",

  exam: "exams",

  assignment: "assignments",

  event: "calendar_events",

  semester: "semesters",
};

export const categories = [
  "Lectures",

  "Assignments",

  "Exams",

  "Previous Exams",

  "Readings",

  "Recordings",

  "Notes",

  "Resources",
] as const;

export type Category = (typeof categories)[number];

export interface Semester {
  id: string;

  name: string;

  start_date: string;

  end_date: string;

  status: "Active" | "Archived";

  storage_directory: string;

  created_at: string;
}

export interface Course {
  id: string;

  semester_id: string;

  code: string;

  name: string;

  professor: string;

  section: string;

  room: string;

  credits: number;

  color: string;

  folder_path: string;

  archived: number;

  created_at: string;

  updated_at: string;
}

export interface Schedule {
  id: string;

  course_id: string;

  day_of_week: number;

  start_time: string;

  end_time: string;
}

export interface Exam {
  cancelled?: number;
  id: string;

  course_id: string;

  title: string;

  type: string;

  date: string;

  start_time: string;

  end_time: string;

  location: string;

  description: string;

  coverage: string;

  notes: string;

  created_at: string;

  updated_at: string;
}

export type AssignmentStatus =
  "Not started" | "In progress" | "Completed" | "Submitted";

export interface Assignment {
  id: string;

  course_id: string;

  title: string;

  description: string;

  assigned_date: string;

  due_date: string;

  due_time: string;

  status: AssignmentStatus;

  notes: string;

  created_at: string;

  updated_at: string;
}

export interface CalendarEvent {
  id: string;

  course_id: string | null;

  title: string;

  type: string;

  start_datetime: string;

  end_datetime: string;

  all_day: number;

  location: string;

  description: string;

  created_at: string;

  updated_at: string;
}

export interface AcademicFile {
  id: string;

  course_id: string;

  semester_id: string;

  filename: string;

  original_filename: string;

  category: Category;

  absolute_path: string;

  extension: string;

  size: number;

  created_at: string;

  modified_at: string;

  added_at: string;

  accessed_at: string | null;

  notes: string;

  folder_id: string | null;
}

export interface FileFolder {
  id: string;

  course_id: string;

  category: Category;

  name: string;

  created_at: string;
}

export interface Reminder {
  id: string;

  type: string;

  title: string;

  description: string;

  entity_id: string;

  created_at: string;

  read: number;

  priority: string;

  delivered: number;
}

export interface Setting {
  key: string;

  value: string;
}

export interface AcademicData {
  scheduleExceptions?: import("../features/email/types").ScheduleException[];
  semesters: Semester[];

  courses: Course[];

  schedules: Schedule[];

  exams: Exam[];

  assignments: Assignment[];

  events: CalendarEvent[];

  studyBlocks?: import("../features/academic/types").TrackRecord[];
}

export interface Occurrence {
  cancelled?: boolean;
  location?: string;
  source_email_id?: string | null;
  exception_id?: string;
  id: string;

  entity_id: string;

  kind: "exam" | "assignment" | "event" | "lecture" | "study";

  title: string;

  course_id: string | null;

  date: string;

  time: string;

  end_time: string;

  type: string;

  all_day: boolean;
}

export interface EditorState {
  defaults?: Record<string, SqlValue>;
  kind: EntityKind;

  id?: string;

  courseId?: string;

  date?: string;
}

export type SqlValue = string | number | null;

export interface Statement {
  expectChanges?: number;
  sql: string;

  params?: SqlValue[];
}
