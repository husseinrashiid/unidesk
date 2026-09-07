import { query } from "../../services/platform";
import { sourceLocation, type MaterialResult } from "../documents/types";
import { modelFor, openAIProvider, type AIProvider } from "./provider";
import { digest, saveResult, type AIResult } from "./results";
import type { Source } from "./retrieval";
export async function extractStructured<T>(
  o: {
    kind: string;
    courseId: string;
    fileId: string;
    settings: Record<string, string>;
    requestId: string;
    schema: Record<string, unknown>;
    instructions: string;
    parse: (raw: unknown, sources: Source[]) => T[];
    cancelled: () => boolean;
    progress: (done: number, total: number) => void;
    regenerate?: boolean;
  },
  provider: AIProvider = openAIProvider,
) {
  const rows = await query<MaterialResult>(
    "SELECT c.*,d.file_id,d.content_hash,f.filename,f.category FROM document_chunks c JOIN documents d ON d.id=c.document_id JOIN files f ON f.id=d.file_id WHERE d.course_id=? AND d.file_id=? AND d.status='Indexed' AND d.enabled=1 ORDER BY c.chunk_index LIMIT 201",
    [o.courseId, o.fileId],
  );
  if (!rows.length)
    throw Error(
      "This file has no current indexed text. Wait for indexing or check its status in Materials.",
    );
  if (rows.length > 200)
    throw Error(
      "This document is too large for complete structured extraction. Import a shorter document containing the relevant syllabus or exam pages.",
    );
  const sources: Source[] = rows.map((r, i) => ({
    label: `SOURCE_${i + 1}`,
    id: r.id,
    documentId: r.document_id,
    fileId: r.file_id,
    emailId: null,
    courseId: o.courseId,
    hash: r.content_hash,
    title: r.filename,
    location: sourceLocation(r),
    text: r.text,
  }));
  const model = modelFor(o.settings, "fast");
  const cacheKey = await digest({
    version: 1,
    kind: o.kind,
    file: o.fileId,
    hash: rows[0].content_hash,
    model,
  });
  if (!o.regenerate) {
    const existing = await query<AIResult>(
      "SELECT * FROM document_ai_results WHERE cache_key=? AND stale=0 ORDER BY created_at DESC LIMIT 1",
      [cacheKey],
    );
    if (existing.length) return existing[0];
  }
  if (o.settings.ai_enabled !== "true")
    throw Error(
      "Enable Cloud AI in Settings → AI. Local indexed text remains available.",
    );
  const items: T[] = [];
  const size = 8,
    total = Math.ceil(sources.length / size);
  for (let start = 0; start < sources.length; start += size) {
    if (o.cancelled()) throw Error("Extraction cancelled.");
    o.progress(Math.floor(start / size), total);
    const batch = sources.slice(start, start + size);
    const response = await provider.generate({
      requestId: o.requestId,
      model,
      instructions: o.instructions,
      input: JSON.stringify({
        sources: batch.map((s) => ({
          id: s.label,
          title: s.title,
          text: s.text,
        })),
      }),
      schema: o.schema,
    });
    if (o.cancelled()) throw Error("Extraction cancelled.");
    let parsed: T[];
    try {
      parsed = o.parse(JSON.parse(response.text), batch);
    } catch {
      throw Error(
        "AI returned invalid extraction or unsupported citations. No academic records were changed.",
      );
    }
    items.push(...parsed);
    if (items.length > 500)
      throw Error("Too many detected items. Use a smaller source document.");
  }
  o.progress(total, total);
  return saveResult(
    {
      id: crypto.randomUUID(),
      course_id: o.courseId,
      exam_id: null,
      conversation_id: null,
      kind: o.kind,
      title: rows[0].filename,
      model,
      cache_key: cacheKey,
      payload_json: JSON.stringify({ items }),
      sources_json: JSON.stringify(sources),
    },
    sources,
  );
}
