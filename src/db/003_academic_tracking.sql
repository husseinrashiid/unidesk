CREATE TABLE lectures (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, number INTEGER, title TEXT NOT NULL, lecture_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Not reviewed' CHECK(status IN ('Not reviewed','In progress','Reviewed')), reviewed_at TEXT, confidence TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', estimated_minutes REAL CHECK(estimated_minutes>0), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX lectures_course ON lectures(course_id);

CREATE TABLE readings (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', assigned_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Not started' CHECK(status IN ('Not started','Reading','Completed')), file_id TEXT REFERENCES files(id) ON DELETE SET NULL, external_reference TEXT NOT NULL DEFAULT '', pages INTEGER CHECK(pages>0), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX readings_course ON readings(course_id);

CREATE TABLE grade_categories (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, name TEXT NOT NULL, weight REAL NOT NULL CHECK(weight>=0 AND weight<=100), sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX grade_categories_course ON grade_categories(course_id);

CREATE TABLE grade_items (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, category_id TEXT NOT NULL REFERENCES grade_categories(id) ON DELETE CASCADE, assignment_id TEXT UNIQUE REFERENCES assignments(id) ON DELETE SET NULL, exam_id TEXT UNIQUE REFERENCES exams(id) ON DELETE SET NULL, title TEXT NOT NULL, points_earned REAL CHECK(points_earned>=0), points_possible REAL NOT NULL DEFAULT 100 CHECK(points_possible>0), weight_override REAL CHECK(weight_override>0), excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)), assessment_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) ,CHECK(assignment_id IS NULL OR exam_id IS NULL));

CREATE INDEX grade_items_course ON grade_items(course_id);

