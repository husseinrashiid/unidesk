import { gmailProvider, gmailAuthentication } from "./gmailProvider";
import type { NormalizedMail } from "./normalization";
import { command } from "../../services/platform";
import type { ImportResult } from "../../services/platform";
import type { EmailAccount } from "./types";

export interface DeviceSignIn {
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
}
export interface SignInResult {
  connected?: boolean;
  pending?: boolean;
  interval?: number;
  accountId?: string;
  emailAddress?: string;
}
export const MICROSOFT_APPROVAL_MESSAGE =
  "Your university requires administrator approval for direct Microsoft 365 mailbox access. You can instead forward your university emails to Gmail and connect that mailbox to UniDesk.";
export function validateMicrosoftClientId(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id.trim(),
    ) ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id.trim())
  )
    throw Object.assign(
      new Error(
        "Enter the Application (client) ID from Microsoft Entra in UUID format.",
      ),
      { code: "invalid_client_id", timestamp: new Date().toISOString() },
    );
}
export function microsoftErrorDetails(error: unknown) {
  const e = error as Error & {
    code?: string;
    timestamp?: string;
    correlation_id?: string;
    http_status?: number;
  };
  return `Timestamp: ${e.timestamp ?? new Date().toISOString()}\nError code: ${e.code ?? "local_operation"}\nDescription: ${e.message}\nAuthority: organizations\nHTTP status: ${e.http_status ?? "Not available"}\nCorrelation ID: ${e.correlation_id ?? "Not available"}`;
}
// Authentication and platform calls stay behind the Microsoft provider boundary.
export const microsoftAuthentication = {
  begin(clientId: string) {
    validateMicrosoftClientId(clientId);
    return command<DeviceSignIn>("email_auth", {
      action: "begin",
      clientId: clientId.trim(),
    });
  },
  poll: (sessionId: string) =>
    command<SignInResult>("email_auth", { action: "poll", sessionId }),
  cancel: (sessionId?: string) =>
    command("email_auth", { action: "cancel", sessionId: sessionId ?? null }),
  open: () => command("email_auth", { action: "open" }),
  diagnostics: () =>
    command<{ details: string }>("email_auth", { action: "diagnostics" }),
  disconnect: (accountId: string) =>
    command("email_request", { accountId, operation: "disconnect" }),
};

export interface MailMessage {
  id: string;
  bodyText?: string;
  originalKey?: string;
  normalized?: NormalizedMail;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  "@removed"?: unknown;
}
export interface MailPage {
  value: MailMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}
export interface MailProvider {
  initialCursor(since: string): string;
  page(account: EmailAccount, cursor: string): Promise<MailPage>;
  body(account: EmailAccount, messageId: string): Promise<string>;
  attachments(
    account: EmailAccount,
    messageId: string,
  ): Promise<{ value: ProviderAttachment[]; next?: string }>;
  saveAttachment(
    id: string,
    courseId: string,
    category: string,
    conflict?: string,
  ): Promise<ImportResult>;
}
export interface ProviderAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline?: boolean;
  "@odata.type"?: string;
}
export const microsoftProvider: MailProvider = {
  async attachments(account, messageId) {
    const value = await command<{
      value: ProviderAttachment[];
      "@odata.nextLink"?: string;
    }>("email_request", {
      accountId: account.id,
      operation: "attachments",
      value: messageId,
    });
    return { value: value.value, next: value["@odata.nextLink"] };
  },
  saveAttachment: (id, courseId, category, conflict) =>
    command("email_save_attachment", {
      attachmentId: id,
      courseId,
      category,
      conflict: conflict ?? null,
    }),
  initialCursor(since) {
    const url = new URL(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta",
    );
    url.searchParams.set("$filter", `receivedDateTime ge ${since}`);
    url.searchParams.set(
      "$select",
      "id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,webLink",
    );
    url.searchParams.set("$top", "50");
    return url.toString();
  },
  page: (account, cursor) =>
    command("email_request", {
      accountId: account.id,
      operation: "page",
      value: cursor,
    }),
  async body(account, messageId) {
    const data = await command<{
      uniqueBody?: { contentType: string; content: string };
      body?: { contentType: string; content: string };
    }>("email_request", {
      accountId: account.id,
      operation: "body",
      value: messageId,
    });
    const body = data.uniqueBody ?? data.body;
    if (!body || body.contentType.toLowerCase() !== "text")
      throw Error(
        "Microsoft did not return a safe text body. Open the message in Outlook.",
      );
    return body.content.slice(0, 500_000);
  },
};

export function providerFor(account?: EmailAccount): MailProvider {
  return account?.mail_provider === "gmail" ? gmailProvider : microsoftProvider;
}
export function disconnectMailbox(account: EmailAccount) {
  return account.mail_provider === "gmail"
    ? gmailAuthentication.disconnect(account.id)
    : microsoftAuthentication.disconnect(account.id);
}
export function openMailboxMessage(account: EmailAccount, value: string) {
  return command(
    account.mail_provider === "gmail" ? "gmail_request" : "email_request",
    { accountId: account.id, operation: "open", value },
  );
}

export const saveEmailAttachment = microsoftProvider.saveAttachment; // Native importer dispatches by account provider.
