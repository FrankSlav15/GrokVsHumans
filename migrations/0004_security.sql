-- (gvh-db) Security hardening (M1/M3): D1 rate-limit counters + X account creation date for account-age checks.
-- ALTER TABLE is not idempotent: apply once.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, win));
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
ALTER TABLE users ADD COLUMN x_created_at INTEGER;