CREATE TABLE previous_exam_attempts (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, file_id TEXT UNIQUE REFERENCES files(id) ON DELETE SET NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not attempted' CHECK(status IN ('Not attempted','In progress','Completed')), completed_at TEXT, score REAL CHECK(score>=0), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX previous_exam_attempts_course ON previous_exam_attempts(course_id);

CREATE TABLE exam_topics (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, lecture_id TEXT REFERENCES lectures(id) ON DELETE SET NULL, reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL, previous_exam_id TEXT REFERENCES previous_exam_attempts(id) ON DELETE SET NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not started' CHECK(status IN ('Not started','Reviewing','Reviewed')), confidence TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX exam_topics_course ON exam_topics(course_id);

CREATE TABLE course_topics (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not started' CHECK(status IN ('Not started','Reviewing','Reviewed')), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX course_topics_course ON course_topics(course_id);

CREATE TABLE study_sessions (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL, lecture_id TEXT REFERENCES lectures(id) ON DELETE SET NULL, reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL CHECK(duration_seconds>0), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) ,CHECK(ended_at>=started_at));

CREATE INDEX study_sessions_course ON study_sessions(course_id);

CREATE TABLE study_blocks (id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, exam_id TEXT REFERENCES exams(id) ON DELETE SET NULL, lecture_id TEXT REFERENCES lectures(id) ON DELETE SET NULL, reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, title TEXT NOT NULL, scheduled_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', estimated_minutes REAL NOT NULL DEFAULT 45 CHECK(estimated_minutes>0 AND estimated_minutes<=1440), completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), completed_at TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) ,CHECK(start_time='' OR (length(start_time)=5 AND start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time<'24:00')));

CREATE INDEX study_blocks_course ON study_blocks(course_id);

CREATE TABLE lecture_files (lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, PRIMARY KEY(lecture_id,file_id));

ALTER TABLE tasks ADD COLUMN lecture_id TEXT REFERENCES lectures(id) ON DELETE SET NULL;

CREATE TABLE grading_scales (id TEXT PRIMARY KEY, course_id TEXT UNIQUE REFERENCES courses(id) ON DELETE CASCADE, semester_id TEXT UNIQUE REFERENCES semesters(id) ON DELETE CASCADE, name TEXT NOT NULL, entries TEXT NOT NULL, CHECK(course_id IS NULL OR semester_id IS NULL));

CREATE INDEX sessions_date ON study_sessions(course_id,started_at DESC);

CREATE INDEX blocks_date ON study_blocks(scheduled_date,course_id);

CREATE INDEX topics_exam ON exam_topics(exam_id,sort_order);

CREATE INDEX readings_due ON readings(due_date);

CREATE INDEX grades_category ON grade_items(category_id);

INSERT INTO settings VALUES ('study_default_minutes','45'),('study_reminders','true'),('week_start','1');

CREATE TRIGGER grade_items_category_id_insert BEFORE INSERT ON grade_items WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM grade_categories WHERE id=NEW.category_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER grade_items_category_id_update BEFORE UPDATE ON grade_items WHEN NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM grade_categories WHERE id=NEW.category_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER grade_items_assignment_id_insert BEFORE INSERT ON grade_items WHEN NEW.assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assignments WHERE id=NEW.assignment_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER grade_items_assignment_id_update BEFORE UPDATE ON grade_items WHEN NEW.assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assignments WHERE id=NEW.assignment_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER grade_items_exam_id_insert BEFORE INSERT ON grade_items WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER grade_items_exam_id_update BEFORE UPDATE ON grade_items WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_exam_id_insert BEFORE INSERT ON exam_topics WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_exam_id_update BEFORE UPDATE ON exam_topics WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_lecture_id_insert BEFORE INSERT ON exam_topics WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_lecture_id_update BEFORE UPDATE ON exam_topics WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_reading_id_insert BEFORE INSERT ON exam_topics WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_reading_id_update BEFORE UPDATE ON exam_topics WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_previous_exam_id_insert BEFORE INSERT ON exam_topics WHEN NEW.previous_exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM previous_exam_attempts WHERE id=NEW.previous_exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER exam_topics_previous_exam_id_update BEFORE UPDATE ON exam_topics WHEN NEW.previous_exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM previous_exam_attempts WHERE id=NEW.previous_exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER readings_file_id_insert BEFORE INSERT ON readings WHEN NEW.file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER readings_file_id_update BEFORE UPDATE ON readings WHEN NEW.file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER previous_exam_attempts_file_id_insert BEFORE INSERT ON previous_exam_attempts WHEN NEW.file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER previous_exam_attempts_file_id_update BEFORE UPDATE ON previous_exam_attempts WHEN NEW.file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_exam_id_insert BEFORE INSERT ON study_sessions WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_exam_id_update BEFORE UPDATE ON study_sessions WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_lecture_id_insert BEFORE INSERT ON study_sessions WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_lecture_id_update BEFORE UPDATE ON study_sessions WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_reading_id_insert BEFORE INSERT ON study_sessions WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_reading_id_update BEFORE UPDATE ON study_sessions WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_task_id_insert BEFORE INSERT ON study_sessions WHEN NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_sessions_task_id_update BEFORE UPDATE ON study_sessions WHEN NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_exam_id_insert BEFORE INSERT ON study_blocks WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_exam_id_update BEFORE UPDATE ON study_blocks WHEN NEW.exam_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM exams WHERE id=NEW.exam_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_lecture_id_insert BEFORE INSERT ON study_blocks WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_lecture_id_update BEFORE UPDATE ON study_blocks WHEN NEW.lecture_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lectures WHERE id=NEW.lecture_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_reading_id_insert BEFORE INSERT ON study_blocks WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_reading_id_update BEFORE UPDATE ON study_blocks WHEN NEW.reading_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM readings WHERE id=NEW.reading_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_task_id_insert BEFORE INSERT ON study_blocks WHEN NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

CREATE TRIGGER study_blocks_task_id_update BEFORE UPDATE ON study_blocks WHEN NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND course_id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Related item must belong to the same course'); END;

