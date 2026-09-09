import {
  code,
  newGroup,
  newRequirement,
  uid,
  type DegreeState,
  type DegreeRequirement,
} from "./types";
import { requirementProgress, uniqueCourses } from "./engine";

// Structure verified against BS in Computer Science 24-25.pdf supplied by the user.
// Personal grades, terms, credits and audit evidence always come from the evaluation.
export const CATALOGUE = "AUB BS Computer Science 24-25";
export const coreCourses = [
  ["201", "Introduction to Programming", "", ""],
  ["202", "Data Structures", "201", "C+"],
  ["214", "Design and Analysis of Algorithms", "202", "C+"],
  ["215", "Theory of Computation", "214", ""],
  ["221", "Computer Organization and Design", "202", "C+"],
  ["240", "Operating Systems", "221", ""],
  ["241", "System Programming", "202", "C+"],
  ["271", "Software Engineering", "270", ""],
] as const;
export const technicalOptions = [
  "BIOL 251",
  "ECON 214",
  "ECON 217",
  "FINA 210",
  "MATH 210",
  "MATH 261",
  "MATH 234",
  "STAT 234",
  "MATH 238",
  "STAT 238",
  "PHYS 222",
  "PHYS 228",
  "PHYS 235",
  "PSYC 222",
  "PSYC 229",
];
export const catalogueGroups = (s: DegreeState) =>
  s.groups.filter((g) => g.description.startsWith(CATALOGUE));
