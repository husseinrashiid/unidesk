import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch, importFile } from "../../services/platform";
import { ImportPicker } from "../documents/ImportPicker";
import {
  extractCourseDocument,
  type ExtractedDocument,
} from "../documents/localImport";
import {
  syllabusParser,
  gradingWarnings,
  type SyllabusCandidate,
  type ItemKind,
} from "./parser";
import {
  reviewLocalSyllabus,
  applyLocalSyllabus,
  fieldsByKind,
  type SyllabusReview,
} from "./repository";
import { dayNames } from "./syllabusData";
import type { SqlValue } from "../../types";
const labels: Record<string, string> = {
  name: "Name",
  code: "Course code",
  section: "Section",
  room: "Room",
  email: "Email",
  office: "Office",
  office_hours: "Office hours",
  day_of_week: "Weekday",
  start_time: "Starts",
  end_time: "Ends",
  weight: "Weight (%)",
  date: "Date",
  due_date: "Due date",
  due_time: "Due time",
  location: "Location",
  description: "Description",
  objectives: "Objectives",
  category: "Category",
  text: "Text",
  kind: "Type",
  detail: "Details",
  note: "Note",
};
const longText = new Set(["text", "detail", "description", "objectives"]);
export const hasConflict = (r: SyllabusReview) =>
  !!r.existing &&
  !r.same &&
  Object.entries(r.values).some(
    ([k, v]) =>
      String(r.existing![k] ?? "").trim() !== "" &&
      String(r.existing![k]) !== String(v),
  );
