export interface ActiveTimer {
  id: string;
  course_id: string;
  title: string;
  started_at: string;
  running_since: number | null;
  elapsed_ms: number;
  exam_id?: string | null;
  lecture_id?: string | null;
  reading_id?: string | null;
}
export const elapsedSeconds = (timer: ActiveTimer, now = Date.now()) =>
  Math.floor(
    (timer.elapsed_ms +
      (timer.running_since === null
        ? 0
        : Math.max(0, now - timer.running_since))) /
      1000,
  );
export function recoverTimer(raw?: string): ActiveTimer | null {
  if (!raw) return null;
  const t: ActiveTimer = JSON.parse(raw);
  if (
    !t ||
    typeof t.id !== "string" ||
    typeof t.course_id !== "string" ||
    !t.title ||
    !Number.isFinite(Date.parse(t.started_at)) ||
    !Number.isFinite(t.elapsed_ms) ||
    t.elapsed_ms < 0 ||
    (t.running_since !== null &&
      (!Number.isFinite(t.running_since) ||
        t.running_since > Date.now() + 60000))
  )
    throw Error(
      "Saved timer state could not be recovered. Discard it to start a new session.",
    );
  return t;
}
export function pauseTimer(timer: ActiveTimer, now = Date.now()): ActiveTimer {
  return {
    ...timer,
    elapsed_ms:
      timer.elapsed_ms +
      (timer.running_since === null
        ? 0
        : Math.max(0, now - timer.running_since)),
    running_since: null,
  };
}
