export type TrackingTable =
  | "lectures"
  | "readings"
  | "grade_categories"
  | "grade_items"
  | "exam_topics"
  | "course_topics"
  | "previous_exam_attempts"
  | "study_sessions"
  | "study_blocks";
export interface TrackRecord {
  id: string;
  course_id: string;
  title: string;
  name?: string;
  status?: string;
  notes: string;
  number?: number | null;
  lecture_date?: string;
  reviewed_at?: string | null;
  confidence?: string;
  estimated_minutes?: number | null;
  author?: string;
  assigned_date?: string;
  due_date?: string;
  file_id?: string | null;
  external_reference?: string;
  pages?: number | null;
  category_id?: string;
  weight?: number;
  sort_order?: number;
  points_earned?: number | null;
  points_possible?: number;
  weight_override?: number | null;
  excluded?: number;
  assessment_date?: string;
  assignment_id?: string | null;
  exam_id?: string | null;
  lecture_id?: string | null;
  reading_id?: string | null;
  previous_exam_id?: string | null;
  task_id?: string | null;
  completed_at?: string | null;
  score?: number | null;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  scheduled_date?: string;
  start_time?: string;
  completed?: number;
}
export interface ScaleEntry {
  letter: string;
  min: number;
  points: number;
}
export interface GradingScale {
  id: string;
  course_id: string | null;
  semester_id: string | null;
  name: string;
  entries: string;
}
export type TrackingData = Record<TrackingTable, TrackRecord[]> & {
  scales: GradingScale[];
};
export const trackingTables: TrackingTable[] = [
  "lectures",
  "readings",
  "grade_categories",
  "grade_items",
  "exam_topics",
  "course_topics",
  "previous_exam_attempts",
  "study_sessions",
  "study_blocks",
];
export const emptyTracking = Object.fromEntries([
  ...trackingTables.map((t) => [t, []]),
  ["scales", []],
]) as unknown as TrackingData;
