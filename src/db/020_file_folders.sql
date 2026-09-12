CREATE TABLE file_folders (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(course_id, category, name)
);
CREATE INDEX file_folders_course ON file_folders(course_id, category);
ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES file_folders(id) ON DELETE SET NULL;
CREATE INDEX files_folder ON files(folder_id);
