-- Phase 4: comments, likes/dislikes, reports. Idempotent.

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type    TEXT NOT NULL CHECK (item_type IN ('battle','meme')),
  item_id      TEXT NOT NULL,
  x_id         TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status       TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_by    TEXT CHECK (hidden_by IN ('reports','admin','ban')),
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_type, item_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);

-- Likes (+1) and dislikes (-1) on items and on comments. One per user per target.
CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL CHECK (target_type IN ('battle','meme','comment')),
  target_id   TEXT NOT NULL,
  x_id        TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  value       INTEGER NOT NULL CHECK (value IN (1,-1)),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, x_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(x_id);

-- One report per user per comment; 3 distinct reports auto-hide the comment.
CREATE TABLE IF NOT EXISTS reports (
  comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  x_id        TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, x_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(x_id, created_at);
