export type CourseStatus =
  "completed" | "in_progress" | "planned" | "failed" | "transferred";
export type RequirementKind =
  | "specific"
  | "one_of"
  | "choose_n"
  | "course_set"
  | "elective"
  | "attribute"
  | "manual"
  | "level";
export interface DegreeProgram {
  id: string;
  name: string;
  degree_type: string;
  major: string;
  minor: string;
  catalog_term: string;
  evaluation_term: string;
  institution: string;
  total_credits: number;
  minimum_gpa: number | null;
  reported_gpa: number | null;
  reported_used_credits: number | null;
  revision: number;
}
export interface DegreeGroup {
  id: string;
  program_id: string;
  parent_id: string | null;
  name: string;
  description: string;
  credits_required: number;
  minimum_gpa: number | null;
  reported_used_credits: number | null;
  reported_gpa: number | null;
  display_order: number;
  completion_rule: "all" | "any" | "credits";
  contributes_credits: number;
}
export interface DegreeRequirement {
  id: string;
  group_id: string;
  name: string;
  kind: RequirementKind;
  credits_required: number;
  count_required: number;
  minimum_grade: number | null;
  minimum_level: number | null;
  attribute: string;
  manual_complete: number;
  display_order: number;
}
export interface DegreeOption {
  id: string;
  requirement_id: string;
  subject: string;
  number: string;
}
export interface DegreeCourse {
  id: string;
  program_id: string;
  subject: string;
  number: string;
  title: string;
  credits: number;
  grade: string;
  term: string;
  original_term: string;
  status: CourseStatus;
  source: string;
  course_id: string | null;
  excluded: number;
  attributes: string;
}
export interface Allocation {
  requirement_id: string;
  course_id: string;
}
export interface DegreePlan {
  id: string;
  requirement_id: string;
  term: string;
  semester_id: string | null;
  subject: string;
  number: string;
  credits: number;
  override_prerequisites: number;
}
export interface Prerequisite {
  minimum_grade?: string;
  id: string;
  program_id: string;
  subject: string;
  number: string;
  prerequisite_subject: string;
  prerequisite_number: string;
  relation: "all" | "any";
}
export interface DegreeState {
  program: DegreeProgram;
  groups: DegreeGroup[];
  requirements: DegreeRequirement[];
  options: DegreeOption[];
  courses: DegreeCourse[];
  allocations: Allocation[];
  plans: DegreePlan[];
  prerequisites: Prerequisite[];
}
export interface ImportSource {
  id: string;
  filename: string;
  parser_version: string;
  source_path: string;
  content_hash: string;
  imported_at?: string;
  changes_json?: string;
}
export const uid = () => crypto.randomUUID();
export const code = (subject: string, number: string) =>
  `${subject.replace(/\s/g, "").toUpperCase()} ${number.replace(/\s/g, "").toUpperCase()}`;
export function normalizeTerm(value: string) {
  const sis=value.trim().match(/^(\d{4})(10|20|30)$/);
  if(sis)return `${sis[2]==="10"?"Fall":sis[2]==="20"?"Spring":"Summer"} ${+sis[1]-(sis[2]==="10"?1:0)}`;
  const m = value.match(
    /\b(Fall|Autumn|Spring|Summer|Winter)\s*(\d{4})(?:\s*[-/]\s*(\d{4}))?/i,
  );
  return m
    ? `${m[1].toLowerCase() === "autumn" ? "Fall" : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()} ${m[3] && /spring|summer/i.test(m[1]) ? m[3] : m[2]}`
    : value.trim().replace(/\s+/g, " ");
}
export function termOrder(term: string) {
  const m = normalizeTerm(term).match(/^(Winter|Spring|Summer|Fall) (\d{4})$/);
  return m
    ? Number(m[2]) * 4 + ["Winter", "Spring", "Summer", "Fall"].indexOf(m[1])
    : null;
}
export function emptyDegree(): DegreeState {
  return {
    program: {
      id: uid(),
      name: "New degree",
      degree_type: "",
      major: "",
      minor: "",
      catalog_term: "",
      evaluation_term: "",
      institution: "",
      total_credits: 0,
      minimum_gpa: null,
      reported_gpa: null,
      reported_used_credits: null,
      revision: 0,
    },
    groups: [],
    requirements: [],
    options: [],
    courses: [],
    allocations: [],
    plans: [],
    prerequisites: [],
  };
}
export function newGroup(
  program_id: string,
  name = "Requirements",
): DegreeGroup {
  return {
    id: uid(),
    program_id,
    parent_id: null,
    name,
    description: "",
    credits_required: 0,
    minimum_gpa: null,
    reported_used_credits: null,
    reported_gpa: null,
    display_order: 0,
    completion_rule: "all",
    contributes_credits: 1,
  };
}
export function newRequirement(group_id: string): DegreeRequirement {
  return {
    id: uid(),
    group_id,
    name: "Course requirement",
    kind: "specific",
    credits_required: 3,
    count_required: 1,
    minimum_grade: null,
    minimum_level: null,
    attribute: "",
    manual_complete: 0,
    display_order: 0,
  };
}
export function newCourse(program_id: string): DegreeCourse {
  return {
    id: uid(),
    program_id,
    subject: "",
    number: "",
    title: "",
    credits: 3,
    grade: "",
    term: "",
    original_term: "",
    status: "completed",
    source: "Manual",
    course_id: null,
    excluded: 0,
    attributes: "",
  };
}
