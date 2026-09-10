import {
  normalizeDocumentText,
  type ExtractedDocument,
} from "../documents/localImport";
export const SYLLABUS_PARSER_VERSION = "syllabus-local-3";
export type ItemKind =
  | "course"
  | "instructor"
  | "schedule"
  | "grade"
  | "exam"
  | "assignment"
  | "info"
  | "policy"
  | "material"
  | "office_hours";
export interface SyllabusCandidate {
  id: string;
  kind: ItemKind;
  title: string;
  fields: Record<string, string>;
  confidence: "high" | "medium" | "low";
  reason: string;
  warnings: string[];
  selected: boolean;
}
export interface ParsedSyllabus {
  items: SyllabusCandidate[];
  diagnostics: string[];
  semester?: string;
}
export interface SyllabusParser {
  parse(input: ExtractedDocument): ParsedSyllabus;
}
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const monthToken =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
export function parseDate(
  text: string,
  year?: number,
): { value: string; warning?: string } {
  const found = [
    ...text.matchAll(
      new RegExp(
        `\\b(?:${monthToken}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${monthToken}(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})\\b`,
        "gi",
      ),
    ),
  ];
  if (found.length !== 1)
    return {
      value: "",
      warning: found.length
        ? "Multiple dates: choose the assessment date."
        : "Missing date or year.",
    };
  const raw = found[0][0];
  let y = year,
    m: number | undefined,
    d: number | undefined;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/),
    numeric = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
  } else if (numeric) {
    const a = +numeric[1],
      b = +numeric[2];
    y = +numeric[3];
    if (a <= 12 && b <= 12 && a !== b)
      return {
        value: "",
        warning: `Ambiguous date format: ${raw}. Choose YYYY-MM-DD.`,
      };
    m = a > 12 ? b : a;
    d = a > 12 ? a : b;
  } else {
    const name = raw.match(/[A-Za-z]+/)?.[0].toLowerCase();
    m = name
      ? months.findIndex((x) => x.startsWith(name.slice(0, 3))) + 1
      : undefined;
    const nums = raw.match(/\d+/g) ?? [];
    d = Number(nums[0]);
    if (nums[1]) y = Number(nums[1]);
  }
  if (!y) return { value: "", warning: `Missing year: ${raw}.` };
  if (!m || !d || y < 1900 || y > 2200)
    return { value: "", warning: "Invalid date." };
  const value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value)
    return { value: "", warning: "Invalid date." };
  return { value };
}
export function parseDays(text: string): number[] {
  const words = text.trim().replace(/\band\b/gi, "/");
  const aliases: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    m: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    t: 2,
    wed: 3,
    wednesday: 3,
    w: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    r: 4,
    th: 4,
    fri: 5,
    friday: 5,
    f: 5,
    sat: 6,
    saturday: 6,
  };
  if (/^(MWF|MW|TR|TTh|MTWRF)$/i.test(words)) {
    const compact = words.toUpperCase().replace("TH", "R");
    return [...new Set([...compact].map((c) => aliases[c.toLowerCase()]))];
  }
  const parts = words
    .toLowerCase()
    .split(/[\s/,]+/)
    .filter(Boolean);
  return parts.length && parts.every((p) => p in aliases)
    ? [...new Set(parts.map((p) => aliases[p]))]
    : [];
}
export function parseTimes(
  text: string,
): { start: string; end: string } | null {
  const m = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/i,
  );
  if (!m) return null;
  const convert = (
    h: string,
    min: string | undefined,
    period: string | undefined,
  ) => {
    let hour = +h;
    if (period) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0);
    }
    if (hour > 23 || Number(min ?? 0) > 59) return null;
    return `${String(hour).padStart(2, "0")}:${min ?? "00"}`;
  };
  let start = convert(m[1], m[2], m[3] ?? m[6]);
  const end = convert(m[4], m[5], m[6]);
  if (
    start &&
    end &&
    start >= end &&
    !m[3] &&
    m[6]?.toUpperCase() === "PM" &&
    +m[1] < 12
  )
    start = convert(m[1], m[2], "AM");
  return start && end && end > start ? { start, end } : null;
}
export function gradingWarnings(items: SyllabusCandidate[]) {
  const grades = items.filter((i) => i.kind === "grade" && i.selected),
    warnings: string[] = [];
  if (grades.length) {
    const total = grades.reduce((n, i) => n + Number(i.fields.weight), 0);
    if (Math.abs(total - 100) > 0.001)
      warnings.push(`Selected grading weights total ${total}%, not 100%.`);
    if (
      new Set(grades.map((g) => g.title.trim().toLowerCase())).size !==
      grades.length
    )
      warnings.push("Duplicate grading component names.");
  }
  return warnings;
}
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function classifyPolicy(heading: string): string {
  const h = heading.toLowerCase();
  if (/attendance/.test(h)) return "Attendance";
  if (/late/.test(h)) return "Late work";
  if (/integrity|honesty/.test(h)) return "Academic integrity";
  if (/participation/.test(h)) return "Participation";
  if (/make-?up/.test(h)) return "Make-up exams";
  if (/communicat/.test(h)) return "Communication";
  if (/electronic|laptop|cell ?phone|device/.test(h)) return "Electronic devices";
  return "Other";
}
function classifyMaterial(heading: string): string {
  const h = heading.toLowerCase();
  if (/text/.test(h)) return "textbook";
  if (/read/.test(h)) return "reading";
  if (/software/.test(h)) return "software";
  if (/website|url|link/.test(h)) return "website";
  if (/equipment/.test(h)) return "equipment";
  return "material";
}
const DESCRIPTION_HEADING =
  /^(Course Description|Description|Catalog Description|Course Overview)\s*:?$/i;
