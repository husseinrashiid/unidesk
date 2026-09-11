import { ResponsiveTable } from "../../components/ResponsiveTable";
import { dateKey } from "../../utils/dates";
import { useState } from "react";
import { Button, Section, Empty, PageHeader, Field } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useTracking } from "./useTracking";
import { TrackingEditor } from "./TrackingEditor";
import {
  courseGrade,
  targetGrade,
  letterGrade,
  parseScale,
  semesterGpa,
} from "./grades";
import { courseProgress } from "./planning";
import type { TrackRecord, TrackingData } from "./types";
export const percent = (v: number | null) =>
  v === null ? "—" : v.toFixed(1) + "%";
export function scaleFor(
  p: TrackingData,
  courseId: string,
  semesterId: string,
) {
  return parseScale(
    (
      p.scales.find((s) => s.course_id === courseId) ??
      p.scales.find((s) => s.semester_id === semesterId) ??
      p.scales.find((s) => !s.course_id && !s.semester_id)
    )?.entries,
  );
}
export function CourseGrades({ courseId }: { courseId: string }) {
  const { p, loading, error } = useTracking();
  const [editor, setEditor] = useState<{
    table: "grade_categories" | "grade_items";
    record?: TrackRecord;
  } | null>(null);
  const [scenario, setScenario] = useState<Record<string, number>>({}),
    [target, setTarget] = useState(90);
  const categories = p.grade_categories
    .filter((c) => c.course_id === courseId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const items = p.grade_items.filter((i) => i.course_id === courseId);
  const result = courseGrade(categories, items, scenario);
  const pending = [
    ...items.filter((i) => !i.excluded && i.points_earned == null),
    ...categories.filter(
      (c) => !items.some((i) => i.category_id === c.id && !i.excluded),
    ),
  ];
  if (loading) return <p>Loading grades…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <div className="academic-view">
      <Section
        title="Course grades"
        action={
          <div className="inline-actions">
            <Button onClick={() => setEditor({ table: "grade_categories" })}>
              Add component
            </Button>
            <Button
              disabled={!categories.length}
              onClick={() => setEditor({ table: "grade_items" })}
            >
              Add grade
            </Button>
          </div>
        }
      >
        {!categories.length ? (
          <Empty
            title="No grading structure yet"
            description="Add course components to begin tracking your grade."
          />
        ) : (
          <>
            <div className="academic-summary">
              <strong>Current grade {percent(result.current)}</strong>
              <span>
                Based on {result.gradedWeight.toFixed(1)}% of the course
                currently graded.
              </span>
            </div>
            <div className="academic-table">
              <ResponsiveTable>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Weight</th>
                    <th>Current grade</th>
                  </tr>
                </thead>
                <tbody>
                  {result.categories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="text-link"
                          onClick={() =>
                            setEditor({
                              table: "grade_categories",
                              record: categories.find((x) => x.id === c.id),
                            })
                          }
                        >
                          {c.name}
                        </button>
                      </td>
                      <td>{c.weight}%</td>
                      <td>{percent(c.current)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total weighting</th>
                    <td>{result.totalWeight}%</td>
                    <td />
                  </tr>
                </tfoot>
              </ResponsiveTable>
            </div>
            {Math.abs(result.totalWeight - 100) > 0.001 && (
              <p className="academic-notice">
                {result.totalWeight < 100
                  ? `${(100 - result.totalWeight).toFixed(1)}% remains unassigned.`
                  : `Weights exceed 100% by ${(result.totalWeight - 100).toFixed(1)}%.`}{" "}
                Complete weighting before using final projections.
              </p>
            )}
            <p className="small muted">
              Current grade uses graded assessments only and normalizes their
              covered course weight. Within a component, points possible
              determine each assessment’s share unless its relative weight is
              overridden. Coverage reflects the assessments entered so far.
            </p>
          </>
        )}
      </Section>
      <Section title="Assessments">
        {items.length ? (
          items.map((i) => (
            <div className="academic-row" key={i.id}>
              <button
                className="row-main"
                onClick={() => setEditor({ table: "grade_items", record: i })}
              >
                <strong>{i.title}</strong>
                <small>
                  {categories.find((c) => c.id === i.category_id)?.name}
                  {i.excluded ? " · Excluded" : ""}
                  {i.exam_id
                    ? " · Linked exam"
                    : i.assignment_id
                      ? " · Linked assignment"
                      : ""}
                </small>
              </button>
              <span>
                {i.points_earned == null
                  ? "Ungraded"
                  : `${i.points_earned} / ${i.points_possible}`}
              </span>
              <Button
                variant="ghost"
                onClick={() => setEditor({ table: "grade_items", record: i })}
              >
                Edit
              </Button>
            </div>
          ))
        ) : (
          <Empty
            title="No assessments yet"
            description="Add planned assessments as well as completed ones to calculate covered weight accurately."
          />
        )}
      </Section>
      {!!categories.length && (
        <Section title="What-if & target calculator">
          <p className="small muted">
            Temporary scenarios are never saved as actual grades. Fill every
            remaining assessment to see a projected final grade.
          </p>
          <div className="scenario-inputs">
            {pending.map((i) => (
              <Field key={i.id} label={i.title || i.name || "Component"}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={scenario[i.id] ?? ""}
                  placeholder="Expected %"
                  onChange={(e) =>
                    setScenario((s) => {
                      const next = { ...s };
                      if (e.target.value === "") delete next[i.id];
                      else next[i.id] = Number(e.target.value);
                      return next;
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <div className="academic-summary">
            <strong>Projected final grade {percent(result.projected)}</strong>
            <Button onClick={() => setScenario({})}>Reset scenario</Button>
          </div>
          <Field label="Target course grade (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </Field>
          <p>{targetGrade(result, target).message}</p>
        </Section>
      )}
      {editor && (
        <TrackingEditor
          {...editor}
          courseId={courseId}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
export function SemesterGrades() {
  const { data, semesterId, navigate } = useWorkspace();
  const { p, loading, error } = useTracking();
  const [scenario, setScenario] = useState<Record<string, string>>({});
  const courses = data.courses.filter((c) => !c.archived);
  const rows = courses.map((c) => {
    const grade = courseGrade(
      p.grade_categories.filter((x) => x.course_id === c.id),
      p.grade_items.filter((x) => x.course_id === c.id),
    );
    const scale = scaleFor(p, c.id, semesterId);
    return { c, grade, scale, letter: letterGrade(grade.current, scale) };
  });
  const actual = semesterGpa(
    rows.map((r) => ({
      credits: r.c.credits,
      points: r.letter?.points ?? null,
    })),
  );
  const simulated = semesterGpa(
    rows.map((r) => ({
      credits: r.c.credits,
      points:
        r.scale.find((s) => s.letter === scenario[r.c.id])?.points ??
        r.letter?.points ??
        null,
    })),
  );
  if (loading) return <p>Loading grades…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <>
      <PageHeader
        title="Grades"
        subtitle={data.semesters.find((s) => s.id === semesterId)?.name}
      />
      <div className="academic-summary">
        <span>{courses.length} courses</span>
        <span>
          {data.exams.filter((e) => e.date >= dateKey()).length} upcoming exams
        </span>
        <span>
          {
            data.assignments.filter(
              (a) => !["Completed", "Submitted"].includes(a.status),
            ).length
          }{" "}
          active assignments
        </span>
      </div>
      <Section title="Semester academic overview">
        <div className="academic-table">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>Course</th>
                <th>Credits</th>
                <th>Current</th>
                <th>Letter / GPA</th>
                <th>Scenario</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, grade, letter, scale }) => (
                <tr key={c.id}>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => navigate(`course/${c.id}/Grades`)}
                    >
                      {c.code}
                    </button>
                  </td>
                  <td>{c.credits}</td>
                  <td>{percent(grade.current)}</td>
                  <td>
                    {letter ? `${letter.letter} / ${letter.points}` : "—"}
                  </td>
                  <td>
                    <select
                      aria-label={`${c.code} scenario`}
                      value={scenario[c.id] ?? ""}
                      onChange={(e) =>
                        setScenario({ ...scenario, [c.id]: e.target.value })
                      }
                    >
                      <option value="">Use current</option>
                      {scale.map((s) => (
                        <option key={s.letter}>{s.letter}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </ResponsiveTable>
        </div>
        {!rows.length && <Empty title="No courses to calculate" />}
        <div className="academic-summary">
          <strong>
            Current GPA estimate {actual.value?.toFixed(2) ?? "—"}
          </strong>
          <strong>
            Scenario estimate {simulated.value?.toFixed(2) ?? "—"}
          </strong>
          <Button onClick={() => setScenario({})}>Reset scenario</Button>
        </div>
        <p className="small muted">
          Current estimate includes {actual.count} courses and {actual.credits}{" "}
          credits with grades. Courses without grades and zero-credit courses
          are omitted. Scenario choices are temporary. Edit credits in the
          course settings.
        </p>
      </Section>
      <Section title="Course progress">
        {courses.map((c) => {
          const progress = courseProgress(data, p, c.id);
          return (
            <div className="academic-row" key={c.id}>
              <span>{c.code}</span>
              <span>
                {progress.percentage === null
                  ? "Not enough tracked items yet"
                  : `${Math.round(progress.percentage)}% · ${progress.completed} / ${progress.total} completed`}
              </span>
            </div>
          );
        })}
        <p className="small muted">
          Completion of tracked academic work, independent of grades.
        </p>
      </Section>
      <ScaleSettings />
    </>
  );
}
import { batch } from "../../services/platform";
export function ScaleSettings({ courseId }: { courseId?: string }) {
  const { p } = useTracking();
  const { semesterId, refresh } = useWorkspace();
  const current = courseId
    ? p.scales.find((s) => s.course_id === courseId)
    : p.scales.find((s) => s.semester_id === semesterId);
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const entries = scaleFor(p, courseId ?? "", semesterId);
  const value =
    text ?? entries.map((e) => `${e.letter}, ${e.min}, ${e.points}`).join("\n");
  return (
    <Section
      title={
        courseId
          ? "Course grading scale override"
          : "Semester grading & GPA scale"
      }
    >
      <p className="small muted">
        One row per letter: letter, minimum percentage, GPA points. Course
        overrides take precedence. Default matches AUB's grading and GPA
        conversion policy for students registered Fall 2019-20 onward; edit it
        if yours differs.
      </p>
      <Field label="Scale entries">
        <textarea
          className="scale-editor"
          value={value}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <div className="inline-actions">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const entries = parseScale(
                JSON.stringify(
                  value
                    .trim()
                    .split("\n")
                    .map((line) => {
                      const [letter, min, points] = line
                        .split(",")
                        .map((x) => x.trim());
                      return {
                        letter,
                        min: Number(min),
                        points: Number(points),
                      };
                    }),
                ),
              );
              await batch([
                {
                  sql: "INSERT INTO grading_scales(id,course_id,semester_id,name,entries) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET entries=excluded.entries",
                  params: [
                    current?.id ?? crypto.randomUUID(),
                    courseId ?? null,
                    courseId ? null : semesterId,
                    courseId ? "Course scale" : "Semester scale",
                    JSON.stringify(entries),
                  ],
                },
              ]);
              await refresh();
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save scale
        </Button>
        {current && (
          <Button
            onClick={async () => {
              try {
                await batch([
                  {
                    sql: "DELETE FROM grading_scales WHERE id=?",
                    params: [current.id],
                  },
                ]);
                setText(null);
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Use inherited default
          </Button>
        )}
      </div>
    </Section>
  );
}
