import { query } from "../../services/platform";
import type { SqlValue } from "../../types";
import { sourceLocation, type MaterialResult } from "../documents/types";
export interface Source {
  label: string;
  id: string;
  documentId: string | null;
  fileId: string | null;
  emailId: string | null;
  courseId: string;
  hash: string;
  title: string;
  location: string;
  text: string;
}
export interface Scope {
  courseId: string;
  fileIds?: string[];
  category?: string;
  examId?: string;
  includeEmails?: boolean;
}
const stop = new Set(
  "what which when where how why does do did is are was were the a an of on in to for from with and or my me this that these those about explain compare summarize summary main argument arguments please course material materials lecture lectures reading readings document documents".split(
    " ",
  ),
);
export function termsOf(text: string) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (t) => t.length > 1 && !stop.has(t),
      ),
    ),
  ].slice(0, 18);
}
export function retrievalQuery(
  text: string,
  scope: Scope,
  limit: number,
  browse = false,
) {
  const terms = termsOf(text),
    clauses = ["d.status='Indexed'", "d.enabled=1", "d.course_id=?"],
    params: SqlValue[] = [scope.courseId];
  if (scope.category) {
    clauses.push("f.category=?");
    params.push(scope.category);
  }
  if (scope.fileIds) {
    if (!scope.fileIds.length) clauses.push("0");
    else {
      clauses.push(`f.id IN (${scope.fileIds.map(() => "?").join(",")})`);
      params.push(...scope.fileIds);
    }
  }
  if (scope.examId) {
    clauses.push(
      "EXISTS(SELECT 1 FROM attachments a JOIN exams e ON e.id=a.entity_id WHERE a.file_id=f.id AND a.entity_type='exam' AND a.entity_id=? AND e.course_id=d.course_id)",
    );
    params.push(scope.examId);
  }
  const search = terms.length && !browse;
  if (search) {
    clauses.push("document_chunks_fts MATCH ?");
    params.push(terms.map((t) => `"${t}"`).join(" OR "));
  } else if (!browse) clauses.push("0");
  return {
    sql: `SELECT c.*,d.file_id,d.content_hash,f.filename,f.category FROM ${search ? "document_chunks_fts JOIN document_chunks c ON c.rowid=document_chunks_fts.rowid" : "document_chunks c"} JOIN documents d ON d.id=c.document_id JOIN files f ON f.id=d.file_id WHERE ${clauses.join(" AND ")} ORDER BY ${search ? "bm25(document_chunks_fts)," : ""}c.chunk_index,f.filename LIMIT ?`,
    params: [...params, Math.max(1, Math.min(200, limit))],
  };
}
export async function retrieve(
  text: string,
  scope: Scope,
  max: number,
  browse = false,
): Promise<Source[]> {
  // Resolve explicit filenames / numbered lectures locally; the model never guesses source identity.
  const names = await query<{ file_id: string; filename: string }>(
    "SELECT d.file_id,f.filename FROM documents d JOIN files f ON f.id=d.file_id WHERE d.course_id=? AND d.status='Indexed' AND d.enabled=1",
    [scope.courseId],
  );
  const compact = (s: string) =>
    s
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  const requested = compact(text);
  const numbered = [
    ...text.matchAll(/(?:lecture|reading|chapter)\s*0*(\d+)/gi),
  ].map((m) => `${m[0].match(/[a-z]+/i)?.[0].toLowerCase()}${Number(m[1])}`);
  const named = names
    .filter((f) => {
      const stem = compact(f.filename);
      return (
        (stem.length > 4 && requested.includes(stem)) ||
        numbered.some((n) =>
          stem.replace(/(lecture|reading|chapter)0+(\d)/g, "$1$2").includes(n),
        )
      );
    })
    .map((f) => f.file_id);
  const effective =
    named.length && !scope.fileIds ? { ...scope, fileIds: named } : scope;
  const q = retrievalQuery(
    text,
    effective,
    max * 5,
    browse || named.length > 0,
  );
  const rows = await query<MaterialResult>(q.sql, q.params);
  const picked: MaterialResult[] = [];
  const counts = new Map<string, number>();
  // Keep multiple documents represented before filling remaining relevance slots.
  for (const cap of [2, max])
    for (const row of rows) {
      if (picked.length >= max) break;
      if (
        picked.some((p) => p.id === row.id) ||
        (counts.get(row.file_id) ?? 0) >= cap
      )
        continue;
      picked.push(row);
      counts.set(row.file_id, (counts.get(row.file_id) ?? 0) + 1);
    }
  const sources: Source[] = picked.map((r) => ({
    label: "",
    id: r.id,
    documentId: r.document_id,
    fileId: r.file_id,
    emailId: null,
    courseId: scope.courseId,
    hash: r.content_hash,
    title: r.filename,
    location: sourceLocation(r),
    text: r.text.slice(0, 3600),
  }));
  if (scope.examId) {
    const emails = await query<{
      id: string;
      subject: string;
      received_at: string;
      text: string;
    }>(
      "SELECT e.id,e.subject,e.received_at,coalesce(e.body_text,e.snippet) text FROM emails e JOIN exam_email_sources s ON s.email_id=e.id JOIN exams x ON x.id=s.exam_id WHERE x.id=? AND x.course_id=? AND e.course_id=x.course_id ORDER BY e.received_at DESC LIMIT 3",
      [scope.examId, scope.courseId],
    );
    for (const e of emails)
      sources.push({
        label: "",
        id: e.id,
        documentId: null,
        fileId: null,
        emailId: e.id,
        courseId: scope.courseId,
        hash: e.text,
        title: e.subject,
        location: `Selected exam email · ${e.received_at.slice(0, 10)}`,
        text: e.text.slice(0, 3000),
      });
  }
  if (scope.includeEmails && !scope.fileIds && !scope.examId) {
    const terms = termsOf(text).slice(0, 5);
    if (terms.length) {
      const emails = await query<{
        id: string;
        subject: string;
        received_at: string;
        text: string;
      }>(
        `SELECT id,subject,received_at,coalesce(body_text,snippet) text FROM emails WHERE course_id=? AND (${terms.map(() => "(lower(subject)||' '||lower(coalesce(body_text,snippet))) LIKE ? ESCAPE '\\'").join(" OR ")}) ORDER BY received_at DESC LIMIT 3`,
        [
          scope.courseId,
          ...terms.map((t) => `%${t.replace(/[%_\\]/g, "\\$&")}%`),
        ],
      );
      for (const e of emails) {
        sources.push({
          label: "",
          id: e.id,
          documentId: null,
          fileId: null,
          emailId: e.id,
          courseId: scope.courseId,
          hash: e.text,
          title: e.subject,
          location: `Professor/course email · ${e.received_at.slice(0, 10)}`,
          text: e.text.slice(0, 3000),
        });
      }
    }
  }
  const emailSources = sources
    .filter((s) => s.emailId)
    .slice(0, Math.min(3, max));
  return [
    ...sources.filter((s) => !s.emailId).slice(0, max - emailSources.length),
    ...emailSources,
  ].map((s, i) => ({ ...s, label: `SOURCE_${i + 1}` }));
}
