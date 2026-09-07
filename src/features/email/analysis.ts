import type { Course } from "../../types";
import type { Confidence, SenderMatch } from "./types";
import { dateKey } from "../../utils/dates";

/** Analyze only the newest message; never interpret quoted instructions or signatures. */
export function newestText(body: string) {
  return body
    .split(/\r?\n/)
    .reduce<{ lines: string[]; ended: boolean }>(
      (state, line) => {
        if (
          /^\s*(?:On .+wrote:|From:|Sent:|Begin forwarded message|[-_]{3,}\s*(?:Original|Forwarded)|--\s*$|Best regards\b|Kind regards\b|Regards\b|Sincerely\b|Sent from my\b|Office hours\s*:)/i.test(
            line,
          )
        )
          state.ended = true;
        if (!state.ended && !/^\s*>/.test(line)) state.lines.push(line);
        return state;
      },
      { lines: [], ended: false },
    )
    .lines.join("\n")
    .trim();
}
const normalizedCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function matchCourse(
  sender: string,
  text: string,
  courses: Course[],
  rules: SenderMatch[],
  professors: SenderMatch[],
) {
  const address = sender.trim().toLowerCase();
  const active = courses.filter((c) => !c.archived);
  const ids = (list: SenderMatch[]) => [
    ...new Set(
      list
        .filter(
          (r) =>
            r.sender_email.toLowerCase() === address &&
            active.some((c) => c.id === r.course_id),
        )
        .map((r) => r.course_id),
    ),
  ];
  const manual = ids(rules),
    instructors = ids(professors);
  const tokens = [
    ...text.toUpperCase().matchAll(/\b[A-Z]{2,8}[ -]?\d{2,4}[A-Z]?\b/g),
  ].map((m) => normalizedCode(m[0]));
  const codes = active
    .filter((c) => tokens.includes(normalizedCode(c.code)))
    .map((c) => c.id);
  const result = (
    courseId: string | null,
    confidence: Confidence,
    reason: string,
  ) => ({ courseId, confidence, reason });
  if (manual.length === 1)
    return result(
      manual[0],
      "High",
      "Your saved sender rule matched this course.",
    );
  if (manual.length > 1)
    return result(
      null,
      "Low",
      "This sender has rules for multiple courses. Select the course.",
    );
  if (codes.length > 1)
    return result(
      null,
      "Low",
      "More than one course code appears in the newest message.",
    );
  if (instructors.length && codes.length && !instructors.includes(codes[0]))
    return result(
      null,
      "Low",
      "The instructor and explicit course code disagree. Select the course.",
    );
  if (codes.length === 1)
    return result(
      codes[0],
      "High",
      "An exact course code appears in the newest message.",
    );
  if (instructors.length === 1)
    return result(
      instructors[0],
      "High",
      "The sender matches this course's instructor email.",
    );
  if (instructors.length > 1)
    return result(
      null,
      "Low",
      "This instructor teaches multiple courses. Select the course.",
    );
  const titles = active.filter(
    (c) =>
      c.name.length > 8 && text.toLowerCase().includes(c.name.toLowerCase()),
  );
  if (titles.length === 1)
    return result(
      titles[0].id,
      "Medium",
      "The course title appears in the message; confirm the match.",
    );
  return result(
    null,
    "Low",
    "No unique course or instructor match. Select a course if relevant.",
  );
}
export function classify(subject: string, body: string) {
  if (/^\s*(?:re|fw|fwd):/i.test(subject) && !/\b(?:exam|midterm|quiz|assignment|deadline|class|lecture|room|due|correction|instead|revised)\b/i.test(newestText(body)))
    return {type:"General course",importance:"Normal",actionable:false};
  const text = `${subject}\n${newestText(body)}`.toLowerCase();
  // Remove negated clauses before looking for positive changes elsewhere.
  const positive = text.replace(
    /[^.!?\n]*(?:\b(?:not|never)\s+(?:been\s+)?(?:changed|cancelled|canceled|rescheduled|postponed|extended)|\bno\s+(?:change|cancellation)|\b(?:will|does)\s+not\b)[^.!?\n]*/g,
    "",
  );
  if (
    positive !== text &&
    !/\b(?:due|submit|on\s+(?:mon|tue|wed|thu|fri|sat|sun)|tomorrow|rescheduled|moved|postponed|extended|cancelled|canceled)\b/.test(
      newestText(body)
        .toLowerCase()
        .replace(/[^.!?\n]*\b(?:not|no|never)\b[^.!?\n]*/g, ""),
    )
  )
    return { type: "General course", importance: "Normal", actionable: false };
  const exam = /\b(?:exam(?:ination)?|midterm|quiz|final exam)\b/.test(
    positive,
  );
  const assignment = /\b(?:assignment\s*\d*|homework|project|\ba\d+\b)\b/.test(
    positive,
  );
  const changed =
    /\b(?:rescheduled|moved|postponed|extended|extension|changed|change|cancelled|canceled|instead|rather than|now due|correction|revised|updated date)\b/.test(
      positive,
    );
  let type = "Unknown",
    importance = "Normal";
  if (/\b(?:campus|university)\b/.test(positive) && /\b(?:closed|closure|evacuate)\b/.test(positive)) {
    type="Administrative"; importance="Critical";
  } else if (exam && changed) {
    type="Exam change"; importance="Critical";
  } else if (/\b(?:room|classroom|venue|meet in)\b/.test(positive) && changed) {
    type="Room change"; importance="Important";
  } else if (/\b(?:class(?:es)?|lectures?)\b/.test(positive) && /\bcancell?ed\b/.test(positive)) {
    type = "Class cancellation";
    importance = "Critical";
  } else if (/\b(?:class(?:es)?|lectures?)\b/.test(positive) && changed) {
    type = "Class reschedule";
    importance = "Critical";
  } else if (/\b(?:room|classroom|venue)\b/.test(positive) && changed) {
    type = "Room change";
    importance = "Important";
  } else if (exam && changed) {
    type = "Exam change";
    importance = "Critical";
  } else if (assignment && changed) {
    type = "Deadline change";
    importance = "Important";
  } else if (/\b(?:grade|score|feedback|marked)\b/.test(positive)) {
    type="Grade / feedback";
  } else if (exam) {
    type = /\bquiz\b/.test(positive) ? "Quiz" : "Exam announcement";
    importance = "Important";
  } else if (
    assignment &&
    /\b(?:due|submit|deadline|posted|available|released)\b/.test(positive)
  ) {
    type = "Assignment announcement";
    importance = "Important";
  } else if (/\b(?:grade|score|feedback|marked)\b/.test(positive))
    type = "Grade / feedback";
  else if (
    /\b(?:slides|reading|lecture notes|course material|recording)\b/.test(
      positive,
    )
  )
    type = "Course material";
  else if (
    /\b(?:registration|tuition|registrar|administrative)\b/.test(positive)
  )
    type = "Administrative";
  else if (/\b(?:course|class|lecture)\b/.test(text)) type = "General course";
  if (
    /\b(?:newsletter|unsubscribe|promotion)\b/.test(text) &&
    type === "Unknown"
  )
    importance = "Low";
  return {
    type,
    importance,
    actionable: [
      "Exam change",
      "Deadline change",
      "Exam announcement",
      "Assignment announcement",
      "Quiz",
      "Class cancellation",
      "Class reschedule",
      "Room change",
    ].includes(type),
  };
}
export interface DetectedDate {
  raw: string;
  date: string | null;
  index: number;
  reason: string;
}
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
export function detectDates(text: string, receivedAt: string): DetectedDate[] {
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) return [];
  const year = received.getFullYear(),
    found: DetectedDate[] = [];
  const add = (
    raw: string,
    index: number,
    month: number,
    day: number,
    explicitYear?: number,
  ) => {
    let y = explicitYear ?? year;
    if (!explicitYear && received.getMonth() === 11 && month === 0) y++;
    if (!explicitYear && received.getMonth() === 0 && month === 11) y--;
    const d = new Date(y, month, day, 12);
    const valid =
      d.getFullYear() === y && d.getMonth() === month && d.getDate() === day;
    found.push({
      raw,
      index,
      date: valid ? dateKey(d) : null,
      reason: valid
        ? "Date written in the newest message."
        : "Invalid calendar date; enter the correct date.",
    });
  };
  const names =
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  for (const m of text.matchAll(
    new RegExp(
      `\\b(${names})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
      "gi",
    ),
  ))
    add(
      m[0],
      m.index!,
      months.indexOf(m[1].slice(0, 3).toLowerCase()),
      Number(m[2]),
      m[3] ? Number(m[3]) : undefined,
    );
  for (const m of text.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${names})(?:,?\\s+(20\\d{2}))?\\b`,
      "gi",
    ),
  ))
    add(
      m[0],
      m.index!,
      months.indexOf(m[2].slice(0, 3).toLowerCase()),
      Number(m[1]),
      m[3] ? Number(m[3]) : undefined,
    );
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    add(m[0], m.index!, Number(m[2]) - 1, Number(m[3]), Number(m[1]));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/g)) {
    const a = Number(m[1]),
      b = Number(m[2]);
    if (a <= 12 && b <= 12 && a !== b)
      found.push({
        raw: m[0],
        index: m.index!,
        date: null,
        reason:
          "Ambiguous numeric date (day/month or month/day). Enter the intended date.",
      });
    else
      add(
        m[0],
        m.index!,
        (a > 12 ? b : a) - 1,
        a > 12 ? a : b,
        m[3] ? Number(m[3]) : undefined,
      );
  }
  for (const m of text.matchAll(
    /\b(today|tomorrow|(?:next|this)\s+(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?))\b/gi,
  )) {
    const d = new Date(received);
    d.setHours(12, 0, 0, 0);
    const raw = m[0].toLowerCase();
    if (raw === "tomorrow") d.setDate(d.getDate() + 1);
    else if (raw !== "today") {
      const targetDay = [
        "sun",
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
      ].indexOf(raw.split(/\s+/)[1].slice(0, 3));
      let offset = (targetDay - d.getDay() + 7) % 7;
      if (raw.startsWith("next") && offset === 0) offset = 7;
      d.setDate(d.getDate() + offset);
    }
    found.push({
      raw: m[0],
      index: m.index!,
      date: dateKey(d),
      reason:
        "Relative to the original email date when available, in local time. Confirm the intended day.",
    });
  }
  if(!found.length)for(const m of text.matchAll(/\b(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/gi)){
    const target=['sun','mon','tue','wed','thu','fri','sat'].indexOf(m[0].slice(0,3).toLowerCase());const d=new Date(received);d.setHours(12,0,0,0);d.setDate(d.getDate()+(target-d.getDay()+7)%7);found.push({raw:m[0],index:m.index!,date:dateKey(d),reason:'Next occurrence of this weekday relative to the original message date; confirm before applying.'});
  }
  return found.sort((a, b) => a.index - b.index);
}
export function proposedDate(text: string, receivedAt: string) {
  const dates = detectDates(text, receivedAt);
  if (dates.length === 1) return dates[0];
  if (dates.length === 2) {
    const before = text.slice(0, dates[0].index).toLowerCase();
    const between = text
      .slice(dates[0].index + dates[0].raw.length, dates[1].index)
      .toLowerCase();
    if (/\bfrom\s*$/.test(before) && /^\s*(?:to|until|→)\s*$/.test(between))
      return dates[1];
    if (/\b(?:instead of|rather than)(?:\s+(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday)?)?[,\s]*$/.test(between)) return dates[0];
  }
  return {
    raw: "",
    date: null,
    reason: dates.length
      ? "Multiple dates; choose the intended new date."
      : "No unambiguous date found. Enter the date before applying.",
    index: 0,
  };
}
export function detectTime(text: string): string | null {
  const times = [
    ...text.matchAll(
      /\b(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{1,2}):(\d{2}))\b/gi,
    ),
  ];
  if (times.length !== 1) return null;
  const m = times[0];
  if (m[1].toLowerCase() === "noon") return "12:00";
  if (m[1].toLowerCase() === "midnight") return "00:00";
  let h = Number(m[2] ?? m[5]),
    min = Number(m[3] ?? m[6] ?? 0);
  if (min > 59 || h > 23 || (m[4] && (h < 1 || h > 12))) return null;
  if (m[4]) h = (h % 12) + (m[4].toLowerCase() === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
export function entityAlias(text: string) {
  return text
    .toLowerCase()
    .replace(/\ba\s*(\d+)\b/g, "assignment $1")
    .replace(/\bassignment\s*#?\s*(\d+)\b/g, "assignment $1")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
