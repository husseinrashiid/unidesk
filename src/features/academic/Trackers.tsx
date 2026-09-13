import { query, fileAction } from "../../services/platform";
import { useState } from "react";
import { dateKey } from "../../utils/dates";
import { Button, Section, Empty } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useTracking } from "./useTracking";
import { TrackingEditor, labels } from "./TrackingEditor";
import type { TrackingTable, TrackRecord } from "./types";
import { courseProgress, prepProgress } from "./planning";
import { percent } from "./GradesView";
import { courseGrade } from "./grades";
export function TrackerList({
  table,
  courseId,
  examId,
}: {
  table: TrackingTable;
  courseId: string;
  examId?: string;
}) {
  const { p, loading, error, change } = useTracking();
  const [editor, setEditor] = useState<TrackRecord | "new" | null>(null);
  const { report } = useWorkspace();
  const rows = p[table]
    .filter(
      (r) => r.course_id === courseId && (!examId || r.exam_id === examId),
    )
    .sort(
      (a, b) =>
        (a.sort_order ?? a.number ?? 0) - (b.sort_order ?? b.number ?? 0),
    );
  const states =
    table === "lectures"
      ? ["Not reviewed", "In progress", "Reviewed"]
      : table === "readings"
        ? ["Not started", "Reading", "Completed"]
        : table === "previous_exam_attempts"
          ? ["Not attempted", "In progress", "Completed"]
          : ["Not started", "Reviewing", "Reviewed"];
  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  if (table === "lectures" && !rows.length)
    return (
      <div className="tracking-empty-inline">
        <span>Lecture tracking: 0 records</span>
        <Button onClick={() => setEditor("new")}>Add lecture</Button>
        {editor && (
          <TrackingEditor
            table={table}
            courseId={courseId}
            defaults={examId ? { exam_id: examId } : {}}
            onClose={() => setEditor(null)}
          />
        )}
      </div>
    );
  return (
    <Section
      title={
        table === "exam_topics"
          ? "Preparation checklist"
          : table === "course_topics"
            ? "Course topics"
            : labels[table] + " tracking"
      }
      action={
        <Button onClick={() => setEditor("new")}>
          Add {labels[table].toLowerCase()}
        </Button>
      }
    >
      {rows.map((r) => (
        <div key={r.id} className="academic-row">
          <button className="row-main" onClick={() => setEditor(r)}>
            <strong>
              {r.number != null
                ? String(r.number).padStart(2, "0") + " · "
                : ""}
              {r.title}
            </strong>
            <small>
              {[
                r.lecture_date,
                r.author,
                r.due_date ? "Due " + r.due_date : "",
                r.confidence ? "Confidence: " + r.confidence : "",
                r.reviewed_at
                  ? "Reviewed " + dateKey(new Date(r.reviewed_at))
                  : "",
                r.completed_at
                  ? "Completed " + dateKey(new Date(r.completed_at))
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </button>
          <select
            aria-label={`${r.title} status`}
            value={r.status}
            onChange={(e) =>
              void change(table, r.id, {
                status: e.target.value,
                ...(table === "lectures"
                  ? {
                      reviewed_at:
                        e.target.value === "Reviewed"
                          ? new Date().toISOString()
                          : null,
                    }
                  : table === "previous_exam_attempts"
                    ? {
                        completed_at:
                          e.target.value === "Completed"
                            ? new Date().toISOString()
                            : null,
                      }
                    : {}),
              })
            }
          >
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {r.file_id && (
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const { fileAction } =
                    await import("../../services/platform");
                  await fileAction(r.file_id!, "open");
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              Open file
            </Button>
          )}

          <Button variant="ghost" onClick={() => setEditor(r)}>
            Edit
          </Button>
        </div>
      ))}
      {!rows.length && (
        <Empty
          title={
            table === "exam_topics"
              ? "No preparation items yet"
              : `No ${labels[table].toLowerCase()} records yet`
          }
          description="Add items when useful. Existing course files stay available below."
        />
      )}
      {editor && (
        <TrackingEditor
          table={table}
          courseId={courseId}
          record={editor === "new" ? undefined : editor}
          defaults={examId ? { exam_id: examId } : {}}
          onClose={() => setEditor(null)}
        />
      )}
    </Section>
  );
}
export function PreparationSummary({
  examId,
  actionable = false,
}: {
  examId: string;
  actionable?: boolean;
}) {
  const { navigate } = useWorkspace();
  const { p, loading, error } = useTracking();
  const progress = prepProgress(
    p.exam_topics.filter((t) => t.exam_id === examId),
  );
  if (loading)
    return <span className="prep-summary">Loading preparation...</span>;
  if (error)
    return (
      <span className="prep-summary" role="alert">
        Could not load preparation.
      </span>
    );
  return (
    <div className="prep-summary">
      {progress.percentage === null
        ? "Preparation not set up"
        : `Preparation ${Math.round(progress.percentage)}% · ${progress.completed} / ${progress.total} items reviewed`}
      {actionable && progress.percentage === null && (
        <Button onClick={() => navigate(`exam/${examId}/Preparation`)}>
          Set up preparation
        </Button>
      )}
    </div>
  );
}
export function ProgressOverview({ courseId }: { courseId?: string }) {
  const { data } = useWorkspace();
  const { p, loading, error } = useTracking();
  const [setup, setSetup] = useState(false);
  const courses = data.courses.filter((c) =>
    courseId ? c.id === courseId : !c.archived,
  );
  const tracked = courses.filter(
    (c) => courseProgress(data, p, c.id).percentage !== null,
  );
  if (loading)
    return (
      <Section title="Course progress">
        <p className="small muted">Loading progress...</p>
      </Section>
    );
  if (error)
    return (
      <Section title="Course progress">
        <p role="alert">Could not load course progress.</p>
      </Section>
    );
  return (
    <Section title={courseId ? "Academic progress" : "Course progress"}>
      {!tracked.length && (
        <Empty
          title="Build your course progress"
          description="Track lectures, readings, or preparation items to see course progress."
          action={
            <Button onClick={() => setSetup(true)}>Set up tracking</Button>
          }
        />
      )}
      {setup && (
        <TrackingEditor
          table="readings"
          courseId={courseId}
          onClose={() => setSetup(false)}
        />
      )}
      {tracked.map((c) => {
        const progress = courseProgress(data, p, c.id);
        const grade = courseGrade(
          p.grade_categories.filter((t) => t.course_id === c.id),
          p.grade_items.filter((t) => t.course_id === c.id),
        );
        return (
          <div key={c.id} className="progress-course">
            <div className="academic-row">
              <strong>{c.code}</strong>
              <span>{`${Math.round(progress.percentage!)}% complete`}</span>
            </div>
            {progress.percentage !== null && (
              <progress
                max="100"
                value={progress.percentage}
                aria-label={`${c.code} completion`}
              />
            )}
            <p className="small muted">
              {progress.counts
                .filter((g) => g.total)
                .map((g) => `${g.name} ${g.completed}/${g.total}`)
                .join(" · ") || "Add lectures, readings, or preparation items."}
            </p>
            {courseId && (
              <p className="small">Current grade {percent(grade.current)}</p>
            )}
          </div>
        );
      })}
      {tracked.length > 0 && (
        <p className="small muted">
          Progress measures tracked completion, not learning mastery.
        </p>
      )}
      {courseId && !tracked.length && (
        <p className="small">
          Current grade{" "}
          {percent(
            courseGrade(
              p.grade_categories.filter((t) => t.course_id === courseId),
              p.grade_items.filter((t) => t.course_id === courseId),
            ).current,
          )}
        </p>
      )}
    </Section>
  );
}
