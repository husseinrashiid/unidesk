import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch } from "../../services/platform";
import { useDocuments } from "../documents/Materials";
import { FileBrowser } from "../files/FileBrowser";
import {
  analyzeSyllabus,
  reviewSyllabus,
  applySyllabus,
  syllabusFields,
  type SyllabusItem,
  type ReviewItem,
} from "./syllabusAnalyzer";
import { openAIProvider } from "./provider";
import { SourceAnswer } from "./SourceAnswer";
import type { AIResult } from "./results";
export function SyllabusImport({ courseId }: { courseId: string }) {
  const { preferences, refresh, report, navigate } = useWorkspace();
  const { data: documents = [] } = useDocuments(courseId);
  const [file, setFile] = useState(""),
    [result, setResult] = useState<AIResult | null>(null),
    [items, setItems] = useState<SyllabusItem[]>([]),
    [review, setReview] = useState<ReviewItem[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const request = useRef("");
  useEffect(
    () => () => {
      if (request.current) {
        void openAIProvider.cancel(request.current);
        request.current = "";
      }
    },
    [],
  );
  const { data: history = [], refetch } = useQuery({
    queryKey: ["syllabus-history", courseId],
    queryFn: () =>
      query<AIResult>(
        "SELECT * FROM document_ai_results WHERE course_id=? AND kind='syllabus' ORDER BY created_at DESC",
        [courseId],
      ),
  });
  async function load(r: AIResult) {
    setResult(r);
    setItems(JSON.parse(r.payload_json).items);
    setSelected([]);
    setReview(await reviewSyllabus(r, JSON.parse(r.payload_json).items));
  }
  async function analyze(regenerate = false) {
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    setError("");
    try {
      const r = await analyzeSyllabus({
        courseId,
        fileId: file,
        settings: preferences,
        requestId: id,
        cancelled: () => request.current !== id,
        progress: (done, total) =>
          setProgress(`Analyzing section batch ${done + 1} of ${total}`),
        regenerate,
      });
      if (request.current !== id) return;
      await load(r);
      await refetch();
    } catch (e) {
      if (request.current === id) setError((e as Error).message);
    } finally {
      if (request.current === id) {
        request.current = "";
        setBusy(false);
      }
    }
  }
  return (
    <Section title="Import syllabus">
      <p className="helper">
        Choose an indexed PDF or DOCX. Extraction uses bounded batches of text
        and may require multiple API requests. Every detected item stays a draft
        until you review and import it.
      </p>
      <Field label="Syllabus document">
        <select value={file} onChange={(e) => setFile(e.target.value)}>
          <option value="">Select syllabus</option>
          {documents
            .filter((d) => /\.(pdf|docx)$/i.test(d.filename))
            .map((d) => (
              <option key={d.id} value={d.file_id}>
                {d.filename} · {d.status}
              </option>
            ))}
        </select>
      </Field>
      <Button disabled={busy || !file} onClick={() => void analyze()}>
        Analyze syllabus
      </Button>
      <Button onClick={() => navigate("settings/ai")}>AI settings</Button>
      {busy && (
        <>
          <p role="status">{progress}</p>
          <Button
            onClick={() => {
              void openAIProvider.cancel(request.current);
              request.current = "";
              setBusy(false);
            }}
          >
            Cancel analysis
          </Button>
        </>
      )}
      <ErrorText error={error} />
      {result && (
        <div className="syllabus-review">
          <h3>Review detected information</h3>
          <p className="helper">
            {result.title} ·{" "}
            {result.stale
              ? "Source changed — re-analyze before importing"
              : "Draft suggestions"}{" "}
            · Generated {result.created_at}
          </p>
          <p className="helper">
            Grading weights detected:{" "}
            {items
              .filter((i) => i.kind === "grade")
              .reduce(
                (sum, i) =>
                  sum +
                  (Number(i.fields.find((f) => f.name === "weight")?.value) ||
                    0),
                0,
              )}
            %. An incomplete total requires review; no weights are silently
            normalized.
          </p>
          {items.map((item, index) => (
            <article className="material-result" key={index}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(index)}
                  disabled={
                    !["New", "Possible update"].includes(
                      review[index]?.state,
                    ) || !!result.stale
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, index]
                        : selected.filter((n) => n !== index),
                    )
                  }
                />
                {item.kind} · {review[index]?.state}
              </label>
              <Field label={`Detected title ${index + 1}`}>
                <input
                  value={item.title}
                  onChange={(e) => {
                    setItems(
                      items.map((i, n) =>
                        n === index ? { ...i, title: e.target.value } : i,
                      ),
                    );
                    setSelected([]);
                    setReview([]);
                  }}
                />
              </Field>
              {item.fields.map((field, j) => (
                <Field
                  key={field.name}
                  label={`${field.name} · item ${index + 1}`}
                >
                  <input
                    value={field.value}
                    onChange={(e) => {
                      setItems(
                        items.map((i, n) =>
                          n === index
                            ? {
                                ...i,
                                fields: i.fields.map((f, k) =>
                                  k === j ? { ...f, value: e.target.value } : f,
                                ),
                              }
                            : i,
                        ),
                      );
                      setSelected([]);
                      setReview([]);
                    }}
                  />
                </Field>
              ))}
              <Field label={`Add missing field · item ${index + 1}`}>
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setItems(
                      items.map((i, n) =>
                        n === index
                          ? {
                              ...i,
                              fields: [
                                ...i.fields,
                                { name: e.target.value, value: "" },
                              ],
                            }
                          : i,
                      ),
                    );
                    setSelected([]);
                    setReview([]);
                  }}
                >
                  <option value="">Choose field to add</option>
                  {syllabusFields[item.kind]
                    .filter((name) => !item.fields.some((f) => f.name === name))
                    .map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                </select>
              </Field>
              {review[index]?.existing && (
                <p className="helper">
                  Existing:{" "}
                  {Object.keys(review[index].values)
                    .map(
                      (k) =>
                        `${k}: ${review[index].existing?.[k] ?? "Not set"}`,
                    )
                    .join(" · ")}
                </p>
              )}
              {review[index]?.error && (
                <p className="helper">{review[index].error}</p>
              )}
              <SourceAnswer
                answer={{
                  sections: [
                    {
                      title: "Source evidence",
                      text: "",
                      citations: item.citations,
                    },
                  ],
                  general: "",
                  insufficient: false,
                }}
                sources={JSON.parse(result.sources_json)}
              />
            </article>
          ))}
          <div className="email-actions">
            <Button
              onClick={() =>
                void reviewSyllabus(result, items)
                  .then((r) => {
                    setReview(r);
                    setSelected([]);
                  })
                  .catch((e) => setError((e as Error).message))
              }
            >
              Check edits and duplicates
            </Button>
            <Button
              disabled={!selected.length || busy || !!result.stale}
              onClick={() => {
                setBusy(true);
                setError("");
                void applySyllabus(result, review, selected)
                  .then(async () => {
                    setSelected([]);
                    setReview(await reviewSyllabus(result, items));
                    await refresh();
                    report("Selected syllabus items imported.");
                  })
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setBusy(false));
              }}
            >
              Import selected
            </Button>
            <Button
              onClick={() => {
                setResult(null);
                setSelected([]);
              }}
            >
              Cancel review
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void batch([
                  {
                    sql: "DELETE FROM document_ai_results WHERE id=? AND course_id=? AND kind=?",
                    params: [result.id, courseId, "syllabus"],
                  },
                ])
                  .then(() => {
                    setResult(null);
                    setSelected([]);
                    report(
                      "Analysis deleted. Previously imported academic records are kept.",
                    );
                    return refetch();
                  })
                  .catch((e) => setError((e as Error).message))
              }
            >
              Delete analysis · keep imported records
            </Button>
            <Button disabled={busy || !file} onClick={() => void analyze(true)}>
              Re-analyze · new API requests
            </Button>
          </div>
        </div>
      )}
      <details>
        <summary>Saved syllabus analyses</summary>
        {history.map((h) => (
          <Button
            key={h.id}
            onClick={() =>
              void load(h).catch((e) => setError((e as Error).message))
            }
          >
            {h.title} · {h.created_at}
            {h.stale ? " · Stale" : ""}
          </Button>
        ))}
      </details>
      <details>
        <summary>Add a syllabus file</summary>
        <FileBrowser courseId={courseId} category="Resources" />
      </details>
    </Section>
  );
}
