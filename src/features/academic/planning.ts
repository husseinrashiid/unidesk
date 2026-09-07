import { dateKey, daysUntil, parseDate, occurrences } from "../../utils/dates";
import type { AcademicData } from "../../types";
import type { TrackRecord, TrackingData } from "./types";
export const addDays = (date: string, n: number) => {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
export function weekDates(date = dateKey(), start = 1) {
  const d = parseDate(date);
  const first = addDays(date, -((d.getDay() - start + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}
export const durationLabel = (seconds: number) =>
  `${Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + "h " : ""}${Math.floor((seconds % 3600) / 60)}m`;
export function prepProgress(rows: TrackRecord[]) {
  const completed = rows.filter((t) => t.status === "Reviewed").length;
  return {
    completed,
    total: rows.length,
    percentage: rows.length ? (completed / rows.length) * 100 : null,
  };
}
export function courseProgress(
  data: AcademicData,
  p: TrackingData,
  id: string,
) {
  const groups = [
    ["Lectures", p.lectures.filter((t) => t.course_id === id), "Reviewed"],
    ["Readings", p.readings.filter((t) => t.course_id === id), "Completed"],
    [
      "Assignments",
      data.assignments.filter((t) => t.course_id === id),
      "Completed",
    ],
    ["Exam prep", p.exam_topics.filter((t) => t.course_id === id), "Reviewed"],
    ["Topics", p.course_topics.filter((t) => t.course_id === id), "Reviewed"],
  ] as const;
  const counts = groups.map(([name, rows, status]) => ({
    name,
    total: rows.length,
    completed: rows.filter(
      (t) => t.status === status || t.status === "Submitted",
    ).length,
  }));
  const total = counts.reduce((s, c) => s + c.total, 0),
    completed = counts.reduce((s, c) => s + c.completed, 0);
  return {
    counts,
    total,
    completed,
    percentage: total ? (completed / total) * 100 : null,
  };
}
export function generatePlan(
  examDate: string,
  items: TrackRecord[],
  start = dateKey(),
  minutes = 45,
) {
  if (examDate < start)
    throw Error("This exam is in the past. Choose a future exam date.");
  const pending = items
    .filter((i) => i.status !== "Reviewed")
    .sort(
      (a, b) =>
        Number(!!a.previous_exam_id) - Number(!!b.previous_exam_id) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
  if (!pending.length)
    throw Error("Add unfinished preparation items before generating a plan.");
  const days = Math.max(1, daysUntil(examDate, parseDate(start)));
  const work = [
    ...pending.map((i) => ({
      title: i.title,
      lecture_id: i.lecture_id ?? null,
      reading_id: i.reading_id ?? null,
    })),
    { title: "Full review", lecture_id: null, reading_id: null },
  ];
  return work.map((item, index) => ({
    ...item,
    scheduled_date: addDays(
      start,
      Math.min(days - 1, Math.floor((index * (days - 1)) / (work.length - 1))),
    ),
    estimated_minutes: minutes,
  }));
}
export function recommendations(
  data: AcademicData,
  p: TrackingData,
  today = dateKey(),
) {
  const result: {
    id: string;
    title: string;
    course_id: string | null;
    reason: string;
    route: string;
    score: number;
  }[] = [];
  const assessmentWeight = (id: string) => {
    const item = p.grade_items.find(
      (i) => (i.exam_id === id || i.assignment_id === id) && !i.excluded,
    );
    if (!item) return 0;
    const category = p.grade_categories.find((c) => c.id === item.category_id);
    const share = (i: TrackRecord) =>
      i.weight_override ?? i.points_possible ?? 100;
    const total = p.grade_items
      .filter((i) => i.category_id === item.category_id && !i.excluded)
      .reduce((sum, i) => sum + share(i), 0);
    return total ? ((category?.weight ?? 0) * share(item)) / total : 0;
  };
  const urgency = (date: string) =>
    date ? Math.max(0, 100 - daysUntil(date, parseDate(today)) * 5) : 5;
  for (const e of data.exams.filter((e) => e.date >= today)) {
    const topics = p.exam_topics.filter(
      (t) => t.exam_id === e.id && t.status !== "Reviewed",
    );
    const n = daysUntil(e.date, parseDate(today));
    if (topics.length)
      result.push({
        id: e.id,
        title: `Review ${topics[0].title}`,
        course_id: e.course_id,
        reason: `Exam ${n === 0 ? "today" : `in ${n} ${n === 1 ? "day" : "days"}`}; ${topics.length} preparation items remain.`,
        route: `exam/${e.id}`,
        score: urgency(e.date) + 25 + assessmentWeight(e.id),
      });
  }
  for (const a of data.assignments.filter(
    (a) => !["Completed", "Submitted"].includes(a.status),
  ))
    result.push({
      id: a.id,
      title: a.title,
      course_id: a.course_id,
      reason: `Assignment ${a.due_date < today ? "overdue" : "due " + a.due_date}.`,
      route: `assignment/${a.id}`,
      score: urgency(a.due_date) + 20 + assessmentWeight(a.id),
    });
  for (const t of [
    ...p.lectures.filter((t) => t.status !== "Reviewed"),
    ...p.readings.filter((t) => t.status !== "Completed"),
  ])
    result.push({
      id: t.id,
      title: t.title,
      course_id: t.course_id,
      reason: `${t.status}${t.due_date ? "; due " + t.due_date : ""}.`,
      route: `course/${t.course_id}/${t.author !== undefined ? "Readings" : "Lectures"}`,
      score: urgency(t.due_date ?? ""),
    });
  return result.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function workload(
  data: AcademicData,
  blocks: TrackRecord[],
  dates: string[],
) {
  const events = occurrences(data, dates[0], dates.at(-1)!).filter(e=>!e.cancelled);
  return dates.map((date) => {
    const daily = events.filter((e) => e.date === date);
    const major = daily.filter(
      (e) => e.kind === "exam" || e.kind === "assignment",
    );
    const planned = blocks.filter(
      (b) => b.scheduled_date === date && !b.completed,
    );
    const minutes =
      planned.reduce((s, b) => s + (b.estimated_minutes ?? 0), 0) +
      daily
        .filter((e) => e.kind === "lecture")
        .reduce((s, e) => {
          const toMinutes = (t: string) =>
            Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
          return s + Math.max(0, toMinutes(e.end_time) - toMinutes(e.time));
        }, 0);
    return {
      date,
      major: major.length,
      minutes,
      label:
        major.length >= 3 || minutes > 480
          ? "Very heavy"
          : major.length >= 2 || minutes > 300
            ? "Heavy"
            : major.length || minutes > 120
              ? "Moderate"
              : "Light",
      reason: `${major.length} deadlines · ${Math.round(minutes)} scheduled minutes`,
    };
  });
}
export function conflicts(data: AcademicData, today = dateKey()) {
  const deadlines = occurrences(
    { ...data, schedules: [] },
    today,
    addDays(today, 90),
  ).filter((e) => !e.cancelled && (e.kind === "exam" || e.kind === "assignment"));
  const groups: { date: string; reason: string; titles: string[] }[] = [];
  let covered = "";
  for (const first of deadlines) {
    if (first.date <= covered) continue;
    const four = deadlines.filter(
      (e) => e.date >= first.date && e.date <= addDays(first.date, 3),
    );
    const two = four.filter((e) => {
      const start = new Date(first.date + "T" + (first.time || "23:59"));
      const end = new Date(e.date + "T" + (e.time || "23:59"));
      return end.getTime() - start.getTime() <= 48 * 3600000;
    });
    const group = four.length >= 3 ? four : two.length >= 2 ? two : [];
    if (group.length) {
      covered = group.at(-1)!.date;
      groups.push({
        date: first.date,
        reason:
          four.length >= 3
            ? "3 or more deadlines fall within four days."
            : "2 or more assessments fall within 48 hours.",
        titles: group.map((e) => e.title),
      });
    }
  }
  return groups;
}
