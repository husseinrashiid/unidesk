-- Read-only mailbox cache. Credentials are never stored in this database.
CREATE TABLE email_accounts (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider='microsoft'),
 email_address TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL,
 connected INTEGER NOT NULL DEFAULT 0, last_sync_at TEXT, sync_cursor TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE professors (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE course_professors (course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, professor_id TEXT NOT NULL REFERENCES professors(id) ON DELETE CASCADE, PRIMARY KEY(course_id,professor_id));
CREATE TABLE email_sender_rules (sender_email TEXT NOT NULL COLLATE NOCASE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, PRIMARY KEY(sender_email,course_id));
CREATE TABLE emails (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
 provider_message_id TEXT NOT NULL, provider_thread_id TEXT NOT NULL DEFAULT '',
 sender_name TEXT NOT NULL DEFAULT '', sender_email TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
 snippet TEXT NOT NULL DEFAULT '', body_text TEXT, received_at TEXT NOT NULL,
 is_read INTEGER NOT NULL DEFAULT 0, folder TEXT NOT NULL DEFAULT 'Inbox',
 course_id TEXT REFERENCES courses(id) ON DELETE SET NULL, course_manual INTEGER NOT NULL DEFAULT 0,
 importance TEXT NOT NULL DEFAULT 'Normal', academic_type TEXT NOT NULL DEFAULT 'Unknown',
 confidence TEXT NOT NULL DEFAULT 'Low', explanation TEXT NOT NULL DEFAULT '', requires_review INTEGER NOT NULL DEFAULT 0,
 archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, has_attachments INTEGER NOT NULL DEFAULT 0,
 web_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(account_id,provider_message_id)
);
CREATE INDEX emails_feed ON emails(archived,received_at DESC,id);
CREATE INDEX emails_course ON emails(course_id,received_at DESC);
CREATE INDEX emails_attention ON emails(requires_review,importance,received_at DESC);
CREATE TABLE email_attachments (id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE, provider_attachment_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, downloaded INTEGER NOT NULL DEFAULT 0, local_path TEXT, UNIQUE(email_id,provider_attachment_id));
CREATE TABLE email_detected_actions (
 id TEXT PRIMARY KEY, email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
 action_type TEXT NOT NULL, course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
 entity_type TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL,
 confidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Applied','Ignored','Superseded')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT,
 UNIQUE(email_id,action_type)
);
CREATE INDEX email_actions_pending ON email_detected_actions(status,email_id);
CREATE TABLE academic_change_log (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, field_name TEXT NOT NULL,
 old_value TEXT, new_value TEXT, source_type TEXT NOT NULL DEFAULT 'email',
 source_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
 source_sender TEXT NOT NULL, source_subject TEXT NOT NULL, source_received_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX academic_change_entity ON academic_change_log(entity_type,entity_id,created_at DESC);
CREATE TABLE course_schedule_exceptions (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 date TEXT NOT NULL, exception_type TEXT NOT NULL CHECK(exception_type IN ('Cancelled','Rescheduled','Room changed','Time changed')),
 original_start_time TEXT NOT NULL DEFAULT '', original_end_time TEXT NOT NULL DEFAULT '',
 new_date TEXT NOT NULL DEFAULT '', new_start_time TEXT NOT NULL DEFAULT '', new_end_time TEXT NOT NULL DEFAULT '',
 room TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', source_email_id TEXT REFERENCES emails(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX schedule_exceptions_course_date ON course_schedule_exceptions(course_id,date);
CREATE VIRTUAL TABLE emails_fts USING fts5(subject,sender_email,body_text,content='emails',content_rowid='rowid',tokenize='unicode61');
CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN INSERT INTO emails_fts(rowid,subject,sender_email,body_text) VALUES(new.rowid,new.subject,new.sender_email,new.body_text); END;
CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN INSERT INTO emails_fts(emails_fts,rowid,subject,sender_email,body_text) VALUES('delete',old.rowid,old.subject,old.sender_email,old.body_text); END;
CREATE TRIGGER emails_fts_update AFTER UPDATE OF subject,sender_email,body_text ON emails BEGIN INSERT INTO emails_fts(emails_fts,rowid,subject,sender_email,body_text) VALUES('delete',old.rowid,old.subject,old.sender_email,old.body_text); INSERT INTO emails_fts(rowid,subject,sender_email,body_text) VALUES(new.rowid,new.subject,new.sender_email,new.body_text); END;
CREATE TRIGGER emails_notification_cleanup AFTER DELETE ON emails BEGIN DELETE FROM notifications WHERE type='email' AND entity_id=old.id; END;
INSERT OR IGNORE INTO settings VALUES ('email_sync_minutes','10');
