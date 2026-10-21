-- Seen / interacted posts per signed-in user (feed ordering: unseen first on Hot). Capped per user in /api/seen;
-- removed on account deletion (server/account.js). eng = post engagement when it was seen (a big rise resurfaces it).
CREATE TABLE IF NOT EXISTS seen_posts (x_id TEXT NOT NULL, post_id TEXT NOT NULL, seen_at INTEGER NOT NULL, eng INTEGER NOT NULL DEFAULT 0,
  acted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (x_id, post_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_seen_posts_user_at ON seen_posts(x_id, seen_at);
