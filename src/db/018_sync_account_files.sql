ALTER TABLE sync_blobs ADD COLUMN state TEXT NOT NULL DEFAULT 'available_offline';
ALTER TABLE sync_blobs ADD COLUMN direction TEXT NOT NULL DEFAULT 'download';
ALTER TABLE sync_blobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_blobs ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_blobs ADD COLUMN updated_at TEXT NOT NULL DEFAULT ('' );
ALTER TABLE sync_outbox ADD COLUMN queued_at TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_outbox ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_outbox ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_conflicts ADD COLUMN detected_at TEXT NOT NULL DEFAULT '';
UPDATE sync_outbox SET queued_at=datetime('now');
CREATE TRIGGER sync_outbox_queued AFTER INSERT ON sync_outbox BEGIN UPDATE sync_outbox SET queued_at=datetime('now') WHERE table_name=NEW.table_name AND record_key=NEW.record_key; END;
CREATE TRIGGER sync_outbox_requeued AFTER UPDATE OF seq ON sync_outbox WHEN NEW.seq<>OLD.seq BEGIN UPDATE sync_outbox SET queued_at=datetime('now'),retry_count=0,last_error='' WHERE table_name=NEW.table_name AND record_key=NEW.record_key; END;
CREATE TABLE sync_resolution_history(id TEXT PRIMARY KEY,table_name TEXT NOT NULL,record_key TEXT NOT NULL,local_payload TEXT,remote_payload TEXT,remote_version INTEGER NOT NULL,resolution TEXT NOT NULL,resolved_at TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE sync_baselines(table_name TEXT NOT NULL,record_key TEXT NOT NULL,payload TEXT,PRIMARY KEY(table_name,record_key));
CREATE TABLE synced_preferences(id TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TRIGGER synced_preferences_insert AFTER INSERT ON settings WHEN NEW.key IN ('week_start','default_reminder_minutes') BEGIN
 INSERT INTO synced_preferences VALUES(NEW.key,NEW.value) ON CONFLICT(id) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER synced_preferences_update AFTER UPDATE ON settings WHEN NEW.key IN ('week_start','default_reminder_minutes') BEGIN
 INSERT INTO synced_preferences VALUES(NEW.key,NEW.value) ON CONFLICT(id) DO UPDATE SET value=excluded.value;
END;
CREATE TRIGGER synced_preferences_delete AFTER DELETE ON settings WHEN OLD.key IN ('week_start','default_reminder_minutes') BEGIN DELETE FROM synced_preferences WHERE id=OLD.key; END;
CREATE TRIGGER sync_preference_insert AFTER INSERT ON synced_preferences WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
 UPDATE sync_context SET clock=clock+1 WHERE id=1;
 INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('synced_preferences',json_array(NEW.id),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW.id,'value',NEW.value)) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_preference_update AFTER UPDATE ON synced_preferences WHEN OLD.value IS NOT NEW.value AND (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
 UPDATE sync_context SET clock=clock+1 WHERE id=1;
 INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('synced_preferences',json_array(NEW.id),(SELECT clock FROM sync_context WHERE id=1),json_object('id',NEW.id,'value',NEW.value)) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
CREATE TRIGGER sync_preference_delete AFTER DELETE ON synced_preferences WHEN (SELECT applying FROM sync_context WHERE id=1)=0 BEGIN
 UPDATE sync_context SET clock=clock+1 WHERE id=1;
 INSERT INTO sync_outbox(table_name,record_key,seq,payload) VALUES('synced_preferences',json_array(OLD.id),(SELECT clock FROM sync_context WHERE id=1),NULL) ON CONFLICT(table_name,record_key) DO UPDATE SET seq=excluded.seq,payload=excluded.payload;
END;
INSERT INTO synced_preferences SELECT key,value FROM settings WHERE key IN ('week_start','default_reminder_minutes');
