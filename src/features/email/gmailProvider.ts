import { z } from "zod";
import { command } from "../../services/platform";
import type { EmailAccount } from "./types";
import type {
  MailProvider,
  MailMessage,
  MailPage,
  ProviderAttachment,
} from "./provider";
import {
  gmailMessageSchema,
  mimeText,
  normalizeForward,
  partsOf,
  decodeHeader,
  type GmailMessage,
} from "./normalization";
const rpc = <T>(account: EmailAccount, operation: string, value?: string) =>
  command<T>("gmail_request", {
    accountId: account.id,
    operation,
    value: value ?? null,
  });
export const gmailAuthentication = {
  begin: (clientId: string, clientSecret?: string) =>
    command<{ sessionId: string }>("gmail_auth", {
      action: "begin",
      clientId: clientId.trim(),
      clientSecret: clientSecret?.trim() || null,
    }),
  status: (sessionId: string) =>
    command<{
      pending?: boolean;
      connected?: boolean;
      accountId?: string;
      emailAddress?: string;
    }>("gmail_auth", { action: "status", sessionId }),
  cancel: (sessionId: string) =>
    command("gmail_auth", { action: "cancel", sessionId }),
  disconnect: (accountId: string) =>
    command("gmail_request", { accountId, operation: "disconnect" }),
};
const cursorSchema = z.object({
  kind: z.enum(["initial", "history"]),
  query: z.string(),
  history: z.string().optional(),
  page: z.string().optional(),
  pending: z.array(z.string()).optional(),
  next: z.string().optional(),
  final: z.string().optional(),
});
const listSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).optional(),
  nextPageToken: z.string().optional(),
});
const historySchema = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: z.string() }) }))
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string(),
});
async function message(account: EmailAccount, id: string) {
  const m = gmailMessageSchema.parse(
    await rpc<unknown>(account, "message", id),
  );
  // Gmail FULL already decodes MIME transfer encodings; data is base64url.
  for (const p of partsOf(m.payload)) {
    if (
      !p.filename &&
      ["text/plain", "text/html"].includes(p.mimeType ?? "") &&
      !p.body?.data &&
      p.body?.attachmentId &&
      (p.body.size ?? 0) <= 500_000
    ) {
      const data = z
        .object({ data: z.string() })
        .parse(
          await rpc(
            account,
            "attachment",
            JSON.stringify({ message: id, attachment: p.body.attachmentId }),
          ),
        );
      p.body.data = data.data;
    }
  }
  return m;
}
export function convertGmail(m: GmailMessage): MailMessage {
  const header = (key: string) =>
    decodeHeader(
      m.payload.headers?.find((h) => h.name.toLowerCase() === key)?.value ?? "",
    );
  const normalized = normalizeForward(
    header("subject"),
    mimeText(m.payload),
    header("from"),
  );
  if (!normalized.forwardedBy) {
    const date = Date.parse(header("date"));
    if (Number.isFinite(date))
      normalized.originalSentAt = new Date(date).toISOString();
  }
  const received = new Date(Number(m.internalDate));
  if (!Number.isFinite(received.getTime()))
    throw Error("Gmail returned an invalid message timestamp.");
  return {
    id: m.id,
    conversationId: m.threadId,
    subject: normalized.subject,
    bodyPreview: normalized.body.slice(0, 2000),
    bodyText: normalized.body,
    from: {
      emailAddress: { address: normalized.sender, name: normalized.name },
    },
    receivedDateTime: received.toISOString(),
    isRead: false,
    hasAttachments: partsOf(m.payload).some((p) => !!p.filename),
    webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent("")}#all/${encodeURIComponent(m.threadId ?? m.id)}`,
    normalized,
  };
}
const rawGmailProvider: MailProvider = {
  initialCursor: (since) =>
    JSON.stringify({
      kind: "initial",
      query: `after:${Math.floor(Date.parse(since) / 1000)} -in:spam -in:trash`,
    }),
  async page(account, cursor): Promise<MailPage> {
    let c = cursorSchema.parse(JSON.parse(cursor));
    let ids = c.pending ?? [];
    let next = c.next;
    let final = c.final;
    if (!c.pending) {
      if (c.kind === "initial") {
        if (!c.history)
          c.history = z
            .object({ historyId: z.string() })
            .parse(await rpc(account, "profile")).historyId;
        const page = listSchema.parse(
          await rpc(
            account,
            "list",
            JSON.stringify({ query: c.query, page: c.page }),
          ),
        );
        ids = (page.messages ?? []).map((m) => m.id);
        next = page.nextPageToken;
        final = c.history;
      } else {
        try {
          const page = historySchema.parse(
            await rpc(
              account,
              "history",
              JSON.stringify({ history: c.history, page: c.page }),
            ),
          );
          ids = [
            ...new Set(
              (page.history ?? []).flatMap((h) =>
                (h.messagesAdded ?? []).map((m) => m.message.id),
              ),
            ),
          ];
          next = page.nextPageToken;
          final = page.historyId;
        } catch (e) {
          if ((e as Error & { code?: string }).code !== "404") throw e;
          return gmailProvider.page(
            account,
            JSON.stringify({ kind: "initial", query: c.query }),
          );
        }
      }
    }
    const value: MailMessage[] = [];
    for (const id of ids.slice(0, 25)) {
      try {
        const full=await message(account,id);if(full.labelIds?.some(label=>["SPAM","TRASH","SENT","DRAFT"].includes(label)))continue;const item = convertGmail(full);
        item.webLink = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email_address)}#all/${encodeURIComponent(item.conversationId ?? id)}`;
        if (
          item.normalized?.forwardedBy &&
          item.normalized.originalSentAt &&
          item.bodyText &&
          !item.hasAttachments
        ) {
          const material = JSON.stringify([
            item.from?.emailAddress?.address,
            item.subject,
            item.normalized.originalSentAt,
            item.bodyText,
            item.hasAttachments,
          ]);
          item.originalKey = Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(material),
              ),
            ),
          )
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
        value.push(item);
      } catch (e) {
        if ((e as Error & { code?: string }).code !== "404") throw e;
      }
    }
    const remaining = ids.slice(25);
    if (remaining.length)
      return {
        value,
        "@odata.nextLink": JSON.stringify({
          ...c,
          pending: remaining,
          next,
          final,
        }),
      };
    if (next)
      return {
        value,
        "@odata.nextLink": JSON.stringify({
          kind: c.kind,
          query: c.query,
          history: c.history,
          page: next,
        }),
      };
    return {
      value,
      "@odata.deltaLink": JSON.stringify({
        kind: "history",
        query: c.query,
        history: final ?? c.history,
      }),
    };
  },
  async body(account, id) {
    return convertGmail(await message(account, id)).bodyText ?? "";
  },
  async attachments(account, id) {
    const m = await message(account, id);
    const value: ProviderAttachment[] = partsOf(m.payload)
      .filter((p) => p.filename && (p.body?.attachmentId || p.body?.data))
      .map((p) => ({
        id: p.body!.attachmentId ?? `inline:${p.partId ?? ""}`,
        name: p.filename!,
        contentType: p.mimeType ?? "",
        size: p.body?.size ?? 0,
        "@odata.type": "fileAttachment",
      }));
    return { value };
  },
  saveAttachment: (id, courseId, category, conflict) =>
    command("email_save_attachment", {
      attachmentId: id,
      courseId,
      category,
      conflict: conflict ?? null,
    }),
};

async function friendly<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(e){if(e instanceof z.ZodError||e instanceof SyntaxError)throw Error('Gmail returned incomplete message data. Retry sync; your cached mail is preserved.');throw e;}}
export const gmailProvider:MailProvider={...rawGmailProvider,page:(a,c)=>friendly(()=>rawGmailProvider.page(a,c)),body:(a,id)=>friendly(()=>rawGmailProvider.body(a,id)),attachments:(a,id)=>friendly(()=>rawGmailProvider.attachments(a,id))};
