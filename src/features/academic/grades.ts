import type { ScaleEntry, TrackRecord } from "./types";
export const defaultScale: ScaleEntry[] = [
  ["A+", 93, 4.3],
  ["A", 87, 4],
  ["A-", 83, 3.7],
  ["B+", 79, 3.3],
  ["B", 75, 3],
  ["B-", 72, 2.7],
  ["C+", 69, 2.3],
  ["C", 66, 2],
  ["C-", 63, 1.7],
  ["D+", 61, 1.3],
  ["D", 60, 1],
  ["F", 0, 0],
].map(([letter, min, points]) => ({
  letter: String(letter),
  min: Number(min),
  points: Number(points),
}));
export function parseScale(raw?: string): ScaleEntry[] {
  if (!raw) return defaultScale;
  const entries: ScaleEntry[] = JSON.parse(raw);
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.some(
      (e) =>
        !e.letter?.trim() ||
        !Number.isFinite(e.min) ||
        e.min < 0 ||
        e.min > 100 ||
        !Number.isFinite(e.points) ||
        e.points < 0,
    ) ||
    new Set(entries.map((e) => e.letter)).size !== entries.length ||
    new Set(entries.map((e) => e.min)).size !== entries.length ||
    !entries.some((e) => e.min === 0)
  )
    throw Error(
      "Scale needs unique letters and thresholds (0–100), including 0, and nonnegative GPA points.",
    );
  return [...entries].sort((a, b) => b.min - a.min);
}
export const letterGrade = (percentage: number | null, scale = defaultScale) =>
  percentage === null
    ? null
    : ([...scale]
        .sort((a, b) => b.min - a.min)
        .find((e) => percentage >= e.min) ?? null);
export interface GradeResult {
  current: number | null;
  gradedWeight: number;
  totalWeight: number;
  earned: number;
  remaining: number;
  projected: number | null;
  categories: {
    id: string;
    name: string;
    weight: number;
    current: number | null;
    coverage: number;
  }[];
}
/** Category points determine relative item shares; an optional override replaces that relative share.
 * Ungraded work contributes neither score nor covered weight. Empty categories remain ungraded. */
export function courseGrade(
  categories: TrackRecord[],
  items: TrackRecord[],
  scenario: Record<string, number> = {},
): GradeResult {
  let earned = 0,
    gradedWeight = 0,
    projectedEarned = 0,
    projectedWeight = 0;
  const rows = categories.map((c) => {
    const weight = c.weight ?? 0;
    const active = items.filter((i) => i.category_id === c.id && !i.excluded);
    const share = (i: TrackRecord) =>
      i.weight_override ?? i.points_possible ?? 100;
    const total = active.reduce((s, i) => s + share(i), 0);
    let categoryEarned = 0,
      coverage = 0;
    for (const i of active) {
      const w = total > 0 ? (weight * share(i)) / total : 0;
      const actual =
        i.points_earned == null
          ? null
          : (100 * i.points_earned) / (i.points_possible ?? 100);
      if (actual !== null) {
        earned += (w * actual) / 100;
        gradedWeight += w;
        categoryEarned += w * actual;
        coverage += w;
      }
      const simulated = actual ?? scenario[i.id];
      if (simulated !== undefined && simulated !== null) {
        projectedEarned += (w * simulated) / 100;
        projectedWeight += w;
      }
    }
    // An empty category can be projected as a whole until assessments are configured.
    if (!active.length && scenario[c.id] !== undefined) {
      projectedEarned += (weight * scenario[c.id]) / 100;
      projectedWeight += weight;
    }
    return {
      id: c.id,
      name: c.name ?? "",
      weight,
      current: coverage > 0 ? categoryEarned / coverage : null,
      coverage,
    };
  });
  const totalWeight = categories.reduce((s, c) => s + (c.weight ?? 0), 0);
  return {
    current: gradedWeight > 0 ? (earned / gradedWeight) * 100 : null,
    gradedWeight,
    totalWeight,
    earned,
    remaining: Math.max(0, totalWeight - gradedWeight),
    projected:
      Math.abs(totalWeight - 100) < 0.001 &&
      Math.abs(projectedWeight - 100) < 0.001
        ? projectedEarned
        : null,
    categories: rows,
  };
}
export function targetGrade(result: GradeResult, target: number) {
  if (Math.abs(result.totalWeight - 100) > 0.001)
    return {
      message:
        "Complete the course weighting to 100% before calculating a target.",
    };
  const highest = result.earned + result.remaining;
  if (target > highest + 1e-8)
    return {
      message: `Target is not reachable: even with 100% on remaining work, the highest final grade is ${highest.toFixed(1)}%.`,
    };
  if (result.remaining < 1e-8)
    return {
      message: `All work is graded. Final grade: ${result.earned.toFixed(1)}%.`,
    };
  const required = Math.max(
    0,
    ((target - result.earned) / result.remaining) * 100,
  );
  return {
    required,
    message: `You need an average of ${required.toFixed(1)}% on the remaining ${result.remaining.toFixed(1)}% of the course.`,
  };
}
export function semesterGpa(
  courses: { credits: number; points: number | null }[],
) {
  const eligible = courses.filter(
    (c) => c.credits > 0 && c.points !== null && Number.isFinite(c.points),
  );
  const credits = eligible.reduce((s, c) => s + c.credits, 0);
  return {
    value: credits
      ? eligible.reduce((s, c) => s + c.credits * c.points!, 0) / credits
      : null,
    credits,
    count: eligible.length,
  };
}
