import { query } from "../../services/platform";
import { dateKey } from "../../utils/dates";
export interface LocalAnswer {
  text: string;
  links: { label: string; page: string }[];
}
export async function routeLocal(
  question: string,
  courseId?: string,
): Promise<LocalAnswer | null> {
  const q = question.toLowerCase(),
    today = dateKey(),
    filter = courseId ? " AND course_id=?" : "",
    params = courseId ? [courseId] : [];
  if (/\b(score|grade|gpa|final for|need.*final)\b/.test(q))
    return {
      text: "Use the grade calculator for exact weighted grades and required final scores.",
      links: [
        {
          label: "Open grade calculator",
          page: courseId ? `course/${courseId}/Grades` : "grades",
        },
      ],
    };
  if (/\b(study tonight|study today|prioriti[sz]e)\b/.test(q)) {
    const exams = await query<{ id: string; title: string; date: string }>(
      `SELECT id,title,date FROM exams WHERE cancelled=0 AND date>=?${filter} ORDER BY date,start_time LIMIT 3`,
      [today, ...params],
    );
    const topics = await query<{ title: string }>(
      `SELECT title FROM exam_topics WHERE status<>'Reviewed'${filter} AND exam_id IN (SELECT id FROM exams WHERE cancelled=0 AND date>=?) ORDER BY (SELECT date FROM exams WHERE id=exam_id),sort_order LIMIT 8`,
      [...params, today],
    );
    return {
      text: exams.length
        ? `Upcoming exams: ${exams.map((e) => `${e.title} (${e.date})`).join("; ")}. Remaining tracked topics: ${topics.map((t) => t.title).join("; ") || "None recorded"}. Priority follows exam date; completion is your recorded progress.`
        : "No upcoming exams recorded. Check your assignments and study planner.",
      links: [
        ...exams.map((e) => ({ label: e.title, page: `exam/${e.id}` })),
        { label: "Study planner", page: "study/planner" },
      ],
    };
  }
  if (
    /\b(readings?|lectures?)\b/.test(q) &&
    /\b(review|unread|incomplete|haven|not yet)\b/.test(q)
  ) {
    const reading = /reading/.test(q),
      rows = await query<{ id: string; course_id: string; title: string }>(
        `SELECT id,course_id,title FROM ${reading ? "readings" : "lectures"} WHERE status<>?${filter} ORDER BY title LIMIT 40`,
        [reading ? "Completed" : "Reviewed", ...params],
      );
    return {
      text: rows.length
        ? `${rows.length} unfinished tracked ${reading ? "readings" : "lectures"}${rows.length === 40 ? " (first 40)" : ""}.`
        : "No unfinished items recorded.",
      links: rows.map((r) => ({
        label: r.title,
        page: `course/${r.course_id}/${reading ? "Readings" : "Lectures"}/${r.id}`,
      })),
    };
  }
  if (
    /\b(email|professor)\b/.test(q) &&
    /\b(changed? deadlines?|deadline changes?)\b/.test(q)
  ) {
    const rows = await query<{ id: string; subject: string }>(
      `SELECT id,subject FROM emails WHERE academic_type='Deadline change'${filter} ORDER BY received_at DESC LIMIT 20`,
      params,
    );
    return {
      text: "These cached messages are classified as deadline changes. Check their review status before treating a proposed date as confirmed.",
      links: rows.map((r) => ({
        label: r.subject,
        page: `emails/message/${r.id}`,
      })),
    };
  }
  const exam =
      /\b(exam|midterm|quiz|final)\b/.test(q) &&
      /\b(when|next|date|within|upcoming|two weeks)\b/.test(q),
    assignment =
      /\b(assignments?|deadlines?)\b/.test(q) &&
      /\b(due|next|when|upcoming)\b/.test(q);
  if (!exam && !assignment) return null;
  let start = today,
    end = "9999-12-31";
  if (/next week/.test(q)) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    start = dateKey(d);
    d.setDate(d.getDate() + 6);
    end = dateKey(d);
  } else if (/two weeks|14 days/.test(q)) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 14);
    end = dateKey(d);
  }
  const titleTerm = exam
    ? (["midterm", "quiz", "final"].find((t) => q.includes(t)) ?? "")
    : "";
  const rows = await query<{
    id: string;
    title: string;
    date: string;
    time: string;
    code: string;
  }>(
    `SELECT a.id,a.title,${exam ? "a.date" : "a.due_date"} date,${exam ? "a.start_time" : "a.due_time"} time,c.code FROM ${exam ? "exams" : "assignments"} a JOIN courses c ON c.id=a.course_id WHERE ${exam ? "a.cancelled=0" : "a.status NOT IN ('Completed','Submitted')"} AND ${exam ? "a.date" : "a.due_date"} BETWEEN ? AND ?${courseId ? " AND a.course_id=?" : ""}${titleTerm ? " AND lower(a.title) LIKE ?" : ""} ORDER BY date,time LIMIT 40`,
    [start, end, ...params, ...(titleTerm ? [`%${titleTerm}%`] : [])],
  );
  return {
    text: rows.length
      ? rows
          .map(
            (r) =>
              `${r.code} · ${r.title} — ${r.date}${r.time ? " " + r.time : ""}`,
          )
          .join("\n")
      : "No matching upcoming records found.",
    links: rows.map((r) => ({
      label: r.title,
      page: `${exam ? "exam" : "assignment"}/${r.id}`,
    })),
  };
}
