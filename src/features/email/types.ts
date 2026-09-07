export type Confidence = "High" | "Medium" | "Low";
export interface EmailAccount {
  id: string;
  provider: "microsoft"; // Legacy schema discriminator; mail_provider is authoritative.
  mail_provider?: "microsoft" | "gmail";
  email_address: string;
  display_name: string;
  client_id: string;
  connected: number;
  last_sync_at: string | null;
  sync_cursor: string | null;
  sync_error?: string;
  retry_after?: string | null;
}
export interface Email {
  id: string;
  account_id: string;
  provider_message_id: string;
  provider_thread_id: string;
  sender_email: string;
  sender_name: string;
  subject: string;
  snippet: string;
  body_text: string | null;
  original_sent_at?: string | null;
  forwarded_by?: string;
  envelope_sender_email?: string;
  envelope_subject?: string;
  received_at: string;
  is_read: number;
  course_id: string | null;
  course_manual: number;
  importance: string;
  academic_type: string;
  confidence: Confidence;
  explanation: string;
  requires_review: number;
  archived: number;
  pinned: number;
  has_attachments: number;
  web_url: string;
}
export interface SenderMatch {
  sender_email: string;
  course_id: string;
}
export interface EmailAction {
  id: string;
  email_id: string;
  action_type: string;
  course_id: string | null;
  entity_type: "exam" | "assignment" | "event" | "grade" | "schedule";
  entity_id: string | null;
  payload_json: string;
  confidence: Confidence;
  status: "Pending" | "Applied" | "Ignored" | "Superseded";
}
export interface ActionPayload {
  proposed: Record<string, string>;
  expected: Record<string, string>;
  explanation: string;
}
export interface ScheduleException {
  source_email_id?: string | null;
  id: string;
  course_id: string;
  date: string;
  exception_type: string;
  original_start_time: string;
  original_end_time: string;
  new_date: string;
  new_start_time: string;
  new_end_time: string;
  room: string;
  reason: string;
}
