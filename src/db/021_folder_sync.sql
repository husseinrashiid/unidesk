-- Hand-maintained: extends the generator's output (scripts/sync-schema.mjs only
-- processes migrations 001-016) to sync files.folder_id and the new file_folders table.
DROP TRIGGER sync_files_insert;
DROP TRIGGER sync_files_update;
DROP TRIGGER sync_files_delete;
CREATE TRIGGER sync_files_insert AFTER INSERT ON "files" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('files',json_array(NEW."id"),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW."id",'course_id',NEW."course_id",'semester_id',NEW."semester_id",'filename',NEW."filename",'original_filename',NEW."original_filename",'category',NEW."category",'extension',NEW."extension",'size',NEW."size",'created_at',NEW."created_at",'modified_at',NEW."modified_at",'added_at',NEW."added_at",'notes',NEW."notes",'folder_id',NEW."folder_id")) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_files_update AFTER UPDATE ON "files" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 AND (OLD."id" IS NOT NEW."id" OR OLD."course_id" IS NOT NEW."course_id" OR OLD."semester_id" IS NOT NEW."semester_id" OR OLD."filename" IS NOT NEW."filename" OR OLD."original_filename" IS NOT NEW."original_filename" OR OLD."category" IS NOT NEW."category" OR OLD."extension" IS NOT NEW."extension" OR OLD."size" IS NOT NEW."size" OR OLD."created_at" IS NOT NEW."created_at" OR OLD."modified_at" IS NOT NEW."modified_at" OR OLD."added_at" IS NOT NEW."added_at" OR OLD."notes" IS NOT NEW."notes" OR OLD."folder_id" IS NOT NEW."folder_id") BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('files',json_array(NEW."id"),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW."id",'course_id',NEW."course_id",'semester_id',NEW."semester_id",'filename',NEW."filename",'original_filename',NEW."original_filename",'category',NEW."category",'extension',NEW."extension",'size',NEW."size",'created_at',NEW."created_at",'modified_at',NEW."modified_at",'added_at',NEW."added_at",'notes',NEW."notes",'folder_id',NEW."folder_id")) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_files_delete AFTER DELETE ON "files" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('files',json_array(OLD."id"),(SELECT clock FROM sync_context WHERE id=1),NULL) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;

CREATE TRIGGER sync_file_folders_insert AFTER INSERT ON "file_folders" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('file_folders',json_array(NEW."id"),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW."id",'course_id',NEW."course_id",'category',NEW."category",'name',NEW."name",'created_at',NEW."created_at")) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_file_folders_update AFTER UPDATE ON "file_folders" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 AND (OLD."id" IS NOT NEW."id" OR OLD."course_id" IS NOT NEW."course_id" OR OLD."category" IS NOT NEW."category" OR OLD."name" IS NOT NEW."name" OR OLD."created_at" IS NOT NEW."created_at") BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('file_folders',json_array(NEW."id"),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW."id",'course_id',NEW."course_id",'category',NEW."category",'name',NEW."name",'created_at',NEW."created_at")) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_file_folders_delete AFTER DELETE ON "file_folders" WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
UPDATE sync_context SET clock=clock+1 WHERE id=1;
INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('file_folders',json_array(OLD."id"),(SELECT clock FROM sync_context WHERE id=1),NULL) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
