import { command } from "../../services/platform";
import type { Extraction, ExtractedFile } from "./types";
export interface ExtractedDocument {
  segments?: Extraction["segments"];
  filename: string;
  text: string;
  hash: string;
  path: string;
  fileId?: string;
}
export function normalizeDocumentText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\t]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[–—−]/g, "-")
    .split("\n")
    .map((l) => l.replace(/ +/g, " ").trim())
    .filter((l) => !/^Page \d+(?: of \d+)?$/i.test(l))
    .join("\n");
}
export async function extractLocalDocument(
  file: File | string,
): Promise<ExtractedDocument> {
  const filename =
    typeof file === "string" ? file.split(/[\\/]/).at(-1)! : file.name;
  if (!/\.(pdf|docx|txt)$/i.test(filename))
    throw Error("Choose a PDF, DOCX or plain text file.");
  if (typeof file !== "string" && file.size > 30_000_000)
    throw Error("Choose a document smaller than 30 MB.");
  const result = await command<Extraction>(
    "document_preview",
    typeof file === "string"
      ? { source: file }
      : {
          filename,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        },
  );
  return {
    filename,
    segments: result.segments,
    text: normalizeDocumentText(result.segments.map((s) => s.text).join("\n")),
    hash: result.content_hash,
    path: typeof file === "string" ? file : "",
  };
}
export async function extractCourseDocument(
  fileId: string,
  filename: string,
): Promise<ExtractedDocument> {
  const r = await command<ExtractedFile>("document_extract", { fileId });
  return {
    filename,
    fileId,
    segments: r.extraction.segments,
    text: normalizeDocumentText(
      r.extraction.segments.map((s) => s.text).join("\n"),
    ),
    hash: r.extraction.content_hash,
    path: "",
  };
}
