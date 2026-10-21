-- Ban list that survives account deletion. Minimum data only: X user id, ban date, optional reason.
-- No handle or other personal data. Sign-in refuses listed ids; admin unban removes the entry. Apply once.
CREATE TABLE IF NOT EXISTS banned_ids (
  x_id TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200));
INSERT OR IGNORE INTO banned_ids (x_id, banned_at, reason) SELECT x_id, unixepoch(), NULL FROM users WHERE banned = 1;
