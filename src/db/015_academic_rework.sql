ALTER TABLE degree_prerequisites ADD COLUMN minimum_grade TEXT NOT NULL DEFAULT '';
CREATE TABLE degree_import_snapshots (
 source_id TEXT PRIMARY KEY REFERENCES local_import_sources(id) ON DELETE CASCADE,
 before_json TEXT,
 after_json TEXT NOT NULL
);
