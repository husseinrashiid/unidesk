import { query } from "../../services/platform";
import {
  openAIProvider,
  modelFor,
  type AIProvider,
  type ModelRole,
} from "./provider";
import { retrieve, type Scope } from "./retrieval";
import {
  instructions,
  answerSchema,
  jsonSchema,
  validateAnswer,
} from "./prompts";
import { digest, saveResult, type AIResult } from "./results";
export async function generateAnswer(
  options: {
    kind: string;
    question: string;
    scope: Scope;
    settings: Record<string, string>;
    requestId: string;
    general?: boolean;
    role?: ModelRole;
    conversationId?: string;
    regenerate?: boolean;
    cancelled: () => boolean;
  },
  provider: AIProvider = openAIProvider,
) {
  const o = options,
    max = Math.max(1, Math.min(20, Number(o.settings.ai_max_sources) || 10));
  const browse = ["summary", "notes", "guide"].includes(o.kind);
  const sources = await retrieve(o.question, o.scope, max, browse);
  if (!sources.length && !o.general)
    throw Error(
      "I couldn't find enough information in the selected indexed material to answer reliably. Try other search terms or broaden the scope.",
    );
  const model = modelFor(
    o.settings,
    o.role ?? (["summary", "notes"].includes(o.kind) ? "fast" : "balanced"),
  );
  const cacheKey = await digest({
    version: 1,
    kind: o.kind,
    question: o.question,
    scope: o.scope,
    model,
    general: o.general,
    sources: sources.map((s) => [s.id, s.hash]),
  });
  if (o.kind !== "ask" && !o.regenerate) {
    const cached = await query<AIResult>(
      "SELECT * FROM document_ai_results WHERE cache_key=? AND stale=0 ORDER BY created_at DESC LIMIT 1",
      [cacheKey],
    );
    if (cached.length) return cached[0];
  }
  if (o.settings.ai_enabled !== "true")
    throw Error(
      "Cloud AI is off. Enable it in Settings → AI; local search and cached results remain available.",
    );
  const history = o.conversationId
    ? await query<{ title: string; payload_json: string }>(
        "SELECT title,payload_json FROM document_ai_results WHERE conversation_id=? ORDER BY created_at DESC LIMIT 3",
        [o.conversationId],
      )
    : [];
  if (o.cancelled()) throw Error("Generation cancelled.");
  const response = await provider.generate({
    requestId: o.requestId,
    model,
    instructions: instructions(o.kind, o.general),
    input: JSON.stringify({
      question: o.question,
      history: history
        .reverse()
        .map((h) => ({
          question: h.title,
          answer: h.payload_json.slice(0, 1800),
        })),
      sources: sources.map((s) => ({
        id: s.label,
        title: s.title,
        text: s.text,
      })),
    }),
    schema: jsonSchema(answerSchema),
  });
  if (o.cancelled()) throw Error("Generation cancelled.");
  let payload;
  try {
    payload = validateAnswer(JSON.parse(response.text), sources, o.general);
  } catch (e) {
    throw Error(
      e instanceof Error && e.message.startsWith("AI ")
        ? e.message
        : "AI returned malformed academic content. Nothing was saved; try again.",
    );
  }
  return saveResult(
    {
      id: crypto.randomUUID(),
      course_id: o.scope.courseId,
      exam_id: o.scope.examId ?? null,
      conversation_id: o.conversationId ?? null,
      kind: o.kind,
      title: o.question,
      model,
      cache_key: cacheKey,
      payload_json: JSON.stringify(payload),
      sources_json: JSON.stringify(sources),
    },
    sources,
  );
}
