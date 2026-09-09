import { useState } from "react";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Button, Modal, Field, ErrorText } from "../components/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import { batch, command, chooseFolder } from "../services/platform";
import { createSemester, insert, update, removeEntity } from "../db/repository";
import { tables, type SqlValue, type Schedule } from "../types";
import { dateKey } from "../utils/dates";
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid calendar date.",
  );
export function Editor() {
  const {
    editor,
    edit,
    data,
    semesterId,
    setSemesterId,
    preferences,
    refresh,
    report,
  } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const kind = editor!.kind,
    table = tables[kind];
  const entities =
    kind === "course"
      ? data.courses
      : kind === "exam"
        ? data.exams
        : kind === "assignment"
          ? data.assignments
          : kind === "semester"
            ? data.semesters
            : data.events;
  const entity = entities.find((x) => x.id === editor!.id);
  const values = (entity ?? editor?.defaults ?? {}) as unknown as Record<string, SqlValue>;
  const text = (key: string, fallback = "") => String(values[key] ?? fallback);
  const [selectedCourse, setSelectedCourse] = useState(
    text(
      "course_id",
      editor!.courseId ??
        (kind === "event"
          ? ""
          : (data.courses.find((c) => !c.archived)?.id ?? "")),
    ),
  );
  const [schedules, setSchedules] = useState<Schedule[]>(
    data.schedules.filter((s) => s.course_id === editor!.id),
  );
  const [base, setBase] = useState(preferences.university_folder ?? "");
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(form).entries());
      const get = (key: string) => String(fields[key] ?? "").trim();
      const id = editor!.id ?? crypto.randomUUID();
      let record: Record<string, SqlValue> = {};
      if (kind === "semester") {
        dateSchema.parse(get("start_date"));
        dateSchema.parse(get("end_date"));
        if (get("end_date") < get("start_date"))
          throw Error("End date must be after the start date.");
        const createdId = await createSemester({
          name: z.string().min(1).max(80).parse(get("name")),
          start_date: get("start_date"),
          end_date: get("end_date"),
          base,
        });
        setSemesterId(createdId);
      } else {
        if (kind === "course") {
          const semester = data.semesters.find((s) => s.id === semesterId);
          if (!semester) throw Error("Create a semester first.");
          const code = z
            .string()
            .min(1)
            .max(24)
            .parse(get("code"))
            .toUpperCase();
          if (
            data.courses.some(
              (c) => c.id !== id && c.code.toUpperCase() === code,
            )
          )
            throw Error(
              "A course with this code already exists in the semester.",
            );
          for (const s of schedules)
            if (!s.start_time || !s.end_time || s.end_time <= s.start_time)
              throw Error("Each class must end after its start time.");
          const folder = entity
            ? text("folder_path")
            : await command<string>("create_folder", {
                base: semester.storage_directory,
                name: code.replace(/\s/g, ""),
                course: true,
              });
          record = {
            code,
            name: z.string().min(1).max(120).parse(get("name")),
            professor: get("professor"),
            section: get("section"),
            room: get("room"),
            credits: z.coerce.number().min(0).max(30).parse(get("credits")),
            color: get("color"),
            folder_path: folder,
            semester_id: semesterId,
          };
        } else {
          record = {
            title: z
              .string()
              .min(1, "Enter a title.")
              .max(180)
              .parse(get("title")),
            course_id: selectedCourse || null,
          };
          if ((kind === "exam" || kind === "assignment") && !selectedCourse)
            throw Error("Add and select a course first.");
          if (kind === "exam") {
            dateSchema.parse(get("date"));
            if (get("end_time") && get("end_time") <= get("start_time"))
              throw Error("End time must be after start time.");
            Object.assign(record, {
              type: get("type"),
              date: get("date"),
              start_time: get("start_time"),
              end_time: get("end_time"),
              location: get("location"),
              description: get("description"),
              coverage: get("coverage"),
              notes: get("notes"),
            });
          }
          if (kind === "assignment") {
            dateSchema.parse(get("due_date"));
            if (get("assigned_date")) dateSchema.parse(get("assigned_date"));
            Object.assign(record, {
              description: get("description"),
              assigned_date: get("assigned_date"),
              due_date: get("due_date"),
              due_time: get("due_time"),
              status: get("status"),
              notes: get("notes"),
            });
          }
          if (kind === "event") {
            dateSchema.parse(get("date"));
            const start = get("date") + "T" + (get("start_time") || "00:00");
            const end = get("end_datetime");
            if (end && end < start)
              throw Error("The event must end after it starts.");
            Object.assign(record, {
              type: get("type"),
              start_datetime: start,
              end_datetime: end,
              all_day: fields.all_day ? 1 : 0,
              location: get("location"),
              description: get("description"),
            });
          }
        }
        const statements = [
          entity
            ? update(table, id, {
                ...record,
                updated_at: new Date().toISOString(),
              })
            : insert(table, { id, ...record }),
        ];
        if (kind === "course") {
          statements.push(
            {
              sql: "DELETE FROM course_schedules WHERE course_id=?",
              params: [id],
            },
            ...schedules.map((s) =>
              insert("course_schedules", {
                id: s.id,
                course_id: id,
                day_of_week: s.day_of_week,
                start_time: s.start_time,
                end_time: s.end_time,
              }),
            ),
          );
        }
        await batch(statements);
      }
      await refresh();
      report(
        `${kind[0].toUpperCase() + kind.slice(1)} ${entity ? "updated" : "added"}`,
      );
      edit(null);
    } catch (e) {
      setError(
        e instanceof z.ZodError ? e.issues[0].message : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await removeEntity(table, editor!.id!);
      await refresh();
      edit(null);
      report("Removed from UniDesk. Files on disk are preserved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = kind === "event" ? "calendar event" : kind;
  return (
    <Modal
      title={`${entity ? "Edit" : "Add"} ${label}`}
      onClose={() => {
        if (!busy) edit(null);
      }}
      wide={kind === "course"}
    >
      {confirmDelete ? (
        <div className="modal-body">
          <h3>Delete {text("title", text("code"))}?</h3>
          <p className="muted">
            {kind === "course"
              ? "This removes the course and its academic records from UniDesk. Your course files stay on disk."
              : "This removes the record from UniDesk. Attached files stay on disk."}
          </p>
          <ErrorText error={error} />
          <div className="form-actions">
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete record
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          <div className="modal-body form-content">
            {kind === "semester" ? (
              <>
                <Field label="Semester name">
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="Spring 2027"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Start date">
                    <input type="date" name="start_date" required />
                  </Field>
                  <Field label="End date">
                    <input type="date" name="end_date" required />
                  </Field>
                </div>
                <Field label="University folder">
                  <div className="input-group">
                    <input
                      value={base}
                      onChange={(e) => setBase(e.target.value)}
                      required
                    />
                    <Button
                      type="button"
                      onClick={async () => {
                        const p = await chooseFolder();
                        if (p) setBase(p);
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                </Field>
                <p className="helper">
                  The current semester will move to Archive.
                </p>
              </>
            ) : kind === "course" ? (
              <>
                <div className="form-grid">
                  <Field label="Course code">
                    <input
                      name="code"
                      defaultValue={text("code")}
                      placeholder="PHIL 210"
                      required
                      maxLength={24}
                    />
                  </Field>
                  <Field label="Course name">
                    <input
                      name="name"
                      defaultValue={text("name")}
                      placeholder="Ethics"
                      required
                      maxLength={120}
                    />
                  </Field>
                </div>
                <Field label="Professor">
                  <input
                    name="professor"
                    defaultValue={text("professor")}
                    placeholder="Dr. Maya Khoury"
                  />
                </Field>
                <div className="form-grid three">
                  <Field label="Section">
                    <input name="section" defaultValue={text("section")} />
                  </Field>
                  <Field label="Room">
                    <input name="room" defaultValue={text("room")} />
                  </Field>
                  <Field label="Credits">
                    <input
                      name="credits"
                      type="number"
                      min="0"
                      max="30"
                      step="0.5"
                      defaultValue={text("credits", "3")}
                    />
                  </Field>
                </div>
                <Field label="Course color">
                  <input
                    name="color"
                    type="color"
                    defaultValue={text("color", "#8a78b1")}
                  />
                </Field>
                <div className="section-heading">
                  <h3>Class schedule</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSchedules([
                        ...schedules,
                        {
                          id: crypto.randomUUID(),
                          course_id: editor!.id ?? "",
                          day_of_week: 1,
                          start_time: "09:00",
                          end_time: "10:15",
                        },
                      ])
                    }
                  >
                    <Plus size={14} />
                    Add meeting
                  </Button>
                </div>
                {schedules.map((s, i) => (
                  <div className="schedule-row" key={s.id}>
                    <select
                      aria-label={`Meeting ${i + 1} day`}
                      value={s.day_of_week}
                      onChange={(e) =>
                        setSchedules(
                          schedules.map((x) =>
                            x.id === s.id
                              ? { ...x, day_of_week: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((day, j) => (
                        <option value={j} key={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Meeting ${i + 1} start`}
                      type="time"
                      value={s.start_time}
                      onChange={(e) =>
                        setSchedules(
                          schedules.map((x) =>
                            x.id === s.id
                              ? { ...x, start_time: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <span>–</span>
                    <input
                      aria-label={`Meeting ${i + 1} end`}
                      type="time"
                      value={s.end_time}
                      onChange={(e) =>
                        setSchedules(
                          schedules.map((x) =>
                            x.id === s.id
                              ? { ...x, end_time: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove meeting ${i + 1}`}
                      onClick={() =>
                        setSchedules(schedules.filter((x) => x.id !== s.id))
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </>
            ) : (
              <>
                <Field label="Title">
                  <input
                    name="title"
                    required
                    maxLength={180}
                    autoFocus
                    defaultValue={text("title")}
                    placeholder={
                      kind === "exam"
                        ? "Midterm Exam"
                        : kind === "assignment"
                          ? "Assignment 3"
                          : "Reading quiz"
                    }
                  />
                </Field>
                <Field label="Course">
                  <select
                    value={selectedCourse}
                    onChange={(e) => setSelectedCourse(e.target.value)}
                    required={kind === "exam" || kind === "assignment"}
                  >
                    <option value="">
                      {kind === "event" ? "No course" : "Choose course"}
                    </option>
                    {data.courses
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                  </select>
                </Field>
                {(kind === "exam" || kind === "event") && (
                  <Field label="Type">
                    <select
                      name="type"
                      defaultValue={text(
                        "type",
                        kind === "exam" ? "Midterm" : "Deadline",
                      )}
                    >
                      {(kind === "exam"
                        ? [
                            "Quiz",
                            "Midterm",
                            "Final",
                            "Oral",
                            "Practical",
                            "Other",
                          ]
                        : ["Deadline", "Quiz", "Lecture", "Personal task"]
                      ).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="form-grid">
                  <Field
                    label={
                      kind === "exam" || kind === "event" ? "Date" : "Due date"
                    }
                  >
                    <input
                      type="date"
                      name={
                        kind === "exam" || kind === "event"
                          ? "date"
                          : "due_date"
                      }
                      required
                      defaultValue={
                        kind === "event"
                          ? text(
                              "start_datetime",
                              editor!.date ?? dateKey(),
                            ).slice(0, 10)
                          : text(
                              kind === "exam" ? "date" : "due_date",
                              editor!.date ?? dateKey(),
                            )
                      }
                    />
                  </Field>
                  <Field
                    label={
                      kind === "exam" || kind === "event"
                        ? "Start time"
                        : "Due time"
                    }
                  >
                    <input
                      type="time"
                      name={
                        kind === "exam" || kind === "event"
                          ? "start_time"
                          : "due_time"
                      }
                      defaultValue={
                        kind === "event"
                          ? text("start_datetime").slice(11, 16)
                          : text(kind === "exam" ? "start_time" : "due_time")
                      }
                      required={kind === "exam"}
                    />
                  </Field>
                </div>
                {kind === "exam" && (
                  <div className="form-grid">
                    <Field label="End time">
                      <input
                        type="time"
                        name="end_time"
                        defaultValue={text("end_time")}
                      />
                    </Field>
                    <Field label="Location">
                      <input
                        name="location"
                        defaultValue={text("location")}
                        placeholder="Nicely 212"
                      />
                    </Field>
                  </div>
                )}
                {kind === "event" && (
                  <>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        name="all_day"
                        defaultChecked={!!values.all_day}
                      />
                      All day
                    </label>
                    <Field label="End date and time">
                      <input
                        type="datetime-local"
                        name="end_datetime"
                        defaultValue={text("end_datetime")}
                      />
                    </Field>
                    <Field label="Location">
                      <input name="location" defaultValue={text("location")} />
                    </Field>
                  </>
                )}
                {kind === "assignment" && (
                  <div className="form-grid">
                    <Field label="Status">
                      <select
                        name="status"
                        defaultValue={text("status", "Not started")}
                      >
                        {[
                          "Not started",
                          "In progress",
                          "Completed",
                          "Submitted",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Assigned date">
                      <input
                        type="date"
                        name="assigned_date"
                        defaultValue={text("assigned_date")}
                      />
                    </Field>
                  </div>
                )}
                <Field label="Description">
                  <textarea
                    name="description"
                    rows={3}
                    defaultValue={text("description")}
                  />
                </Field>
                {kind === "exam" && (
                  <Field label="Topics / coverage">
                    <textarea
                      name="coverage"
                      rows={3}
                      defaultValue={text("coverage")}
                      placeholder="Weeks 1–6, chapters 1–4…"
                    />
                  </Field>
                )}
                {kind !== "event" && (
                  <Field label="Notes">
                    <textarea
                      name="notes"
                      rows={2}
                      defaultValue={text("notes")}
                    />
                  </Field>
                )}
              </>
            )}
            <ErrorText error={error} />
          </div>
          <div className="modal-footer">
            {entity && (
              <Button
                type="button"
                variant="ghost"
                className="delete-link"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            )}
            <div className="spacer" />
            <Button type="button" onClick={() => edit(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy}>
              {busy ? "Saving…" : entity ? "Save changes" : `Add ${label}`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
