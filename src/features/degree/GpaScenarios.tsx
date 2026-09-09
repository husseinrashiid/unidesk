import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Section, Field } from "../../components/ui";
import { query } from "../../services/platform";
import { parseScale } from "../academic/grades";
import type { GradingScale } from "../academic/types";
import { code, type DegreeState } from "./types";
import { degreeGpa, targetGpa, degreeProgress } from "./engine";
export function GpaScenarios({
  state: s,
  scaleRaw,
}: {
  state: DegreeState;
  scaleRaw?: string;
}) {
  const scales = useQuery({
    queryKey: ["degree-gpa-scales"],
    queryFn: () => query<GradingScale>("SELECT * FROM grading_scales"),
  });
  const [scaleId, setScaleId] = useState("");
  const [target, setTarget] = useState(3.2),
    [remaining, setRemaining] = useState(degreeProgress(s).remaining),
    [scenario, setScenario] = useState<Record<string, number>>({});
  let scale;
  try {
    scale = parseScale(
      scales.data?.find((x) => x.id === scaleId)?.entries ??
        scales.data?.find((x) => !x.course_id && !x.semester_id)?.entries ??
        scaleRaw,
    );
  } catch {
    scale = parseScale();
  }
  const actual = degreeGpa(s, scale),
    projected = degreeGpa(s, scale, scenario),
    needed =
      actual.value === null
        ? null
        : targetGpa(
            actual.value,
            actual.credits,
            remaining,
            target,
            Math.max(...scale.map((e) => e.points)),
          );
  return (
    <Section title="GPA scenarios">
      <Field label="Existing GPA scale">
        <select value={scaleId} onChange={(e) => setScaleId(e.target.value)}>
          <option value="">Default workspace scale</option>
          {scales.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <p>
        Actual GPA: {actual.value?.toFixed(2) ?? "Unavailable"} ·{" "}
        {actual.credits} graded credits. Pass/transfer grades are excluded. All
        graded attempts are included.
      </p>
      <div className="form-grid">
        <Field label="Target graduation GPA">
          <input
            type="number"
            min="0"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(+e.target.value)}
          />
        </Field>
        <Field label="Remaining graded credits">
          <input
            type="number"
            min="0"
            value={remaining}
            onChange={(e) => setRemaining(+e.target.value)}
          />
        </Field>
      </div>
      {needed && (
        <p>
          Required remaining average:{" "}
          {needed.required?.toFixed(2) ?? "No remaining credits"}
          {!needed.reachable ? " · Target exceeds the selected scale" : ""}
        </p>
      )}
      {s.courses
        .filter((c) => ["planned", "in_progress"].includes(c.status))
        .map((c) => (
          <Field
            key={c.id}
            label={`${code(c.subject, c.number)} ${c.status === "in_progress" ? "in-progress estimate" : "planned what-if"}`}
          >
            <select
              value={scenario[c.id] ?? ""}
              onChange={(e) =>
                setScenario((old) => {
                  const next = { ...old };
                  if (e.target.value === "") delete next[c.id];
                  else next[c.id] = Number(e.target.value);
                  return next;
                })
              }
            >
              <option value="">No estimate</option>
              {scale.map((e) => (
                <option key={e.letter} value={e.points}>
                  {e.letter} ({e.points})
                </option>
              ))}
            </select>
          </Field>
        ))}
      <p>
        Projected GPA for entered estimates:{" "}
        {projected.value?.toFixed(2) ?? "Unavailable"}. Scenarios are temporary
        and never change actual grades.
      </p>
    </Section>
  );
}
