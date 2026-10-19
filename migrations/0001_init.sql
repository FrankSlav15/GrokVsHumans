-- GrokVsHumans D1 schema, phase 1-3: users, sessions, OAuth login state, votes.
-- Apply in order; every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
  x_id        TEXT PRIMARY KEY,          -- numeric X user id (string)
  handle      TEXT NOT NULL,             -- current @handle without "@"
  name        TEXT,
  avatar_url  TEXT,
  verified    INTEGER NOT NULL DEFAULT 0,
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,          -- unix seconds
  last_login  INTEGER NOT NULL
);

-- Session cookie holds a random token; only its SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  x_id        TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_x_id ON sessions(x_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Short-lived OAuth 2.0 PKCE state (10 minutes). Deleted when used.
CREATE TABLE IF NOT EXISTS oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  return_to      TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- One vote per signed-in user per item (the primary key enforces it).
-- Changing your vote is an UPSERT on the same row.
CREATE TABLE IF NOT EXISTS votes (
  item_type   TEXT NOT NULL CHECK (item_type IN ('battle')),
  item_id     TEXT NOT NULL,
  x_id        TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  choice      TEXT NOT NULL CHECK (choice IN ('grok','human')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id, x_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_x_id ON votes(x_id);

-- Anonymous totals carried over from Firebase RTDB (pre-login era).
CREATE TABLE IF NOT EXISTS legacy_votes (
  item_type  TEXT NOT NULL DEFAULT 'battle',
  item_id    TEXT NOT NULL,
  grok       INTEGER NOT NULL DEFAULT 0,
  human      INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'firebase-rtdb',
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id)
);
