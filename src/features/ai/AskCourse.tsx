import { useEffect, useRef, useState } from "react";
import "./ai.css";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch, query } from "../../services/platform";
import { useDocuments } from "../documents/Materials";
import { categories } from "../../types";
import { generateAnswer } from "./courseQuestionService";
import { openAIProvider, type ModelRole } from "./provider";
import { SourceAnswer, answerText } from "./SourceAnswer";
import { routeLocal, type LocalAnswer } from "./router";
import type { AIResult } from "./results";
export function AskCourse({
  courseId,
  initialFileId = "",
  initialKind = "ask",
  examId,
}: {
  courseId: string;
  initialFileId?: string;
  initialKind?: string;
  examId?: string;
}) {
  const { preferences, data, navigate, report } = useWorkspace();
  const { data: documents = [] } = useDocuments(courseId);
  const [question, setQuestion] = useState(""),
    [kind, setKind] = useState(initialKind),
    [category, setCategory] = useState(""),
    [selected, setSelected] = useState<string[]>(
      initialFileId ? [initialFileId] : [],
    ),
    [scope, setScope] = useState(initialFileId ? "selected" : "all"),
    [general, setGeneral] = useState(false),
    [emails, setEmails] = useState(false),
    [role, setRole] = useState<ModelRole | "automatic">("automatic"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<AIResult | null>(null),
    [local, setLocal] = useState<LocalAnswer | null>(null),
    [conversation, setConversation] = useState("");
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
    queryKey: ["ai-history", courseId, conversation],
    queryFn: () =>
      query<AIResult>(
        `SELECT * FROM document_ai_results WHERE course_id=?${conversation ? " AND conversation_id=?" : ""} ORDER BY created_at DESC,id DESC LIMIT 30`,
        [courseId, ...(conversation ? [conversation] : [])],
      ),
  });
  const { data: conversations = [], refetch: reloadConversations } = useQuery({
    queryKey: ["ai-conversations", courseId],
    queryFn: () =>
      query<{ id: string; title: string }>(
        "SELECT id,title FROM ai_conversations WHERE course_id=? ORDER BY created_at DESC",
        [courseId],
      ),
  });
  async function run(regenerate = false) {
    setError("");
    setLocal(null);
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    try {
      const prompt =
        question.trim() ||
        ({
          summary: "Summarize this document",
          notes: "Generate study notes",
          guide: "Generate an exam study guide",
        }[kind] ??
          "");
      if (!prompt) throw Error("Enter a question.");
      if (kind === "ask") {
        const answer = await routeLocal(prompt, courseId);
        if (answer) {
          setLocal(answer);
          setResult(null);
          return;
        }
      }
      let conversationId = conversation;
      if (kind === "ask" && !conversationId) {
        conversationId = crypto.randomUUID();
        await batch([
          {
            sql: "INSERT INTO ai_conversations(id,course_id,title) VALUES(?,?,?)",
            params: [conversationId, courseId, prompt.slice(0, 100)],
          },
        ]);
        setConversation(conversationId);
        await reloadConversations();
      }
      const answer = await generateAnswer({
        kind,
        question: prompt,
        scope: {
          courseId,
          category: category || undefined,
          fileIds: scope === "selected" ? selected : undefined,
          examId,
          includeEmails: emails,
        },
        settings: preferences,
        requestId: id,
        general,
        role: role === "automatic" ? undefined : role,
        conversationId: kind === "ask" ? conversationId : undefined,
        regenerate,
        cancelled: () => request.current !== id,
      });
      if (request.current !== id) return;
      setResult(answer);
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
    <Section
      title={
        examId
          ? "Ask about this exam"
          : `Ask ${data.courses.find((c) => c.id === courseId)?.code ?? "Course"}`
      }
    >
      <p className="helper">
        Only selected/retrieved excerpts are sent to OpenAI when you run an
        action. Answers retain source evidence.{" "}
        {examId
          ? "Scope is limited to files attached in this exam’s Materials tab."
          : ""}
      </p>
      <div className="material-filters">
        <Field label="AI action">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="ask">Ask Course</option>
            <option value="summary">Summarize</option>
            <option value="notes">Generate study notes</option>
            {examId && <option value="guide">Generate exam study guide</option>}
          </select>
        </Field>
        <Field label="Ask scope">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">
              {examId ? "Selected exam material" : "All course material"}
            </option>
            <option value="selected">Selected documents only</option>
          </select>
        </Field>
        <Field label="Source category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories
              .filter((c) => c !== "Recordings")
              .map((c) => (
                <option key={c}>{c}</option>
              ))}
          </select>
        </Field>
      </div>
      {scope === "selected" && (
        <div className="ai-file-options">
          {documents.map((d) => (
            <label key={d.id}>
              <input
                type="checkbox"
                checked={selected.includes(d.file_id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, d.file_id]
                      : selected.filter((id) => id !== d.file_id),
                  )
                }
              />
              {d.filename} <small>· {d.status}</small>
            </label>
          ))}
        </div>
      )}
      <Field label="Your question or focus">
        <textarea
          rows={3}
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What are the strongest objections in these readings?"
        />
      </Field>
      <label className="ai-option">
        <input
          type="checkbox"
          checked={!general}
          onChange={(e) => setGeneral(!e.target.checked)}
        />
        Use only my materials
      </label>
      {!examId && scope !== "selected" && (
        <label className="ai-option">
          <input
            type="checkbox"
            checked={emails}
            onChange={(e) => setEmails(e.target.checked)}
          />
          Include relevant cached course emails
        </label>
      )}
      <Field label="Model role">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as ModelRole | "automatic")}
        >
          <option value="automatic">Automatic</option>
          <option value="fast">Fast</option>
          <option value="balanced">Balanced</option>
          <option value="advanced">Advanced · manual</option>
        </select>
      </Field>
      <div className="email-actions">
        <Button disabled={busy} onClick={() => void run()}>
          {" "}
          {kind === "ask" ? "Ask" : "Generate"}
        </Button>
        {busy && (
          <Button
            onClick={() => {
              const id = request.current;
              request.current = "";
              setBusy(false);
              void openAIProvider.cancel(id);
              report(
                "Cancelled. A request already sent may still incur API usage.",
              );
            }}
          >
            Cancel generation
          </Button>
        )}
        <Button onClick={() => navigate("settings/ai")}>AI settings</Button>
      </div>
      {busy && (
        <p role="status">
          Finding relevant sources and generating a cited result…
        </p>
      )}
      <ErrorText error={error} />
      {local && (
        <div className="ai-answer">
          <p style={{ whiteSpace: "pre-wrap" }}>{local.text}</p>
          {local.links.map((l) => (
            <Button key={l.page} onClick={() => navigate(l.page)}>
              {l.label}
            </Button>
          ))}
        </div>
      )}
      {result && (
        <article className="ai-saved-result">
          <p className="helper">
            Generated · {result.created_at} · {result.model}
            {result.stale ? " · Sources changed: this result is stale" : ""}
          </p>
          <SourceAnswer
            answer={JSON.parse(result.payload_json)}
            sources={JSON.parse(result.sources_json)}
          />
          <div className="email-actions">
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    answerText(
                      JSON.parse(result.payload_json),
                      JSON.parse(result.sources_json),
                    ),
                  )
                  .then(() => report("Generated text copied."))
                  .catch(() =>
                    setError(
                      "Could not copy. Select the text to copy it manually.",
                    ),
                  )
              }
            >
              Copy generated text
            </Button>
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
              Delete result
            </Button>
          </div>
        </article>
      )}
      <details className="material-index">
        <summary>Saved conversations and generated results</summary>
        <div className="email-actions">
          <Button
            onClick={() => {
              setConversation("");
              setResult(null);
              setQuestion("");
            }}
          >
            New conversation
          </Button>
          {conversation && (
            <Button
              onClick={() =>
                void batch([
                  {
                    sql: "DELETE FROM ai_conversations WHERE id=?",
                    params: [conversation],
                  },
                ])
                  .then(() => {
                    setConversation("");
                    setResult(null);
                    return reloadConversations();
                  })
                  .catch((e) => setError((e as Error).message))
              }
            >
              Delete conversation
            </Button>
          )}
        </div>
        {conversations.map((c) => (
          <Button key={c.id} onClick={() => setConversation(c.id)}>
            {c.title}
          </Button>
        ))}
        {history
          .filter((h) => ["ask", "summary", "notes", "guide"].includes(h.kind))
          .map((h) => (
            <button
              className="ai-history"
              key={h.id}
              onClick={() => {
                setResult(h);
                setKind(h.kind);
                setQuestion(h.title);
              }}
            >
              {h.title}
              <small>
                {h.created_at}
                {h.stale ? " · Stale" : ""}
              </small>
            </button>
          ))}
      </details>
    </Section>
  );
}
