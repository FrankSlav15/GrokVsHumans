-- Grok vs. Humans v2 schema (fresh D1 database "gvh-v2"). Idempotent.
-- Accounts / login (same as v1)
CREATE TABLE IF NOT EXISTS users (
  x_id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT, avatar_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_x_id ON sessions(x_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  return_to TEXT NOT NULL, created_at INTEGER NOT NULL);

-- Posts = one Grok-vs-human exchange (a reply chain of 2..10 tweets).
CREATE TABLE IF NOT EXISTS posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,   -- site id used in URLs, votes, comments
  grok_tweet_id   TEXT NOT NULL UNIQUE,                -- the @grok reply that was discovered
  conversation_id TEXT,
  human_x_id      TEXT, human_handle TEXT,             -- main human participant
  headline        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','skipped','blocked','hidden')),
  featured        INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'fetch' CHECK (source IN ('fetch','history','manual')),
  x_engagement    INTEGER NOT NULL DEFAULT 0,           -- likes+reposts+replies+quotes on X at fetch time
  tweet_created_at INTEGER,                            -- unix secs of the grok reply
  fetched_at      INTEGER NOT NULL,
  approved_at     INTEGER,
  last_checked_at INTEGER,
  check_failures  INTEGER NOT NULL DEFAULT 0,
  hidden_reason   TEXT);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, approved_at);
CREATE INDEX IF NOT EXISTS idx_posts_conv ON posts(conversation_id);

-- The chain, oldest first (pos 0 = root of what we show).
CREATE TABLE IF NOT EXISTS post_tweets (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  pos        INTEGER NOT NULL,
  tweet_id   TEXT NOT NULL,
  author_id  TEXT, author_handle TEXT NOT NULL, author_name TEXT, author_avatar TEXT,
  verified   INTEGER NOT NULL DEFAULT 0,
  is_grok    INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL,
  media_json TEXT,                                     -- [{type,url,preview,video}]
  created_at INTEGER,
  PRIMARY KEY (post_id, pos));
CREATE INDEX IF NOT EXISTS idx_post_tweets_tweet ON post_tweets(tweet_id);

CREATE TABLE IF NOT EXISTS topics (name TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO topics (name, sort) VALUES
 ('Politics',1),('Technology',2),('Memology',3),('Sports',4),('Pop Culture',5),
 ('Life Advice',6),('History',7),('Science',8),('Money',9),('Wild Card',10);
CREATE TABLE IF NOT EXISTS post_topics (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  topic   TEXT NOT NULL REFERENCES topics(name),
  suggested INTEGER NOT NULL DEFAULT 1,               -- 1 = machine suggestion, 0 = set by admin
  PRIMARY KEY (post_id, topic));
CREATE INDEX IF NOT EXISTS idx_post_topics_topic ON post_topics(topic);

CREATE TABLE IF NOT EXISTS blocked_authors (
  x_id TEXT, handle TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (handle));

-- Every paid X API request is logged here; the fetch Worker refuses to exceed the caps.
CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL, at INTEGER NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL,
  kind TEXT NOT NULL,                                  -- discover | expand | recheck | usage | note
  endpoint TEXT, http_status INTEGER,
  posts_read INTEGER NOT NULL DEFAULT 0, users_read INTEGER NOT NULL DEFAULT 0,
  est_cost REAL NOT NULL DEFAULT 0,                    -- USD, conservative (no dedupe discount)
  candidates INTEGER NOT NULL DEFAULT 0, note TEXT);
CREATE INDEX IF NOT EXISTS idx_fetch_log_day ON fetch_log(day);
CREATE INDEX IF NOT EXISTS idx_fetch_log_month ON fetch_log(month);
-- Queue of conversations discovered but not yet expanded (staged to fit Worker subrequest limits).
CREATE TABLE IF NOT EXISTS fetch_candidates (
  grok_tweet_id TEXT PRIMARY KEY, conversation_id TEXT, human_x_id TEXT, payload TEXT NOT NULL,
  engagement INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);

-- Votes / reactions / comments / reports, now for item type 'post'
CREATE TABLE IF NOT EXISTS votes (
  item_type TEXT NOT NULL CHECK (item_type IN ('post','battle')), item_id TEXT NOT NULL,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  choice TEXT NOT NULL CHECK (choice IN ('grok','human')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id, x_id));
CREATE INDEX IF NOT EXISTS idx_votes_item ON votes(item_type, item_id);
CREATE TABLE IF NOT EXISTS legacy_votes (
  item_type TEXT NOT NULL DEFAULT 'battle', item_id TEXT NOT NULL, grok INTEGER NOT NULL DEFAULT 0,
  human INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'firebase-rtdb', imported_at INTEGER NOT NULL,
  PRIMARY KEY (item_type, item_id));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK (item_type IN ('post','battle','meme')), item_id TEXT NOT NULL,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  hidden_by TEXT CHECK (hidden_by IN ('reports','admin','ban')),
  report_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_comments_item ON comments(item_type, item_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(x_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);
CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL CHECK (target_type IN ('post','battle','meme','comment')), target_id TEXT NOT NULL,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (1,-1)), created_at INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, x_id));
CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);
CREATE TABLE IF NOT EXISTS reports (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  x_id TEXT NOT NULL REFERENCES users(x_id) ON DELETE CASCADE,
  reason TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (comment_id, x_id));
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(x_id, created_at);
