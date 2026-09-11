import { ResponsiveTable } from "../../components/ResponsiveTable";
﻿import { Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query } from "../../services/platform";
import { code, type DegreeState, type DegreeCourse } from "./types";
import { degreeProgress, requirementProgress } from "./engine";
import { requirementRows } from "./catalogue";
function CourseLink({
  course: c,
  label,
}: {
  course: DegreeCourse;
  label?: string;
}) {
  const { setSemesterId, navigate, edit, report } = useWorkspace();
  return (
    <button
      className="academic-course-link"
      onClick={async () => {
        try {
          if (c.course_id) {
            const rows = await query<{ semester_id: string }>(
              "SELECT semester_id FROM courses WHERE id=?",
              [c.course_id],
            );
            if (rows[0]) {
              setSemesterId(rows[0].semester_id);
              navigate(`course/${c.course_id}`);
            }
          } else
            edit({
              kind: "course",
              defaults: {
                code: code(c.subject, c.number),
                name: c.title,
                credits: c.credits,
              },
            });
        } catch (e) {
          report((e as Error).message);
        }
      }}
    >
      {code(c.subject, c.number)} · {c.title}
      {!c.course_id && <small>Create course workspace ↗</small>}
    </button>
  );
}
export function DegreeSummary({ state: s }: { state: DegreeState }) {
  const p = degreeProgress(s),
    total = s.program.total_credits;
  return (
    <section className="degree-metrics" aria-label="Degree summary">
      <div className="degree-stat-grid">
        {[
          [
            "Credits used",
            `${p.auditUsedCredits ?? p.expectedCredits} / ${total}`,
          ],
          ["Earned", `${p.credits}`],
          ["In progress", `${p.inProgressCredits}`],
          ["Remaining", `${p.projectedRemaining}`],
          ["Program GPA", s.program.reported_gpa?.toFixed(2) ?? "—"],
          ["Graduation minimum", s.program.minimum_gpa?.toFixed(2) ?? "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div
        className="degree-track"
        role="img"
        aria-label={`${p.credits} earned plus ${p.inProgressCredits} in progress out of ${total}`}
      >
        <span
          style={{
            width: `${Math.min(100, (p.credits / (total || 1)) * 100)}%`,
          }}
        />
        <span
          style={{
            width: `${Math.max(0, Math.min(100 - (p.credits / (total || 1)) * 100, (p.inProgressCredits / (total || 1)) * 100))}%`,
          }}
        />
      </div>
      <p>
        {p.credits} earned + {p.inProgressCredits} in progress / {total} credits{" "}
        <span className="academic-secondary">
          · Remaining assumes current courses are passed
        </span>
      </p>
      {p.auditUsedCredits !== null &&
        p.auditUsedCredits !== p.expectedCredits && (
          <p role="note">
            The evaluation reports {p.auditUsedCredits} used credits; course
            records account for {p.expectedCredits}. Review the source before
            planning.
          </p>
        )}
    </section>
  );
}
export function Remaining({
  state: s,
  unplanned = false,
}: {
  state: DegreeState;
  unplanned?: boolean;
}) {
  return (
    <>
      {requirementRows(s)
        .filter(
          (r) =>
            !requirementProgress(s, r, true).complete &&
            (!unplanned || !s.plans.some((p) => p.requirement_id === r.id)),
        )
        .map((r) => (
          <div className="academic-line" key={r.id}>
            <span>{r.name}</span>
            <strong>
              {Math.max(
                0,
                r.credits_required - requirementProgress(s, r, true).credits,
              )}{" "}
              cr
            </strong>
          </div>
        ))}
    </>
  );
}
export function AttemptTable({
  courses,
  interactive = false,
}: {
  courses: DegreeCourse[];
  interactive?: boolean;
}) {
  return (
    <div className="academic-table-wrap">
      <ResponsiveTable className="academic-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Course</th>
            <th>Credits</th>
            <th>Grade</th>
            <th>Term</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id}>
              <td>
                {c.excluded || c.status === "failed"
                  ? "Not counted"
                  : c.status === "in_progress"
                    ? "◐ In progress"
                    : c.status === "planned"
                      ? "○ Planned"
                      : "✓ Completed"}
              </td>
              <td>
                {interactive ? (
                  <CourseLink course={c} />
                ) : (
                  `${code(c.subject, c.number)} · ${c.title}`
                )}
              </td>
              <td>{c.credits}</td>
              <td>{c.grade || "—"}</td>
              <td>{c.term || "—"}</td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </div>
  );
}
export function Requirements({
  state: s,
  interactive = false,
}: {
  state: DegreeState;
  interactive?: boolean;
}) {
  const rows = requirementRows(s);
  return (
    <div className="degree-requirements">
      {s.groups
        .filter((g) => rows.some((r) => r.group_id === g.id))
        .map((g) => {
          const rs = rows.filter((r) => r.group_id === g.id);
          return (
            <details open key={g.id} className="degree-group">
              <summary>
                <strong>{g.name}</strong>
                <span>
                  {rs.filter((r) => requirementProgress(s, r).complete).length}{" "}
                  / {rs.length} complete · {g.credits_required} credits
                </span>
              </summary>
              {/elective|Reasoning/i.test(g.name) && (
                <p className="academic-secondary">
                  {g.description.replace(
                    /^AUB BS Computer Science 24-25\. /,
                    "",
                  )}
                </p>
              )}
              <div className="academic-table-wrap">
                <ResponsiveTable className="academic-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Course / Requirement</th>
                      <th>Credits</th>
                      <th>Grade</th>
                      <th>Term</th>
                      <th>Prerequisite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => {
                      const a = requirementProgress(s, r),
                        e = requirementProgress(s, r, true),
                        plan = s.plans.find((p) => p.requirement_id === r.id),
                        status = a.complete
                          ? "Completed"
                          : e.complete
                            ? "In progress"
                            : plan
                              ? "Planned"
                              : "Remaining",
                        symbol = a.complete
                          ? "✓"
                          : e.complete
                            ? "◐"
                            : plan
                              ? "○"
                              : "□",
                        options = s.options.filter(
                          (o) => o.requirement_id === r.id,
                        ),
                        pre = s.prerequisites.filter((p) =>
                          options.some(
                            (o) =>
                              o.subject === p.subject && o.number === p.number,
                          ),
                        );
                      return (
                        <tr key={r.id}>
                          <td
                            className="academic-status"
                            title={status}
                            aria-label={status}
                          >
                            {symbol}
                          </td>
                          <td>
                            <strong>
                              {r.kind === "specific" && e.courses.length === 1
                                ? null
                                : r.name}
                            </strong>
                            {e.courses.map((c) => (
                              <div key={c.id}>
                                {interactive ? (
                                  <CourseLink
                                    course={c}
                                    label={
                                      r.kind === "specific" ? r.name : undefined
                                    }
                                  />
                                ) : (
                                  `${code(c.subject, c.number)} · ${c.title}`
                                )}
                              </div>
                            ))}
                            {r.kind === "one_of" && (
                              <small>
                                Choose one:{" "}
                                {options
                                  .map((o) => code(o.subject, o.number))
                                  .join(" or ")}
                              </small>
                            )}
                            {!e.courses.length && r.kind === "elective" && (
                              <small>Not selected</small>
                            )}
                          </td>
                          <td>{r.credits_required}</td>
                          <td>
                            {e.courses.map((c) => c.grade || "—").join(" / ") ||
                              "—"}
                          </td>
                          <td>
                            {e.courses
                              .map((c) => c.term)
                              .filter((v, i, a) => a.indexOf(v) === i)
                              .join(" / ") ||
                              plan?.term ||
                              "—"}
                          </td>
                          <td>
                            {[
                              ...new Set(
                                pre.map(
                                  (p) =>
                                    (p.minimum_grade
                                      ? `${p.minimum_grade} in `
                                      : "") +
                                    code(
                                      p.prerequisite_subject,
                                      p.prerequisite_number,
                                    ),
                                ),
                              ),
                            ].join(" / ") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </ResponsiveTable>
              </div>
            </details>
          );
        })}
    </div>
  );
}
export function GraduationChecks({ state: s }: { state: DegreeState }) {
  const p = degreeProgress(s),
    fifty = s.groups.find((g) => /^50/.test(g.name)),
    arabic = s.groups.find((g) => /Arabic Communication/i.test(g.name)),
    social = s.groups.find((g) => /Social Inequalities/i.test(g.name));
  const rows = [
    [
      "120 credits",
      `${p.auditUsedCredits ?? p.expectedCredits} / ${s.program.total_credits} used · ${p.projectedRemaining ? "In progress" : "Credit target reached"}`,
    ],
    [
      "Minimum GPA",
      `${s.program.reported_gpa ?? "Unknown"} / ${s.program.minimum_gpa ?? "Unknown"}${s.program.reported_gpa !== null && s.program.minimum_gpa !== null && s.program.reported_gpa >= s.program.minimum_gpa ? " · Met" : ""}`,
    ],
    [
      "50 credits with C+ or above",
      fifty?.reported_used_credits !== null &&
      fifty?.reported_used_credits !== undefined &&
      fifty.reported_used_credits >= 50
        ? "Met according to evaluation"
        : "Needs verification",
    ],
    [
      "Arabic communication",
      arabic?.reported_used_credits === 0
        ? "Incomplete"
        : arabic &&
            arabic.reported_used_credits !== null &&
            arabic.reported_used_credits >= 3
          ? "Met according to evaluation"
          : "Needs verification",
    ],
    [
      "Social Inequalities",
      social &&
      s.requirements.some((r) => r.group_id === social.id && r.manual_complete)
        ? "Met according to evaluation"
        : "Needs verification",
    ],
    [
      "CHLA course",
      "Needs verification · One Cultures & Histories or Human Values course must carry CHLA",
    ],
  ];
  return (
    <Section title="Graduation checks">
      {rows.map(([label, status]) => (
        <div className="graduation-check" key={label}>
          <strong>{label}</strong>
          <span>{status}</span>
        </div>
      ))}
    </Section>
  );
}
