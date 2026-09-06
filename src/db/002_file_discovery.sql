CREATE TABLE ignored_files (
  absolute_path TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX ignored_files_course ON ignored_files(course_id);
CREATE TRIGGER IF NOT EXISTS exams_cleanup AFTER DELETE ON exams BEGIN DELETE FROM attachments WHERE entity_id=OLD.id AND entity_type='exam'; DELETE FROM notifications WHERE entity_id=OLD.id AND type='exam'; END;
CREATE TRIGGER IF NOT EXISTS assignments_cleanup AFTER DELETE ON assignments BEGIN DELETE FROM attachments WHERE entity_id=OLD.id AND entity_type='assignment'; DELETE FROM notifications WHERE entity_id=OLD.id AND type='assignment'; END;
