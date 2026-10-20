-- AI moderation: hidden_by gains 'auto'; per-comment moderation verdict; daily digest store.
-- SQLite cannot alter a CHECK, so comments is rebuilt. reports references comments(id) ON DELETE CASCADE,
-- so reports are copied aside first and restored after the rebuild.
PRAGMA defer_foreign_keys = on;
CREATE TABLE reports_bak AS SELECT * FROM reports;
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK (item_type IN ('post','battle','meme')), item_id TEXT NOT NULL,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_by TEXT CHECK (hidden_by IN ('reports','admin','ban','auto')),
  report_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  mod_state TEXT CHECK (mod_state IN ('ok','flagged','hidden','error')),   -- AI verdict at post time
  mod_category TEXT, mod_reason TEXT, mod_reviewed INTEGER NOT NULL DEFAULT 0);
INSERT INTO comments_new (id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at)
  SELECT id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_type, item_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_mod ON comments(mod_state, mod_reviewed, created_at);
DELETE FROM reports;
INSERT INTO reports SELECT * FROM reports_bak;
DROP TABLE reports_bak;
CREATE TABLE IF NOT EXISTS mod_digests (day TEXT PRIMARY KEY, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL, flagged INTEGER NOT NULL,
  data_json TEXT NOT NULL, emailed_at INTEGER, email_error TEXT);
