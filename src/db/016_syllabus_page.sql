CREATE TABLE course_syllabus (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
 description TEXT NOT NULL DEFAULT '', objectives TEXT NOT NULL DEFAULT '',
 source_file_id TEXT REFERENCES files(id) ON DELETE SET NULL, source_filename TEXT NOT NULL DEFAULT '',
 parser_version TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE course_syllabus_policy (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 category TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(course_id,category)
);
CREATE INDEX course_syllabus_policy_course ON course_syllabus_policy(course_id);
CREATE TABLE course_syllabus_material (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(course_id,title)
);
CREATE INDEX course_syllabus_material_course ON course_syllabus_material(course_id);
CREATE TABLE course_syllabus_office_hours (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 day_of_week INTEGER CHECK(day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
 start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX course_syllabus_office_hours_course ON course_syllabus_office_hours(course_id);
