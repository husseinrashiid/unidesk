import { Button, Field } from "../../components/ui";
import {
  code,
  newCourse,
  newGroup,
  newRequirement,
  uid,
  type DegreeState,
  type RequirementKind,
  type CourseStatus,
} from "./types";
import { mergeDetectedCourses } from "./repository";
export function DegreeEditor({
  state: s,
  onChange,
}: {
  state: DegreeState;
  onChange: (s: DegreeState) => void;
}) {
  const change = (fn: (draft: DegreeState) => void) => {
    const draft = structuredClone(s);
    fn(draft);
    onChange(draft);
  };
  return (
    <div className="degree-editor">
      <h3>Program</h3>
      <div className="form-grid">
        {(
          [
            "name",
            "degree_type",
            "major",
            "minor",
            "catalog_term",
            "evaluation_term",
            "institution",
          ] as const
        ).map((key) => (
          <Field key={key} label={key.replace(/_/g, " ")}>
            <input
              value={s.program[key]}
              onChange={(e) =>
                change((d) => {
                  d.program[key] = e.target.value;
                })
              }
            />
          </Field>
        ))}
        {(
          [
            "total_credits",
            "minimum_gpa",
            "reported_gpa",
            "reported_used_credits",
          ] as const
        ).map((key) => (
          <Field key={key} label={key.replace(/_/g, " ")}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={s.program[key] ?? ""}
              onChange={(e) =>
                change((d) => {
                  if (key === "total_credits")
                    d.program[key] = Number(e.target.value);
                  else
                    d.program[key] =
                      e.target.value === "" ? null : Number(e.target.value);
                })
              }
            />
          </Field>
        ))}
      </div>
      <h3>Requirement groups</h3>
      {s.groups.map((g) => (
        <details key={g.id} className="material-result">
          <summary>{g.name}</summary>
          <div className="form-grid">
            <Field label="Group name">
              <input
                value={g.name}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.name = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="Group credits">
              <input
                type="number"
                min="0"
                value={g.credits_required}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.credits_required =
                      Number(e.target.value);
                  })
                }
              />
            </Field>
            <Field label="Parent group">
              <select
                value={g.parent_id ?? ""}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.parent_id =
                      e.target.value || null;
                  })
                }
              >
                <option value="">None</option>
                {s.groups
                  .filter((x) => x.id !== g.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Completion rule">
              <select
                value={g.completion_rule}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.completion_rule = e
                      .target.value as typeof g.completion_rule;
                  })
                }
              >
                <option value="all">All requirements</option>
                <option value="any">Any requirement</option>
                <option value="credits">Minimum credits</option>
              </select>
            </Field>
            <Field label="Minimum group GPA">
              <input
                type="number"
                min="0"
                step="0.01"
                value={g.minimum_gpa ?? ""}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.minimum_gpa = e.target
                      .value
                      ? Number(e.target.value)
                      : null;
                  })
                }
              />
            </Field>
            <Field label="Description">
              <input
                value={g.description}
                onChange={(e) =>
                  change((d) => {
                    d.groups.find((x) => x.id === g.id)!.description =
                      e.target.value;
                  })
                }
              />
            </Field>
          </div>
          {s.requirements
            .filter((r) => r.group_id === g.id)
            .map((r) => (
              <article className="material-result" key={r.id}>
                <div className="form-grid">
                  <Field label="Requirement name">
                    <input
                      value={r.name}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find((x) => x.id === r.id)!.name =
                            e.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Requirement type">
                    <select
                      value={r.kind}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find((x) => x.id === r.id)!.kind = e
                            .target.value as RequirementKind;
                        })
                      }
                    >
                      {[
                        "specific",
                        "one_of",
                        "choose_n",
                        "course_set",
                        "elective",
                        "attribute",
                        "manual",
                        "level",
                      ].map((k) => (
                        <option key={k} value={k}>
                          {k.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Required credits">
                    <input
                      type="number"
                      min="0"
                      value={r.credits_required}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find(
                            (x) => x.id === r.id,
                          )!.credits_required = Number(e.target.value);
                        })
                      }
                    />
                  </Field>
                  <Field label="Course count">
                    <input
                      type="number"
                      min="1"
                      value={r.count_required}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find(
                            (x) => x.id === r.id,
                          )!.count_required = Number(e.target.value);
                        })
                      }
                    />
                  </Field>
                  <Field label="Minimum numeric grade">
                    <input
                      type="number"
                      value={r.minimum_grade ?? ""}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find(
                            (x) => x.id === r.id,
                          )!.minimum_grade = e.target.value
                            ? Number(e.target.value)
                            : null;
                        })
                      }
                    />
                  </Field>
                  <Field label="Minimum course level">
                    <input
                      type="number"
                      value={r.minimum_level ?? ""}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find(
                            (x) => x.id === r.id,
                          )!.minimum_level = e.target.value
                            ? Number(e.target.value)
                            : null;
                        })
                      }
                    />
                  </Field>
                  <Field label="Attribute">
                    <input
                      value={r.attribute}
                      onChange={(e) =>
                        change((d) => {
                          d.requirements.find((x) => x.id === r.id)!.attribute =
                            e.target.value;
                        })
                      }
                    />
                  </Field>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={!!r.manual_complete}
                    onChange={(e) =>
                      change((d) => {
                        d.requirements.find(
                          (x) => x.id === r.id,
                        )!.manual_complete = Number(e.target.checked);
                      })
                    }
                  />{" "}
                  Manually verified completion (manual / zero-credit
                  requirement)
                </label>
                <Field
                  label="Course options (comma-separated codes)"
                  hint="For example CMPS 211, MATH 211. One-of means only one option is required."
                >
                  <input
                    defaultValue={s.options
                      .filter((o) => o.requirement_id === r.id)
                      .map((o) => code(o.subject, o.number))
                      .join(", ")}
                    onBlur={(e) =>
                      change((d) => {
                        d.options = d.options.filter(
                          (o) => o.requirement_id !== r.id,
                        );
                        for (const value of e.target.value.split(",")) {
                          const m = value
                            .trim()
                            .match(/^([A-Za-z]{2,8})\s*(\d{2,4}[A-Za-z]?)$/);
                          if (m)
                            d.options.push({
                              id: uid(),
                              requirement_id: r.id,
                              subject: m[1].toUpperCase(),
                              number: m[2].toUpperCase(),
                            });
                        }
                      })
                    }
                  />
                </Field>
                <details>
                  <summary>
                    Allocate history courses to this requirement
                  </summary>
                  {s.courses.map((c) => (
                    <label className="degree-allocation" key={c.id}>
                      <input
                        type="checkbox"
                        checked={s.allocations.some(
                          (a) =>
                            a.course_id === c.id && a.requirement_id === r.id,
                        )}
                        onChange={(e) =>
                          change((d) => {
                            d.allocations = d.allocations.filter(
                              (a) =>
                                !(
                                  a.course_id === c.id &&
                                  a.requirement_id === r.id
                                ),
                            );
                            if (e.target.checked)
                              d.allocations.push({
                                course_id: c.id,
                                requirement_id: r.id,
                              });
                          })
                        }
                      />
                      {code(c.subject, c.number)} · {c.term} · {c.status}
                    </label>
                  ))}
                </details>
                <Button
                  variant="ghost"
                  onClick={() =>
                    change((d) => {
                      d.requirements = d.requirements.filter(
                        (x) => x.id !== r.id,
                      );
                      d.options = d.options.filter(
                        (x) => x.requirement_id !== r.id,
                      );
                      d.allocations = d.allocations.filter(
                        (x) => x.requirement_id !== r.id,
                      );
                      d.plans = d.plans.filter(
                        (x) => x.requirement_id !== r.id,
                      );
                    })
                  }
                >
                  Remove requirement
                </Button>
              </article>
            ))}
          <Button
            onClick={() =>
              change((d) => {
                d.requirements.push(newRequirement(g.id));
              })
            }
          >
            Add requirement
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              change((d) => {
                const ids = d.requirements
                  .filter((r) => r.group_id === g.id)
                  .map((r) => r.id);
                d.groups = d.groups
                  .filter((x) => x.id !== g.id)
                  .map((x) => ({
                    ...x,
                    parent_id: x.parent_id === g.id ? null : x.parent_id,
                  }));
                d.requirements = d.requirements.filter(
                  (r) => r.group_id !== g.id,
                );
                d.options = d.options.filter(
                  (o) => !ids.includes(o.requirement_id),
                );
                d.allocations = d.allocations.filter(
                  (a) => !ids.includes(a.requirement_id),
                );
                d.plans = d.plans.filter(
                  (p) => !ids.includes(p.requirement_id),
                );
              })
            }
          >
            Remove group
          </Button>
        </details>
      ))}
      <Button
        onClick={() =>
          change((d) => {
            d.groups.push(newGroup(d.program.id));
          })
        }
      >
        Add group
      </Button>
      <h3>Course history</h3>
      <p className="helper">
        Historic courses remain degree history unless linked to an existing
        workspace. Different attempts must have different terms.
      </p>
      {s.courses.map((c) => (
        <details key={c.id} className="material-result">
          <summary>
            {code(c.subject, c.number)} · {c.title} · {c.status}
            {c.excluded ? " · Not counted" : ""}
            {c.course_id ? " · Matched workspace" : " · Degree history only"}
          </summary>
          <div className="form-grid">
            {(
              [
                "subject",
                "number",
                "title",
                "grade",
                "term",
                "attributes",
              ] as const
            ).map((key) => (
              <Field label={`Course ${key}`} key={key}>
                <input
                  value={c[key]}
                  onChange={(e) =>
                    change((d) => {
                      d.courses.find((x) => x.id === c.id)![key] =
                        e.target.value;
                    })
                  }
                />
              </Field>
            ))}
            <Field label="Course credits">
              <input
                type="number"
                min="0"
                step="0.5"
                value={c.credits}
                onChange={(e) =>
                  change((d) => {
                    d.courses.find((x) => x.id === c.id)!.credits = Number(
                      e.target.value,
                    );
                  })
                }
              />
            </Field>
            <Field label="Course status">
              <select
                value={c.status}
                onChange={(e) =>
                  change((d) => {
                    d.courses.find((x) => x.id === c.id)!.status = e.target
                      .value as CourseStatus;
                  })
                }
              >
                {[
                  "completed",
                  "in_progress",
                  "planned",
                  "failed",
                  "transferred",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replace("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="helper">
            Original term: {c.original_term || "Not provided"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={!!c.excluded}
              onChange={(e) =>
                change((d) => {
                  d.courses.find((x) => x.id === c.id)!.excluded = Number(
                    e.target.checked,
                  );
                })
              }
            />{" "}
            Exclude from degree credit
          </label>
          <Button
            variant="ghost"
            onClick={() =>
              change((d) => {
                d.courses = d.courses.filter((x) => x.id !== c.id);
                d.allocations = d.allocations.filter(
                  (a) => a.course_id !== c.id,
                );
              })
            }
          >
            Remove course
          </Button>
        </details>
      ))}
      <Button
        onClick={() =>
          change((d) => {
            d.courses.push(newCourse(d.program.id));
          })
        }
      >
        Add history course
      </Button>
      <Button onClick={() => onChange(mergeDetectedCourses(s))}>
        Merge identical duplicates
      </Button>
      <h3>Prerequisites</h3>
      <p className="helper">
        Enter verified prerequisites. ALL rules must all be met; at least one
        ANY rule must be met.
      </p>
      {s.prerequisites.map((p) => (
        <article key={p.id} className="material-result">
          <div className="form-grid">
            {(
              [
                "subject",
                "number",
                "prerequisite_subject",
                "prerequisite_number",
              ] as const
            ).map((key) => (
              <Field key={key} label={key.replace(/_/g, " ")}>
                <input
                  value={p[key]}
                  onChange={(e) =>
                    change((d) => {
                      d.prerequisites.find((x) => x.id === p.id)![key] =
                        e.target.value.toUpperCase();
                    })
                  }
                />
              </Field>
            ))}
            <Field label="Relation">
              <select
                value={p.relation}
                onChange={(e) =>
                  change((d) => {
                    d.prerequisites.find((x) => x.id === p.id)!.relation = e
                      .target.value as "all" | "any";
                  })
                }
              >
                <option value="all">ALL</option>
                <option value="any">ANY</option>
              </select>
            </Field>
          </div>
          <Button
            onClick={() =>
              change((d) => {
                d.prerequisites = d.prerequisites.filter((x) => x.id !== p.id);
              })
            }
          >
            Remove prerequisite
          </Button>
        </article>
      ))}
      <Button
        onClick={() =>
          change((d) => {
            d.prerequisites.push({
              id: uid(),
              program_id: s.program.id,
              subject: "",
              number: "",
              prerequisite_subject: "",
              prerequisite_number: "",
              relation: "all",
            });
          })
        }
      >
        Add prerequisite
      </Button>
    </div>
  );
}
