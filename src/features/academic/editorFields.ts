import type { TrackingTable } from "./types";
type InputSpec = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
};
const title: InputSpec = { key: "title", label: "Title", required: true };
const notes: InputSpec = { key: "notes", label: "Notes", type: "textarea" };
const confidence: InputSpec = {
  key: "confidence",
  label: "Confidence (optional)",
  options: ["", "Low", "Medium", "High"],
};
export const labels: Record<TrackingTable, string> = {
  lectures: "Lecture",
  readings: "Reading",
  grade_categories: "Grade component",
  grade_items: "Grade",
  exam_topics: "Preparation item",
  course_topics: "Course topic",
  previous_exam_attempts: "Previous exam",
  study_sessions: "Study session",
  study_blocks: "Study block",
};
const related: InputSpec[] = [
  { key: "exam_id", label: "Related exam", type: "relation" },
  { key: "lecture_id", label: "Related lecture", type: "relation" },
  { key: "reading_id", label: "Related reading", type: "relation" },
];
export const specs: Record<TrackingTable, InputSpec[]> = {
  lectures: [
    { key: "number", label: "Lecture number", type: "number", min: 0 },
    title,
    { key: "lecture_date", label: "Lecture date", type: "date" },
    {
      key: "status",
      label: "Status",
      options: ["Not reviewed", "In progress", "Reviewed"],
    },
    confidence,
    {
      key: "estimated_minutes",
      label: "Estimated minutes",
      type: "number",
      min: 1,
    },
    notes,
  ],
  readings: [
    title,
    { key: "author", label: "Author" },
    { key: "assigned_date", label: "Assigned date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    {
      key: "status",
      label: "Status",
      options: ["Not started", "Reading", "Completed"],
    },
    { key: "file_id", label: "File", type: "relation" },
    { key: "external_reference", label: "External reference" },
    { key: "pages", label: "Pages", type: "number", min: 1 },
    notes,
  ],
  grade_categories: [
    { key: "name", label: "Component name", required: true },
    {
      key: "weight",
      label: "Course weight (%)",
      type: "number",
      min: 0,
      max: 100,
      required: true,
    },
    { key: "sort_order", label: "Order", type: "number", min: 0 },
  ],
  grade_items: [
    title,
    {
      key: "category_id",
      label: "Component",
      type: "relation",
      required: true,
    },
    {
      key: "points_earned",
      label: "Points earned (blank = ungraded)",
      type: "number",
      min: 0,
    },
    {
      key: "points_possible",
      label: "Points possible",
      type: "number",
      min: 0.01,
      required: true,
    },
    {
      key: "weight_override",
      label: "Relative item weight (optional)",
      type: "number",
      min: 0.01,
    },
    {
      key: "excluded",
      label: "Exclude / drop this assessment",
      type: "checkbox",
    },
    { key: "assessment_date", label: "Assessment date", type: "date" },
    { key: "assignment_id", label: "Link assignment", type: "relation" },
    { key: "exam_id", label: "Link exam", type: "relation" },
    notes,
  ],
  exam_topics: [
    title,
    {
      key: "status",
      label: "Status",
      options: ["Not started", "Reviewing", "Reviewed"],
    },
    confidence,
    { key: "sort_order", label: "Order", type: "number", min: 0 },
    ...related.slice(1, 3),
    { key: "previous_exam_id", label: "Previous exam", type: "relation" },
    notes,
  ],
  course_topics: [
    title,
    {
      key: "status",
      label: "Status",
      options: ["Not started", "Reviewing", "Reviewed"],
    },
    notes,
  ],
  previous_exam_attempts: [
    title,
    { key: "file_id", label: "Existing file", type: "relation" },
    {
      key: "status",
      label: "Status",
      options: ["Not attempted", "In progress", "Completed"],
    },
    { key: "score", label: "Score (optional)", type: "number", min: 0 },
    notes,
  ],
  study_sessions: [
    title,
    {
      key: "started_at",
      label: "Started at",
      type: "datetime-local",
      required: true,
    },
    {
      key: "duration_minutes",
      label: "Duration (minutes)",
      type: "number",
      min: 0.016667,
      max: 10080,
      required: true,
    },
    ...related,
    notes,
  ],
  study_blocks: [
    title,
    { key: "scheduled_date", label: "Date", type: "date", required: true },
    { key: "start_time", label: "Start time (optional)", type: "time" },
    {
      key: "estimated_minutes",
      label: "Estimated minutes",
      type: "number",
      min: 1,
      max: 1440,
      required: true,
    },
    { key: "completed", label: "Completed", type: "checkbox" },
    ...related,
    notes,
  ],
};
