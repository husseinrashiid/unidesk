import { z } from "zod";
import { newestText } from "./analysis";

const headerSchema = z.object({ name: z.string(), value: z.string() });
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z
      .object({
        size: z.number().nonnegative().optional(),
        data: z.string().max(40_000_000).optional(),
        attachmentId: z.string().optional(),
      })
      .optional(),
    parts: z.array(partSchema).max(300).optional(),
  }),
);
export const gmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().optional(),
  internalDate: z.string().regex(/^\d+$/),
  snippet: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  payload: partSchema,
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;
export function decodeData(data: string, charset = "utf-8") {
  const raw = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
/** Email HTML is reduced to inert text. It is never inserted into a DOM as HTML. */
export function htmlText(html: string) {
  return html
    .slice(0, 1_000_000)
    .replace(
      /<(script|style|iframe|form|object|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi,
      (m) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
        })[m.toLowerCase()] ?? m,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\r/g, "");
}
export function partsOf(part: GmailPart): GmailPart[] {
  const result: GmailPart[] = [];
  function walk(p: GmailPart, depth: number) {
    if (depth > 30 || result.length >= 500)
      throw Error("This email has too many MIME parts. Open it in Gmail.");
    result.push(p);
    for (const child of p.parts ?? []) walk(child, depth + 1);
  }
  walk(part, 0);
  return result;
}
export function mimeText(part: GmailPart) {
  const parts = partsOf(part).filter((p) => !p.filename);
  const read = (p: GmailPart) =>
    decodeData(
      p.body?.data ?? "",
      p.headers
        ?.find((h) => h.name.toLowerCase() === "content-type")
        ?.value.match(/charset=["']?([^\s;"']+)/i)?.[1],
    );
  const plain = parts
    .filter((p) => p.mimeType === "text/plain" && p.body?.data)
    .map(read)
    .join("\n");
  return (
    plain ||
    parts
      .filter((p) => p.mimeType === "text/html" && p.body?.data)
      .map((p) => htmlText(read(p)))
      .join("\n")
  ).slice(0, 500_000);
}
export function decodeHeader(value: string) {
  return value.replace(
    /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,
    (_, charset: string, kind: string, encoded: string) => {
      try {
        if (kind.toUpperCase() === "B") return decodeData(encoded, charset);
        const bytes = Uint8Array.from(
          encoded
            .replace(/_/g, " ")
            .replace(/=([A-F0-9]{2})/gi, (_, hex: string) =>
              String.fromCharCode(parseInt(hex, 16)),
            ),
          (c) => c.charCodeAt(0),
        );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return "";
      }
    },
  );
}
export function address(value: string) {
  value = decodeHeader(value);
  const email =
    value
      .match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      ?.toLowerCase() ?? "";
  return {
    email,
    name: value
      .replace(/<[^>]*>/g, "")
      .replace(email, "")
      .replace(/^[\s"']+|[\s"']+$/g, "")
      .trim(),
  };
}
export interface NormalizedMail {
  sender: string;
  name: string;
  subject: string;
  body: string;
  originalSentAt: string | null;
  forwardedBy: string;
  envelopeSender: string;
  envelopeSubject: string;
}
export function normalizeForward(
  subject: string,
  body: string,
  from: string,
): NormalizedMail {
  const outer = address(from);
  const result: NormalizedMail = {
    sender: outer.email,
    name: outer.name,
    subject,
    body: newestText(body),
    originalSentAt: null,
    forwardedBy: "",
    envelopeSender: outer.email,
    envelopeSubject: subject,
  };
  // A reply saying "Thanks" must not revive an older academic action.
  if (/^\s*re\s*:/i.test(subject)) return result;
  const lines = body.replace(/\r/g, "").split("\n");
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const fromLine = lines[i].match(/^\s*(?:>\s*)?From:\s*(.+)/i);
    if (!fromLine) continue;
    const headers: Record<string, string> = { from: fromLine[1] };
    let j = i + 1;
    for (; j < Math.min(lines.length, i + 18); j++) {
      const line = lines[j].replace(/^\s*>\s?/, "");
      const h = line.match(/^\s*(Sent|Date|To|Cc|Subject):\s*(.*)/i);
      if (h) {
        headers[h[1].toLowerCase()] = h[2];
        continue;
      }
      if (!line.trim()) continue;
      break;
    }
    const original = address(headers.from);
    if (!original.email || !headers.subject || !(headers.sent || headers.date))
      continue;
    const prefix = lines.slice(0, i).join("\n");
    if (
      !/^\s*(?:fw|fwd)\s*:/i.test(subject) &&
      !/(?:forwarded message|begin forwarded|original message)/i.test(prefix) &&
      prefix.trim()
    )
      continue;
    const date = headers.date ?? headers.sent;
    const parsed = /^\s*\d{1,2}\/\d{1,2}\//.test(date) ? NaN : Date.parse(date);
    result.sender = original.email;
    result.name = original.name;
    result.subject = headers.subject;
    result.originalSentAt = Number.isFinite(parsed)
      ? new Date(parsed).toISOString()
      : null;
    result.forwardedBy = outer.email;
    result.body = newestText(
      lines
        .slice(j)
        .map((l) => l.replace(/^\s*>\s?/, ""))
        .join("\n"),
    );
    break;
  }
  result.body = result.body
    .split(
      /\n\s*(?:Confidentiality notice|This (?:email|message) (?:and|is)|Unsubscribe\b|Office hours\s*:)/i,
    )[0]
    .trim();
  return result;
}
