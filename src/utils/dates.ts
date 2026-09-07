import type { AcademicData, Occurrence } from "../types";

export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

export function daysUntil(value: string, now = new Date()): number {
  const d = parseDate(value);

  return Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000,
  );
}

export function relativeDate(value: string): string {
  if (!value) return "No date";

  const n = daysUntil(value);

  return n < 0
    ? `${Math.abs(n)}d overdue`
    : n === 0
      ? "Today"
      : n === 1
        ? "Tomorrow"
        : `In ${n} days`;
}

export function shortDate(value: string): string {
  return value
    ? parseDate(value).toLocaleDateString("en-US", {
        month: "short",

        day: "numeric",
      })
    : "No date";
}

export function timeLabel(value: string): string {
  if (!value) return "All day";

  const [h, m] = value.split(":").map(Number);

  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function urgency(date: string): string {
  const n = daysUntil(date);

  return n <= 2 ? "urgent" : n <= 6 ? "warning" : n <= 14 ? "info" : "";
}

export function occurrences(
  data: AcademicData,

  start: string,

  end: string,
): Occurrence[] {
  const result: Occurrence[] = [];

  for (const b of data.studyBlocks ?? []) {
    result.push({
      id: b.id,
      entity_id: b.id,
      kind: "study",
      title: b.title,
      course_id: b.course_id,
      date: b.scheduled_date!,
      time: b.start_time ?? "",
      end_time: b.start_time
        ? (() => {
            const minutes =
              Number(b.start_time!.slice(0, 2)) * 60 +
              Number(b.start_time!.slice(3)) +
              (b.estimated_minutes ?? 45);
            return `${String(Math.min(23, Math.floor(minutes / 60))).padStart(2, "0")}:${String(minutes >= 1440 ? 59 : minutes % 60).padStart(2, "0")}`;
          })()
        : "",
      type: "Study",
      all_day: !b.start_time,
    });
  }

  for (const e of data.exams)
    result.push({
      id: e.id,

      entity_id: e.id,

      kind: "exam",
      cancelled: !!e.cancelled,

      title: e.cancelled ? `Cancelled · ${e.title}` : e.title,

      course_id: e.course_id,

      date: e.date,

      time: e.start_time,

      end_time: e.end_time,

      type: e.type,

      all_day: !e.start_time,
    });

  for (const a of data.assignments.filter(
    (a) => !["Completed", "Submitted"].includes(a.status),
  ))
    result.push({
      id: a.id,

      entity_id: a.id,

      kind: "assignment",

      title: a.title,

      course_id: a.course_id,

      date: a.due_date,

      time: a.due_time,

      end_time: "",

      type: "Assignment",

      all_day: !a.due_time,
    });

  for (const e of data.events)
    result.push({
      id: e.id,

      entity_id: e.id,

      kind: "event",

      title: e.title,

      course_id: e.course_id,

      date: e.start_datetime.slice(0, 10),

      time: e.all_day ? "" : e.start_datetime.slice(11, 16),

      end_time: e.end_datetime.slice(11, 16),

      type: e.type,

      all_day: !!e.all_day,
    });

  for (
    let d = parseDate(start);
    data.schedules.length && dateKey(d) <= end;
    d.setDate(d.getDate() + 1)
  )
    for (const s of data.schedules) {
      const c = data.courses.find((c) => c.id === s.course_id),
        semester = data.semesters.find((x) => x.id === c?.semester_id);

      const key = dateKey(d);

      if (
        c &&
        !c.archived &&
        semester &&
        key >= semester.start_date &&
        key <= semester.end_date &&
        d.getDay() === s.day_of_week
      )
        result.push({
          id: `${s.id}-${key}`,

          entity_id: c.id,

          kind: "lecture",

          title: `${c.code} · Lecture`,

          course_id: c.id,

          date: key,

          time: s.start_time,

          end_time: s.end_time,

          type: "Lecture",

          all_day: false,
        });
    }

  for (const exception of data.scheduleExceptions ?? []) {
    const course = data.courses.find(c=>c.id===exception.course_id);
    if (!course || course.archived) continue;
    const original=result.find(e=>e.kind==='lecture' && e.course_id===exception.course_id && e.date===exception.date && e.time===exception.original_start_time);
    if (original) {
      original.exception_id=exception.id; original.source_email_id=exception.source_email_id;
      if (exception.exception_type === 'Cancelled' || exception.exception_type === 'Rescheduled') {
        original.cancelled=true;
        original.title=`${course.code} · ${exception.exception_type === 'Cancelled' ? 'Class cancelled' : `Moved to ${exception.new_date}`}`;
        original.type=exception.exception_type;
      } else {
        original.time=exception.new_start_time || original.time;
        original.end_time=exception.new_end_time || original.end_time;
        original.location=exception.room || course.room;
        original.title=`${course.code} · Lecture${exception.room ? ` · ${exception.room}` : ''}`;
        original.type=exception.exception_type;
      }
    }
    if (exception.exception_type === 'Rescheduled' && exception.new_date) result.push({
      id:`exception-${exception.id}`,entity_id:course.id,kind:'lecture',course_id:course.id,
      title:`${course.code} · Rescheduled class${exception.room ? ` · ${exception.room}` : ''}`,
      date:exception.new_date,time:exception.new_start_time || exception.original_start_time,end_time:exception.new_end_time || exception.original_end_time,
      type:'Rescheduled',all_day:false,location:exception.room || course.room,source_email_id:exception.source_email_id,exception_id:exception.id,
    });
  }
  return result

    .filter((e) => e.date >= start && e.date <= end)

    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
