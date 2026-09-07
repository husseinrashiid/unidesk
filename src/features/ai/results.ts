import { batch, query } from "../../services/platform";
import type { Statement } from "../../types";
import type { Source } from "./retrieval";
export interface AIResult {
  id: string;
  course_id: string;
  exam_id: string | null;
  conversation_id: string | null;
  kind: string;
  title: string;
  model: string;
  cache_key: string;
  payload_json: string;
  sources_json: string;
  stale: number;
  created_at: string;
}
export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function resultStatements(
  result: Omit<AIResult, "created_at" | "stale">,
  sources: Source[],
): Statement[] {
  const statements: Statement[] = [];
  for (const s of sources.filter(
    (s, i, a) =>
      s.documentId && a.findIndex((t) => t.documentId === s.documentId) === i,
  )) {
    statements.push({
      sql: "UPDATE documents SET indexed_at=indexed_at WHERE id=? AND content_hash=? AND status='Indexed' AND enabled=1 AND course_id=?",
      params: [s.documentId, s.hash, result.course_id],
      expectChanges: 1,
    });
  }
  for (const s of sources.filter((s) => s.emailId)) {
    statements.push({
      sql: "UPDATE emails SET id=id WHERE id=? AND course_id=? AND coalesce(body_text,snippet)=?",
      params: [s.emailId, result.course_id, s.hash],
      expectChanges: 1,
    });
  }
  statements.push({
    sql: "INSERT INTO document_ai_results(id,course_id,exam_id,conversation_id,kind,title,model,cache_key,payload_json,sources_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
    params: [
      result.id,
      result.course_id,
      result.exam_id,
      result.conversation_id,
      result.kind,
      result.title,
      result.model,
      result.cache_key,
      result.payload_json,
      result.sources_json,
    ],
  });
  for (const s of sources.filter(
    (s, i, a) =>
      s.documentId && a.findIndex((t) => t.documentId === s.documentId) === i,
  ))
    statements.push({
      sql: "INSERT INTO ai_result_sources(result_id,document_id,content_hash) VALUES(?,?,?)",
      params: [result.id, s.documentId, s.hash],
    });
  for (const s of sources.filter((s) => s.emailId)) {
    statements.push({
      sql: "INSERT INTO ai_result_emails(result_id,email_id) VALUES(?,?)",
      params: [result.id, s.emailId],
    });
  }
  return statements;
}
export async function saveResult(
  result: Omit<AIResult, "created_at" | "stale">,
  sources: Source[],
) {
  await batch(resultStatements(result, sources));
  return (
    await query<AIResult>("SELECT * FROM document_ai_results WHERE id=?", [
      result.id,
    ])
  )[0];
}