export function applyCatalogue(input: DegreeState): DegreeState {
  const s = structuredClone(input);
  if (
    !/computer science/i.test(s.program.major || s.program.name) ||
    !/2024-2025/.test(s.program.catalog_term)
  )
    return s;
  if (catalogueGroups(s).length) return s;
  const audit = structuredClone(s);
  s.groups.forEach((g) => {
    g.contributes_credits = 0;
  });
  const group = (name: string, credits: number, note = "") => {
    const g = {
      ...newGroup(s.program.id, name),
      credits_required: credits,
      description: `${CATALOGUE}. ${note}`,
      display_order: s.groups.length,
    };
    s.groups.push(g);
    return g.id;
  };
  const add = (
    group_id: string,
    name: string,
    credits: number,
    options: string[] = [],
    kind: DegreeRequirement["kind"] = "specific",
  ) => {
    const r = {
      ...newRequirement(group_id),
      name,
      credits_required: credits,
      kind:
        options.length > 1 && kind === "specific" ? ("one_of" as const) : kind,
      display_order: s.requirements.length,
    };
    s.requirements.push(r);
    options.forEach((c) => {
      const [subject, number] = c.split(" ");
      s.options.push({ id: uid(), requirement_id: r.id, subject, number });
    });
    return r;
  };
  const allocate = (r: DegreeRequirement, courses: DegreeState["courses"]) =>
    courses.forEach((c) =>
      s.allocations.push({ requirement_id: r.id, course_id: c.id }),
    );
  const core = group("Major requirements", 24);
  for (const [number, title, pre, minimum_grade] of coreCourses) {
    add(core, `CMPS ${number} · ${title}`, 3, [`CMPS ${number}`]);
    if (pre)
      s.prerequisites.push({
        id: uid(),
        program_id: s.program.id,
        subject: "CMPS",
        number,
        prerequisite_subject: "CMPS",
        prerequisite_number: pre,
        relation: "all",
        minimum_grade,
      });
  }
  const elective = group(
    "CMPS electives",
    18,
    "Six courses numbered 214 or above, except CMPS 297T. Audit-approved substitutions are retained.",
  );
  const auditMajor = audit.groups.find((g) => /Major Req/i.test(g.name));
  const electiveReqs = audit.requirements.filter(
    (r) => r.group_id === auditMajor?.id && /elect/i.test(r.name),
  );
  const used = uniqueCourses(
    electiveReqs.flatMap((r) => requirementProgress(audit, r, true).courses),
  );
  used.sort(
    (a, b) =>
      Number(a.status === "in_progress") - Number(b.status === "in_progress"),
  );
  for (let i = 0; i < 6; i++) {
    const r = add(elective, `Elective ${i + 1}`, 3, [], "elective");
    if (used[i]) allocate(r, [used[i]]);
  }
  const math = group("Math / Statistics", 9);
  add(math, "Discrete Structures", 3, ["CMPS 211", "MATH 211"]);
  add(math, "Calculus · MATH 201", 3, ["MATH 201"]);
  add(math, "Probability requirement", 3, ["STAT 230", "STAT 233"]);
  for (const number of ["230", "233"])
    s.prerequisites.push({
      id: uid(),
      program_id: s.program.id,
      subject: "STAT",
      number,
      prerequisite_subject: "MATH",
      prerequisite_number: "201",
      relation: "all",
      minimum_grade: "",
    });
  const tech = group(
    "Technical elective",
    3,
    "Choose an approved technical course or a CMPS elective numbered 214 or above.",
  );
  const technical = add(
    tech,
    "Technical elective",
    3,
    technicalOptions,
    "elective",
  );
  allocate(
    technical,
    audit.requirements
      .filter((r) => /technical/i.test(r.name))
      .flatMap((r) => requirementProgress(audit, r, true).courses),
  );
  const communication = group("Understanding Communication", 9);
  const arabic = add(communication, "Arabic communication", 3, [], "elective");
  allocate(
    arabic,
    audit.requirements
      .filter((r) =>
        audit.groups.find(
          (g) => g.id === r.group_id && /Arabic Communication/i.test(g.name),
        ),
      )
      .flatMap((r) => requirementProgress(audit, r, true).courses),
  );
  add(communication, "Academic English · ENGL 203", 3, ["ENGL 203"]);
  add(communication, "Advanced Academic English · ENGL 204", 3, ["ENGL 204"]);
  const cel = group("Community-engaged Learning", 3);
  add(
    cel,
    "Community-engaged learning",
    3,
    ["PHIL 200A", "PHIL 200B"],
    "course_set",
  );
  const geSlot = (
    g: string,
    name: string,
    credits: number,
    codes: string[],
  ) => {
    const r = add(g, name, credits, [], "elective");
    allocate(
      r,
      audit.courses.filter(
        (c) => !c.excluded && codes.includes(code(c.subject, c.number)),
      ),
    );
    return r;
  };
  const hv = group("Human Values", 3);
  geSlot(hv, "Human Values", 3, ["PHIL 210"]);
  const ch = group("Cultures & Histories", 9);
  geSlot(ch, "Cultures & Histories 1", 3, ["HIST 245"]);
  geSlot(ch, "Cultures & Histories 2", 3, ["HIST 246"]);
  add(ch, "Cultures & Histories 3", 3, [], "elective");
  const world = group("Understanding the World", 3);
  geSlot(world, "Understanding the World", 3, ["CHEM 200"]);
  const qr = group(
    "Quantitative Reasoning",
    3,
    "Additional QR is met through MATH 201 and adds no credits.",
  );
  add(qr, "Linear Algebra", 3, ["MATH 218", "MATH 219"]);
  const si = group("Societies & Individuals", 6);
  geSlot(si, "Societies & Individuals 1", 3, ["ECON 211"]);
  geSlot(si, "Societies & Individuals 2", 3, ["EDUC 211"]);
  const freshman = group("Freshman / Baccalaureate", 30);
  const transfer = add(
    freshman,
    "Freshman / Baccalaureate credit",
    30,
    [],
    "elective",
  );
  allocate(
    transfer,
    audit.requirements
      .filter((r) =>
        audit.groups.some(
          (g) => g.id === r.group_id && /Freshman|Bacc/i.test(g.name),
        ),
      )
      .flatMap((r) => requirementProgress(audit, r, true).courses),
  );
  const checks = group(
    "Graduation rules",
    0,
    "Requirements that do not add credits.",
  );
  s.groups.find((g) => g.id === checks)!.contributes_credits = 0;
  for (const [name, attribute] of [
    ["Minimum 120 credits", "credits:120"],
    ["Minimum cumulative GPA 2.30", "gpa:2.30"],
    ["50 credits with C+ or above", "audit:50"],
    ["Arabic communication", "audit:Arabic Communication Skills"],
    ["Social Inequalities", "audit:Social Inequalities"],
    ["CHLA course in Cultures & Histories or Human Values", "attribute:CHLA"],
  ]) {
    const r = add(checks, name, 0, [], "manual");
    r.attribute = attribute;
  }
  return s;
}
export function requirementRows(s: DegreeState) {
  const groups = catalogueGroups(s);
  return s.requirements.filter((r) =>
    (groups.length
      ? groups.filter((g) => g.contributes_credits)
      : s.groups.filter((g) => g.contributes_credits && g.credits_required > 0)
    ).some((g) => g.id === r.group_id),
  );
}
export function cataloguePlanWarnings(s: DegreeState) {
  return s.plans.flatMap((p) => {
    const r = s.requirements.find((r) => r.id === p.requirement_id);
    const g = s.groups.find((g) => g.id === r?.group_id);
    if (!p.subject || !p.number || !g?.description.startsWith(CATALOGUE))
      return [];
    const c = code(p.subject, p.number),
      cmps =
        p.subject === "CMPS" &&
        parseInt(p.number) >= 214 &&
        p.number !== "297T";
    const valid =
      g.name === "CMPS electives"
        ? cmps
        : g.name === "Technical elective"
          ? (p.subject === "CMPS" && parseInt(p.number) >= 214) ||
            technicalOptions.includes(c)
          : true;
    return valid ? [] : [`${c} is not an allowed choice for ${g.name}.`];
  });
}
