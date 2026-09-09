import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PageHeader, Section, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch } from "../../services/platform";
import { ImportPicker } from "../documents/ImportPicker";
import type { ExtractedDocument } from "../documents/localImport";
import { evaluationParser, DEGREE_PARSER_VERSION } from "./parser";
import {
  loadDegree,
  saveDegree,
  matchCourses,
  mergeEvaluation,
} from "./repository";
import {
  emptyDegree,
  uid,
  type DegreeState,
  type DegreeProgram,
  type ImportSource,
} from "./types";
import { applyCatalogue, catalogueGroups } from "./catalogue";
import { DegreeEditor } from "./DegreeEditor";
import { syncPlannedHistory } from "./plannedHistory";
import { reviewWorkspaceHistory } from "./workspaceHistory";
import { DegreePlanner } from "./DegreePlanner";
import { GpaScenarios } from "./GpaScenarios";
import {
  DegreeSummary,
  Requirements,
  AttemptTable,
  GraduationChecks,
  Remaining,
} from "./DegreeViews";
export function DegreePage() {
  const { refresh, preferences, page } = useWorkspace();
  const [id, setId] = useState(page.split("/")[1] ?? ""),
    [tab, setTab] = useState("Overview"),
    [draft, setDraft] = useState<DegreeState | null>(null),
    [source, setSource] = useState<ImportSource>(),
    [importing, setImporting] = useState(false),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [changes, setChanges] = useState<string[]>([]),
    [issues, setIssues] = useState(0),
    [reset, setReset] = useState(false);
  const programs = useQuery({
    queryKey: ["degree-programs"],
    queryFn: () =>
      query<DegreeProgram>("SELECT * FROM degree_programs ORDER BY created_at"),
  });
  const selected = id || programs.data?.[0]?.id || "";
  const degree = useQuery({
    queryKey: ["degree", selected],
    queryFn: async () => {
      const saved = await loadDegree(selected);
      const upgraded = applyCatalogue(saved);
      if (upgraded.groups.length !== saved.groups.length) {
        await saveDegree(upgraded, saved, {
          id: uid(),
          filename: "BS in Computer Science 24-25.pdf",
          parser_version: "catalogue-1",
          source_path: "",
          content_hash: "",
        });
        return loadDegree(selected);
      }
      return saved;
    },
    enabled: !!selected,
  });
  const history = useQuery({
    queryKey: ["degree-history", selected, degree.data?.program.revision],
    enabled: !!selected,
    queryFn: () =>
      query<ImportSource>(
        "SELECT * FROM local_import_sources WHERE program_id=? ORDER BY imported_at DESC",
        [selected],
      ),
  });
  const s = degree.data;
  async function parsed(d: ExtractedDocument) {
    try {
      const parsed = evaluationParser.parse(d),
        incoming = applyCatalogue(parsed.state);
      const merged = s
        ? mergeEvaluation(s, incoming)
        : { state: incoming, changes: [] };
      setDraft(merged.state);
      setChanges(merged.changes);
      setIssues(
        parsed.diagnostics.filter((x) => !/review credits and grade/i.test(x))
          .length,
      );
      setEditing(false);
      setImporting(false);
      setSource({
        id: uid(),
        filename: d.filename,
        parser_version: DEGREE_PARSER_VERSION,
        source_path: d.path,
        content_hash: d.hash,
        changes_json: JSON.stringify(merged.changes),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function persist(next: DegreeState) {
    setBusy(true);
    setError("");
    try {
      next = syncPlannedHistory(applyCatalogue(next));
      matchCourses(
        next,
        await query<{ id: string; code: string; name: string; term: string }>(
          "SELECT c.id,c.code,c.name,s.name term FROM courses c JOIN semesters s ON s.id=c.semester_id",
        ),
      );
      await saveDegree(
        next,
        s ?? null,
        source ?? {
          id: uid(),
          filename: "Degree updated",
          parser_version: "manual",
          source_path: "",
          content_hash: "",
        },
      );
      setId(next.program.id);
      setDraft(null);
      setSource(undefined);
      setEditing(false);
      await programs.refetch();
      if (selected === next.program.id) await degree.refetch();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = (state: DegreeState) =>
    state.program.degree_type && state.program.major
      ? `${state.program.degree_type} in ${state.program.major}`
      : state.program.name;
  return (
    <div className="degree-page">
      <PageHeader
        title="Degree Progress"
        subtitle={
          s
            ? `${title(s)} · Catalog: ${s.program.catalog_term}`
            : "Your degree, from first credit to graduation"
        }
      >
        {s && !draft && !importing && (
          <>
            <Button variant="primary" onClick={() => setTab("Planner")}>
              Plan graduation
            </Button>
            <details className="degree-menu">
              <summary aria-label="Degree actions">•••</summary>
              <div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setImporting(true);
                    setSource(undefined);
                  }}
                >
                  Re-import degree evaluation
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(structuredClone(s));
                    setEditing(true);
                    setSource(undefined);
                  }}
                >
                  Edit degree structure
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      setDraft(await reviewWorkspaceHistory(s));
                      setSource(undefined);
                      setEditing(true);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Import/update progress
                </Button>
                {!catalogueGroups(s).length &&
                  /2024-2025/.test(s.program.catalog_term) && (
                    <Button
                      variant="ghost"
                      onClick={() => void persist(applyCatalogue(s))}
                    >
                      Use CS 24-25 structure
                    </Button>
                  )}
                <Button variant="ghost" onClick={() => setReset(true)}>
                  Reset degree data
                </Button>
              </div>
            </details>
          </>
        )}
      </PageHeader>
      <ErrorText
        error={
          error ||
          (programs.error as Error)?.message ||
          (degree.error as Error)?.message
        }
      />
      {reset && (
        <Section title="Reset this degree?">
          <p>
            This removes this degree’s requirements, plans and import history.
            Course workspaces stay available.
          </p>
          <Button onClick={() => setReset(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await batch([
                  {
                    sql: "DELETE FROM degree_programs WHERE id=?",
                    params: [selected],
                  },
                ]);
                setReset(false);
                setId("");
                await programs.refetch();
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Reset degree
          </Button>
        </Section>
      )}
      {programs.isLoading || degree.isLoading ? (
        <p role="status">Loading your degree…</p>
      ) : null}
      {(programs.data?.length ?? 0) > 1 && (
        <select
          aria-label="Degree program"
          value={selected}
          onChange={(e) => setId(e.target.value)}
        >
          {programs.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {importing ? (
        <div className="academic-review">
          <Section
            title={s ? "Update degree evaluation" : "Import degree evaluation"}
          >
            <p>
              Choose your evaluation. You’ll review a summary before anything is
              saved.
            </p>
            <ImportPicker
              label="Degree evaluation document"
              onExtract={(d) => void parsed(d)}
            />
            <Button onClick={() => setImporting(false)}>Cancel</Button>
          </Section>
        </div>
      ) : draft ? (
        <div className="academic-review">
          <Section
            title={
              source
                ? s
                  ? "Degree evaluation update"
                  : "Degree evaluation found"
                : "Edit degree structure"
            }
          >
            {source && (
              <>
                <h2>{title(draft)}</h2>
                <p>Catalog: {draft.program.catalog_term}</p>
                <DegreeSummary state={draft} />
                {s ? (
                  <>
                    <h3>Changes found</h3>
                    {changes.length ? (
                      changes.map((c, i) => (
                        <p key={i}>{c.replaceAll("_", " ")}</p>
                      ))
                    ) : (
                      <p>No changes to your degree progress.</p>
                    )}
                  </>
                ) : (
                  <p>
                    {
                      draft.groups.filter(
                        (g) => !g.description.startsWith("AUB BS"),
                      ).length
                    }{" "}
                    audit areas ·{" "}
                    {draft.courses.filter((c) => !c.excluded).length} used
                    records ·{" "}
                    {
                      draft.courses.filter(
                        (c) => !c.excluded && c.status === "in_progress",
                      ).length
                    }{" "}
                    in-progress courses ·{" "}
                    {
                      draft.courses.filter(
                        (c) => c.excluded || c.status === "failed",
                      ).length
                    }{" "}
                    previous attempts
                  </p>
                )}
                {issues > 0 && (
                  <p role="note">
                    Some document information needs review. Check the course and
                    requirement summaries before importing.
                  </p>
                )}
                <details>
                  <summary>Program details</summary>
                  <p>
                    {draft.program.name} · {draft.program.degree_type} ·{" "}
                    {draft.program.major}
                  </p>
                  <p>
                    Evaluation: {draft.program.evaluation_term} · Minimum GPA:{" "}
                    {draft.program.minimum_gpa?.toFixed(2)}
                  </p>
                </details>
                <details>
                  <summary>Courses</summary>
                  <AttemptTable
                    courses={draft.courses.filter(
                      (c) => !c.excluded && c.status !== "failed",
                    )}
                  />
                </details>
                <details>
                  <summary>Requirement matches</summary>
                  <Requirements state={draft} />
                </details>
                <details>
                  <summary>Previous attempts</summary>
                  <AttemptTable
                    courses={draft.courses.filter(
                      (c) => c.excluded || c.status === "failed",
                    )}
                  />
                </details>
                <Button variant="ghost" onClick={() => setEditing(!editing)}>
                  {editing ? "Close corrections" : "Correct information"}
                </Button>
              </>
            )}
            {(editing || !source) && (
              <DegreeEditor state={draft} onChange={setDraft} />
            )}
            <div className="modal-footer">
              <Button
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setSource(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || (!draft.courses.length && !!source)}
                onClick={() => void persist(draft)}
              >
                {busy
                  ? "Saving…"
                  : source
                    ? s
                      ? "Apply update"
                      : "Import degree"
                    : "Save degree"}
              </Button>
            </div>
          </Section>
        </div>
      ) : s ? (
        <>
          <nav className="tabs degree-tabs" aria-label="Degree sections">
            {["Overview", "Requirements", "Planner", "History"].map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Overview" && (
            <>
              <DegreeSummary state={s} />
              <div className="degree-overview-grid">
                <Section title="What remains">
                  <p className="academic-secondary">
                    After your current courses are passed
                  </p>
                  <Remaining state={s} />
                  <Button
                    variant="ghost"
                    onClick={() => setTab("Requirements")}
                  >
                    View all requirements →
                  </Button>
                </Section>
                <GraduationChecks state={s} />
              </div>
              <Section title="Taking now">
                <AttemptTable
                  courses={s.courses.filter(
                    (c) => !c.excluded && c.status === "in_progress",
                  )}
                  interactive
                />
              </Section>
            </>
          )}
          {tab === "Requirements" && (
            <>
              <p className="academic-secondary">
                ✓ Completed · ◐ In progress · ○ Planned · □ Remaining
              </p>
              <Requirements state={s} interactive />
              <GraduationChecks state={s} />
            </>
          )}
          {tab === "Planner" && (
            <>
              <DegreePlanner
                key={s.program.revision}
                state={s}
                busy={busy}
                onSave={(next) => void persist(next)}
              />
              <details>
                <summary>GPA scenarios</summary>
                <GpaScenarios state={s} scaleRaw={preferences.gpa_scale} />
              </details>
            </>
          )}
          {tab === "History" && (
            <>
              <Section title="Previous / Not Counted Attempts">
                <details>
                  <summary>
                    {
                      s.courses.filter(
                        (c) => c.excluded || c.status === "failed",
                      ).length
                    }{" "}
                    previous attempts
                  </summary>
                  <AttemptTable
                    courses={s.courses.filter(
                      (c) => c.excluded || c.status === "failed",
                    )}
                  />
                </details>
              </Section>
              <Section title="Imports & source documents">
                {history.data?.map((h) => (
                  <div className="academic-line" key={h.id}>
                    <span>{h.filename}</span>
                    <span>{h.imported_at?.slice(0, 10)}</span>
                  </div>
                ))}
                <details>
                  <summary>Evaluation areas</summary>
                  {s.groups
                    .filter((g) => !g.description.startsWith("AUB BS"))
                    .map((g) => (
                      <div className="academic-line" key={g.id}>
                        <span>{g.name}</span>
                        <span>
                          {g.reported_used_credits ?? "—"} /{" "}
                          {g.credits_required} credits used
                        </span>
                      </div>
                    ))}
                </details>
              </Section>
            </>
          )}
        </>
      ) : (
        !programs.isLoading && (
          <Section title="Set up your degree progress">
            <div className="academic-empty">
              <p>
                See what you’ve completed, what you’re taking now, and what
                remains.
              </p>
              <Button variant="primary" onClick={() => setImporting(true)}>
                Import degree evaluation
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(emptyDegree());
                  setEditing(true);
                  setSource(undefined);
                }}
              >
                Set up manually
              </Button>
              <p className="academic-secondary">
                Your evaluation is read locally on this device.
              </p>
            </div>
          </Section>
        )
      )}
    </div>
  );
}
