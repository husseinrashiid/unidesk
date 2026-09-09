import { query, batch } from "../../services/platform";
import { insert, update } from "../../db/repository";
import type { Statement, SqlValue, Course } from "../../types";
import {
  code,
  normalizeTerm,
  type DegreeState,
  type DegreeProgram,
  type ImportSource,
} from "./types";
const tables = {
  groups: "degree_groups",
  requirements: "degree_requirements",
  options: "degree_options",
  courses: "degree_courses",
  allocations: "degree_allocations",
  plans: "degree_plans",
  prerequisites: "degree_prerequisites",
} as const;
export async function loadDegree(id: string): Promise<DegreeState> {
  const [program] = await query<DegreeProgram>(
    "SELECT * FROM degree_programs WHERE id=?",
    [id],
  );
  if (!program) throw Error("Degree no longer exists.");
  const groups = await query<DegreeState["groups"][number]>(
    "SELECT * FROM degree_groups WHERE program_id=? ORDER BY display_order",
    [id],
  );
  const requirements = await query<DegreeState["requirements"][number]>(
    "SELECT r.* FROM degree_requirements r JOIN degree_groups g ON g.id=r.group_id WHERE g.program_id=? ORDER BY r.display_order",
    [id],
  );
  const [options, courses, allocations, plans, prerequisites] =
    await Promise.all([
      query<DegreeState["options"][number]>(
        "SELECT o.* FROM degree_options o JOIN degree_requirements r ON r.id=o.requirement_id JOIN degree_groups g ON g.id=r.group_id WHERE g.program_id=?",
        [id],
      ),
      query<DegreeState["courses"][number]>(
        "SELECT * FROM degree_courses WHERE program_id=?",
        [id],
      ),
      query<DegreeState["allocations"][number]>(
        "SELECT a.* FROM degree_allocations a JOIN degree_courses c ON c.id=a.course_id WHERE c.program_id=?",
        [id],
      ),
      query<DegreeState["plans"][number]>(
        "SELECT p.* FROM degree_plans p JOIN degree_requirements r ON r.id=p.requirement_id JOIN degree_groups g ON g.id=r.group_id WHERE g.program_id=?",
        [id],
      ),
      query<DegreeState["prerequisites"][number]>(
        "SELECT * FROM degree_prerequisites WHERE program_id=?",
        [id],
      ),
    ]);
  return {
    program,
    groups,
    requirements,
    options,
    courses,
    allocations,
    plans,
    prerequisites,
  };
}
export function matchCourses(
  s: DegreeState,
  courses: (Pick<Course, "id" | "code" | "name"> & { term: string })[],
) {
  for (const c of s.courses) {
    const exact = courses.filter(
      (x) =>
        x.code.replace(/\s/g, "").toUpperCase() ===
        code(c.subject, c.number).replace(/\s/g, ""),
    );
    const term = exact.filter((x) => normalizeTerm(x.term) === c.term);
    const fallback =
      c.title.length > 8
        ? courses.filter(
            (x) =>
              x.name.trim().toLowerCase() === c.title.trim().toLowerCase() &&
              normalizeTerm(x.term) === c.term,
          )
        : [];
    c.course_id =
      term.length === 1
        ? term[0].id
        : exact.length === 1 &&
            (!c.term || normalizeTerm(exact[0].term) === c.term)
          ? exact[0].id
          : !exact.length && fallback.length === 1
            ? fallback[0].id
            : null;
  }
  return s;
}
export function mergeDetectedCourses(s: DegreeState): DegreeState {
  const out = structuredClone(s),
    seen = new Map<string, string>();
  out.courses = out.courses.filter((c) => {
    c.subject = c.subject.trim().toUpperCase();
    c.number = c.number.trim().toUpperCase();
    c.term = normalizeTerm(c.term);
    const key = `${code(c.subject, c.number)}:${c.term}:${c.grade}:${c.status}`;
    const id = seen.get(key);
    if (id) {
      out.allocations.forEach((a) => {
        if (a.course_id === c.id) a.course_id = id;
      });
      return false;
    }
    seen.set(key, c.id);
    return true;
  });
  out.allocations = out.allocations.filter(
    (a, i, all) =>
      all.findIndex(
        (b) =>
          a.course_id === b.course_id && a.requirement_id === b.requirement_id,
      ) === i,
  );
  return out;
}
/** Match stable identities on updates, retaining plans and manual history. Missing imported rows remain for explicit review. */
export function mergeEvaluation(old: DegreeState, incoming: DegreeState) {
  const next = structuredClone(old),
    changes: string[] = [];
  if (old.program.reported_gpa !== incoming.program.reported_gpa)
    changes.push(
      `GPA: ${old.program.reported_gpa ?? "?"} ? ${incoming.program.reported_gpa ?? "?"}`,
    );
  next.program = {
    ...incoming.program,
    id: old.program.id,
    revision: old.program.revision,
  };
  const groupMap = new Map<string, string>(),
    reqMap = new Map<string, string>(),
    courseMap = new Map<string, string>();
  for (const g of incoming.groups) {
    const found = old.groups.find(
      (x) => x.name.toLowerCase() === g.name.toLowerCase(),
    );
    groupMap.set(g.id, found?.id ?? g.id);
    const row = { ...g, id: found?.id ?? g.id, program_id: old.program.id };
    if (found) {
      if (found.reported_used_credits !== g.reported_used_credits)
        changes.push(
          `Requirement progress: ${g.name} ${found.reported_used_credits ?? 0} ? ${g.reported_used_credits ?? 0} credits`,
        );
      Object.assign(
        next.groups.find((x) => x.id === found.id)!,
        row,
      );
    } else {
      next.groups.push(row);
      changes.push(`+ Requirement group: ${g.name}`);
    }
  }
  next.groups.forEach((g) => {
    if (g.parent_id) g.parent_id = groupMap.get(g.parent_id) ?? g.parent_id;
  });
  for (const r of incoming.requirements) {
    const group_id = groupMap.get(r.group_id)!;
    const found = old.requirements.find(
      (x) =>
        x.group_id === group_id &&
        x.name === r.name &&
        ![...reqMap.values()].includes(x.id),
    );
    reqMap.set(r.id, found?.id ?? r.id);
    const row = { ...r, id: found?.id ?? r.id, group_id };
    if (found) {
      if (
        JSON.stringify({ ...row, id: "" }) !==
        JSON.stringify({ ...found, id: "" })
      )
        changes.push(`~ Requirement: ${r.name}`);
      Object.assign(
        next.requirements.find((x) => x.id === found.id)!,
        row,
      );
    } else {
      next.requirements.push(row);
      changes.push(`+ Requirement: ${r.name}`);
    }
  }
  for (const o of incoming.options) {
    const requirement_id = reqMap.get(o.requirement_id)!;
    if (
      !next.options.some(
        (x) =>
          x.requirement_id === requirement_id &&
          code(x.subject, x.number) === code(o.subject, o.number),
      )
    )
      next.options.push({ ...o, requirement_id });
  }
  for (const c of incoming.courses) {
    const found = old.courses.find(
      (x) =>
        code(x.subject, x.number) === code(c.subject, c.number) &&
        normalizeTerm(x.term) === normalizeTerm(c.term),
    );
    courseMap.set(c.id, found?.id ?? c.id);
    const row = {
      ...c,
      id: found?.id ?? c.id,
      program_id: old.program.id,
      course_id: c.course_id ?? found?.course_id ?? null,
    };
    if (found) {
      if (
        found.grade !== c.grade ||
        found.status !== c.status ||
        found.credits !== c.credits ||
        found.excluded !== c.excluded
      )
        changes.push(
          `~ ${code(c.subject, c.number)} ${c.term}: ${found.status} ${found.grade} → ${c.status} ${c.grade}`,
        );
      Object.assign(
        next.courses.find((x) => x.id === found.id)!,
        row,
      );
    } else {
      next.courses.push(row);
      changes.push(`+ ${code(c.subject, c.number)} ${c.term}: ${c.status}`);
    }
  }
  // Replace usages for the reviewed areas; retaining stale slot links double-counts updates.
  next.allocations = next.allocations.filter(
    (a) => ![...reqMap.values()].includes(a.requirement_id),
  );
  for (const p of incoming.prerequisites) {
    const found = next.prerequisites.find(
      (x) =>
        code(x.subject, x.number) === code(p.subject, p.number) &&
        code(x.prerequisite_subject, x.prerequisite_number) ===
          code(p.prerequisite_subject, p.prerequisite_number),
    );
    if (found)
      Object.assign(found, { ...p, id: found.id, program_id: old.program.id });
    else next.prerequisites.push({ ...p, program_id: old.program.id });
  }
  for (const c of next.courses)
    if (
      c.source !== "Manual" &&
      c.status !== "planned" &&
      ![...courseMap.values()].includes(c.id)
    ) {
      c.excluded = 1;
      changes.push(
        `Not counted in this evaluation: ${code(c.subject, c.number)} ${c.term}`,
      );
    }
  for (const a of incoming.allocations) {
    const row = {
      requirement_id: reqMap.get(a.requirement_id)!,
      course_id: courseMap.get(a.course_id)!,
    };
    if (
      !next.allocations.some(
        (x) =>
          x.requirement_id === row.requirement_id &&
          x.course_id === row.course_id,
      )
    )
      next.allocations.push(row);
  }
  for (const r of old.requirements)
    if (![...reqMap.values()].includes(r.id))
      changes.push(
        `− Not present in new evaluation (retained for review): ${r.name}`,
      );
  return { state: next, changes };
}
const values = (o: object) => o as Record<string, SqlValue>;
export function validateDegree(s: DegreeState) {
  if (
    !s.program.name.trim() ||
    !Number.isFinite(s.program.total_credits) ||
    s.program.total_credits < 0
  )
    throw Error("Enter a program name and valid total credits.");
  for (const g of s.groups) {
    const seen = new Set([g.id]);
    let p = g.parent_id;
    while (p) {
      if (seen.has(p))
        throw Error("Requirement groups cannot contain a cycle.");
      seen.add(p);
      p = s.groups.find((x) => x.id === p)?.parent_id ?? null;
    }
  }
  const attempts = new Set<string>();
  for (const c of s.courses) {
    if (
      !c.subject.trim() ||
      !c.number.trim() ||
      c.credits < 0 ||
      !Number.isFinite(c.credits)
    )
      throw Error("Every course needs a code and nonnegative credits.");
    const key = `${code(c.subject, c.number)}:${normalizeTerm(c.term)}`;
    if (attempts.has(key))
      throw Error(
        `Duplicate attempt: ${key}. Merge duplicates or correct their terms.`,
      );
    attempts.add(key);
  }
  for (const r of s.requirements) {
    if (
      !r.name.trim() ||
      r.credits_required < 0 ||
      !Number.isFinite(r.credits_required)
    )
      throw Error("Requirements need names and valid credits.");
    if (
      ["specific", "one_of", "choose_n", "course_set"].includes(r.kind) &&
      !s.options.some((o) => o.requirement_id === r.id)
    )
      throw Error(`Add course options to ${r.name}.`);
  }
  const planned = new Set<string>();
  for (const p of s.plans) {
    if (p.credits < 0 || !Number.isFinite(p.credits))
      throw Error("Enter valid planned credits.");
    if (p.subject && p.number) {
      const key = code(p.subject, p.number);
      if (planned.has(key))
        throw Error(
          `${key} is planned more than once. Assign it to one requirement; its course history can satisfy overlapping groups.`,
        );
      planned.add(key);
    }
  }
  for (const p of s.prerequisites)
    if (
      !p.subject.trim() ||
      !p.number.trim() ||
      !p.prerequisite_subject.trim() ||
      !p.prerequisite_number.trim()
    )
      throw Error("Complete all prerequisite course codes.");
}
export function degreeSaveStatements(
  s: DegreeState,
  old: DegreeState | null,
  source?: ImportSource,
): Statement[] {
  validateDegree(s);
  const out: Statement[] = [];
  const program = { ...s.program, revision: (old?.program.revision ?? -1) + 1 };
  if (old) {
    out.push({
      sql: "UPDATE degree_programs SET revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=?",
      params: [old.program.id, old.program.revision],
      expectChanges: 1,
    });
    out.push(update("degree_programs", s.program.id, values(program)));
  } else out.push(insert("degree_programs", values(program)));
  // Delete only rows removed explicitly in review, children first. Retain stable IDs.
  if (old)
    for (const key of [
      "allocations",
      "options",
      "plans",
      "prerequisites",
      "courses",
      "requirements",
      "groups",
    ] as const) {
      if (key === "allocations") {
        for (const a of old.allocations)
          if (
            !s.allocations.some(
              (x) =>
                x.requirement_id === a.requirement_id &&
                x.course_id === a.course_id,
            )
          )
            out.push({
              sql: "DELETE FROM degree_allocations WHERE requirement_id=? AND course_id=?",
              params: [a.requirement_id, a.course_id],
            });
      } else
        for (const row of old[key])
          if (!s[key].some((x) => x.id === row.id))
            out.push({
              sql: `DELETE FROM ${tables[key]} WHERE id=?`,
              params: [row.id],
            });
    }
  // Parents first regardless of display order.
  const groups = [...s.groups].sort((a, b) => {
    const depth = (id: string | null): number =>
      id ? 1 + depth(s.groups.find((g) => g.id === id)?.parent_id ?? null) : 0;
    return depth(a.parent_id) - depth(b.parent_id);
  });
  for (const key of [
    "groups",
    "requirements",
    "options",
    "courses",
    "plans",
    "prerequisites",
  ] as const)
    for (const row of key === "groups" ? groups : s[key]) {
      const previous = old?.[key].find((x) => x.id === row.id);
      out.push(
        previous
          ? update(tables[key], row.id, values(row))
          : insert(tables[key], values(row)),
      );
    }
  for (const a of s.allocations)
    if (
      !old?.allocations.some(
        (x) =>
          x.requirement_id === a.requirement_id && x.course_id === a.course_id,
      )
    )
      out.push(insert("degree_allocations", values(a)));
  if (source)
    out.push(
      insert("local_import_sources", {
        id: source.id,
        kind: source.parser_version === "manual" ? "manual" : "degree",
        program_id: s.program.id,
        filename: source.filename,
        parser_version: source.parser_version,
        source_path: source.source_path,
        content_hash: source.content_hash,
        changes_json: source.changes_json ?? "[]",
      }),
    );
  if (source)
    out.push(
      insert("degree_import_snapshots", {
        source_id: source.id,
        before_json: old ? JSON.stringify(old) : null,
        after_json: JSON.stringify(s),
      }),
    );
  return out;
}
export const saveDegree = (
  s: DegreeState,
  old: DegreeState | null,
  source?: ImportSource,
) => batch(degreeSaveStatements(s, old, source));