function itemSummary(i: SyllabusCandidate) {
  if (i.kind === "grade") return `${i.fields.weight}%`;
  if (i.kind === "schedule")
    return `${dayNames[+i.fields.day_of_week]} · ${i.fields.start_time}–${i.fields.end_time}`;
  if (i.kind === "office_hours")
    return "day_of_week" in i.fields
      ? `${dayNames[+i.fields.day_of_week]} · ${i.fields.start_time}–${i.fields.end_time}${i.fields.location ? ` · ${i.fields.location}` : ""}`
      : i.fields.note;
  if (i.kind === "info")
    return [
      i.fields.description ? "Description" : "",
      i.fields.objectives ? "Objectives" : "",
    ]
      .filter(Boolean)
      .join(" & ");
  if (i.kind === "policy") return i.fields.text.slice(0, 80);
  if (i.kind === "material")
    return [i.fields.kind, i.fields.detail].filter(Boolean).join(": ").slice(0, 80);
  if (i.kind === "course")
    return [
      i.fields.code,
      i.fields.name,
      i.fields.section ? `Section ${i.fields.section}` : "",
      i.fields.room,
    ]
      .filter(Boolean)
      .join(" · ");
  return Object.entries(i.fields)
    .filter(([, v]) => v)
    .map(([k, v]) =>
      ["date", "due_date"].includes(k)
        ? new Date(`${v}T12:00:00`).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : v,
    )
    .join(" · ");
}
export function SyllabusImportFlow({
  courseId,
  onDone,
}: {
  courseId: string;
  onDone: (message?: string) => void;
}) {
  const { data, refresh } = useWorkspace(),
    course = data.courses.find((c) => c.id === courseId),
    semester = data.semesters.find((s) => s.id === course?.semester_id);
  const [officeCalendar, setOfficeCalendar] = useState(false),
    [document, setDocument] = useState<ExtractedDocument | null>(null),
    [file, setFile] = useState<File | string | null>(null),
    [items, setItems] = useState<SyllabusCandidate[]>([]),
    [review, setReview] = useState<SyllabusReview[] | null>(null),
    [grades, setGrades] = useState<Record<string, SqlValue>[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saveFile, setSaveFile] = useState(true),
    [manual, setManual] = useState(false),
    [weightApproved, setWeightApproved] = useState(false),
    [choosing, setChoosing] = useState(true),
    [detectedSemester, setDetectedSemester] = useState(""),
    [gradeMode, setGradeMode] = useState<"merge" | "replace" | "ignore">(
      "merge",
    );
  const files = useQuery({
    queryKey: ["syllabus-files", courseId],
    queryFn: () =>
      query<{ id: string; filename: string }>(
        "SELECT id,filename FROM files WHERE course_id=?",
        [courseId],
      ),
  });
  useEffect(() => {
    let active = true;
    setReview(null);
    if (!document) return;
    void Promise.all([
      reviewLocalSyllabus(courseId, items),
      query<Record<string, SqlValue>>(
        "SELECT * FROM grade_categories WHERE course_id=?",
        [courseId],
      ),
    ])
      .then(([rows, gs]) => {
        if (active) {
          setReview(rows);
          setGrades(gs);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [courseId, items, document]);
  function parsed(d: ExtractedDocument, f: File | string | null) {
    const result = syllabusParser.parse(d);
    setDetectedSemester(result.semester ?? "");
    setDocument(d);
    setFile(f);
    setItems(result.items);
    setError("");
    setManual(false);
    setWeightApproved(false);
    setGradeMode("merge");
    setOfficeCalendar(false);
  }
  function edit(id: string, patch: Partial<SyllabusCandidate>) {
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setWeightApproved(false);
  }
  async function apply(fileOnly = false) {
    if (!document || !review) return;
    setBusy(true);
    setError("");
    try {
      if (
        !fileOnly &&
        items.some((i) => i.selected && i.kind === "schedule") &&
        (!semester?.start_date || !semester.end_date)
      )
        throw Error(
          "Set your semester dates before importing recurring classes.",
        );
      if (
        !fileOnly &&
        gradeMode !== "ignore" &&
        gradingWarnings(items).length &&
        !weightApproved
      )
        throw Error("Review and acknowledge the grading weights.");
      const officeRows = items.filter(
        (i) => i.selected && i.kind === "office_hours" && "day_of_week" in i.fields,
      );
      const sourceId = await applyLocalSyllabus(
        courseId,
        document,
        fileOnly ? [] : review,
        gradeMode,
        grades,
        !fileOnly && officeCalendar && officeRows.length
          ? {
              rows: officeRows.map((i) => ({
                day_of_week: +i.fields.day_of_week,
                start_time: i.fields.start_time,
                end_time: i.fields.end_time,
                location: i.fields.location ?? "",
              })),
              start: semester?.start_date ?? "",
              end: semester?.end_date ?? "",
            }
          : undefined,
      );
      if ((fileOnly || saveFile) && file && !document.fileId) {
        try {
          const result = await importFile(courseId, "Resources", file);
          if (result.id)
            await batch([
              {
                sql: "UPDATE local_import_sources SET file_id=? WHERE id=?",
                params: [result.id, sourceId],
                expectChanges: 1,
              },
              {
                sql: "UPDATE course_syllabus SET source_file_id=?,source_filename=? WHERE course_id=?",
                params: [result.id, result.filename ?? document.filename, courseId],
              },
            ]);
        } catch {
          // The syllabus data still imported; the source file just couldn't be added to Materials.
        }
      }
      await refresh();
      await files.refetch();
      onDone(
        fileOnly ? "Syllabus saved." : "Selected syllabus information imported.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const limited = items.every((i) => i.kind === "course"),
    conflicts = review?.filter((r) => r.item.selected && hasConflict(r)) ?? [],
    weightWarnings = gradingWarnings(items),
    officeHourItems = items.filter((i) => i.kind === "office_hours"),
    groups: [string, ItemKind[]][] = [
      ["Course information", ["course", "instructor", "schedule"]],
      ["Office hours", ["office_hours"]],
      ["Grading breakdown", ["grade"]],
      ["Assessments", ["exam", "assignment"]],
      ["Description & objectives", ["info"]],
      ["Policies", ["policy"]],
      ["Required materials", ["material"]],
    ];
  return (
    <div className="local-syllabus academic-review">
      <Section title={document ? "Syllabus review" : "Import syllabus"}>
        <ErrorText error={error} />
        {!document ? (
          <>
            <ImportPicker label="Syllabus document" onExtract={parsed} />
            {!!files.data?.some((f) => /\.(pdf|docx|txt)$/i.test(f.filename)) && (
              <details open={choosing}>
                <summary onClick={() => setChoosing(!choosing)}>
                  Choose from course files
                </summary>
                {files.data
                  .filter((f) => /\.(pdf|docx|txt)$/i.test(f.filename))
                  .map((f) => (
                    <Button
                      key={f.id}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          parsed(
                            await extractCourseDocument(f.id, f.filename),
                            null,
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {f.filename}
                    </Button>
                  ))}
              </details>
            )}
            <div className="modal-footer">
              <Button disabled={busy} onClick={() => onDone()}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2>
              {items.find((i) => i.kind === "course")?.fields.code ||
                course?.code}{" "}
              —{" "}
              {items.find((i) => i.kind === "course")?.fields.name ||
                course?.name}
            </h2>
            {limited && !manual ? (
              <div className="academic-empty">
                <h3>We found limited syllabus information</h3>
                {items.map((i) => (
                  <p key={i.id}>✓ {itemSummary(i)}</p>
                ))}
                <p>
                  Could not reliably detect grading, assessments or a class
                  schedule.
                </p>
                <Button
                  variant="primary"
                  disabled={busy || !review}
                  onClick={() => void apply(true)}
                >
                  Add syllabus to course files
                </Button>
                <Button onClick={() => setManual(true)}>Review manually</Button>
              </div>
            ) : (
              <>
                <p className="academic-secondary">
                  Detected {items.length} items
                  {detectedSemester ? ` — ${detectedSemester}` : ""} · Select
                  what to import. Expand an item to edit.
                </p>
                {groups.map(([heading, kinds]) => {
                  const rows = items.filter((i) => kinds.includes(i.kind));
                  return rows.length ? (
                    <section className="syllabus-section" key={heading}>
                      <h3>{heading}</h3>
                      {rows.map((item) => (
                        <article key={item.id} className="syllabus-item">
                          <div className="syllabus-item-summary">
                            <label>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={(e) =>
                                  edit(item.id, { selected: e.target.checked })
                                }
                              />
                              <strong>
                                {item.kind === "course"
                                  ? "Course"
                                  : item.kind === "schedule"
                                    ? "Class"
                                    : item.title}
                              </strong>
                            </label>
                            <span>{itemSummary(item)}</span>
                            {item.warnings.length > 0 && (
                              <small>Needs review</small>
                            )}
                          </div>
                          <details>
                            <summary>
                              Edit{" "}
                              {item.kind === "course"
                                ? "course information"
                                : item.title}
                            </summary>
                            {item.warnings.map((w) => (
                              <p role="note" key={w}>
                                {w}
                              </p>
                            ))}
                            <div className="form-grid">
                              {![
                                "course",
                                "instructor",
                                "schedule",
                                "office_hours",
                                "info",
                              ].includes(item.kind) && (
                                <Field label="Title">
                                  <input
                                    value={item.title}
                                    onChange={(e) =>
                                      edit(item.id, { title: e.target.value })
                                    }
                                  />
                                </Field>
                              )}
                              {fieldsByKind[item.kind].map((key) => (
                                <Field
                                  key={key}
                                  label={
                                    key === "name"
                                      ? item.kind === "course"
                                        ? "Course title"
                                        : "Instructor"
                                      : (labels[key] ?? key)
                                  }
                                >
                                  {key === "day_of_week" ? (
                                    <select
                                      value={item.fields[key] ?? ""}
                                      onChange={(e) =>
                                        edit(item.id, {
                                          fields: {
                                            ...item.fields,
                                            [key]: e.target.value,
                                          },
                                        })
                                      }
                                    >
                                      {dayNames.map((d, i) => (
                                        <option value={i} key={d}>
                                          {d}
                                        </option>
                                      ))}
                                    </select>
                                  ) : longText.has(key) ? (
                                    <textarea
                                      rows={3}
                                      value={item.fields[key] ?? ""}
                                      onChange={(e) =>
                                        edit(item.id, {
                                          fields: {
                                            ...item.fields,
                                            [key]: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  ) : (
                                    <input
                                      type={
                                        /date$/.test(key)
                                          ? "date"
                                          : /time$/.test(key)
                                            ? "time"
                                            : key === "weight"
                                              ? "number"
                                              : "text"
                                      }
                                      value={item.fields[key] ?? ""}
                                      onChange={(e) =>
                                        edit(item.id, {
                                          fields: {
                                            ...item.fields,
                                            [key]: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  )}
                                </Field>
                              ))}
                            </div>
                          </details>
                        </article>
                      ))}
                      {heading === "Grading breakdown" && (
                        <p>
                          <strong>
                            {rows
                              .filter((i) => i.selected)
                              .reduce((n, i) => n + Number(i.fields.weight), 0)}
                            % total
                          </strong>
                        </p>
                      )}
                      {heading === "Office hours" &&
                        officeHourItems.some(
                          (i) => i.selected && "day_of_week" in i.fields,
                        ) && (
                          <label>
                            <input
                              type="checkbox"
                              checked={officeCalendar}
                              onChange={(e) =>
                                setOfficeCalendar(e.target.checked)
                              }
                            />{" "}
                            Add office hours to calendar
                          </label>
                        )}
                    </section>
                  ) : null;
                })}
                {manual && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setItems([
                        ...items,
                        {
                          id: crypto.randomUUID(),
                          kind: "assignment",
                          title: "Assignment",
                          fields: { due_date: "" },
                          warnings: ["Choose a due date."],
                          selected: false,
                          confidence: "low",
                          reason: "Manual entry",
                        },
                      ])
                    }
                  >
                    Add an assessment
                  </Button>
                )}
                {weightWarnings.map((w) => (
                  <p role="alert" key={w}>
                    {w}
                  </p>
                ))}
                {!!weightWarnings.length && (
                  <label>
                    <input
                      type="checkbox"
                      checked={weightApproved}
                      onChange={(e) => setWeightApproved(e.target.checked)}
                    />{" "}
                    I reviewed these weights; import them as entered.
                  </label>
                )}
                {!!conflicts.length && (
                  <section className="syllabus-section">
                    <h3>{conflicts.length} changes to review</h3>
                    {conflicts.map((r) => (
                      <article className="syllabus-conflict" key={r.item.id}>
                        <strong>{r.item.title}</strong>
                        {Object.entries(r.values)
                          .filter(
                            ([k, v]) =>
                              String(r.existing![k] ?? "") !== String(v),
                          )
                          .map(([k, v]) => (
                            <div className="conflict-comparison" key={k}>
                              <span>{labels[k] ?? k}</span>
                              <span>
                                Existing: {String(r.existing![k] || "Not set")}
                              </span>
                              <span>Syllabus: {String(v || "Not set")}</span>
                            </div>
                          ))}
                        <Field label={`Resolve ${r.item.title}`}>
                          <select
                            value={r.choice}
                            onChange={(e) =>
                              setReview(
                                review!.map((x) =>
                                  x.item.id === r.item.id
                                    ? {
                                        ...x,
                                        choice: e.target
                                          .value as SyllabusReview["choice"],
                                      }
                                    : x,
                                ),
                              )
                            }
                          >
                            <option value="keep">Keep existing</option>
                            <option value="update">Use syllabus</option>
                            {[
                              "exam",
                              "assignment",
                              "schedule",
                              "office_hours",
                              "policy",
                              "material",
                            ].includes(r.item.kind) && (
                              <option value="both">Keep both</option>
                            )}
                          </select>
                        </Field>
                      </article>
                    ))}
                  </section>
                )}
                {grades.length > 0 &&
                  conflicts.some((r) => r.item.kind === "grade") && (
                    <Field label="Grading changes">
                      <select
                        value={gradeMode}
                        onChange={(e) =>
                          setGradeMode(e.target.value as typeof gradeMode)
                        }
                      >
                        <option value="merge">Apply selected changes</option>
                        <option value="ignore">Keep existing grading</option>
                        <option value="replace">
                          Replace grading breakdown
                        </option>
                      </select>
                    </Field>
                  )}
                {review
                  ?.filter((r) => r.item.selected && r.error)
                  .map((r) => (
                    <ErrorText
                      key={r.item.id}
                      error={`${r.item.title}: ${r.error}`}
                    />
                  ))}
                <section className="syllabus-section">
                  <h3>Source file</h3>
                  <p>{document.filename}</p>
                  {!document.fileId && (
                    <label>
                      <input
                        type="checkbox"
                        checked={saveFile}
                        onChange={(e) => setSaveFile(e.target.checked)}
                      />{" "}
                      Add to course files
                    </label>
                  )}
                </section>
              </>
            )}
            <div className="modal-footer">
              <Button disabled={busy} onClick={() => onDone()}>
                Cancel
              </Button>
              {(!limited || manual) && (
                <Button
                  variant="primary"
                  disabled={
                    busy ||
                    !review ||
                    !items.some((i) => i.selected) ||
                    review.some((r) => r.item.selected && !!r.error)
                  }
                  onClick={() => void apply()}
                >
                  {busy ? "Importing…" : "Import selected"}
                </Button>
              )}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
