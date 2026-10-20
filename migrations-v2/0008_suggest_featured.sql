-- User thread suggestions, paid featured spots (Ko-fi), payments ledger.
ALTER TABLE posts ADD COLUMN suggested_by_x_id TEXT;
ALTER TABLE posts ADD COLUMN suggested_by_handle TEXT;

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  tweet_id TEXT NOT NULL, url TEXT NOT NULL, note TEXT,
  -- new: waiting for admin · queued: admin approved, fetch worker builds it · fetched: pending post created
  -- duplicate: thread already on the site · failed: could not build · rejected: admin said no
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','queued','fetched','duplicate','failed','rejected')),
  post_id INTEGER, result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER, seen_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_tweet ON suggestions(tweet_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_user ON suggestions(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_state ON suggestions(state, created_at);

CREATE TABLE IF NOT EXISTS feature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                         -- short code the buyer puts in the Ko-fi message
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  post_id INTEGER, suggestion_id INTEGER,
  tier TEXT NOT NULL, amount_usd REAL NOT NULL, days INTEGER NOT NULL, pin_topics INTEGER NOT NULL DEFAULT 1,
  -- pending_payment -> paid -> active -> expired ; rejected (refund_needed=1 if it was paid) ; cancelled (never paid)
  state TEXT NOT NULL DEFAULT 'pending_payment' CHECK (state IN ('pending_payment','paid','active','expired','rejected','cancelled')),
  paid_usd REAL NOT NULL DEFAULT 0, refund_needed INTEGER NOT NULL DEFAULT 0, refunded_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER, paid_at INTEGER, starts_at INTEGER, ends_at INTEGER, admin_note TEXT, seen_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_feature_active ON feature_requests(state, ends_at);
CREATE INDEX IF NOT EXISTS idx_feature_post ON feature_requests(post_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL, kofi_timestamp TEXT,
  amount REAL NOT NULL, currency TEXT NOT NULL,
  kofi_txn_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('donation','feature','subscription','shop','other')),
  kofi_type TEXT, from_name TEXT, message TEXT,
  feature_request_id INTEGER, post_id INTEGER, matched_code TEXT, raw_json TEXT);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(received_at);
