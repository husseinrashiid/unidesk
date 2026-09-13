import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Modal } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { saveSetting, insert } from "../../db/repository";
import { batch, query } from "../../services/platform";
import { useTracking } from "./useTracking";
import {
  recoverTimer,
  elapsedSeconds,
  pauseTimer,
  type ActiveTimer,
} from "./timing";
export function StudyTimer() {
  const { data, refresh, report } = useWorkspace();
  const { p } = useTracking();
  const result = useQuery({
    queryKey: ["active-timer"],
    queryFn: async () => {
      const rows = await query<{ value: string }>(
        "SELECT value FROM settings WHERE key='active_timer'",
      );
      return recoverTimer(rows[0]?.value);
    },
  });
  const timer = result.data;
  const [open, setOpen] = useState(false),
    [finish, setFinish] = useState(false),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(Date.now()),
    [minutes, setMinutes] = useState(""),
    [notes, setNotes] = useState("");
  const [course, setCourse] = useState(
      data.courses.find((c) => !c.archived)?.id ?? "",
    ),
    [title, setTitle] = useState("General review"),
    [relation, setRelation] = useState("");
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("unidesk:start-study", handler);
    return () => window.removeEventListener("unidesk:start-study", handler);
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const persist = (t: ActiveTimer) =>
    saveSetting("active_timer", JSON.stringify(t));
  const seconds = timer ? elapsedSeconds(timer, tick) : 0;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {timer
          ? `${timer.title} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
          : result.error
            ? "Recover timer"
            : "Start study session"}
      </Button>
      {open && (
        <Modal
          title={finish ? "Study session complete" : "Study timer"}
          onClose={() => setOpen(false)}
        >
          <div className="academic-form">
            {result.error ? (
              <>
                <p role="alert">{result.error.message}</p>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await batch([
                        {
                          sql: "DELETE FROM settings WHERE key='active_timer'",
                        },
                      ]);
                    })
                  }
                >
                  Discard saved timer
                </Button>
              </>
            ) : timer ? (
              <>
                <p>
                  {data.courses.find((c) => c.id === timer.course_id)?.code ??
                    "Course from another semester"}{" "}
                  · {timer.title}
                </p>
                {finish ? (
                  <>
                    <Field label="Duration (minutes)">
                      <input
                        type="number"
                        min="0.016667"
                        step="any"
                        value={minutes}
                        onChange={(e) => setMinutes(e.target.value)}
                      />
                    </Field>
                    <Field label="Notes">
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </Field>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const duration = Math.round(Number(minutes) * 60);
                          if (!Number.isFinite(duration) || duration <= 0)
                            throw Error("Enter a positive duration.");
                          await batch([
                            insert("study_sessions", {
                              id: timer.id,
                              course_id: timer.course_id,
                              title: timer.title,
                              exam_id: timer.exam_id ?? null,
                              lecture_id: timer.lecture_id ?? null,
                              reading_id: timer.reading_id ?? null,
                              started_at: timer.started_at,
                              ended_at: new Date(
                                Math.max(
                                  Date.now(),
                                  Date.parse(timer.started_at) +
                                    duration * 1000,
                                ),
                              ).toISOString(),
                              duration_seconds: duration,
                              notes,
                            }),
                            {
                              sql: "DELETE FROM settings WHERE key='active_timer'",
                            },
                          ]);
                          setFinish(false);
                          setOpen(false);
                        })
                      }
                    >
                      Save session
                    </Button>
                    <Button disabled={busy} onClick={() => setFinish(false)}>
                      Back
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="timer-display">
                      {Math.floor(seconds / 60)}:
                      {String(seconds % 60).padStart(2, "0")}
                    </div>
                    <p className="small muted">
                      {timer.running_since === null ? "Paused" : "Running"} ·
                      Recovered across navigation and restarts. Correct the
                      duration when finishing if needed.
                    </p>
                    <div className="inline-actions">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            persist(
                              timer.running_since === null
                                ? { ...timer, running_since: Date.now() }
                                : pauseTimer(timer),
                            ),
                          )
                        }
                      >
                        {timer.running_since === null ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        disabled={busy}
                        variant="primary"
                        onClick={() =>
                          void run(async () => {
                            const stopped = pauseTimer(timer);
                            await persist(stopped);
                            setMinutes(
                              String(Math.max(1, elapsedSeconds(stopped)) / 60),
                            );
                            setFinish(true);
                          })
                        }
                      >
                        Finish
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await batch([
                              {
                                sql: "DELETE FROM settings WHERE key='active_timer'",
                              },
                            ]);
                            setOpen(false);
                          })
                        }
                      >
                        Cancel session
                      </Button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <Field label="Course">
                  <select
                    value={course}
                    onChange={(e) => {
                      setCourse(e.target.value);
                      setRelation("");
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
                <Field label="Study title">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Field label="Related material (optional)">
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value)}
                  >
                    <option value="">None</option>
                    {(
                      [
                        ["exam_id", data.exams],
                        ["lecture_id", p.lectures],
                        ["reading_id", p.readings],
                      ] as const
                    ).map(([key, rows]) => (
                      <optgroup key={key} label={key.replace("_id", "")}>
                        {rows
                          .filter((r) => r.course_id === course)
                          .map((r) => (
                            <option key={r.id} value={`${key}/${r.id}`}>
                              {r.title}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Button
                  variant="primary"
                  disabled={busy || result.isPending}
                  onClick={() =>
                    void run(async () => {
                      if (!course || !title.trim())
                        throw Error("Choose a course and enter a study title.");
                      const [key, id] = relation.split("/");
                      await persist({
                        id: crypto.randomUUID(),
                        course_id: course,
                        title: title.trim(),
                        started_at: new Date().toISOString(),
                        running_since: Date.now(),
                        elapsed_ms: 0,
                        ...(key ? { [key]: id } : {}),
                      });
                    })
                  }
                >
                  Start
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
