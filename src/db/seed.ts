import { batch, command } from "../services/platform";
import { createSemester, insert } from "./repository";
export async function seedDemo(base: string) {
  const semester = await createSemester({
    name: "Fall 2026",
    start_date: "2026-08-31",
    end_date: "2026-12-20",
    base,
  });
  const courses = [
    {
      id: "demo-phil",
      code: "PHIL 210",
      name: "Ethics",
      professor: "Dr. Maya Khoury",
      room: "Nicely 212",
      color: "#8a78b1",
      days: [1, 3],
      start: "12:30",
      end: "13:45",
    },
    {
      id: "demo-cmps",
      code: "CMPS 256",
      name: "Algorithms and Data Structures",
      professor: "Dr. Karim Haddad",
      room: "Bliss 205",
      color: "#5b88b2",
      days: [2, 4],
      start: "15:00",
      end: "16:15",
    },
    {
      id: "demo-hist",
      code: "HIST 210",
      name: "Modern Middle Eastern History",
      professor: "Dr. Rania Mansour",
      room: "Fisk 101",
      color: "#bd8b58",
      days: [1, 3],
      start: "10:00",
      end: "11:15",
    },
  ];
  const folders: Record<string, string> = {};
  for (const c of courses)
    folders[c.id] = await command<string>("create_folder", {
      base: await command<string>("create_folder", {
        base,
        name: "Fall 2026",
        course: false,
      }),
      name: c.code.replace(/\s/g, ""),
      course: true,
    });
  await batch(
    courses
      .flatMap((c) => [
        insert("courses", {
          id: c.id,
          semester_id: semester,
          code: c.code,
          name: c.name,
          professor: c.professor,
          room: c.room,
          color: c.color,
          folder_path: folders[c.id],
          section: "1",
          credits: 3,
        }),
        ...c.days.map((day) =>
          insert("course_schedules", {
            id: crypto.randomUUID(),
            course_id: c.id,
            day_of_week: day,
            start_time: c.start,
            end_time: c.end,
          }),
        ),
      ])
      .concat([
        insert("exams", {
          id: "demo-midterm",
          course_id: "demo-phil",
          title: "Midterm Exam",
          type: "Midterm",
          date: "2026-10-17",
          start_time: "12:30",
          end_time: "14:00",
          location: "Nicely 212",
          coverage:
            "Weeks 1–6: moral reasoning, virtue ethics, utilitarianism, and Kantian ethics.",
          description: "Closed book. Bring your student ID and a pen.",
        }),
        insert("assignments", {
          id: "demo-assignment",
          course_id: "demo-cmps",
          title: "Assignment 2",
          due_date: "2026-09-10",
          due_time: "23:59",
          status: "In progress",
          description:
            "Implement a binary search tree with insertion, deletion, and traversal. Include complexity analysis and test cases.",
        }),
        insert("assignments", {
          id: "demo-essay",
          course_id: "demo-hist",
          title: "Essay draft",
          due_date: "2026-09-14",
          due_time: "17:00",
          status: "Not started",
          description:
            "A 1,500-word draft on the late Ottoman reforms. Cite at least three course readings.",
        }),
        insert("assignments", {
          id: "demo-reflection",
          course_id: "demo-phil",
          title: "Reading reflection",
          due_date: "2026-09-18",
          due_time: "23:59",
          status: "Not started",
        }),
        insert("calendar_events", {
          id: "demo-quiz",
          course_id: "demo-phil",
          title: "Reading quiz",
          type: "Quiz",
          start_datetime: "2026-09-08T12:30",
          end_datetime: "2026-09-08T12:50",
        }),
        insert("calendar_events", {
          id: "demo-deadline",
          title: "Last day to change courses",
          type: "Deadline",
          start_datetime: "2026-09-11T00:00",
          all_day: 1,
        }),
      ]),
  );
  const notes = [
    [
      "demo-phil",
      "Lectures",
      "Lecture 03 — Virtue ethics.txt",
      "Lecture 3 · Virtue ethics\n\nAristotle: a good life involves the cultivation of virtue through habit.\nReview: the doctrine of the mean; practical wisdom; eudaimonia.",
    ],
    [
      "demo-cmps",
      "Assignments",
      "Assignment 02 — Brief.txt",
      "Assignment 2\n\nImplement a binary search tree. Include insertion, deletion, traversal, and tests.\nDue September 10, 2026 at 11:59 PM.",
    ],
    [
      "demo-hist",
      "Readings",
      "Week 01 — Reading list.txt",
      "Week 1 reading list\n\nReview the assigned introduction to the modern Middle East.\nTake notes on chronology, institutions, and primary sources.",
    ],
  ];
  for (const [courseId, category, filename, content] of notes)
    await command("import_file", {
      courseId,
      category,
      filename,
      bytes: Array.from(new TextEncoder().encode(content)),
    });
}
