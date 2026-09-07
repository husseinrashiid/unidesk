import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Modal } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { insert, update } from "../../db/repository";
import { query, batch } from "../../services/platform";
import { dateKey } from "../../utils/dates";
import { useTracking } from "./useTracking";
import type { TrackingTable, TrackRecord } from "./types";
import type { AcademicFile, SqlValue } from "../../types";
import { specs, labels } from "./editorFields";
export { labels } from "./editorFields";
const localDateTime = (value: string) => {
  const d = new Date(value);
  return (
    dateKey(d) +
    "T" +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
};
export interface TrackingEditorProps {
  table: TrackingTable;
  record?: TrackRecord;
  courseId?: string;
  defaults?: Record<string, SqlValue>;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}
export function TrackingEditor({
  table,
  record,
  courseId,
  defaults = {},
  onClose,
  onSaved,
}: TrackingEditorProps) {
  const { data, preferences, refresh } = useWorkspace();
  const { p, save } = useTracking();
  const [values, setValues] = useState<Record<string, SqlValue>>(() => ({
    course_id:
      courseId ??
      record?.course_id ??
      data.courses.find((c) => !c.archived)?.id ??
      "",
    points_possible: 100,
    sort_order: 0,
    estimated_minutes: Number(preferences.study_default_minutes ?? 45),
    scheduled_date: dateKey(),
    started_at: dateKey() + "T12:00",
    duration_minutes: 45,
    ...Object.fromEntries(
      specs[table].filter((s) => s.options).map((s) => [s.key, s.options![0]]),
    ),
    ...record,
    ...(record?.duration_seconds
      ? {
          duration_minutes: record.duration_seconds / 60,
          started_at: localDateTime(record.started_at!),
        }
      : {}),
    ...defaults,
  }));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const { data: files = [] } = useQuery({
    queryKey: ["academic-files", values.course_id],
    queryFn: () =>
      query<AcademicFile>(
        "SELECT * FROM files WHERE course_id=? ORDER BY filename",
        [values.course_id],
      ),
  });
  const {
    data: attached = [],
    isPending: attachmentsPending,
    error: attachmentError,
  } = useQuery({
    queryKey: ["lecture-files", record?.id],
    enabled: table === "lectures" && !!record,
    queryFn: () =>
      query<{ file_id: string }>(
        "SELECT file_id FROM lecture_files WHERE lecture_id=?",
        [record!.id],
      ),
  });
  const [fileIds, setFileIds] = useState<string[] | null>(null);
  const relation = (key: string) => {
    const rows =
      key === "category_id"
        ? p.grade_categories
        : key === "assignment_id"
          ? data.assignments
          : key === "exam_id"
            ? data.exams
            : key === "lecture_id"
              ? p.lectures
              : key === "reading_id"
                ? p.readings
                : key === "previous_exam_id"
                  ? p.previous_exam_attempts
                  : files.map((f) => ({ ...f, title: f.filename }));
    return rows
      .filter((r) => r.course_id === values.course_id)
      .map((r) => ({
        id: r.id,
        title: "name" in r && r.name ? r.name : r.title,
      }));
  };
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const out: Record<string, SqlValue> = { course_id: values.course_id };
      for (const s of specs[table]) {
        const v = values[s.key];
        if (s.key === "duration_minutes") continue;
        out[s.key] =
          s.type === "number"
            ? v == null || v === ""
              ? null
              : Number(v)
            : s.type === "checkbox"
              ? Number(v || 0)
              : s.type === "relation"
                ? v || null
                : String(v ?? "").trim();
        if (
          s.type === "number" &&
          out[s.key] !== null &&
          (!Number.isFinite(Number(out[s.key])) ||
            (s.min !== undefined && Number(out[s.key]) < s.min) ||
            (s.max !== undefined && Number(out[s.key]) > s.max))
        )
          throw Error(`${s.label} is outside the allowed range.`);
        if (
          s.type === "date" &&
          out[s.key] &&
          !/^\d{4}-\d{2}-\d{2}$/.test(String(out[s.key]))
        )
          throw Error("Enter a valid date.");
        if (s.required && (out[s.key] === null || out[s.key] === ""))
          throw Error(`${s.label} is required.`);
      }
      if (!out.course_id) throw Error("Choose a course first.");
      if (table === "exam_topics")
        out.exam_id = record?.exam_id ?? defaults.exam_id ?? null;
      if (table === "grade_items" && out.exam_id && out.assignment_id)
        throw Error("Link either an exam or an assignment.");
      if (table === "lectures")
        out.reviewed_at =
          out.status === "Reviewed"
            ? (record?.reviewed_at ?? new Date().toISOString())
            : null;
      if (table === "previous_exam_attempts" || table === "study_blocks")
        out.completed_at =
          out.status === "Completed" || out.completed === 1
            ? (record?.completed_at ?? new Date().toISOString())
            : null;
      if (table === "study_sessions") {
        const seconds = Math.round(Number(values.duration_minutes) * 60);
        const start = new Date(String(out.started_at));
        if (
          !Number.isFinite(seconds) ||
          seconds <= 0 ||
          !Number.isFinite(start.getTime())
        )
          throw Error("Enter a valid start date and positive duration.");
        out.started_at = start.toISOString();
        out.ended_at = new Date(start.getTime() + seconds * 1000).toISOString();
        out.duration_seconds = seconds;
      }
      if (table === "lectures") {
        if (record && (attachmentsPending || attachmentError))
          throw Error("Wait for attached files to load before saving.");
        const id = record?.id ?? crypto.randomUUID();
        await batch([
          record ? update(table, id, out) : insert(table, { id, ...out }),
          { sql: "DELETE FROM lecture_files WHERE lecture_id=?", params: [id] },
          ...(fileIds ?? attached.map((f) => f.file_id)).map((file_id) => ({
            sql: "INSERT INTO lecture_files(lecture_id,file_id) VALUES (?,?)",
            params: [id, file_id],
          })),
        ]);
        await refresh();
      } else await save(table, out, record?.id);
      await onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${record ? "Edit" : "Add"} ${labels[table].toLowerCase()}`}
      onClose={onClose}
    >
      <form
        className="academic-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Course">
          <select
            required
            disabled={!!record || !!courseId}
            value={String(values.course_id)}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                course_id: e.target.value,
                ...Object.fromEntries(
                  [
                    "category_id",
                    "assignment_id",
                    "exam_id",
                    "lecture_id",
                    "reading_id",
                    "task_id",
                    "previous_exam_id",
                    "file_id",
                  ].map((k) => [k, null]),
                ),
              }));
              setFileIds([]);
            }}
          >
            <option value="">Choose course</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </Field>
        <div className="academic-form-grid">
          {specs[table].map((s) => (
            <Field key={s.key} label={s.label}>
              {s.type === "textarea" ? (
                <textarea
                  value={String(values[s.key] ?? "")}
                  onChange={(e) =>
                    setValues({ ...values, [s.key]: e.target.value })
                  }
                />
              ) : s.options || s.type === "relation" ? (
                <select
                  required={s.required}
                  value={String(values[s.key] ?? "")}
                  onChange={(e) =>
                    setValues({ ...values, [s.key]: e.target.value })
                  }
                >
                  {s.options ? (
                    s.options.map((o) => (
                      <option key={o} value={o}>
                        {o || "Not set"}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="">
                        {s.required ? "Choose component" : "None"}
                      </option>
                      {relation(s.key).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              ) : (
                <input
                  type={s.type ?? "text"}
                  required={s.required}
                  min={s.min}
                  max={s.max}
                  step="any"
                  checked={!!values[s.key]}
                  value={
                    s.type === "checkbox"
                      ? undefined
                      : String(values[s.key] ?? "")
                  }
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [s.key]:
                        s.type === "checkbox"
                          ? Number(e.target.checked)
                          : e.target.value,
                    })
                  }
                />
              )}
            </Field>
          ))}
        </div>
        {table === "grade_items" && (
          <p className="small muted">
            Assessments share a component by points possible. Relative item
            weight overrides that share. Missing scores stay ungraded; excluded
            assessments are omitted.
          </p>
        )}
        {table === "lectures" && (
          <Field label="Attach existing files">
            <div className="academic-file-options">
              {files.map((f) => (
                <label key={f.id}>
                  <input
                    type="checkbox"
                    checked={(
                      fileIds ?? attached.map((x) => x.file_id)
                    ).includes(f.id)}
                    onChange={(e) => {
                      const ids = fileIds ?? attached.map((x) => x.file_id);
                      setFileIds(
                        e.target.checked
                          ? [...ids, f.id]
                          : ids.filter((id) => id !== f.id),
                      );
                    }}
                  />
                  {f.filename}
                </label>
              ))}
              {!files.length && (
                <p className="muted">
                  Import files in the course workspace first.
                </p>
              )}
            </div>
          </Field>
        )}
        {record && table === "lectures" && (
          <p className="small muted">
            Reviewed: {record.reviewed_at?.slice(0, 10) || "Not yet"} · Recent
            study:{" "}
            {p.study_sessions
              .filter((s) => s.lecture_id === record.id)
              .map(
                (s) =>
                  `${s.started_at?.slice(0, 10)} (${Math.round((s.duration_seconds ?? 0) / 60)} min)`,
              )
              .join(", ") || "No sessions"}
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {confirmDelete && (
          <p role="alert">
            Delete this {labels[table].toLowerCase()}?{" "}
            {table === "grade_categories"
              ? "Its grade assessments will also be deleted."
              : "Linked study history will remain; its reference will be cleared."}
          </p>
        )}
        <div className="modal-actions">
          {record && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                setBusy(true);
                try {
                  await batch([
                    {
                      sql: `DELETE FROM ${table} WHERE id=?`,
                      params: [record.id],
                    },
                  ]);
                  await refresh();
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
