import { letterGrade, semesterGpa, defaultScale } from "../academic/grades";
import type { ScaleEntry } from "../academic/types";
import {
  code,
  termOrder,
  uid,
  type DegreeState,
  type DegreeCourse,
  type DegreeRequirement,
  type DegreePlan,
} from "./types";
export function gradePoints(
  grade: string,
  scale: ScaleEntry[] = defaultScale,
): number | null {
  const g = grade.trim().toUpperCase();
  if (!g || /^(P|PASS|TR|S|W|I|IP)$/.test(g)) return null;
  return (
    scale.find((s) => s.letter.toUpperCase() === g)?.points ??
    (/^\d+(\.\d+)?$/.test(g)
      ? (letterGrade(Number(g), scale)?.points ?? null)
      : null)
  );
}
export const earned = (c: DegreeCourse) =>
  !c.excluded &&
  ["completed", "transferred"].includes(c.status) &&
  !/^(F|FAIL|W|WF|NP|U)$/i.test(c.grade.trim()) &&
  (!/^\d+(\.\d+)?$/.test(c.grade) || (gradePoints(c.grade) ?? 0) > 0);
/** A repeated course contributes credits once, using its latest eligible attempt. */
export function uniqueCourses(courses: DegreeCourse[]) {
  const map = new Map<string, DegreeCourse>();
  for (const c of [...courses].sort(
    (a, b) => (termOrder(a.term) ?? 0) - (termOrder(b.term) ?? 0),
  ))
    map.set(code(c.subject, c.number), c);
  return [...map.values()];
}
function eligible(s: DegreeState, r: DegreeRequirement, expected: boolean) {
  const options = s.options
    .filter((o) => o.requirement_id === r.id)
    .map((o) => code(o.subject, o.number));
  return uniqueCourses(
    s.courses.filter(
      (c) =>
        (earned(c) ||
          (expected && !c.excluded && c.status === "in_progress")) &&
        (r.minimum_grade === null ||
          (/^\d+(\.\d+)?$/.test(c.grade) &&
            Number(c.grade) >= r.minimum_grade)) &&
        (["specific", "one_of", "choose_n", "course_set"].includes(r.kind)
          ? options.includes(code(c.subject, c.number))
          : r.kind === "level"
            ? Number.parseInt(c.number, 10) >= (r.minimum_level ?? Infinity)
            : r.kind === "attribute"
              ? c.attributes
                  .split(/[,;]+/)
                  .some(
                    (a) =>
                      a.trim().toLowerCase() ===
                      r.attribute.trim().toLowerCase(),
                  )
              : s.allocations.some(
                  (a) => a.requirement_id === r.id && a.course_id === c.id,
                )),
    ),
  );
}
export function requirementProgress(
  s: DegreeState,
  r: DegreeRequirement,
  expected = false,
) {
  const courses = eligible(s, r, expected),
    credits = courses.reduce((n, c) => n + c.credits, 0);
  const complete =
    r.kind === "manual"
      ? Boolean(r.manual_complete)
      : ["specific", "one_of", "choose_n"].includes(r.kind)
        ? courses.length >= (r.kind === "choose_n" ? r.count_required : 1) &&
          credits >= r.credits_required
        : credits >= r.credits_required &&
          (r.credits_required > 0 ||
            courses.length > 0 ||
            Boolean(r.manual_complete));
  return { complete, credits, courses };
}
export function groupProgress(
  s: DegreeState,
  id: string,
  expected = false,
  visited = new Set<string>(),
): { complete: boolean; credits: number; courses: DegreeCourse[] } {
  if (visited.has(id)) return { complete: false, credits: 0, courses: [] };
  const g = s.groups.find((g) => g.id === id);
  if (!g) return { complete: false, credits: 0, courses: [] };
  const next = new Set(visited).add(id),
    rows = s.requirements
      .filter((r) => r.group_id === id)
      .map((r) => requirementProgress(s, r, expected)),
    children = s.groups
      .filter((c) => c.parent_id === id)
      .map((c) => groupProgress(s, c.id, expected, next));
  const all = [...rows, ...children],
    courses = uniqueCourses(all.flatMap((r) => r.courses)),
    credits = courses.reduce((n, c) => n + c.credits, 0);
  const gpa = semesterGpa(
    courses.map((c) => ({ credits: c.credits, points: gradePoints(c.grade) })),
  ).value;
  return {
    credits,
    courses,
    complete:
      (g.minimum_gpa === null || (gpa !== null && gpa >= g.minimum_gpa)) &&
      (g.completion_rule === "credits"
        ? credits >= g.credits_required
        : g.completion_rule === "any"
          ? all.some((r) => r.complete)
          : all.length > 0 && all.every((r) => r.complete)) &&
      credits >= g.credits_required,
  };
}
export function degreeProgress(s: DegreeState) {
  const actual = uniqueCourses(s.courses.filter(earned)),
    expected = uniqueCourses(
      s.courses.filter(
        (c) => earned(c) || (!c.excluded && c.status === "in_progress"),
      ),
    );
  const sum = (cs: DegreeCourse[]) => cs.reduce((n, c) => n + c.credits, 0);
  // A group whose credits double-count another group (e.g. an audit's "History of
  // Ideas" bucket satisfied entirely by courses already required elsewhere) adds no
  // additional requirement of its own, so its placeholder requirements are excluded
  // from the top-level "requirements complete" tally.
  const counted = s.requirements.filter(
    (r) => s.groups.find((g) => g.id === r.group_id)?.contributes_credits !== 0,
  );
  return {
    credits: sum(actual),
    expectedCredits: sum(expected),
    inProgressCredits: sum(expected) - sum(actual),
    projectedRemaining: Math.max(0, s.program.total_credits - sum(expected)),
    auditUsedCredits: s.program.reported_used_credits,
    plannedCredits: s.plans.reduce((n, p) => n + p.credits, 0),
    remaining: Math.max(0, s.program.total_credits - sum(actual)),
    complete: counted.filter((r) => requirementProgress(s, r).complete).length,
    total: counted.length,
  };
}
export function degreeGpa(
  s: DegreeState,
  scale = defaultScale,
  scenario: Record<string, number> = {},
) {
  const rows = s.courses.filter(
    (c) =>
      !c.excluded &&
      c.status !== "transferred" &&
      (c.status === "completed" ||
        c.status === "failed" ||
        scenario[c.id] !== undefined),
  );
  return semesterGpa(
    rows.map((c) => ({
      credits: c.credits,
      points: ["completed", "failed"].includes(c.status)
        ? gradePoints(c.grade, scale)
        : (scenario[c.id] ?? null),
    })),
  );
}
export function targetGpa(
  gpa: number,
  gradedCredits: number,
  remaining: number,
  target: number,
  max: number,
) {
  if (remaining <= 0) return { required: null, reachable: gpa >= target };
  const required =
    (target * (gradedCredits + remaining) - gpa * gradedCredits) / remaining;
  return { required: Math.max(0, required), reachable: required <= max };
}
export function prerequisiteWarnings(s: DegreeState, plans = s.plans) {
  const warnings: { planId: string; message: string }[] = [];
  for (const p of plans) {
    const target = termOrder(p.term);
    const rules = s.prerequisites.filter(
      (r) => code(r.subject, r.number) === code(p.subject, p.number),
    );
    const satisfied = (sub: string, num: string, minimum = "") =>
      s.courses.some(
        (c) =>
          code(c.subject, c.number) === code(sub, num) &&
          (earned(c) || (!c.excluded && c.status === "in_progress")) &&
          (!minimum ||
            c.status === "in_progress" ||
            (gradePoints(c.grade) ?? -1) >=
              (gradePoints(minimum) ?? Infinity)) &&
          target !== null &&
          termOrder(c.term) !== null &&
          termOrder(c.term)! < target,
      ) ||
      plans.some(
        (q) =>
          code(q.subject, q.number) === code(sub, num) &&
          target !== null &&
          termOrder(q.term) !== null &&
          termOrder(q.term)! < target,
      );
    const missing = rules.filter(
      (r) =>
        r.relation === "all" &&
        !satisfied(
          r.prerequisite_subject,
          r.prerequisite_number,
          r.minimum_grade,
        ),
    );
    const any = rules.filter((r) => r.relation === "any");
    if (
      missing.length ||
      (any.length &&
        !any.some((r) =>
          satisfied(
            r.prerequisite_subject,
            r.prerequisite_number,
            r.minimum_grade,
          ),
        ))
    )
      warnings.push({
        planId: p.id,
        message: `${code(p.subject, p.number)} in ${p.term} needs earlier prerequisite ${[...missing, ...(any.length && !any.some((r) => satisfied(r.prerequisite_subject, r.prerequisite_number, r.minimum_grade)) ? any : [])].map((r) => (r.minimum_grade ? `${r.minimum_grade} in ` : "") + code(r.prerequisite_subject, r.prerequisite_number)).join(", ")}.`,
      });
  }
  return warnings;
}
export function graduationPlan(
  s: DegreeState,
  terms: string[],
  maxCredits: number,
  minCredits = 0,
) {
  if (
    !Number.isFinite(maxCredits) ||
    maxCredits <= 0 ||
    minCredits < 0 ||
    minCredits > maxCredits
  )
    throw Error("Choose valid semester credit limits.");
  if (terms.some((t) => termOrder(t) === null))
    throw Error("Use terms such as Spring 2027.");
  const plans = [...s.plans],
    unscheduled: string[] = [],
    warnings: string[] = [];
  const remaining = s.requirements
    .filter(
      (r) =>
        s.groups.find((g) => g.id === r.group_id)?.contributes_credits !== 0 &&
        !requirementProgress(s, r, true).complete &&
        !plans.some((p) => p.requirement_id === r.id),
    )
    .sort(
      (a, b) =>
        Number(["elective", "manual", "attribute"].includes(a.kind)) -
          Number(["elective", "manual", "attribute"].includes(b.kind)) ||
        a.display_order - b.display_order ||
        a.id.localeCompare(b.id),
    );
  const ordered = [...new Set(terms)].sort(
    (a, b) => termOrder(a)! - termOrder(b)!,
  );
  const inProgressCredits = (term: string) =>
    uniqueCourses(
      s.courses.filter(
        (c) =>
          !c.excluded &&
          c.status === "in_progress" &&
          termOrder(c.term) === termOrder(term),
      ),
    ).reduce((n, c) => n + c.credits, 0);
  // Retry after scheduling prerequisites. New prerequisites always occupy an earlier term.
  let pending = [...remaining];
  for (let pass = 0; pass <= remaining.length && pending.length; pass++) {
    const next: DegreeRequirement[] = [];
    for (const r of pending) {
      const options = s.options.filter((o) => o.requirement_id === r.id);
      if (
        r.kind === "manual" ||
        r.kind === "attribute" ||
        (r.kind === "choose_n" && r.count_required > 1)
      ) {
        next.push(r);
        continue;
      }
      let placed = false;
      for (const term of ordered) {
        const credits = Math.max(
          0,
          r.credits_required - requirementProgress(s, r, true).credits,
        );
        if (
          plans
            .filter((p) => p.term === term)
            .reduce((n, p) => n + p.credits, 0) +
            inProgressCredits(term) +
            credits >
          maxCredits
        )
          continue;
        for (const option of options.length
          ? options
          : [{ subject: "", number: "" }]) {
          const p: DegreePlan = {
            id: uid(),
            requirement_id: r.id,
            term,
            semester_id: null,
            subject: option.subject,
            number: option.number,
            credits,
            override_prerequisites: 0,
          };
          if (
            option.subject &&
            plans.some(
              (q) => code(q.subject, q.number) === code(p.subject, p.number),
            )
          ) {
            continue;
          }
          if (
            prerequisiteWarnings(s, [...plans, p]).some(
              (w) => w.planId === p.id,
            )
          )
            continue;
          plans.push(p);
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (!placed) next.push(r);
    }
    if (next.length === pending.length) {
      pending = next;
      break;
    }
    pending = next;
  }
  unscheduled.push(...pending.map((r) => r.id));
  for (const term of ordered) {
    const credits =
      plans.filter((p) => p.term === term).reduce((n, p) => n + p.credits, 0) +
      inProgressCredits(term);
    if (credits > maxCredits)
      warnings.push(`${term}: existing plans exceed ${maxCredits} credits.`);
    if (credits < minCredits)
      warnings.push(`${term}: below the requested minimum.`);
  }
  return {
    plans,
    unscheduled,
    warnings: [
      ...warnings,
      ...prerequisiteWarnings(s, plans).map((w) => w.message),
    ],
  };
}
