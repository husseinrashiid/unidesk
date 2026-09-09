import {
  normalizeDocumentText,
  type ExtractedDocument,
} from "../documents/localImport";
import {
  emptyDegree,
  newGroup,
  newRequirement,
  newCourse,
  normalizeTerm,
  code,
  uid,
  type DegreeState,
  type DegreeGroup,
  type DegreeCourse,
  type DegreeRequirement,
  type DegreeProgram,
} from "./types";
export const DEGREE_PARSER_VERSION = "degree-local-3";
export interface ParsedDegree {
  state: DegreeState;
  diagnostics: string[];
}
export interface DegreeParser {
  parse(document: ExtractedDocument): ParsedDegree;
}
const termPattern =
  "(?:Fall|Spring|Summer|Winter|Autumn)\\s*\\d{4}(?:\\s*[-/]\\s*\\d{4})?";
// A raw registrar term code (e.g. "202510") is sometimes fused directly onto the
// following subject with no separating space by layout-preserving PDF extraction.
const courseStart =
  /^\s*(?:[✓✔□◐*+!-]\s*)?(?:(\d{4,8})\s*)?([A-Z]{2,8})\s*(\d{2,4}[A-Z]?)\b\s*(.*)$/i;
const creditGradeLine =
  /^(\d+(?:\.\d+)?)\s*(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|PASS|TR|IP|W|I)?$/i;
function statusFromGrade(grade: string): DegreeCourse["status"] | null {
  if (/^(F|W)$/i.test(grade)) return "failed";
  if (/^(P|PASS|TR)$/i.test(grade)) return "transferred";
  if (/^(IP|I)$/i.test(grade)) return "in_progress";
  return null;
}
// Program-description headers are laid out two-per-row ("Program : X Catalog Term : Y"),
// so every recognized label also terminates its neighbor's value capture.
const trackedLabels: Record<string, keyof DegreeProgram> = {
  program: "name",
  degree: "degree_type",
  major: "major",
  majors: "major",
  minor: "minor",
  minors: "minor",
  concentration: "minor",
  concentrations: "minor",
  "catalog term": "catalog_term",
  "evaluation term": "evaluation_term",
  institution: "institution",
};
const untrackedLabels = [
  "Campus",
  "College",
  "Level",
  "Departments",
  "Expected Graduation Date",
  "Request Number",
  "Results as of",
  "Name",
  "ID",
];
const allLabels = [
  ...Object.keys(trackedLabels).map((k) =>
    k.replace(/\b\w/g, (c) => c.toUpperCase()),
  ),
  ...untrackedLabels,
];
const labelAlt = allLabels
  .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const metadataLineStart = new RegExp(`^(?:${labelAlt})\\s*:`, "i");
