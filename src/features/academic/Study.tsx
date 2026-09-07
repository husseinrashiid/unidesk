import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, PageHeader, Empty } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useTracking } from "./useTracking";
import { TrackingEditor } from "./TrackingEditor";
import type { TrackRecord } from "./types";
import {
  recommendations,
  conflicts,
  workload,
  weekDates,
  addDays,
  durationLabel,
} from "./planning";
import { dateKey, occurrences, shortDate, timeLabel } from "../../utils/dates";
import { PreparationSummary, TrackerList } from "./Trackers";
import { query } from "../../services/platform";
export function Study({ courseId }: { courseId?: string }) {
  const { data, navigate, page, preferences, semesterId } = useWorkspace();
  const { p, change, loading, error } = useTracking();
  const [tab, setTab] = useState(
    page === "study/planner" ? "Planner" : "Overview",
  );
  const [week, setWeek] = useState(dateKey());
  const [historyPage, setHistoryPage] = useState(0);
  const [editor, setEditor] = useState<{
    table: "study_sessions" | "study_blocks";
    record?: TrackRecord;
    defaults?: Record<string, string | number | null>;
  } | null>(null);
  const dates = weekDates(week, Number(preferences.week_start ?? 1));
  const currentWeek = weekDates(dateKey(), Number(preferences.week_start ?? 1));
  const { data: totals = [] } = useQuery({
    queryKey: ["study-totals", semesterId, currentWeek[0]],
    queryFn: () =>
      query<{
        course_id: string;
        today: number;
        week: number;
        semester: number;
      }>(
        `SELECT s.course_id, SUM(CASE WHEN date(s.started_at,'localtime')=? THEN s.duration_seconds ELSE 0 END) AS today, SUM(CASE WHEN date(s.started_at,'localtime') BETWEEN ? AND ? THEN s.duration_seconds ELSE 0 END) AS week, SUM(s.duration_seconds) AS semester FROM study_sessions s JOIN courses c ON c.id=s.course_id WHERE c.semester_id=? GROUP BY s.course_id`,
        [dateKey(), currentWeek[0], currentWeek[6], semesterId],
      ),
  });
  const scoped = courseId
    ? {
        ...data,
        exams: data.exams.filter((e) => e.course_id === courseId),
        assignments: data.assignments.filter((e) => e.course_id === courseId),
      }
    : data;
  const next = recommendations(scoped, p)
    .filter((r) => !courseId || r.course_id === courseId)
    .slice(0, 5);
  const blocks = p.study_blocks.filter(
    (b) => !courseId || b.course_id === courseId,
  );
  const sessions = p.study_sessions.filter(
    (s) => !courseId || s.course_id === courseId,
  );
  const events = occurrences(data, dates[0], dates[6]).filter(
    (e) => e.kind !== "study" && (!courseId || e.course_id === courseId),
  );
  const { data: history = [] } = useQuery({
    queryKey: ["study-history", semesterId, courseId, historyPage],
    enabled: tab === "History",
    queryFn: () =>
      query<TrackRecord>(
        `SELECT s.* FROM study_sessions s JOIN courses c ON c.id=s.course_id WHERE c.semester_id=? ${courseId ? "AND s.course_id=?" : ""} ORDER BY s.started_at DESC,s.id LIMIT 51 OFFSET ?`,
        [semesterId, ...(courseId ? [courseId] : []), historyPage * 50],
      ),
  });
  const sums = totals.filter((t) => !courseId || t.course_id === courseId);
  if (loading) return <p>Loading study activity…</p>;
  if (error) return <p role="alert">{error.message}</p>;
  return (
    <>
      <PageHeader
        title="Study"
        subtitle="Plan your week and keep track of your work."
      >
        <Button onClick={() => setEditor({ table: "study_sessions" })}>
          Add study session
        </Button>
        <Button onClick={() => setEditor({ table: "study_blocks" })}>
          Schedule study block
        </Button>
      </PageHeader>
      <div className="tabs">
        {["Overview", "Planner", "History"].map((t) => (
          <button
            key={t}
            className={t === tab ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Overview" ? (
        <>
          <Section title="Recommended next">
            {next.map((r) => (
              <button
                className="academic-row recommendation"
                key={r.id}
                onClick={() => navigate(r.route)}
              >
                <span className="row-main">
                  <strong>{r.title}</strong>
                  <small>
                    {data.courses.find((c) => c.id === r.course_id)?.code} ·{" "}
                    {r.reason}
                  </small>
                </span>
                <span>Open →</span>
              </button>
            ))}
            {!next.length && (
              <Empty
                title="No pending study work"
                description="Add preparation items, lectures, readings, or tasks to see recommendations."
              />
            )}
          </Section>
          <Section title="Exam preparation">
            {scoped.exams
              .filter((e) => e.date >= dateKey())
              .map((e) => (
                <button
                  className="academic-row recommendation"
                  key={e.id}
                  onClick={() => navigate(`exam/${e.id}`)}
                >
                  <span>
                    {e.title}
                    <small className="muted"> · {shortDate(e.date)}</small>
                  </span>
                  <PreparationSummary examId={e.id} />
                </button>
              ))}
          </Section>
          <Section title="Needs review">
            {[
              ...p.lectures.filter((l) => l.status !== "Reviewed"),
              ...p.readings.filter((r) => r.status !== "Completed"),
            ]
              .filter((r) => !courseId || r.course_id === courseId)
              .slice(0, 12)
              .map((r) => (
                <button
                  key={r.id}
                  className="academic-row recommendation"
                  onClick={() =>
                    navigate(
                      `course/${r.course_id}/${r.author !== undefined ? "Readings" : "Lectures"}`,
                    )
                  }
                >
                  <span className="row-main">
                    <strong>{r.title}</strong>
                    <small>
                      {data.courses.find((c) => c.id === r.course_id)?.code} -{" "}
                      {r.status}
                    </small>
                  </span>
                  <span>
                    {r.estimated_minutes
                      ? `${r.estimated_minutes} min`
                      : "Open"}
                  </span>
                </button>
              ))}
            {!p.lectures.some(
              (l) =>
                l.status !== "Reviewed" &&
                (!courseId || l.course_id === courseId),
            ) &&
              !p.readings.some(
                (r) =>
                  r.status !== "Completed" &&
                  (!courseId || r.course_id === courseId),
              ) && <Empty title="No unreviewed materials" />}
          </Section>
          <Section title="Study time">
            <div className="academic-summary">
              <span>
                Today{" "}
                <strong>
                  {durationLabel(sums.reduce((s, t) => s + t.today, 0))}
                </strong>
              </span>
              <span>
                This week{" "}
                <strong>
                  {durationLabel(sums.reduce((s, t) => s + t.week, 0))}
                </strong>
              </span>
              <span>
                This semester{" "}
                <strong>
                  {durationLabel(sums.reduce((s, t) => s + t.semester, 0))}
                </strong>
              </span>
            </div>
            {sums.map((t) => (
              <div className="academic-row" key={t.course_id}>
                <span>
                  {data.courses.find((c) => c.id === t.course_id)?.code}
                </span>
                <span>{durationLabel(t.week)} this week</span>
              </div>
            ))}
          </Section>
          <WorkloadOverview courseId={courseId} />
          {courseId && (
            <TrackerList table="course_topics" courseId={courseId} />
          )}
        </>
      ) : tab === "Planner" ? (
        <>
          <div className="academic-summary">
            <Button onClick={() => setWeek(addDays(week, -7))}>
              Previous week
            </Button>
            <strong>
              {shortDate(dates[0])} – {shortDate(dates[6])}
            </strong>
            <Button onClick={() => setWeek(dateKey())}>This week</Button>
            <Button onClick={() => setWeek(addDays(week, 7))}>Next week</Button>
          </div>
          <div className="study-week">
            {dates.map((date) => (
              <Section
                key={date}
                title={new Date(date + "T12:00:00").toLocaleDateString(
                  "en-US",
                  { weekday: "long", month: "short", day: "numeric" },
                )}
                action={
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setEditor({
                        table: "study_blocks",
                        defaults: { scheduled_date: date },
                      })
                    }
                  >
                    Add block
                  </Button>
                }
              >
                {events
                  .filter((e) => e.date === date)
                  .map((e) => (
                    <div className="academic-row" key={e.id}>
                      <span>{timeLabel(e.time)}</span>
                      <button
                        className="row-main"
                        onClick={() =>
                          e.kind === "lecture"
                            ? navigate(`course/${e.course_id}`)
                            : e.kind === "exam" || e.kind === "assignment"
                              ? navigate(`${e.kind}/${e.entity_id}`)
                              : navigate("calendar")
                        }
                      >
                        <strong>{e.title}</strong>
                        <small>{e.type}</small>
                      </button>
                    </div>
                  ))}
                {blocks
                  .filter((b) => b.scheduled_date === date)
                  .sort((a, b) =>
                    (a.start_time ?? "").localeCompare(b.start_time ?? ""),
                  )
                  .map((b) => (
                    <div className="academic-row" key={b.id}>
                      <input
                        aria-label={`Complete ${b.title}`}
                        type="checkbox"
                        checked={!!b.completed}
                        onChange={(e) =>
                          void change("study_blocks", b.id, {
                            completed: Number(e.target.checked),
                            completed_at: e.target.checked
                              ? new Date().toISOString()
                              : null,
                          })
                        }
                      />
                      <button
                        className="row-main"
                        onClick={() =>
                          setEditor({ table: "study_blocks", record: b })
                        }
                      >
                        <strong>{b.title}</strong>
                        <small>
                          {timeLabel(b.start_time ?? "")} ·{" "}
                          {b.estimated_minutes} min ·{" "}
                          {b.completed ? "Completed" : "Planned"}
                        </small>
                      </button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setEditor({
                            table: "study_sessions",
                            defaults: {
                              course_id: b.course_id,
                              title: b.title,
                              duration_minutes: b.estimated_minutes ?? 45,
                              exam_id: b.exam_id ?? null,
                              lecture_id: b.lecture_id ?? null,
                              reading_id: b.reading_id ?? null,
                              task_id: b.task_id ?? null,
                            },
                          })
                        }
                      >
                        Log time
                      </Button>
                    </div>
                  ))}
                {!events.some((e) => e.date === date) &&
                  !blocks.some((b) => b.scheduled_date === date) && (
                    <p className="small muted">Nothing scheduled.</p>
                  )}
              </Section>
            ))}
          </div>
          <p className="small muted">
            Completing a block does not invent study time. Use Log time to
            record an actual session.
          </p>
        </>
      ) : (
        <Section title="Study history">
          <p className="small muted">
            Page {historyPage + 1}. Totals include all saved sessions.
          </p>
          {history.slice(0, 50).map((s) => (
            <div className="academic-row" key={s.id}>
              <span>{shortDate(s.started_at ?? "")}</span>
              <button
                className="row-main"
                onClick={() =>
                  setEditor({ table: "study_sessions", record: s })
                }
              >
                <strong>{s.title}</strong>
                <small>{s.notes}</small>
              </button>
              <span>{durationLabel(s.duration_seconds ?? 0)}</span>
              <Button
                variant="ghost"
                onClick={() =>
                  setEditor({ table: "study_sessions", record: s })
                }
              >
                Edit
              </Button>
            </div>
          ))}
          {!history.length && (
            <Empty
              title="No study activity yet"
              description="Start a timer or add a manual study session."
            />
          )}
          <div className="inline-actions">
            <Button
              disabled={historyPage === 0}
              onClick={() => setHistoryPage(historyPage - 1)}
            >
              Newer sessions
            </Button>
            <Button
              disabled={history.length <= 50}
              onClick={() => setHistoryPage(historyPage + 1)}
            >
              Older sessions
            </Button>
          </div>
        </Section>
      )}
      {editor && (
        <TrackingEditor
          {...editor}
          courseId={courseId}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
export function WorkloadOverview({ courseId }: { courseId?: string }) {
  const { data } = useWorkspace();
  const { p } = useTracking();
  const scoped = courseId
    ? {
        ...data,
        exams: data.exams.filter((e) => e.course_id === courseId),
        assignments: data.assignments.filter((e) => e.course_id === courseId),
        schedules: data.schedules.filter((e) => e.course_id === courseId),
      }
    : data;
  const conflictsList = conflicts(scoped);
  const days = Array.from({ length: 7 }, (_, i) => addDays(dateKey(), i));
  return (
    <Section title="Upcoming workload">
      <div className="workload-days">
        {workload(
          scoped,
          p.study_blocks.filter((b) => !courseId || b.course_id === courseId),
          days,
        ).map((d) => (
          <div key={d.date}>
            <small>{shortDate(d.date)}</small>
            <strong>{d.label}</strong>
            <small>{d.reason}</small>
          </div>
        ))}
      </div>
      <p className="small muted">
        Approximate workload based on deadlines and scheduled class / study
        minutes. Task effort is not estimated.
      </p>
      {conflictsList.slice(0, 3).map((c) => (
        <p className="academic-notice" key={c.date}>
          {shortDate(c.date)} · {c.reason} {c.titles.join(" · ")}. Consider
          starting one earlier.
        </p>
      ))}
    </Section>
  );
}
