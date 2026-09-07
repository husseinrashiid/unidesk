-- Additive provider metadata: provider is a legacy Microsoft-only CHECK column.
-- mail_provider is authoritative from version 12 onward; no account IDs/FKs change.
ALTER TABLE email_accounts ADD COLUMN mail_provider TEXT NOT NULL DEFAULT 'microsoft' CHECK(mail_provider IN ('microsoft','gmail'));
ALTER TABLE emails ADD COLUMN envelope_sender_email TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN envelope_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN original_sent_at TEXT;
ALTER TABLE emails ADD COLUMN forwarded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN original_message_key TEXT;
CREATE INDEX emails_original_key ON emails(account_id,original_message_key);
INSERT OR IGNORE INTO settings VALUES('email_provider','gmail'),('gmail_client_id','');
