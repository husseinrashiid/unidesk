import { code, newCourse, normalizeTerm, type DegreeState } from "./types";
/** Plans are degree-history entries; course workspaces are linked only when they already exist. */
export function syncPlannedHistory(state: DegreeState): DegreeState {
  const s = structuredClone(state);
  s.courses = s.courses.filter(
    (c) =>
      !c.source.startsWith("Graduation plan:") ||
      c.status !== "planned" ||
      s.plans.some((p) => c.source === `Graduation plan:${p.requirement_id}`),
  );
  s.allocations = s.allocations.filter((a) =>
    s.courses.some((c) => c.id === a.course_id),
  );
  for (const p of s.plans) {
    if (!p.subject || !p.number) continue;
    const source = `Graduation plan:${p.requirement_id}`;
    const existing = s.courses.find(
      (c) => c.source === source && c.status === "planned",
    );
    const duplicate = s.courses.find(
      (c) =>
        c.id !== existing?.id &&
        code(c.subject, c.number) === code(p.subject, p.number) &&
        c.term === normalizeTerm(p.term),
    );
    if (duplicate) {
      if (existing) {
        s.courses = s.courses.filter((c) => c.id !== existing.id);
        s.allocations = s.allocations.filter(
          (a) => a.course_id !== existing.id,
        );
      }
      continue;
    }
    const row = {
      ...(existing ?? newCourse(s.program.id)),
      subject: p.subject.trim().toUpperCase(),
      number: p.number.trim().toUpperCase(),
      term: normalizeTerm(p.term),
      original_term: p.term,
      credits: p.credits,
      title: s.requirements.find((r) => r.id === p.requirement_id)?.name ?? "",
      status: "planned" as const,
      source,
    };
    if (existing) Object.assign(existing, row);
    else s.courses.push(row);
    if (
      !s.allocations.some(
        (a) => a.course_id === row.id && a.requirement_id === p.requirement_id,
      )
    )
      s.allocations.push({
        course_id: row.id,
        requirement_id: p.requirement_id,
      });
  }
  return s;
}
