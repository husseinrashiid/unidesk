import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch } from "../../services/platform";
import { useDocuments } from "../documents/Materials";
import {
  analyzeExam,
  topicFrequency,
  type StoredQuestion,
} from "./examAnalyzer";
import { openAIProvider } from "./provider";
import { SourceAnswer } from "./SourceAnswer";
export function PreviousExamAnalysis({ courseId }: { courseId: string }) {
  const { preferences, navigate } = useWorkspace();
  const { data: documents = [] } = useDocuments(courseId);
  const [file, setFile] = useState(""),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("Questions"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
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
  const { data: questions = [], refetch } = useQuery({
    queryKey: ["previous-questions", courseId],
    queryFn: () =>
      query<StoredQuestion>(
        "SELECT q.*,f.filename,r.sources_json FROM previous_exam_questions q JOIN files f ON f.id=q.file_id JOIN document_ai_results r ON r.id=q.result_id JOIN documents d ON d.file_id=q.file_id WHERE q.course_id=? AND r.stale=0 AND d.status='Indexed' AND d.enabled=1 ORDER BY q.year DESC,f.filename,q.rowid",
        [courseId],
      ),
  });
  const { data: counts = [], refetch: reloadCount } = useQuery({
    queryKey: ["previous-analysis-count", courseId],
    queryFn: () =>
      query<{ n: number }>(
        "SELECT count(DISTINCT s.document_id) n FROM document_ai_results r JOIN ai_result_sources s ON s.result_id=r.id JOIN documents d ON d.id=s.document_id WHERE r.course_id=? AND r.kind='exam_analysis' AND r.stale=0 AND d.status='Indexed'",
        [courseId],
      ),
  });
  async function run(force = false) {
    setError("");
    setBusy(true);
    const id = crypto.randomUUID();
    request.current = id;
    try {
      await analyzeExam({
        courseId,
        fileId: file,
        settings: preferences,
        requestId: id,
        cancelled: () => request.current !== id,
        progress: (done, total) =>
          setProgress(`Analyzing batch ${done + 1} of ${total}`),
        regenerate: force,
      });
      await refetch();
      await reloadCount();
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
    <Section title="Previous exam analysis">
      <p className="helper">
        Questions are extracted from original text. Topics are AI-detected
        labels; recurrence describes analyzed uploads and does not predict the
        next exam. Repeated uploads can inflate counts.
      </p>
      <Field label="Previous exam document">
        <select value={file} onChange={(e) => setFile(e.target.value)}>
          <option value="">Select an uploaded exam</option>
          {documents
            .filter((d) => d.category === "Previous Exams")
            .map((d) => (
              <option key={d.id} value={d.file_id}>
                {d.filename} · {d.status}
              </option>
            ))}
        </select>
      </Field>
      <div className="email-actions">
        <Button disabled={busy || !file} onClick={() => void run()}>
          Analyze previous exam
        </Button>
        <Button disabled={busy || !file} onClick={() => void run(true)}>
          Re-analyze · new API requests
        </Button>
        <Button
          disabled={busy || !file}
          onClick={() =>
            void batch([
              {
                sql: "DELETE FROM document_ai_results WHERE course_id=? AND kind='exam_analysis' AND id IN(SELECT result_id FROM ai_result_sources WHERE document_id=?)",
                params: [courseId, file],
              },
            ])
              .then(async () => {
                await refetch();
                await reloadCount();
              })
              .catch((e) => setError((e as Error).message))
          }
        >
          Delete selected exam analysis
        </Button>
        <Button onClick={() => navigate("settings/ai")}>AI settings</Button>
        {busy && (
          <Button
            onClick={() => {
              void openAIProvider.cancel(request.current);
              request.current = "";
              setBusy(false);
            }}
          >
            Cancel analysis
          </Button>
        )}
      </div>
      {busy && <p role="status">{progress}</p>}
      <ErrorText error={error} />
      <div className="tabs">
        {["Questions", "Topics"].map((t) => (
          <button
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <Field label="Search past questions or topics">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Field>
      {tab === "Questions"
        ? questions
            .filter((q) =>
              (q.text + " " + q.topics_json + " " + q.filename)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((q) => (
              <article className="material-result" key={q.id}>
                <strong>
                  {q.filename} · Q{q.number} · {q.type}
                  {q.year ? ` · ${q.year}` : ""}
                </strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{q.text}</p>
                <p className="helper">
                  Detected topics: {JSON.parse(q.topics_json).join(", ")}
                </p>
                <SourceAnswer
                  answer={{
                    sections: [
                      {
                        title: "Original question evidence",
                        text: "",
                        citations: JSON.parse(q.citations_json),
                      },
                    ],
                    general: "",
                    insufficient: false,
                  }}
                  sources={JSON.parse(q.sources_json)}
                />
                <Button
                  onClick={() => navigate(`course/${courseId}/Materials`)}
                >
                  Find related course material
                </Button>
              </article>
            ))
        : topicFrequency(questions)
            .filter((t) => t.topic.includes(search.toLowerCase()))
            .map((t) => (
              <div className="material-result" key={t.topic}>
                <strong>{t.topic}</strong>
                <p>
                  Appeared in {t.exams} of {counts[0]?.n ?? 0} analyzed uploaded
                  exams · {t.questions} questions
                  {t.years.length ? ` · ${t.years.join(", ")}` : ""}
                </p>
              </div>
            ))}
      {!questions.length && (
        <p className="helper">
          No extracted questions yet. Add a searchable previous exam below, wait
          for indexing, then analyze it.
        </p>
      )}
    </Section>
  );
}
