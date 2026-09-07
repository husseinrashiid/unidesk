import { z } from "zod";
import {
  citationSchema,
  rules,
  jsonSchema,
  validateCitations,
} from "./prompts";
import { extractStructured } from "./extractionService";
import type { Source } from "./retrieval";
import { batch } from "../../services/platform";
export const examQuestionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            number: z.string().max(60),
            text: z.string().min(12).max(10000),
            type: z.enum([
              "MCQ",
              "Short answer",
              "Essay",
              "Problem",
              "True/False",
              "Other",
            ]),
            year: z.number().int().min(1900).max(2200).nullable(),
            topics: z.array(z.string().min(2).max(100)).max(10),
            citations: z.array(citationSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type ExamQuestion = z.infer<typeof examQuestionSchema>["items"][number];
const normal = (s: string) => s.replace(/\s+/g, " ").trim();
export function parseExamQuestions(raw: unknown, sources: Source[]) {
  const { items } = examQuestionSchema.parse(raw);
  for (const item of items) {
    validateCitations(item.citations, sources);
    if (!sources.some((s) => normal(s.text).includes(normal(item.text))))
      throw Error("Question text must occur in the original material.");
    if (item.year && !sources.some((s) => s.text.includes(String(item.year))))
      item.year = null;
    item.topics = [...new Set(item.topics.map((t) => t.trim().toLowerCase()))];
  }
  return items;
}
export async function analyzeExam(
  o: Omit<
    Parameters<typeof extractStructured<ExamQuestion>>[0],
    "kind" | "schema" | "instructions" | "parse"
  >,
) {
  const result = await extractStructured({
    ...o,
    kind: "exam_analysis",
    schema: jsonSchema(examQuestionSchema),
    instructions: `${rules}\nExtract individual past-exam questions verbatim, including MCQ options in text. Never answer them. Keep each question within an actual supplied passage; if it is cut off, return only the complete visible question, not an invented continuation. Use an empty number if not printed. Broad topic labels may be inferred but no predictions. Year must be explicit in the text, otherwise null.`,
    parse: parseExamQuestions,
  });
  if (o.cancelled()) throw Error("Analysis cancelled.");
  const sources: Source[] = JSON.parse(result.sources_json),
    items: ExamQuestion[] = JSON.parse(result.payload_json).items;
  const unique = items.filter(
    (item, i) =>
      items.findIndex((q) => normal(q.text) === normal(item.text)) === i,
  );
  await batch([
    {
      sql: "UPDATE documents SET indexed_at=indexed_at WHERE id=? AND course_id=? AND status='Indexed' AND content_hash=? AND enabled=1",
      params: [o.fileId, o.courseId, sources[0]?.hash ?? ""],
      expectChanges: 1,
    },
    {
      sql: "DELETE FROM previous_exam_questions WHERE file_id=? AND course_id=?",
      params: [o.fileId, o.courseId],
    },
    ...unique.map((item, index) => ({
      sql: "INSERT INTO previous_exam_questions(id,result_id,file_id,course_id,number,text,type,year,topics_json,citations_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
      params: [
        crypto.randomUUID(),
        result.id,
        o.fileId,
        o.courseId,
        item.number || String(index + 1),
        item.text,
        item.type,
        item.year,
        JSON.stringify(item.topics),
        JSON.stringify(item.citations),
      ],
    })),
  ]);
  return result;
}
export interface StoredQuestion {
  id: string;
  result_id: string;
  file_id: string;
  course_id: string;
  number: string;
  text: string;
  type: string;
  year: number | null;
  topics_json: string;
  citations_json: string;
  filename: string;
  sources_json: string;
}
export function topicFrequency(questions: StoredQuestion[]) {
  const topics = new Map<
    string,
    { files: Set<string>; years: Set<number>; questions: number }
  >();
  for (const q of questions) {
    for (const topic of new Set<string>(JSON.parse(q.topics_json))) {
      const key = topic.trim().toLowerCase();
      const group = topics.get(key) ?? {
        files: new Set<string>(),
        years: new Set<number>(),
        questions: 0,
      };
      group.files.add(q.file_id);
      if (q.year) group.years.add(q.year);
      group.questions++;
      topics.set(key, group);
    }
  }
  return [...topics]
    .map(([topic, v]) => ({
      topic,
      exams: v.files.size,
      questions: v.questions,
      years: [...v.years].sort(),
    }))
    .sort((a, b) => b.exams - a.exams || a.topic.localeCompare(b.topic));
}