const labelLineRe = new RegExp(
  `(${labelAlt})\\s*:\\s*(.*?)(?=\\s+(?:${labelAlt})\\s*:|$)`,
  "gi",
);
/** Repair known SIS print-layout artifacts without altering the original source. */
export function normalizeAuditText(text: string) {
  let value = normalizeDocumentText(text);
  if (!/MetRequirement|Student D etails|Total\nRequired/.test(value))
    return value;
  const words = [
    "CMPS",
    "ARAB",
    "BIOL",
    "CHEM",
    "EECE",
    "ECON",
    "EDUC",
    "ARCH",
    "GRDS",
    "TECHNICAL",
    "SOCIETIES",
    "COMMUNITY",
    "VALUES",
    "CULTURES",
    "QUANT",
    "COEL",
    "CHIS",
    "HUMV",
    "SOIN",
    "UNWO",
    "Bachelor",
    "Computer",
    "Cmps",
    "Arabic",
    "Communication",
    "Courses",
    "Attributes",
    "Crs",
    "Bacc",
    "Degree",
    "Details",
    "Data",
    "Design",
    "Analysis",
    "Algorithms",
    "Calculus",
    "Analytical",
    "Applied",
    "Basic",
    "Biology",
    "Chemistry",
    "Academic",
    "Advanced",
    "Adv",
    "Concepts",
    "Credits",
    "Count",
    "Double",
    "Dbl",
    "History",
    "Ideas",
    "Linear",
    "Algebra",
    "Applications",
    "Applica",
    "CEL",
    "Civic",
    "English",
    "Placement",
    "Exemption",
    "Authorized",
  ];
  for (const word of words)
    value = value.replace(new RegExp(word.split("").join(" *"), "g"), word);
  value = value
    .replace(/([ABCDF])\s+([+-])(?=\s|$)/g, "$1$2")
    .replace(/Total\s*\nRequired\s*:/g, "Total Required :")
    .replace(/Program\s*\nGPA\s*:/g, "Program GPA :")
    .replace(/General\s*\nRequirements/g, "General Requirements");
  const out: string[] = [];
  for (let line of value.split("\n")) {
    line = line.trim();
    if (
      !line ||
      /^https?:|^\d+\/\d+\/\d+,|^\d+\/\d+$|^MetRequirement|^MetRequired|^Credits Used|^Credits Required|^Courses Used|^Courses$|^Credits$|^Met Requirement|^Area Subject|^SubjectCourse|^AttributeSubject|^AREA Description|^[A-Z _]+ (?:30 Crs|Major Req|Arabic Communication|CMPS Required|CMPS GE|Extra Free|History of Ideas|Social Inequalities|English Plcmt|50 cr)/.test(
        line,
      )
    )
      continue;
    if (
      /^Total Credits and GPA|^Program Evaluation$|^50 cr\. \[|^398Z|^- 398|^50 cr\.with a grade of$|^70&above/.test(
        line,
      )
    )
      continue;
    line = line.replace(/\s*Total Credits and GPA.*$/, "");
    const term = line.match(/\b(\d{6})(?=[A-Z])/);
    if (term && term.index! > 0) {
      const prefix = line.slice(0, term.index).trim();
      if (/elective|ELEC\./i.test(prefix))
        out.push("CMPS ELEC. 18 crs CMPS Elective");
      if (/^One of/.test(prefix))
        out.push(
          "One of",
          prefix.replace(/^One of\s*/, "").replace(/\s+\d{6}.*/, ""),
        );
      line = line.slice(term.index);
    }
    // The elective label itself can wrap immediately before its first course.
    if (/^CMPS ELEC\./.test(line)) {
      out.push("CMPS ELEC. 18 crs CMPS Elective");
      continue;
    }
    if (/^Elective\s+\d{6}/.test(line)) line = line.replace(/^Elective\s+/, "");
    if (/^English Plcmt\/Arabic Exemption/.test(line))
      line = "English Placement/Arabic Exemption";
    // A title may continue on the next line with credits and grade at its end.
    const tail = line.match(/^(.*?)\s+(\d+\.\d{2})\s*([ABCDF][+-]?|P)?$/);
    if (
      tail &&
      !/^\d{6}|^[A-Z]{2,8}\s+\d|^Total|^Area|^Program/.test(line) &&
      out.some((l) => /^\d{6}/.test(l))
    ) {
      out.push(tail[1], `${tail[2]} ${tail[3] ?? ""}`.trim());
    } else out.push(line);
  }
  return out.join("\n");
}
export const evaluationParser: DegreeParser = {
  parse(document) {
    const s = emptyDegree(),
      diagnostics: string[] = [];
    s.program.name = "Imported degree";
    const lines = normalizeAuditText(document.text).split("\n");
    let group: DegreeGroup | undefined,
      section: "used" | "unused" | "attributes" | "progress" | "restricted" =
        "used";
    let pending: DegreeCourse | null = null,
      choice: DegreeRequirement | undefined,
      // Once a "One of" alternative's actual attempt is recorded, the choice is
      // resolved: a later, unrelated course code should start its own requirement
      // instead of continuing to be folded into this one.
      choiceResolved = false;
    const flush = () => {
      if (!pending) return;
      const c = pending;
      pending = null;
      if (
        choice &&
        !s.options.some(
          (o) =>
            o.requirement_id === choice!.id &&
            code(o.subject, o.number) === code(c.subject, c.number),
        )
      )
        s.options.push({
          id: uid(),
          requirement_id: choice.id,
          subject: c.subject,
          number: c.number,
        });
      if (choice && !c.original_term && !c.grade) return;
      if (choice) choiceResolved = true;
      c.term = normalizeTerm(c.original_term);
      if (!c.grade && c.status === "completed") {
        c.status = "in_progress";
        diagnostics.push(
          `${code(c.subject, c.number)} has no grade; review its status.`,
        );
      }
      const duplicate = s.courses.find(
        (x) =>
          code(x.subject, x.number) === code(c.subject, c.number) &&
          x.term === c.term &&
          x.grade === c.grade,
      );
      const record = duplicate ?? c;
      if (!duplicate) s.courses.push(c);
      else if (!c.excluded) duplicate.excluded = 0;
      if (group && section !== "unused" && section !== "attributes") {
        let r =
          choice ??
          s.requirements.find(
            (r) =>
              r.group_id === group!.id && r.name === code(c.subject, c.number),
          );
        if (!r) {
          r = {
            ...newRequirement(group.id),
            name: code(c.subject, c.number),
            credits_required: c.credits,
          };
          s.requirements.push(r);
          s.options.push({
            id: uid(),
            requirement_id: r.id,
            subject: c.subject,
            number: c.number,
          });
        }
        if (
          !s.allocations.some(
            (a) => a.requirement_id === r!.id && a.course_id === record.id,
          )
        )
          s.allocations.push({ requirement_id: r.id, course_id: record.id });
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        flush();
        choice = undefined;
        choiceResolved = false;
        continue;
      }
      if (metadataLineStart.test(line)) {
        flush();
        const matches = [...line.matchAll(labelLineRe)];
        const evaluation = line.match(
          /Evaluation Term\s*:\s*(Fall|Spring|Summer|Winter)\s*(\d{4}-\d{4})/i,
        );
        if (evaluation)
          s.program.evaluation_term = `${evaluation[1]} ${evaluation[2]}`;
        for (const m of matches) {
          const key = trackedLabels[m[1].toLowerCase()];
          if (!key) continue;
          const value =
            m[2].trim() || (matches.length === 1 ? lines[++i] || "" : "");
          Object.assign(s.program, { [key]: value });
        }
        continue;
      }
      if (/^Program Restricted Subjects\b/i.test(line)) {
        flush();
        choice = undefined;
        choiceResolved = false;
        section = "restricted";
        group = undefined;
        continue;
      }
      if (/^Courses Not Used\b/i.test(line)) {
        flush();
        choice = undefined;
        choiceResolved = false;
        section = "unused";
        group = undefined;
        continue;
      }
      if (/^Attributes Not Used\b/i.test(line)) {
        flush();
        choice = undefined;
        choiceResolved = false;
        section = "attributes";
        group = undefined;
        continue;
      }
      if (/^(?:Courses )?In[- ]Progress\b/i.test(line)) {
        flush();
        choice = undefined;
        choiceResolved = false;
        section = "progress";
        group = undefined;
        continue;
      }
      if (
        /^(?:Subject\s+|Course\s+(?:Number|Title)|Grade\s+|Term\s+|Met\s+|General Requirements\b|Student\s*(?:Name|ID)|Name\s*:|ID\s*:)/i.test(
          line,
        )
      )
        continue;
      // A requirement group can double-count courses satisfied elsewhere; it then
      // contributes no additional credits toward the program total.
      if (/\b(?:double|dbl)[\s.]*count\b/i.test(line)) {
        flush();
        if (group) group.contributes_credits = 0;
        continue;
      }
      const tableRow = line.match(
        /^(Total Required|Program GPA|Area GPA|Required GPA)\s*:?\s*[^\d\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(\d+))?\s*$/i,
      );
      if (tableRow) {
        flush();
        const label = tableRow[1].toLowerCase(),
          n1 = Number(tableRow[2]),
          n2 = Number(tableRow[3]),
          n3 = tableRow[4] ? Number(tableRow[4]) : null;
        if (label === "total required") {
          if (group) {
            group.credits_required = n1;
            group.reported_used_credits = n2;
          } else {
            s.program.total_credits = n1;
            s.program.reported_used_credits = n2;
          }
          if (n3 !== null)
            diagnostics.push(
              `${group ? group.name : "Program"}: reported ${n3} used courses.`,
            );
        } else if (label === "program gpa") {
          s.program.minimum_gpa = n1;
          s.program.reported_gpa = n2;
        } else if (label === "area gpa" || label === "required gpa") {
          if (group) {
            group.minimum_gpa = n1;
            group.reported_gpa = n2;
          } else s.program.minimum_gpa = n1;
        }
        continue;
      }
      const numeric = line.match(
        /^(Total (?:Required )?Credits|Credits Required|Required Credits|Credits Used|Used Credits|Program GPA|Minimum GPA|Area GPA|Required GPA)\s*:?\s*(\d+(?:\.\d+)?)/i,
      );
      if (numeric) {
        flush();
        const label = numeric[1].toLowerCase(),
          n = Number(numeric[2]);
        if (label === "program gpa") s.program.reported_gpa = n;
        else if (label === "area gpa" && group) group.reported_gpa = n;
        else if (label.includes("gpa")) {
          if (group) group.minimum_gpa = n;
          else s.program.minimum_gpa = n;
        } else if (label.includes("used")) {
          if (group) group.reported_used_credits = n;
          else s.program.reported_used_credits = n;
        } else if (group && !label.startsWith("total"))
          group.credits_required = n;
        else s.program.total_credits = n;
        continue;
      }
      const summary = line.match(
        /^(?:Credits|Courses)\s+(?:Required\s+Used\s+)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/i,
      );
      if (summary) {
        flush();
        if (/^Credits/i.test(line)) {
          if (group) {
            group.credits_required = +summary[1];
            group.reported_used_credits = +summary[2];
          } else {
            s.program.total_credits = +summary[1];
            s.program.reported_used_credits = +summary[2];
          }
        } else
          diagnostics.push(
            `Reported course counts: ${summary[1]} required, ${summary[2]} used.`,
          );
        continue;
      }
      // Rows in the restricted-subjects/attributes table (e.g. "AVSC 279 None 0 0")
      // look like a subject+number but are not course attempts.
      if (
        section === "restricted" &&
        /^[A-Z]{2,8}\s+\S*\s*(?:None|N\/A)\s+\d+\s+\d+\s*$/i.test(line)
      )
        continue;
      const cm = section === "restricted" ? null : line.match(courseStart);
      if (cm) {
        flush();
        const subject = cm[2].toUpperCase(),
          number = cm[3].toUpperCase();
        const c = newCourse(s.program.id);
        Object.assign(c, {
          subject,
          number,
          source: document.filename,
          credits: 0,
          status: section === "progress" ? "in_progress" : "completed",
          excluded: section === "unused" || section === "attributes" ? 1 : 0,
        });
        let rest = cm[4];
        let termRaw = "";
        const monthTerm = rest.match(new RegExp(termPattern, "i"));
        if (monthTerm) {
          termRaw = monthTerm[0];
          rest = rest.replace(monthTerm[0], "").trim();
        } else {
          const sisTerm = rest.match(/(?<![\d.])\b\d{4,8}\b(?!\.\d)/);
          if (sisTerm) {
            termRaw = sisTerm[0];
            rest = (
              rest.slice(0, sisTerm.index) +
              " " +
              rest.slice(sisTerm.index! + sisTerm[0].length)
            )
              .replace(/\s+/g, " ")
              .trim();
          }
        }
        if (!termRaw && cm[1]) termRaw = cm[1];
        c.original_term = termRaw;
        // A resolved "one of"/"choose N" choice only keeps absorbing lines already
        // declared as its alternatives; a genuinely new attempt afterward starts its
        // own requirement. Bare alternative-name lines (no data yet) are never
        // treated as new. A "course_set" elective bucket has no such single
        // resolution: every real course under it legitimately extends the set.
        if (
          choice &&
          choice.kind !== "course_set" &&
          choiceResolved &&
          (termRaw || /\S/.test(rest)) &&
          !s.options.some(
            (o) =>
              o.requirement_id === choice!.id &&
              code(o.subject, o.number) === code(c.subject, c.number),
          )
        ) {
          choice = undefined;
          choiceResolved = false;
        }
        const tail = rest.match(
          /^(.*?)\s+(\d+(?:\.\d+)?)\s*(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|P|PASS|TR|IP|W|I|\d{2,3}(?:\.\d+)?)?\s*$/i,
        );
        if (tail) {
          c.title = tail[1].trim();
          c.credits = +tail[2];
          c.grade = tail[3] ?? "";
        } else {
          c.title = rest;
          // An empty remainder is expected here: the title/credits/grade are still
          // to come on wrapped continuation lines, or this is a bare "one of"
          // alternative that never carries its own data. Only flag lines that had
          // content we genuinely failed to make sense of.
          if (rest)
            diagnostics.push(
              `${code(c.subject, c.number)}: review credits and grade.`,
            );
        }
        c.status = statusFromGrade(c.grade) ?? c.status;
        pending = c;
        continue;
      }
      // A choice/elective requirement line ("One of", "Choose N of", "18 crs ...
      // Elective") belongs to the current group's course table, not a new area,
      // even though its wording can otherwise resemble a heading.
      if (
        group &&
        /(?:^One of\b|^Choose\s+\d+\s+of\b|^\d+\s+(?:credits?|cr\.)\s+(?:from|electives?)|\d+\s*crs?\.?\s+(?:from\b|.*\belective))/i.test(
          line,
        )
      ) {
        flush();
        const choices = [...line.matchAll(/([A-Z]{2,8})\s*(\d{2,4}[A-Z]?)/g)];
        const r = newRequirement(group.id);
        r.name = line;
        r.kind = /^One of/i.test(line)
          ? "one_of"
          : /^Choose/i.test(line)
            ? "choose_n"
            : "course_set";
        r.count_required = Number(line.match(/^Choose\s+(\d+)/i)?.[1] ?? 1);
        if (r.kind === "course_set") {
          const credits = line.match(/(\d+)\s*(?:crs?\.?|credits?)\b/i);
          if (credits) r.credits_required = Number(credits[1]);
        }
        s.requirements.push(r);
        for (const c of choices)
          s.options.push({
            id: uid(),
            requirement_id: r.id,
            subject: c[1],
            number: c[2],
          });
        choice = choices.length ? undefined : r;
        choiceResolved = false;
        continue;
      }
      const heading = line.match(
        /^(?:Area\s*:\s*|Requirement(?: Group)?\s*:\s*)(.+)$/i,
      );
      // Every real requirement block is immediately followed by its own
      // "Required/Used" mini-table, regardless of how the area name itself reads.
      const lookahead = lines.slice(i + 1, i + 3).find((l) => l.trim()) ?? "";
      const followedByGroupTable =
        /^General Requirements\b/i.test(lookahead) ||
        /^Total Required\s*:/i.test(lookahead);
      const looksHeading =
        heading ||
        followedByGroupTable ||
        (!/\b(?:policy|must|should|student)\b/i.test(line) &&
          /^(?:\d+\s*(?:Crs?|credits?)\b.*|.*(?:Requirements?|Req\.|Electives?|Communication Skills|History of Ideas|Social Inequalities|Placement\/Arabic Exemption|grade of \d+.*above))$/i.test(
            line,
          ));
      if (looksHeading) {
        flush();
        choice = undefined;
        choiceResolved = false;
        section = "used";
        const name = heading ? heading[1] : line;
        group =
          s.groups.find((g) => g.name.toLowerCase() === name.toLowerCase()) ??
          newGroup(s.program.id, name);
        if (!s.groups.includes(group)) {
          group.display_order = s.groups.length;
          s.groups.push(group);
        }
        continue;
      }
      if (pending) {
        const term = line.match(new RegExp(`^${termPattern}$`, "i"));
        const creditGrade = line.match(creditGradeLine);
        const wrappedTail = line.match(
          /^(.*?)\s+(\d+\.\d{2})\s*([ABCDF][+-]?|P)?$/,
        );
        if (term) pending.original_term = term[0];
        else if (creditGrade) {
          pending.credits = +creditGrade[1];
          if (creditGrade[2]) pending.grade = creditGrade[2];
          pending.status = statusFromGrade(pending.grade) ?? pending.status;
        } else if (wrappedTail) {
          pending.title = `${pending.title} ${wrappedTail[1]}`.trim();
          pending.credits = +wrappedTail[2];
          pending.grade = wrappedTail[3] ?? "";
          pending.status = statusFromGrade(pending.grade) ?? pending.status;
        } else if (
          !/^(?:Degree evaluation|Evaluation record|Credits|Required|Used|GPA)\b/i.test(
            line,
          )
        )
          pending.title = `${pending.title} ${line}`.trim();
      }
    }
    flush();
    for (const r of s.requirements)
      if (
        ["one_of", "course_set", "specific"].includes(r.kind) &&
        !s.options.some((o) => o.requirement_id === r.id)
      )
        r.kind =
          s.groups.find((g) => g.id === r.group_id)?.credits_required === 0
            ? "manual"
            : "elective";
    for (const g of s.groups) {
      if (!s.requirements.some((r) => r.group_id === g.id)) {
        s.requirements.push({
          ...newRequirement(g.id),
          name: g.name,
          kind: g.credits_required ? "elective" : "manual",
          credits_required: g.credits_required,
        });
      }
    }
    if (!s.groups.length)
      diagnostics.push(
        "No requirement groups were recognized. Add or correct groups before importing.",
      );
    if (!s.program.total_credits)
      diagnostics.push(
        "Total required credits were not identified. Enter the authoritative program total.",
      );
    diagnostics.push(
      "Reported used credits and GPA are source snapshots. Calculated progress uses reviewed course records.",
    );
    return { state: s, diagnostics: [...new Set(diagnostics)] };
  },
};
