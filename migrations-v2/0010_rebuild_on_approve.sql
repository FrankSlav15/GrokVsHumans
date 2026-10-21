-- Rebuild-on-approve: a pending post whose chain does not start at its root is rebuilt by gvh-fetch before publishing.
-- rebuild_state: NULL | 'queued' (worker will rebuild) | 'done' | 'failed' (published with the old chain, flagged)
-- rebuild_publish: 1 = approve when the rebuild ends; rebuild_feature: 1 = also feature
ALTER TABLE posts ADD COLUMN rebuild_state TEXT;
ALTER TABLE posts ADD COLUMN rebuild_publish INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN rebuild_feature INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN rebuild_note TEXT;
ALTER TABLE posts ADD COLUMN rebuild_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_posts_rebuild ON posts(rebuild_state) WHERE rebuild_state = 'queued';
