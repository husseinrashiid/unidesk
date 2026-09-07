import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch } from "../../services/platform";
import { AskCourse } from "./AskCourse";
import { generatePractice, type Practice } from "./practiceGenerator";
import { openAIProvider } from "./provider";
import { SourceAnswer } from "./SourceAnswer";
import { topicFrequency, type StoredQuestion } from "./examAnalyzer";
import type { AIResult } from "./results";
import { ExamEmails } from "./ExamEmails";
export function ExamAIWorkspace({
  examId,
  courseId,
}: {
  examId: string;
  courseId: string;
}) {
  const { preferences } = useWorkspace();
  const [count, setCount] = useState(5),
    [type, setType] = useState("Mixed"),
    [difficulty, setDifficulty] = useState("Exam-style"),
    [focus, setFocus] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<AIResult | null>(null),
    [revealed, setRevealed] = useState<number[]>([]);
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
  const { data: files = [] } = useQuery({
    queryKey: ["exam-ai-files", examId],
    queryFn: () =>
      query<{ id: string; filename: string; category: string; status: string }>(
        "SELECT f.id,f.filename,f.category,coalesce(d.status,'Not indexed') status FROM attachments a JOIN files f ON f.id=a.file_id LEFT JOIN documents d ON d.file_id=f.id WHERE a.entity_type='exam' AND a.entity_id=? AND f.course_id=?",
        [examId, courseId],
      ),
  });
  const { data: topics = [] } = useQuery({
    queryKey: ["exam-ai-topics", examId],
    queryFn: () =>
      query<{ title: string; status: string }>(
        "SELECT title,status FROM exam_topics WHERE exam_id=? ORDER BY sort_order",
        [examId],
      ),
  });
  const { data: past = [] } = useQuery({
    queryKey: ["exam-ai-past", examId],
    queryFn: () =>
      query<StoredQuestion>(
        "SELECT q.* FROM previous_exam_questions q JOIN document_ai_results r ON r.id=q.result_id JOIN attachments a ON a.file_id=q.file_id WHERE a.entity_id=? AND a.entity_type='exam' AND r.stale=0 AND q.course_id=?",
        [examId, courseId],
      ),
  });
  const { data: history = [], refetch } = useQuery({
    queryKey: ["practice-history", examId],
    queryFn: () =>
      query<AIResult>(
        "SELECT * FROM document_ai_results WHERE exam_id=? AND kind='practice' ORDER BY created_at DESC",
        [examId],
      ),
  });
  async function run(regenerate = false) {
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    setError("");
    try {
      const r = await generatePractice({
        scope: { courseId, examId },
        settings: preferences,
        requestId: id,
        count,
        type,
        difficulty,
        focus,
        regenerate,
        cancelled: () => request.current !== id,
      });
      if (request.current !== id) return;
      setResult(r);
      setRevealed([]);
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
  const practice: Practice | null = result
    ? JSON.parse(result.payload_json)
    : null;
  return (
    <>
      <Section title="Exam study workspace">
        <p className="helper">
          Choose files in this exam's Materials tab. AI uses only that
          selection, never the entire course by assumption. Answers and guides
          cover retrieved excerpts, not guaranteed complete exam coverage.
        </p>
        <p>
          {files.length} selected files ·{" "}
          {files.filter((f) => f.status === "Indexed").length} indexed
        </p>
        {files.map((f) => (
          <p className="helper" key={f.id}>
            {f.filename} · {f.category} · {f.status}
          </p>
        ))}
        <details>
          <summary>Tracked preparation and previous topics</summary>
          <p className="helper">Completion reflects your recorded tracking.</p>
          {topics.map((t, i) => (
            <p key={i}>
              {t.title} · {t.status}
            </p>
          ))}
          {topicFrequency(past).map((t) => (
            <p key={t.topic}>
              {t.topic} · {t.exams} selected past-exam uploads · {t.questions}{" "}
              questions
            </p>
          ))}
        </details>
      </Section>
      <ExamEmails courseId={courseId} examId={examId} />
      <AskCourse courseId={courseId} examId={examId} />
      <Section title="Generate practice questions">
        <div className="material-filters">
          <Field label="Practice question type">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {["Mixed", "MCQ", "Short answer", "Essay"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Number of questions">
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[5, 10, 20].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {["Basic", "Exam-style", "Challenging"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Practice focus (optional)">
          <input
            value={focus}
            maxLength={1500}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Leave blank to sample selected exam material"
          />
        </Field>
        <Button disabled={busy} onClick={() => void run()}>
          Generate practice questions
        </Button>
        {busy && (
          <>
            <p role="status">Generating source-grounded questions…</p>
            <Button
              onClick={() => {
                void openAIProvider.cancel(request.current);
                request.current = "";
                setBusy(false);
              }}
            >
              Cancel generation
            </Button>
          </>
        )}
        <ErrorText error={error} />
        {result && practice && (
          <article>
            <p className="helper">
              Generated · {result.created_at} · {result.model}
              {result.stale ? " · Stale: sources changed" : ""}
            </p>
            {practice.questions.map((q, i) => (
              <section className="material-result" key={i}>
                <strong>
                  {i + 1}. {q.question}
                </strong>
                {q.choices.length > 0 && (
                  <ol type="A">
                    {q.choices.map((c, j) => (
                      <li key={j}>{c}</li>
                    ))}
                  </ol>
                )}
                <Field label={`Your answer ${i + 1}`}>
                  <textarea rows={2} />
                </Field>
                <Button
                  onClick={() =>
                    setRevealed(
                      revealed.includes(i)
                        ? revealed.filter((n) => n !== i)
                        : [...revealed, i],
                    )
                  }
                >
                  {revealed.includes(i) ? "Hide answer" : "Show answer"}
                </Button>
                {revealed.includes(i) && (
                  <SourceAnswer
                    answer={{
                      sections: [
                        {
                          title: "Suggested answer",
                          text: q.answer + "\n\n" + q.explanation,
                          citations: q.citations,
                        },
                      ],
                      general: "",
                      insufficient: false,
                    }}
                    sources={JSON.parse(result.sources_json)}
                  />
                )}
              </section>
            ))}
            <Button disabled={busy} onClick={() => void run(true)}>
              Regenerate · new API request
            </Button>
            <Button
              onClick={() =>
                void batch([
                  {
                    sql: "DELETE FROM document_ai_results WHERE id=?",
                    params: [result.id],
                  },
                ])
                  .then(() => {
                    setResult(null);
                    return refetch();
                  })
                  .catch((e) => setError((e as Error).message))
              }
            >
              Delete practice set
            </Button>
          </article>
        )}
        <details>
          <summary>Saved practice sets</summary>
          {history.map((r) => (
            <Button
              key={r.id}
              onClick={() => {
                setResult(r);
                setRevealed([]);
              }}
            >
              {r.title} · {r.created_at}
              {r.stale ? " · Stale" : ""}
            </Button>
          ))}
        </details>
      </Section>
    </>
  );
}
