-- Branching battles. Existing rows are not rewritten: thread_id NULL means "this post is a
-- one-battle thread", which is how every post stored before this migration behaves.
-- Votes, reactions and comments stay keyed by posts.id. Nothing in those tables is updated.
-- A thread with several qualifying arguments gets one threads row and one posts row per battle.

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_tweet_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  headline TEXT,
  root_json TEXT,
  grok_answer_json TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  fetched_at INTEGER NOT NULL,
  reads_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_threads_conv ON threads(conversation_id);

ALTER TABLE posts ADD COLUMN thread_id INTEGER;
ALTER TABLE posts ADD COLUMN battle_score INTEGER;
ALTER TABLE posts ADD COLUMN battle_kind TEXT;
ALTER TABLE posts ADD COLUMN battle_flags TEXT;
ALTER TABLE posts ADD COLUMN battle_reason TEXT;
ALTER TABLE posts ADD COLUMN battle_mains TEXT;
ALTER TABLE posts ADD COLUMN battle_context TEXT;
ALTER TABLE posts ADD COLUMN battle_borderline INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);

CREATE TABLE IF NOT EXISTS branch_rejects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  title TEXT,
  reason TEXT,
  score INTEGER,
  handles TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_rejects_thread ON branch_rejects(thread_id);
