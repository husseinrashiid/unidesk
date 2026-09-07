CREATE TABLE exam_email_sources(exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,PRIMARY KEY(exam_id,email_id));
CREATE TABLE ai_result_emails(result_id TEXT NOT NULL REFERENCES document_ai_results(id) ON DELETE CASCADE,email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,PRIMARY KEY(result_id,email_id));
CREATE TRIGGER ai_email_changed AFTER UPDATE OF body_text,snippet,course_id ON emails BEGIN UPDATE document_ai_results SET stale=1 WHERE id IN(SELECT result_id FROM ai_result_emails WHERE email_id=NEW.id); END;
CREATE TRIGGER ai_email_removed BEFORE DELETE ON emails BEGIN UPDATE document_ai_results SET stale=1 WHERE id IN(SELECT result_id FROM ai_result_emails WHERE email_id=OLD.id); END;
