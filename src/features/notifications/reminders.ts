import type { AcademicData, Reminder } from "../../types";
import { daysUntil, dateKey } from "../../utils/dates";
import { query, batch, notify } from "../../services/platform";
export function reminderCandidates(data: AcademicData, now = new Date()) {
  const active = data.semesters.find((s) => s.status === "Active")?.id;
  const courses = data.courses.filter(
    (c) => !c.archived && c.semester_id === active,
  );
  return [
    ...data.exams.filter(e=>!e.cancelled).map((e) => ({
      type: "exam",
      id: e.id,
      title: e.title,
      date: e.date,
      courseId: e.course_id,
      thresholds: [14, 7, 3, 1, 0],
    })),
    ...data.assignments
      .filter((a) => !["Completed", "Submitted"].includes(a.status))
      .map((a) => ({
        type: "assignment",
        id: a.id,
        title: a.title,
        date: a.due_date,
        courseId: a.course_id,
        thresholds: [7, 3, 1, 0],
      })),
  ].flatMap((e) => {
    const course = courses.find((c) => c.id === e.courseId);
    const days = daysUntil(e.date, now);
    if (!course || !e.thresholds.includes(days)) return [];
    return [
      {
        id: `${e.type}:${e.id}:${e.date}:${days}`,
        type: e.type,
        title: `${course.code} · ${e.title}`,
        description:
          days === 0
            ? "Due today"
            : days === 1
              ? "Due tomorrow"
              : `In ${days} days`,
        entity_id: e.id,
        priority: days <= 1 ? "High" : "Normal",
        date: dateKey(now),
      },
    ];
  });
}
export async function generateReminders(
  data: AcademicData,
  desktopEnabled: boolean,
  studyReminders = true,
  emailEnabled = false,
) {
  const candidates = reminderCandidates(data);
  for (const r of candidates.filter((r) => r.type === "exam")) {
    const topics = await query<{ total: number; remaining: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status<>'Reviewed' THEN 1 ELSE 0 END) AS remaining FROM exam_topics WHERE exam_id=?",
      [r.entity_id],
    );
    if (topics[0]?.total)
      r.description += ` ? ${topics[0].remaining} preparation items remain`;
  }
  if (studyReminders)
    for (const b of data.studyBlocks ?? []) {
      const course = data.courses.find(
        (c) =>
          c.id === b.course_id &&
          !c.archived &&
          data.semesters.some(
            (s) => s.id === c.semester_id && s.status === "Active",
          ),
      );
      if (course && !b.completed && b.scheduled_date === dateKey())
        candidates.push({
          id: `study:${b.id}:${b.scheduled_date}:${b.start_time}`,
          type: "study",
          title: `${course.code} ? ${b.title}`,
          description: `Study block today${b.start_time ? " at " + b.start_time : ""} ? ${b.estimated_minutes} min`,
          entity_id: b.id,
          priority: "Normal",
          date: dateKey(),
        });
    }
  if (candidates.length)
    await batch(
      candidates.map((r) => ({
        sql: "INSERT OR IGNORE INTO notifications(id,type,title,description,entity_id,priority) VALUES(?,?,?,?,?,?)",
        params: [r.id, r.type, r.title, r.description, r.entity_id, r.priority],
      })),
    );
  if (desktopEnabled || emailEnabled) {
    const pending = await query<Reminder>(
      "SELECT * FROM notifications WHERE delivered=0 AND read=0 AND date(created_at)=date('now') AND ((type='email' AND ?=1) OR (type<>'email' AND ?=1)) ORDER BY created_at LIMIT 3",
      [emailEnabled ? 1:0,desktopEnabled ? 1:0],
    );
    for (const r of pending)
      if (await notify(r.title, r.description))
        await batch([
          {
            sql: "UPDATE notifications SET delivered=1 WHERE id=?",
            params: [r.id],
          },
        ]);
  }
}
