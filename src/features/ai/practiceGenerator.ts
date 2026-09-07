import { z } from "zod";
import { query } from "../../services/platform";
import { retrieve, type Scope, type Source } from "./retrieval";
import {
  citationSchema,
  jsonSchema,
  rules,
  validateCitations,
} from "./prompts";
import { modelFor, openAIProvider, type AIProvider } from "./provider";
import { digest, saveResult, type AIResult } from "./results";
export const practiceSchema = z
  .object({
    insufficient: z.boolean(),
    questions: z
      .array(
        z
          .object({
            type: z.enum(["MCQ", "Short answer", "Essay"]),
            question: z.string().min(8).max(3000),
            choices: z.array(z.string().max(1000)).max(6),
            answer: z.string().min(1).max(4000),
            explanation: z.string().max(4000),
            citations: z.array(citationSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type Practice = z.infer<typeof practiceSchema>;
export function validatePractice(
  raw: unknown,
  sources: Source[],
  count: number,
  type: string,
) {
  const p = practiceSchema.parse(raw);
  if (p.insufficient)
    throw Error(
      "Not enough evidence to generate this practice set. Select more relevant exam material.",
    );
  if (p.questions.length !== count)
    throw Error("AI returned an incomplete practice set. Try fewer questions.");
  for (const q of p.questions) {
    validateCitations(q.citations, sources);
    if (type !== "Mixed" && q.type !== type)
      throw Error("AI returned the wrong question type.");
    if (
      q.type === "MCQ" &&
      (q.choices.length < 2 || !q.choices.includes(q.answer))
    )
      throw Error(
        "An MCQ answer did not match its options. Nothing was saved.",
      );
    if (q.type !== "MCQ" && q.choices.length)
      throw Error("Unexpected choices in a written question.");
  }
  return p;
}
export async function generatePractice(
  o: {
    scope: Scope;
    settings: Record<string, string>;
    requestId: string;
    count: number;
    type: string;
    difficulty: string;
    focus: string;
    cancelled: () => boolean;
    regenerate?: boolean;
  },
  provider: AIProvider = openAIProvider,
) {
  if (
    ![5, 10, 20].includes(o.count) ||
    !["Mixed", "MCQ", "Short answer", "Essay"].includes(o.type) ||
    !["Basic", "Exam-style", "Challenging"].includes(o.difficulty)
  )
    throw Error("Invalid practice options.");
  const sources = await retrieve(
    o.focus,
    o.scope,
    Math.min(20, Math.max(1, Number(o.settings.ai_max_sources) || 10)),
    !o.focus.trim(),
  );
  if (!sources.length)
    throw Error("Select indexed material for this exam in its Materials tab.");
  const model = modelFor(o.settings, "balanced"),
    cacheKey = await digest({
      version: 1,
      kind: "practice",
      scope: o.scope,
      count: o.count,
      type: o.type,
      difficulty: o.difficulty,
      focus: o.focus,
      model,
      sources: sources.map((s) => [s.id, s.hash]),
    });
  if (!o.regenerate) {
    const cached = await query<AIResult>(
      "SELECT * FROM document_ai_results WHERE cache_key=? AND stale=0 ORDER BY created_at DESC LIMIT 1",
      [cacheKey],
    );
    if (cached.length) return cached[0];
  }
  if (o.settings.ai_enabled !== "true")
    throw Error("Cloud AI is off. Saved sets remain available.");
  if (o.cancelled()) throw Error("Practice generation cancelled.");
  const response = await provider.generate({
    requestId: o.requestId,
    model,
    instructions: `${rules}\nGenerate exactly ${o.count} ${o.type} practice questions, difficulty ${o.difficulty}. Ground both questions and answers in the selected excerpts. MCQ answer must exactly equal one choice; other types have no choices. Give suggested answers and explanations, not grading claims. Do not predict what will appear on the real exam. Return insufficient=true if the evidence cannot support this many useful questions.`,
    input: JSON.stringify({
      focus: o.focus,
      sources: sources.map((s) => ({
        id: s.label,
        title: s.title,
        text: s.text,
      })),
    }),
    schema: jsonSchema(practiceSchema),
  });
  if (o.cancelled()) throw Error("Practice generation cancelled.");
  const payload = validatePractice(
    JSON.parse(response.text),
    sources,
    o.count,
    o.type,
  );
  return saveResult(
    {
      id: crypto.randomUUID(),
      course_id: o.scope.courseId,
      exam_id: o.scope.examId ?? null,
      conversation_id: null,
      kind: "practice",
      title: `${o.count} ${o.type} questions · ${o.difficulty}`,
      model,
      cache_key: cacheKey,
      payload_json: JSON.stringify(payload),
      sources_json: JSON.stringify(sources),
    },
    sources,
  );
}
