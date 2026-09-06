CREATE TABLE documents (
 id TEXT PRIMARY KEY,
 file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Indexing','Indexed','Text unavailable','Failed','Stale','Removed')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 content_hash TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL DEFAULT '', extractor_version TEXT NOT NULL DEFAULT '',
 word_count INTEGER NOT NULL DEFAULT 0, page_count INTEGER, slide_count INTEGER,
 indexed_at TEXT, last_error TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX documents_course ON documents(course_id,status);
CREATE TABLE document_chunks (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
 page_start INTEGER, page_end INTEGER, slide_start INTEGER, slide_end INTEGER,
 heading TEXT, line_start INTEGER, line_end INTEGER,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(document_id,chunk_index)
);
CREATE INDEX document_chunks_course ON document_chunks(course_id,document_id);
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(text,heading,content='document_chunks',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER document_chunks_insert AFTER INSERT ON document_chunks BEGIN
 INSERT INTO document_chunks_fts(rowid,text,heading) VALUES(NEW.rowid,NEW.text,NEW.heading);
END;
CREATE TRIGGER document_chunks_delete AFTER DELETE ON document_chunks BEGIN
 INSERT INTO document_chunks_fts(document_chunks_fts,rowid,text,heading) VALUES('delete',OLD.rowid,OLD.text,OLD.heading);
END;
CREATE TRIGGER document_chunks_update AFTER UPDATE ON document_chunks BEGIN
 INSERT INTO document_chunks_fts(document_chunks_fts,rowid,text,heading) VALUES('delete',OLD.rowid,OLD.text,OLD.heading);
 INSERT INTO document_chunks_fts(rowid,text,heading) VALUES(NEW.rowid,NEW.text,NEW.heading);
END;
CREATE TABLE document_index_jobs (
 file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Queued' CHECK(status IN ('Queued','Running','Done','Failed')),
 requested_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, finished_at TEXT
);
INSERT INTO documents(id,file_id,course_id)
 SELECT id,id,course_id FROM files WHERE lower(ltrim(extension,'.')) IN ('pdf','docx','pptx','txt','md','markdown') AND category<>'Recordings';
INSERT INTO document_index_jobs(file_id,request_id) SELECT file_id,lower(hex(randomblob(16))) FROM documents;
CREATE TRIGGER files_document_insert AFTER INSERT ON files
 WHEN lower(ltrim(NEW.extension,'.')) IN ('pdf','docx','pptx','txt','md','markdown') AND NEW.category<>'Recordings'
BEGIN
 INSERT INTO documents(id,file_id,course_id) VALUES(NEW.id,NEW.id,NEW.course_id);
 INSERT INTO document_index_jobs(file_id,request_id) VALUES(NEW.id,lower(hex(randomblob(16))));
END;
CREATE TRIGGER files_document_change AFTER UPDATE OF absolute_path,size,modified_at,extension,course_id,category ON files
 WHEN NEW.absolute_path<>OLD.absolute_path OR NEW.size<>OLD.size OR NEW.modified_at<>OLD.modified_at OR NEW.extension<>OLD.extension OR NEW.course_id<>OLD.course_id OR NEW.category<>OLD.category
BEGIN
 INSERT INTO documents(id,file_id,course_id) SELECT NEW.id,NEW.id,NEW.course_id WHERE lower(ltrim(NEW.extension,'.')) IN ('pdf','docx','pptx','txt','md','markdown') AND NEW.category<>'Recordings' AND NOT EXISTS(SELECT 1 FROM documents WHERE file_id=NEW.id);
 UPDATE documents SET course_id=NEW.course_id,status=CASE WHEN enabled=1 THEN 'Stale' ELSE status END,updated_at=datetime('now') WHERE file_id=NEW.id;
 UPDATE document_chunks SET course_id=NEW.course_id WHERE document_id=NEW.id;
 INSERT INTO document_index_jobs(file_id,request_id) SELECT file_id,lower(hex(randomblob(16))) FROM documents WHERE file_id=NEW.id AND enabled=1
 ON CONFLICT(file_id) DO UPDATE SET request_id=excluded.request_id,status='Queued',requested_at=datetime('now'),started_at=NULL,finished_at=NULL;
END;
