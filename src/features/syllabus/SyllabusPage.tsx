import { ResponsiveTable } from "../../components/ResponsiveTable";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Section,
  Field,
  Empty,
  ErrorText,
  Modal,
  TextLink,
} from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { fileAction } from "../../services/platform";
import { dateKey, occurrences, timeLabel, relativeDate } from "../../utils/dates";
import { EventRows } from "../calendar/EventRows";
import { ProfessorDirectory } from "../email/ProfessorDirectory";
import { useTracking } from "../academic/useTracking";
import { TrackingEditor } from "../academic/TrackingEditor";
import { courseGrade } from "../academic/grades";
import { SyllabusImportFlow } from "./SyllabusImport";
import {
  loadCourseSyllabus,
  updateSyllabusInfo,
  savePolicy,
  removePolicy,
  saveMaterial,
  removeMaterial,
  saveOfficeHours,
  removeOfficeHours,
  addOfficeHoursToCalendar,
  officeHoursOnCalendar,
  dayNames,
  dayAbbrev,
  type SyllabusPolicy,
  type SyllabusMaterial,
  type SyllabusOfficeHours,
} from "./syllabusData";
function PolicyEditor({
  courseId,
  record,
  onClose,
  onSaved,
}: {
  courseId: string;
  record?: SyllabusPolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(record?.category ?? "Attendance"),
    [text, setText] = useState(record?.text ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const categories = [
    "Attendance",
    "Late work",
    "Academic integrity",
    "Participation",
    "Make-up exams",
    "Communication",
    "Electronic devices",
    "Other",
  ];
  return (
    <Modal title={record ? "Edit policy" : "Add policy"} onClose={onClose}>
      <div className="modal-body">
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Policy text">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorText error={error} />
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await savePolicy(courseId, { category, text: text.trim() }, record?.id);
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save policy
        </Button>
      </div>
    </Modal>
  );
}
function MaterialEditor({
  courseId,
  record,
  onClose,
  onSaved,
}: {
  courseId: string;
  record?: SyllabusMaterial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState(record?.kind ?? "textbook"),
    [title, setTitle] = useState(record?.title ?? ""),
    [detail, setDetail] = useState(record?.detail ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={record ? "Edit material" : "Add material"} onClose={onClose}>
      <div className="modal-body">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {["textbook", "reading", "software", "website", "equipment", "material"].map(
              (k) => (
                <option key={k}>{k}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Details">
          <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <ErrorText error={error} />
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !title.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await saveMaterial(
                courseId,
                { kind, title: title.trim(), detail: detail.trim() },
                record?.id,
              );
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save material
        </Button>
      </div>
    </Modal>
  );
}
function OfficeHoursEditor({
  courseId,
  record,
  onClose,
  onSaved,
}: {
  courseId: string;
  record?: SyllabusOfficeHours;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [byAppointment, setByAppointment] = useState(record?.day_of_week == null),
    [day, setDay] = useState(record?.day_of_week ?? 1),
    [start, setStart] = useState(record?.start_time ?? "14:00"),
    [end, setEnd] = useState(record?.end_time ?? "15:00"),
    [location, setLocation] = useState(record?.location ?? ""),
    [note, setNote] = useState(record?.note ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={record ? "Edit office hours" : "Add office hours"} onClose={onClose}>
      <div className="modal-body">
        <label>
          <input
            type="checkbox"
            checked={byAppointment}
            onChange={(e) => setByAppointment(e.target.checked)}
          />{" "}
          By appointment (no fixed day/time)
        </label>
        {!byAppointment && (
          <>
            <Field label="Day">
              <select value={day} onChange={(e) => setDay(+e.target.value)}>
                {dayNames.map((d, i) => (
                  <option value={i} key={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends">
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Location">
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        {byAppointment && (
          <Field label="Note">
            <input
              value={note}
              placeholder="e.g. By appointment — email to schedule"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
        <ErrorText error={error} />
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || (byAppointment ? !note.trim() : end <= start)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await saveOfficeHours(
                courseId,
                byAppointment
                  ? { day_of_week: null, start_time: "", end_time: "", location, note: note.trim() }
                  : { day_of_week: day, start_time: start, end_time: end, location, note: "" },
                record?.id,
              );
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save office hours
        </Button>
      </div>
    </Modal>
  );
}
function DescriptionEditor({
  syllabusId,
  description,
  objectives,
  onClose,
  onSaved,
}: {
  syllabusId: string;
  description: string;
  objectives: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState(description),
    [o, setO] = useState(objectives),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Edit description & objectives" onClose={onClose}>
      <div className="modal-body">
        <Field label="Course description">
          <textarea rows={5} value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        <Field label="Learning objectives (one per line)">
          <textarea rows={5} value={o} onChange={(e) => setO(e.target.value)} />
        </Field>
        <ErrorText error={error} />
      </div>
      <div className="modal-footer">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await updateSyllabusInfo(syllabusId, {
                description: d.trim(),
                objectives: o.trim(),
              });
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
export function SyllabusPage({ courseId }: { courseId: string }) {
  const { data, navigate } = useWorkspace(),
    course = data.courses.find((c) => c.id === courseId),
    semester = data.semesters.find((s) => s.id === course?.semester_id);
  const [importing, setImporting] = useState(false),
    [editing, setEditing] = useState(false),
    [done, setDone] = useState(""),
    [editingInstructor, setEditingInstructor] = useState(false),
    [policyEditor, setPolicyEditor] = useState<SyllabusPolicy | "new" | null>(null),
    [materialEditor, setMaterialEditor] = useState<SyllabusMaterial | "new" | null>(null),
    [hoursEditor, setHoursEditor] = useState<SyllabusOfficeHours | "new" | null>(null),
    [descriptionEditor, setDescriptionEditor] = useState(false),
    [gradeEditor, setGradeEditor] = useState(false);
  const syllabus = useQuery({
    queryKey: ["syllabus-page", courseId],
    queryFn: () => loadCourseSyllabus(courseId),
  });
  const calendarStatus = useQuery({
    queryKey: ["syllabus-office-hours-calendar", courseId],
    queryFn: () => officeHoursOnCalendar(courseId),
  });
  const { p: tracking } = useTracking();
  const gradeCategories = tracking.grade_categories
    .filter((c) => c.course_id === courseId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const gradeItems = tracking.grade_items.filter((i) => i.course_id === courseId);
  const gradeResult = courseGrade(gradeCategories, gradeItems);
  if (!course) return <Empty title="Course not found" />;
  const s = syllabus.data;
  const hasAny =
    !!s &&
    (s.info ||
      s.policies.length ||
      s.materials.length ||
      s.officeHours.length ||
      s.instructors.length ||
      gradeCategories.length);
  const refetch = async () => {
    await syllabus.refetch();
    await calendarStatus.refetch();
  };
  if (importing)
    return (
      <SyllabusImportFlow
        courseId={courseId}
        onDone={(message) => {
          setImporting(false);
          setDone(message ?? "");
          void refetch();
        }}
      />
    );
  if (syllabus.isPending) return <p>Loading syllabus…</p>;
  if (!hasAny)
    return (
      <div className="syllabus-page academic-empty">
        <h3>Syllabus</h3>
        <p>
          Import a syllabus to automatically detect instructor information, class
          schedule, office hours, grading breakdown, exams and assignments.
        </p>
        <p className="academic-secondary">Parsing happens locally.</p>
        <Button variant="primary" onClick={() => setImporting(true)}>
          Import syllabus
        </Button>
      </div>
    );
  const exams = data.exams.filter((e) => e.course_id === courseId);
  const assignments = data.assignments.filter((a) => a.course_id === courseId);
  const importantDates = occurrences(
    { ...data, schedules: [], events: [], studyBlocks: [] },
    dateKey(),
    "2099-12-31",
  ).filter((e) => e.course_id === courseId);
  const structuredHours = s!.officeHours.filter((h) => h.day_of_week !== null);
  return (
    <div className="syllabus-page">
      {done && (
        <p role="status" className="academic-secondary">
          {done}
        </p>
      )}
      <header className="syllabus-header">
        <div>
          <h2>Syllabus</h2>
          {s!.sourceFile || s!.info?.source_filename ? (
            <p className="academic-secondary">
              Last updated from{" "}
              <strong>{s!.sourceFile?.filename ?? s!.info?.source_filename}</strong>
              {s!.info?.imported_at ? ` · ${s!.info.imported_at.slice(0, 10)}` : ""}
            </p>
          ) : null}
        </div>
        <div className="syllabus-header-actions">
          <Button onClick={() => setEditing(!editing)}>
            {editing ? "Done editing" : "Edit syllabus info"}
          </Button>
          {s!.sourceFile && (
            <Button onClick={() => void fileAction(s!.sourceFile!.id, "open")}>
              Open original
            </Button>
          )}
          <Button variant="primary" onClick={() => setImporting(true)}>
            Replace syllabus
          </Button>
        </div>
      </header>
      <div className="degree-overview-grid syllabus-grid">
        <div>
          <Section title="Instructor">
            {s!.instructors.length ? (
              s!.instructors.map((i) => (
                <div className="syllabus-instructor" key={i.id}>
                  <strong>{i.name}</strong>
                  <p className="academic-secondary">
                    <button
                      className="link-button"
                      onClick={() => void navigator.clipboard.writeText(i.email)}
                    >
                      {i.email}
                    </button>
                  </p>
                  {i.office && <p className="small muted">Office · {i.office}</p>}
                  {i.office_hours && !structuredHours.length && (
                    <p className="small muted">Office hours · {i.office_hours}</p>
                  )}
                </div>
              ))
            ) : (
              <p className="academic-secondary">Instructor not detected.</p>
            )}
            {editing && (
              <TextLink onClick={() => setEditingInstructor(!editingInstructor)}>
                {editingInstructor ? "Hide instructor editor" : "Edit instructor"}
              </TextLink>
            )}
            {editingInstructor && <ProfessorDirectory courseId={courseId} />}
          </Section>
          <Section
            title="Class information"
            action={
              editing ? (
                <TextLink onClick={() => navigate(`course/${courseId}/Schedule`)}>
                  Edit schedule
                </TextLink>
              ) : undefined
            }
          >
            <dl className="details-list">
              {!!data.schedules.filter((sc) => sc.course_id === courseId).length && (
                <>
                  <dt>Class schedule</dt>
                  <dd>
                    {data.schedules
                      .filter((sc) => sc.course_id === courseId)
                      .map((sc) => `${dayAbbrev[sc.day_of_week]} ${timeLabel(sc.start_time)}`)
                      .join(" · ")}
                  </dd>
                </>
              )}
              {course.room && (
                <>
                  <dt>Room</dt>
                  <dd>{course.room}</dd>
                </>
              )}
              {course.section && (
                <>
                  <dt>Section</dt>
                  <dd>{course.section}</dd>
                </>
              )}
              {semester && (
                <>
                  <dt>Term</dt>
                  <dd>{semester.name}</dd>
                </>
              )}
            </dl>
          </Section>
          <Section title="Office hours">
            {structuredHours.length || s!.officeHours.length ? (
              <>
                {s!.officeHours.map((h) => (
                  <div className="syllabus-office-hour-row" key={h.id}>
                    <span>
                      {h.day_of_week !== null
                        ? `${dayNames[h.day_of_week]} · ${timeLabel(h.start_time)}–${timeLabel(h.end_time)}`
                        : h.note || "By appointment"}
                    </span>
                    {h.location && <span className="muted">{h.location}</span>}
                    {editing && (
                      <span className="row-actions">
                        <TextLink onClick={() => setHoursEditor(h)}>Edit</TextLink>
                        <TextLink
                          onClick={async () => {
                            await removeOfficeHours(h.id);
                            void refetch();
                          }}
                        >
                          Remove
                        </TextLink>
                      </span>
                    )}
                  </div>
                ))}
                {!!structuredHours.length &&
                  (calendarStatus.data ? (
                    <p className="academic-secondary">Added to calendar</p>
                  ) : (
                    <Button
                      disabled={!semester?.start_date || !semester?.end_date}
                      onClick={async () => {
                        await addOfficeHoursToCalendar(
                          courseId,
                          structuredHours,
                          semester!.start_date,
                          semester!.end_date,
                          `From ${s!.info?.source_filename || "syllabus"}`,
                        );
                        void calendarStatus.refetch();
                      }}
                    >
                      Add to calendar
                    </Button>
                  ))}
              </>
            ) : (
              <p className="academic-secondary">No office hours detected.</p>
            )}
            {editing && (
              <TextLink onClick={() => setHoursEditor("new")}>Add office hours</TextLink>
            )}
          </Section>
        </div>
        <div>
          <Section
            title="Grading"
            action={
              editing ? (
                <TextLink onClick={() => setGradeEditor(true)}>Add component</TextLink>
              ) : undefined
            }
          >
            {gradeCategories.length ? (
              <div className="academic-table-wrap">
                <ResponsiveTable className="academic-table">
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Weight</th>
                      <th>Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeResult.categories.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.weight}%</td>
                        <td>{c.current === null ? "—" : `${c.current.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
              </div>
            ) : (
              <p className="academic-secondary">No grading breakdown detected.</p>
            )}
            {gradeCategories.length > 0 && (
              <p className="academic-secondary">
                <TextLink onClick={() => navigate(`course/${courseId}/Grades`)}>
                  Open full grade calculator
                </TextLink>
              </p>
            )}
          </Section>
          <Section title="Important dates">
            {importantDates.length ? (
              <EventRows items={importantDates.slice(0, 8)} />
            ) : (
              <p className="academic-secondary">No upcoming assessment dates.</p>
            )}
          </Section>
        </div>
      </div>
      <Section title="Assessments">
        {exams.length || assignments.length ? (
          <div className="academic-table-wrap">
            <ResponsiveTable className="academic-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Assessment</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr
                    key={e.id}
                    className="academic-course-link"
                    onClick={() => navigate(`exam/${e.id}`)}
                  >
                    <td>{e.type || "Exam"}</td>
                    <td>{e.title}</td>
                    <td>{e.date ? relativeDate(e.date) : "—"}</td>
                    <td>{e.date >= dateKey() ? "Upcoming" : "Past"}</td>
                  </tr>
                ))}
                {assignments.map((a) => (
                  <tr
                    key={a.id}
                    className="academic-course-link"
                    onClick={() => navigate(`assignment/${a.id}`)}
                  >
                    <td>Assignment</td>
                    <td>{a.title}</td>
                    <td>{a.due_date ? relativeDate(a.due_date) : "—"}</td>
                    <td>{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
        ) : (
          <p className="academic-secondary">No exams or assignments detected yet.</p>
        )}
      </Section>
      {(s!.info?.description || s!.info?.objectives || editing) && (
        <details
          className="degree-group"
          open={!!(s!.info?.description || s!.info?.objectives)}
        >
          <summary>
            <strong>Course description & objectives</strong>
          </summary>
          {s!.info?.description && <p>{s!.info.description}</p>}
          {s!.info?.objectives && (
            <ul>
              {s!.info.objectives
                .split("\n")
                .filter(Boolean)
                .map((line, i) => (
                  <li key={i}>{line.replace(/^[-•*]\s*/, "")}</li>
                ))}
            </ul>
          )}
          {editing && (
            <TextLink onClick={() => setDescriptionEditor(true)}>
              Edit description & objectives
            </TextLink>
          )}
        </details>
      )}
      {(s!.materials.length > 0 || editing) && (
        <details className="degree-group" open={s!.materials.length > 0}>
          <summary>
            <strong>Required materials</strong>
          </summary>
          {s!.materials.map((m) => (
            <div className="syllabus-material-row" key={m.id}>
              <strong>{m.title}</strong>
              <p>{m.detail}</p>
              {editing && (
                <span className="row-actions">
                  <TextLink onClick={() => setMaterialEditor(m)}>Edit</TextLink>
                  <TextLink
                    onClick={async () => {
                      await removeMaterial(m.id);
                      void refetch();
                    }}
                  >
                    Remove
                  </TextLink>
                </span>
              )}
            </div>
          ))}
          {editing && (
            <TextLink onClick={() => setMaterialEditor("new")}>Add material</TextLink>
          )}
        </details>
      )}
      {(s!.policies.length > 0 || editing) && (
        <details className="degree-group" open={s!.policies.length > 0}>
          <summary>
            <strong>Policies</strong>
          </summary>
          {s!.policies.map((p) => (
            <div className="syllabus-policy-row" key={p.id}>
              <strong>{p.category}</strong>
              <p>{p.text}</p>
              {editing && (
                <span className="row-actions">
                  <TextLink onClick={() => setPolicyEditor(p)}>Edit</TextLink>
                  <TextLink
                    onClick={async () => {
                      await removePolicy(p.id);
                      void refetch();
                    }}
                  >
                    Remove
                  </TextLink>
                </span>
              )}
            </div>
          ))}
          {editing && (
            <TextLink onClick={() => setPolicyEditor("new")}>Add policy</TextLink>
          )}
        </details>
      )}
      {!!s!.history.length && (
        <details className="degree-group">
          <summary>
            <strong>Import history</strong>
          </summary>
          {s!.history.map((h) => (
            <div className="academic-line" key={h.id}>
              <span>{h.filename}</span>
              <span>{h.imported_at.slice(0, 10)}</span>
            </div>
          ))}
        </details>
      )}
      {policyEditor && (
        <PolicyEditor
          courseId={courseId}
          record={policyEditor === "new" ? undefined : policyEditor}
          onClose={() => setPolicyEditor(null)}
          onSaved={() => {
            setPolicyEditor(null);
            void refetch();
          }}
        />
      )}
      {materialEditor && (
        <MaterialEditor
          courseId={courseId}
          record={materialEditor === "new" ? undefined : materialEditor}
          onClose={() => setMaterialEditor(null)}
          onSaved={() => {
            setMaterialEditor(null);
            void refetch();
          }}
        />
      )}
      {hoursEditor && (
        <OfficeHoursEditor
          courseId={courseId}
          record={hoursEditor === "new" ? undefined : hoursEditor}
          onClose={() => setHoursEditor(null)}
          onSaved={() => {
            setHoursEditor(null);
            void refetch();
          }}
        />
      )}
      {descriptionEditor && s!.info && (
        <DescriptionEditor
          syllabusId={s!.info.id}
          description={s!.info.description}
          objectives={s!.info.objectives}
          onClose={() => setDescriptionEditor(false)}
          onSaved={() => {
            setDescriptionEditor(false);
            void refetch();
          }}
        />
      )}
      {gradeEditor && (
        <TrackingEditor
          table="grade_categories"
          courseId={courseId}
          onClose={() => setGradeEditor(false)}
          onSaved={() => setGradeEditor(false)}
        />
      )}
    </div>
  );
}
