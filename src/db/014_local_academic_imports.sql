CREATE TABLE degree_programs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, degree_type TEXT NOT NULL DEFAULT '', major TEXT NOT NULL DEFAULT '', minor TEXT NOT NULL DEFAULT '', catalog_term TEXT NOT NULL DEFAULT '', evaluation_term TEXT NOT NULL DEFAULT '', institution TEXT NOT NULL DEFAULT '',
 total_credits REAL NOT NULL DEFAULT 0 CHECK(total_credits>=0), minimum_gpa REAL, reported_gpa REAL, reported_used_credits REAL,
 revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE degree_groups (
 id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE, parent_id TEXT REFERENCES degree_groups(id) ON DELETE SET NULL,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', credits_required REAL NOT NULL DEFAULT 0 CHECK(credits_required>=0), minimum_gpa REAL, reported_used_credits REAL, reported_gpa REAL, display_order INTEGER NOT NULL DEFAULT 0,
 completion_rule TEXT NOT NULL DEFAULT 'all' CHECK(completion_rule IN ('all','any','credits')), contributes_credits INTEGER NOT NULL DEFAULT 1 CHECK(contributes_credits IN (0,1))
);
CREATE TABLE degree_requirements (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES degree_groups(id) ON DELETE CASCADE, name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('specific','one_of','choose_n','course_set','elective','attribute','manual','level')),
 credits_required REAL NOT NULL DEFAULT 0 CHECK(credits_required>=0), count_required INTEGER NOT NULL DEFAULT 1 CHECK(count_required>=0), minimum_grade REAL, minimum_level INTEGER, attribute TEXT NOT NULL DEFAULT '', manual_complete INTEGER NOT NULL DEFAULT 0 CHECK(manual_complete IN (0,1)), display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE degree_options (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL REFERENCES degree_requirements(id) ON DELETE CASCADE, subject TEXT NOT NULL, number TEXT NOT NULL, UNIQUE(requirement_id,subject,number));
CREATE TABLE degree_courses (
 id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE, subject TEXT NOT NULL, number TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', credits REAL NOT NULL DEFAULT 0 CHECK(credits>=0), grade TEXT NOT NULL DEFAULT '', term TEXT NOT NULL DEFAULT '', original_term TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('completed','in_progress','planned','failed','transferred')), source TEXT NOT NULL DEFAULT 'Manual', course_id TEXT REFERENCES courses(id) ON DELETE SET NULL, excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1)), attributes TEXT NOT NULL DEFAULT '',
 UNIQUE(program_id,subject,number,term)
);
CREATE TABLE degree_allocations (requirement_id TEXT NOT NULL REFERENCES degree_requirements(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES degree_courses(id) ON DELETE CASCADE, PRIMARY KEY(requirement_id,course_id));
CREATE TABLE degree_plans (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL UNIQUE REFERENCES degree_requirements(id) ON DELETE CASCADE, term TEXT NOT NULL, semester_id TEXT REFERENCES semesters(id) ON DELETE SET NULL, subject TEXT NOT NULL DEFAULT '', number TEXT NOT NULL DEFAULT '', credits REAL NOT NULL CHECK(credits>=0), override_prerequisites INTEGER NOT NULL DEFAULT 0);
CREATE TABLE degree_prerequisites (id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES degree_programs(id) ON DELETE CASCADE, subject TEXT NOT NULL, number TEXT NOT NULL, prerequisite_subject TEXT NOT NULL, prerequisite_number TEXT NOT NULL, relation TEXT NOT NULL DEFAULT 'all' CHECK(relation IN ('all','any')), UNIQUE(program_id,subject,number,prerequisite_subject,prerequisite_number));
CREATE TABLE local_import_sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('degree','syllabus','manual')), program_id TEXT REFERENCES degree_programs(id) ON DELETE CASCADE, course_id TEXT REFERENCES courses(id) ON DELETE CASCADE, filename TEXT NOT NULL, parser_version TEXT NOT NULL, source_path TEXT NOT NULL DEFAULT '', file_id TEXT REFERENCES files(id) ON DELETE SET NULL, content_hash TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT(datetime('now')), changes_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE local_import_records (source_id TEXT NOT NULL REFERENCES local_import_sources(id) ON DELETE CASCADE, entity_table TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, PRIMARY KEY(source_id,entity_table,entity_id));
CREATE INDEX degree_groups_program ON degree_groups(program_id);
CREATE INDEX degree_courses_program ON degree_courses(program_id);
CREATE TRIGGER degree_parent_insert BEFORE INSERT ON degree_groups WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM degree_groups WHERE id=NEW.parent_id AND program_id=NEW.program_id) BEGIN SELECT RAISE(ABORT,'Parent group must belong to the same degree'); END;
CREATE TRIGGER degree_parent_update BEFORE UPDATE OF parent_id,program_id ON degree_groups WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM degree_groups WHERE id=NEW.parent_id AND program_id=NEW.program_id) BEGIN SELECT RAISE(ABORT,'Parent group must belong to the same degree'); END;
CREATE TRIGGER degree_allocation_insert BEFORE INSERT ON degree_allocations WHEN NOT EXISTS(SELECT 1 FROM degree_requirements r JOIN degree_groups g ON g.id=r.group_id JOIN degree_courses c ON c.program_id=g.program_id WHERE r.id=NEW.requirement_id AND c.id=NEW.course_id) BEGIN SELECT RAISE(ABORT,'Allocated course must belong to the same degree'); END;
