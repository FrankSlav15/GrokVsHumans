-- Admin audit log (security review M1): one row per admin action, written in the same D1 batch as the change.
CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, admin_x_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS idx_admin_log_at ON admin_log(at);
CREATE INDEX IF NOT EXISTS idx_admin_log_target ON admin_log(target);