const OBJECTIVES_HEADING =
  /^(Learning Outcomes|Course Objectives|Learning Objectives|Objectives|Student Learning Outcomes)\s*:?$/i;
const MATERIALS_HEADING =
  /^(Required (?:Texts?|Materials?|Readings?)|Textbooks?|Readings?|Other Readings?|Course Materials|Materials|Software|Equipment)\s*:?$/i;
const POLICY_HEADING =
  /^(.*\bPolic(?:y|ies)\b.*|Attendance|Academic (?:Integrity|Honesty)|Late (?:Work|Submission|Assignments?)|Participation|Make-?up (?:Exams?)|Communication|Electronic Devices|Classroom (?:Conduct|Etiquette)|Disability (?:Services|Accommodations?))\s*:?$/i;
export const syllabusParser: SyllabusParser = {
  parse(input) {
    const structured = input.segments?.flatMap((segment) => {
      const heading = segment.heading ? [segment.heading] : [];
      if (segment.cells?.length) {
        const cells = segment.cells.map((c) =>
          normalizeDocumentText(c).replace(/\n/g, " ").trim(),
        );
        const labels =
          /^(?:course(?: code| title)?|section|instructor|professor|email|instructor email|office|office hours|room|location|semester|term|class(?: schedule| time)?|time)$/i;
        if (cells.length === 2 && labels.test(cells[0].replace(/:$/, "")))
          return [...heading, `${cells[0].replace(/:$/, "")}: ${cells[1]}`];
        if(cells.length>=2 && /^(?:Midterm|Final|Quiz|Reflection|Assignment|Paper|Project|Presentation|Essay|Oral|Reading quiz)/i.test(cells[1]) && /\d/.test(cells[0])) return [...heading,[cells[1],cells[0],...cells.slice(2)].join(' | ')];
        return [...heading, cells.join(" | ")];
      }
      return [...heading, ...normalizeDocumentText(segment.text).split("\n")];
    });
    const lines = (structured ?? normalizeDocumentText(input.text).split("\n"))
        .filter(Boolean)
        .map((l) => l.replace(/\s*\|\s*/g, " ").trim()),
      items: SyllabusCandidate[] = [],
      diagnostics: string[] = [];
    const term = input.text.match(
      /\b(Fall|Spring|Summer|Winter)\s+(\d{4})(?!\s*[-/]\s*\d{4})\b/i,
    );
    const academicTerm=input.text.match(/\b(Fall|Spring|Summer|Winter)\s+(\d{4})\s*[-/]\s*(\d{4})/i);
    const year = term ? +term[2] : academicTerm ? +( /Spring|Summer/i.test(academicTerm[1]) ? academicTerm[3] : academicTerm[2]) : undefined;
    const add = (
      kind: ItemKind,
      title: string,
      fields: Record<string, string>,
      reason: string,
      warnings: string[] = [],
    ) => {
      if (
        items.some(
          (i) =>
            i.kind === kind &&
            i.title === title &&
            JSON.stringify(i.fields) === JSON.stringify(fields),
        )
      )
        return;
      items.push({
        id: crypto.randomUUID(),
        kind,
        title,
        fields,
        reason,
        warnings,
        confidence: warnings.length
          ? "low"
          : reason.startsWith("Explicit")
            ? "high"
            : "medium",
        selected: !warnings.length,
      });
    };
    function addOfficeHours(text: string): boolean {
      const timeMatch = text.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*[-–—]/i);
      if (!timeMatch || timeMatch.index === undefined) {
        if (/appointment/i.test(text))
          add(
            "office_hours",
            "Office hours by appointment",
            { note: text.trim().slice(0, 200) },
            "Appointment-only office hours",
          );
        return false;
      }
      const daysPart = text.slice(0, timeMatch.index).trim();
      const days = parseDays(daysPart);
      const times = parseTimes(text);
      if (!days.length || !times) {
        if (/appointment/i.test(text))
          add(
            "office_hours",
            "Office hours by appointment",
            { note: text.trim().slice(0, 200) },
            "Appointment-only office hours",
          );
        return false;
      }
      const location = text
        .slice(timeMatch.index + timeMatch[0].length)
        .replace(/^\s*\d{1,2}(?::\d{2})?\s*(AM|PM)?\b/i, "")
        .replace(/^[\s,;-]+/, "")
        .trim()
        .slice(0, 120);
      for (const day of days)
        add(
          "office_hours",
          `Office hours ${dayNames[day]}`,
          {
            day_of_week: String(day),
            start_time: times.start,
            end_time: times.end,
            ...(location ? { location } : {}),
          },
          "Explicit office-hours weekday and time range",
        );
      return true;
    }
    let section = "";
    const instructor: Record<string, string> = {};
    const info: Record<string, string> = {};
    let policyCategory = "",
      policyLines: string[] = [];
    let materialsHeading = "",
      materialsLines: string[] = [];
    const flushPolicy = () => {
      if (policyCategory && policyLines.length) {
        const text = policyLines.join(" ").trim().slice(0, 600);
        if (text)
          add(
            "policy",
            policyCategory,
            { text },
            "Detected policy heading",
          );
      }
      policyCategory = "";
      policyLines = [];
    };
    const flushMaterial = () => {
      if (materialsHeading && materialsLines.length) {
        const detail = materialsLines.join(" ").trim().slice(0, 400);
        add(
          "material",
          materialsHeading,
          { kind: classifyMaterial(materialsHeading), detail },
          "Detected required-materials heading",
        );
      }
      materialsHeading = "";
      materialsLines = [];
    };
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index];
      if (
        /^(?:Course Title|Instructor|Professor|Email|Office|Office Hours|Section|Room|Semester|Class Schedule)\s*:?$/i.test(
          line,
        ) &&
        lines[index + 1]
      )
        line = `${line.replace(/:$/, "")}: ${lines[++index]}`;
      if (line.length > 2000) continue;
      if (
        section === "grading" &&
        /^[\d.]+\s*%$/.test(lines[index + 1] ?? "") &&
        !/%/.test(line)
      )
        line += ` ${lines[++index]}`;
      if (
        /^(Grading(?: Breakdown)?|Assessment(?: Breakdown)?|Evaluation|Grade Distribution|Course Grade|Course Requirements)\s*:?$/i.test(
          line,
        )
      ) {
        flushPolicy();
        flushMaterial();
        section = "grading";
        continue;
      }
      if (
        /^(Schedule|Course Calendar|Course Schedule|Tentative Schedule|Assessments?|Important Dates|Exams?|Assignments?)\s*:?$/i.test(
          line,
        )
      ) {
        flushPolicy();
        flushMaterial();
        section = "assessments";
        continue;
      }
      if (DESCRIPTION_HEADING.test(line)) {
        flushPolicy();
        flushMaterial();
        section = "description";
        continue;
      }
      if (OBJECTIVES_HEADING.test(line)) {
        flushPolicy();
        flushMaterial();
        section = "objectives";
        continue;
      }
      if (MATERIALS_HEADING.test(line)) {
        flushPolicy();
        flushMaterial();
        materialsHeading = line.replace(/:$/, "").trim();
        section = "materials";
        continue;
      }
      if (POLICY_HEADING.test(line)) {
        flushMaterial();
        flushPolicy();
        policyCategory = classifyPolicy(line.replace(/:$/, ""));
        section = "policy";
        continue;
      }
      const course = line.match(
        /^(?:(?:Course(?: Code)?)\s*:\s*)?([A-Z]{2,8})\s*(\d{2,4}[A-Z]?)\b\s*[-:]?\s*(.*)$/,
      );
      if (course && index < 30) {
        const sectionMatch = course[3].match(
          /\(?Section\s*[:#]?\s*([\w-]+)\)?/i,
        );
        const courseName = course[3]
          .replace(/\(?Section\s*[:#]?\s*[\w-]+\)?/i, "")
          .trim();
        add(
          "course",
          `${course[1]} ${course[2]}`,
          {
            code: `${course[1]} ${course[2]}`,
            ...(courseName ? { name: courseName } : {}),
            ...(sectionMatch ? { section: sectionMatch[1] } : {}),
          },
          "Explicit course code",
        );
        continue;
      }
      const infoLine = line.match(
        /^(Instructor|Professor|Instructor Email|Email|Office|Office Hours|Location|Room|Course Title|Section|Semester|Term)\s*:\s*(.*)$/i,
      );
      if (infoLine) {
        const key = infoLine[1].toLowerCase(),
          value = infoLine[2] || lines[++index] || "";
        if (key === "instructor" || key === "professor")
          instructor.name = value;
        else if (key.includes("email")) instructor.email = value;
        else if (key === "office") instructor.office = value;
        else if (key === "office hours") {
          instructor.office_hours = value;
          section = "office";
          addOfficeHours(value);
        } else if (key === "room" || key === "location")
          add(
            "course",
            "Class location",
            { room: value },
            "Explicit location label",
          );
        else if (key === "section")
          add(
            "course",
            "Course section",
            { section: value },
            "Explicit section",
          );
        else if (key === "course title")
          add(
            "course",
            "Course title",
            { name: value },
            "Explicit course title",
          );
        continue;
      }
      if (section === "grading") {
        const weight = line.match(
          /^([A-Za-z][A-Za-z\d /()&,:-]*?)\s*(?:\.{2,}\s*)?(\d+(?:\.\d+)?)\s*%\s*$/,
        );
        if (weight) {
          add(
            "grade",
            weight[1].trim().replace(/[\s:\u2013\u2014-]+$/, ""),
            { weight: weight[2] },
            "Explicit percentage in grading section",
            +weight[2] > 100 ? ["Weight exceeds 100%."] : [],
          );
          continue;
        }
      }
      const schedule = line.match(
        /^(?:(?:Class(?:es| Meetings| Schedule| Time)?|Lectures?|Meets|Time)\s*:\s*)?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Thu|Wed|Fri|Sat|Sun|MWF|MW|TR|TTh|MTWRF)(?:\s*(?:\/|,|and)\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Thu|Wed|Fri|Sat|Sun))*)\s+(.+)$/i,
      );
      if (schedule) {
        if (
          section === "office" &&
          !/^(Class|Lecture|Meets|Time)\b/i.test(line)
        ) {
          instructor.office_hours += ` ; ${line}`;
          addOfficeHours(line);
          continue;
        }
        section = "class";
        const days = parseDays(schedule[1]),
          times = parseTimes(schedule[2]);
        if (days.length && times) {
          for (const day of days)
            add(
              "schedule",
              `Class ${dayNames[day]}`,
              {
                day_of_week: String(day),
                start_time: times.start,
                end_time: times.end,
              },
              "Explicit weekday and time range",
            );
        }
        continue;
      }
      if (section === "description") {
        if (
          !/\b(?:revision|revised)\b/i.test(line) &&
          (info.description ?? "").length < 900
        )
          info.description = info.description
            ? `${info.description} ${line}`
            : line;
        continue;
      }
      if (section === "objectives") {
        if (
          !/\b(?:revision|revised)\b/i.test(line) &&
          (info.objectives ?? "").split("\n").filter(Boolean).length < 12
        )
          info.objectives = info.objectives
            ? `${info.objectives}\n${line}`
            : line;
        continue;
      }
      if (section === "materials") {
        if (!/\b(?:revision|revised)\b/i.test(line))
          materialsLines.push(line);
        continue;
      }
      if (section === "policy") {
        if (!/\b(?:revision|revised)\b/i.test(line)) policyLines.push(line);
        continue;
      }
      if (
        /\b(?:revision|revised|policy|attendance|penalty|absence)\b/i.test(
          line,
        )
      )
        continue;
      if (
        /^(?:Midterm(?: Exam)?(?:\s+\d+)?|Exam\s+[IVX\d]+|Final(?: Exam)?|Quiz(?:\s+\d+)?|Project|Presentation|Assignment|Homework|Paper|Report|Lab|Essay|Reflection(?: Paper)?|Reading Quiz|Oral(?: Exam)?)\b/i.test(
          line,
        )
      ) {
        if (
          !/\d/.test(line) &&
          lines[index + 1] &&
          parseDate(lines[index + 1], year).value
        )
          line += ` ${lines[++index]}`;
        if (/%/.test(line)) continue;
        const date = parseDate(line, year);
        const title = line
          .split(
            new RegExp(
              `\\s*(?:[:|]|[-]\\s|\\b${monthToken}\\s+\\d|\\b\\d{1,2}\\s+${monthToken}|\\b\\d{1,2}/\\d|\\b\\d{4}-\\d{2})`,
              "i",
            ),
          )[0]
          .trim();
        const kind = /^(Midterm|Exam|Final|Quiz|Reading Quiz|Oral)/i.test(line)
          ? "exam"
          : "assignment";
        add(
          kind,
          title || line,
          { [kind === "exam" ? "date" : "due_date"]: date.value },
          /\d{4}/.test(line)
            ? "Explicit assessment and full date"
            : "Assessment date with syllabus term year",
          date.warning ? [date.warning] : [],
        );
      }
    }
    flushPolicy();
    flushMaterial();
    if (Object.keys(instructor).length)
      add(
        "instructor",
        instructor.name || "Instructor",
        instructor,
        "Explicit instructor labels",
        !instructor.email
          ? ["Enter an instructor email to link metadata."]
          : [],
      );
    if (info.description || info.objectives)
      add(
        "info",
        "Course description & objectives",
        info,
        "Detected description/objectives headings",
      );
    const courseRows = items.filter((i) => i.kind === "course");
    if (courseRows.length > 1) {
      courseRows[0].fields = Object.assign(
        {},
        ...courseRows.map((i) => i.fields),
      );
      for (const row of courseRows.slice(1))
        items.splice(items.indexOf(row), 1);
    }
    diagnostics.push(...gradingWarnings(items));
    if (!items.length)
      diagnostics.push(
        "UniDesk couldn't reliably identify structured syllabus information. You can still add the syllabus to the course files.",
      );
    return { items, diagnostics, semester: academicTerm?.[0] ?? term?.[0] };
  },
};
