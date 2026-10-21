-- Self-service account deletion (POST /api/account/delete).
-- comments.x_id and feature_requests.x_id become nullable with ON DELETE SET NULL so that deleting a user
-- keeps their comments as '[deleted]' placeholders (author removed) and keeps feature requests linked to
-- Ko-fi payment records for bookkeeping, without the user id. SQLite cannot alter a column, so both tables
-- are rebuilt. reports references comments(id) ON DELETE CASCADE, so reports are copied aside first.
-- comments.deleted_at marks author-deleted placeholders. Apply once.
PRAGMA defer_foreign_keys = on;
CREATE TABLE reports_bak AS SELECT * FROM reports;
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK (item_type IN ('post','battle','meme')), item_id TEXT NOT NULL,
  x_id TEXT REFERENCES users(x_id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_by TEXT CHECK (hidden_by IN ('reports','admin','ban','auto')),
  report_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  mod_state TEXT CHECK (mod_state IN ('ok','flagged','hidden','error')),
  mod_category TEXT, mod_reason TEXT, mod_reviewed INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER);
INSERT INTO comments_new (id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at, mod_state, mod_category, mod_reason, mod_reviewed)
  SELECT id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at, mod_state, mod_category, mod_reason, mod_reviewed FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_type, item_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_mod ON comments(mod_state, mod_reviewed, created_at);
DELETE FROM reports;
INSERT INTO reports SELECT * FROM reports_bak;
DROP TABLE reports_bak;

CREATE TABLE feature_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  x_id TEXT REFERENCES users(x_id) ON DELETE SET NULL,
  post_id INTEGER, suggestion_id INTEGER,
  tier TEXT NOT NULL, amount_usd REAL NOT NULL, days INTEGER NOT NULL, pin_topics INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'pending_payment' CHECK (state IN ('pending_payment','paid','active','expired','rejected','cancelled')),
  paid_usd REAL NOT NULL DEFAULT 0, refund_needed INTEGER NOT NULL DEFAULT 0, refunded_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER, paid_at INTEGER, starts_at INTEGER, ends_at INTEGER, admin_note TEXT, seen_at INTEGER);
INSERT INTO feature_requests_new SELECT * FROM feature_requests;
DROP TABLE feature_requests;
ALTER TABLE feature_requests_new RENAME TO feature_requests;
CREATE INDEX IF NOT EXISTS idx_feature_active ON feature_requests(state, ends_at);
CREATE INDEX IF NOT EXISTS idx_feature_post ON feature_requests(post_id);
CREATE INDEX IF NOT EXISTS idx_feature_user ON feature_requests(x_id, created_at);
