-- Projects: things people build together with SI (Grok / Grok Bot). Submitted by signed-in users, approved in
-- /admin/queue (Projects tab). We never handle money for projects: donate_url is only an outbound link.
-- Account deletion removes a user's projects (pending and approved) with their votes and comments; see server/account.js.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id TEXT REFERENCES users(x_id) ON DELETE SET NULL,
  handle TEXT,                                   -- submitter's @handle at submit time (shown on the card)
  name TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL, si_usage TEXT NOT NULL,
  image_url TEXT, donate_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','skipped','hidden')),
  hidden_by TEXT, mod_state TEXT, mod_category TEXT, mod_reason TEXT,
  created_at INTEGER NOT NULL, approved_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, approved_at);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(x_id, created_at);
CREATE TABLE IF NOT EXISTS project_votes (
  project_id INTEGER NOT NULL, x_id TEXT NOT NULL, value INTEGER NOT NULL CHECK (value IN (1,-1)), created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, x_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_project_votes_user ON project_votes(x_id);
-- paid Featured spots for projects reuse feature_requests (same Ko-fi codes, webhook and payments ledger)
ALTER TABLE feature_requests ADD COLUMN project_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_feature_project ON feature_requests(project_id);
-- Comments and translations gain the 'project' kinds. SQLite cannot alter a CHECK, so both tables are rebuilt
-- (same pattern as 0011: reports reference comments(id) ON DELETE CASCADE and are copied aside first). Apply once.
PRAGMA defer_foreign_keys = on;
CREATE TABLE reports_bak AS SELECT * FROM reports;
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK (item_type IN ('post','battle','meme','project')), item_id TEXT NOT NULL,
  x_id TEXT REFERENCES users(x_id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_by TEXT CHECK (hidden_by IN ('reports','admin','ban','auto')),
  report_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  mod_state TEXT CHECK (mod_state IN ('ok','flagged','hidden','error')),
  mod_category TEXT, mod_reason TEXT, mod_reviewed INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER);
INSERT INTO comments_new (id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at, mod_state, mod_category, mod_reason, mod_reviewed, deleted_at)
  SELECT id, item_type, item_id, x_id, body, status, hidden_by, report_count, created_at, mod_state, mod_category, mod_reason, mod_reviewed, deleted_at FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_type, item_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
CREATE INDEX IF NOT EXISTS idx_comments_mod ON comments(mod_state, mod_reviewed, created_at);
DELETE FROM reports;
INSERT INTO reports SELECT * FROM reports_bak;
DROP TABLE reports_bak;
CREATE TABLE translations_new (
  kind TEXT NOT NULL CHECK (kind IN ('post_turn','comment','project')),
  item_id TEXT NOT NULL,                 -- post_turn: "<post_id>:<pos>", comment: comment id, project: "<project_id>:d|s"
  target TEXT NOT NULL, hash TEXT NOT NULL, source TEXT, text TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, item_id, target, hash));
INSERT INTO translations_new SELECT kind, item_id, target, hash, source, text, model, created_at FROM translations;
DROP TABLE translations;
ALTER TABLE translations_new RENAME TO translations;
CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);
