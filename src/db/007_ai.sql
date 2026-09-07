CREATE TABLE ai_usage(id TEXT PRIMARY KEY,model TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT(datetime('now')));
INSERT OR IGNORE INTO settings(key,value) VALUES('ai_enabled','false'),('ai_fast_model','gpt-5-mini'),('ai_balanced_model','gpt-5-mini'),('ai_advanced_model',''),('ai_max_sources','10');
