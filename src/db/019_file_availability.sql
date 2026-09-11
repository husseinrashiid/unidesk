-- Local-only eviction override; logical file identities and remote content remain.
ALTER TABLE sync_blobs ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 1 CHECK(auto_download IN(0,1));
