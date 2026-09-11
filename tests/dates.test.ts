import { test } from "node:test";
import assert from "node:assert/strict";
import { dateKey, daysUntil, occurrences } from "../src/utils/dates";
import { reminderCandidates } from "../src/features/notifications/reminders";
import type { AcademicData } from "../src/types";
const empty: AcademicData = {
  semesters: [],
  courses: [],
  schedules: [],
  exams: [],
  assignments: [],
  events: [],
};
test("countdowns use local calendar dates through midnight and DST", () => {
  assert.equal(daysUntil("2026-10-17", new Date(2026, 8, 5, 23, 59)), 42);
  assert.equal(daysUntil("2026-09-06", new Date(2026, 8, 5, 23, 59)), 1);
  assert.equal(dateKey(new Date(2026, 8, 5, 0, 1)), "2026-09-05");
  assert.equal(daysUntil("2026-03-09", new Date(2026, 2, 8, 23)), 1);
});
test("calendar derives records once, omits completed assignments, bounds lectures to semester", () => {
  const data: AcademicData = {
    ...empty,
    semesters: [
      {
        id: "s",
        name: "Fall",
        start_date: "2026-09-07",
        end_date: "2026-09-14",
        status: "Active",
        storage_directory: "folder",
        created_at: "",
      },
    ],
    courses: [
      {
        id: "c",
        semester_id: "s",
        code: "PHIL",
        name: "Ethics",
        professor: "",
        section: "",
        room: "",
        credits: 3,
        color: "#000",
        folder_path: "folder/c",
        archived: 0,
        created_at: "",
        updated_at: "",
      },
    ],
    schedules: [
      {
        id: "meeting",
        course_id: "c",
        day_of_week: 1,
        start_time: "12:30",
        end_time: "13:45",
      },
    ],
    exams: [
      {
        id: "exam",
        course_id: "c",
        title: "Midterm",
        type: "Midterm",
        date: "2026-09-10",
        start_time: "12:30",
        end_time: "13:30",
        location: "",
        description: "",
        coverage: "",
        notes: "",
        created_at: "",
        updated_at: "",
      },
    ],
  };
  const events = occurrences(data, "2026-09-01", "2026-09-30");
  assert.equal(events.filter((e) => e.kind === "lecture").length, 2);
  assert.equal(events.filter((e) => e.kind === "exam").length, 1);
  const reminders = reminderCandidates(data, new Date(2026, 8, 7));
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].id, "exam:exam:2026-09-10:3");
  assert.deepEqual(reminders, reminderCandidates(data, new Date(2026, 8, 7)));
  assert.equal(
    reminderCandidates(
      { ...data, semesters: [{ ...data.semesters[0], status: "Archived" }] },
      new Date(2026, 8, 7),
    ).length,
    0,
  );
});
