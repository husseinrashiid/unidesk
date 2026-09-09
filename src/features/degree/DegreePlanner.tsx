import { useState } from "react";
import { Button, Field, ErrorText } from "../../components/ui";
import {
  code,
  uid,
  termOrder,
  type DegreeState,
  type DegreePlan,
} from "./types";
import {
  graduationPlan,
  prerequisiteWarnings,
  requirementProgress,
} from "./engine";
import { requirementRows, cataloguePlanWarnings } from "./catalogue";
import { Remaining } from "./DegreeViews";
export function DegreePlanner({
  state: s,
  onSave,
  busy,
}: {
  state: DegreeState;
  onSave: (s: DegreeState) => void;
  busy: boolean;
}) {
  const [plans, setPlans] = useState(s.plans),
    [start, setStart] = useState(`Spring ${new Date().getFullYear() + 1}`),
    [target, setTarget] = useState(`Fall ${new Date().getFullYear() + 1}`),
    [max, setMax] = useState(18),
    [summer, setSummer] = useState(false),
    [error, setError] = useState("");
  const remaining = requirementRows(s).filter(
      (r) => !requirementProgress(s, r, true).complete,
    ),
    warnings = [
      ...prerequisiteWarnings(s, plans).map((w) => w.message),
      ...cataloguePlanWarnings({ ...s, plans }),
    ];
  const current = s.courses.filter(
    (c) => !c.excluded && c.status === "in_progress",
  );
  const terms = [
    ...new Set([
      ...current.map((c) => c.term),
      ...plans.map((p) => p.term),
      start,
      target,
    ]),
  ].sort((a, b) => (termOrder(a) ?? 0) - (termOrder(b) ?? 0));
  function change(id: string, patch: Partial<DegreePlan>) {
    setPlans(plans.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function suggest() {
    try {
      const a = termOrder(start),
        b = termOrder(target);
      if (a === null || b === null || b < a || b - a > 40)
        throw Error("Choose valid semesters within ten years.");
      const ts = [];
      for (let n = a; n <= b; n++) {
        const season = ["Winter", "Spring", "Summer", "Fall"][n % 4];
        if (season !== "Winter" && (summer || season !== "Summer"))
          ts.push(`${season} ${Math.floor(n / 4)}`);
      }
      const result = graduationPlan({ ...s, plans }, ts, max);
      setPlans(result.plans);
      setError(result.warnings.join(" "));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="degree-planner">
      <div className="planner-controls">
        <Field label="First planned semester">
          <input value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Graduation semester">
          <input value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Maximum credits">
          <input
            type="number"
            min="1"
            value={max}
            onChange={(e) => setMax(+e.target.value)}
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={summer}
            onChange={(e) => setSummer(e.target.checked)}
          />{" "}
          Include summer
        </label>
        <Button onClick={suggest}>Suggest a plan</Button>
      </div>
      <ErrorText error={error} />
      <div className="planner-layout">
        <div className="semester-board">
          {terms.map((term) => (
            <section className="semester-column" key={term}>
              <h3>{term}</h3>
              <p>
                {plans
                  .filter((p) => p.term === term)
                  .reduce((n, p) => n + p.credits, 0) +
                  current
                    .filter((c) => c.term === term)
                    .reduce((n, c) => n + c.credits, 0)}{" "}
                credits
              </p>
              {current
                .filter((c) => c.term === term)
                .map((c) => (
                  <div className="planned-course" key={c.id}>
                    <strong>◐ {code(c.subject, c.number)}</strong>
                    <span>{c.title}</span>
                    <small>{c.credits} credits · In progress</small>
                  </div>
                ))}
              {plans
                .filter((p) => p.term === term)
                .map((p) => (
                  <div className="planned-course" key={p.id}>
                    <strong>
                      ○{" "}
                      {remaining.find((r) => r.id === p.requirement_id)?.name ??
                        code(p.subject, p.number)}
                    </strong>
                    <details>
                      <summary>Choose / move course</summary>
                      <Field label="Course code">
                        <input
                          placeholder="e.g. CMPS 250"
                          value={code(p.subject, p.number).trim()}
                          onChange={(e) => {
                            const m = e.target.value
                              .toUpperCase()
                              .match(/^([A-Z]*)\s*(.*)$/);
                            if (m)
                              change(p.id, { subject: m[1], number: m[2] });
                          }}
                        />
                      </Field>
                      <Field
                        label={`Move ${remaining.find((r) => r.id === p.requirement_id)?.name ?? "course"} to`}
                      >
                        <select
                          value={p.term}
                          onChange={(e) =>
                            change(p.id, {
                              term: e.target.value,
                              semester_id: null,
                            })
                          }
                        >
                          {terms.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </Field>
                    </details>
                    <small>{p.credits} credits · Offering unknown</small>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setPlans(plans.filter((x) => x.id !== p.id))
                      }
                    >
                      Remove from plan
                    </Button>
                  </div>
                ))}
              <select
                aria-label={`Add remaining course to ${term}`}
                value=""
                onChange={(e) => {
                  const r = remaining.find((r) => r.id === e.target.value);
                  if (!r) return;
                  const o = s.options.find((o) => o.requirement_id === r.id);
                  setPlans([
                    ...plans,
                    {
                      id: uid(),
                      requirement_id: r.id,
                      term,
                      semester_id: null,
                      subject: r.kind === "elective" ? "" : (o?.subject ?? ""),
                      number: r.kind === "elective" ? "" : (o?.number ?? ""),
                      credits: Math.max(
                        0,
                        r.credits_required -
                          requirementProgress(s, r, true).credits,
                      ),
                      override_prerequisites: 0,
                    },
                  ]);
                }}
              >
                <option value="">+ Add remaining course</option>
                {remaining
                  .filter((r) => !plans.some((p) => p.requirement_id === r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </section>
          ))}
        </div>
        <aside>
          <h3>Remaining to plan</h3>
          <Remaining state={{ ...s, plans }} unplanned />
          <p>Planned: {plans.reduce((n, p) => n + p.credits, 0)} credits</p>
          <p className="academic-secondary">
            Course offerings are unknown. Confirm your choices and prerequisites
            before registration.
          </p>
        </aside>
      </div>
      {warnings.map((w, i) => (
        <p role="alert" key={i}>
          {w}
        </p>
      ))}
      <div className="modal-footer">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            if (plans.some((p) => termOrder(p.term) === null)) {
              setError("Enter valid semester names.");
              return;
            }
            if (cataloguePlanWarnings({ ...s, plans }).length) {
              setError("Correct the course choices before saving.");
              return;
            }
            onSave({ ...s, plans });
          }}
        >
          Save plan
        </Button>
      </div>
    </div>
  );
}
