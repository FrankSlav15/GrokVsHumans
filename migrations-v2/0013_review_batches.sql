-- Review batches: an editor's 1-5 score, one-line reason and batch for pending posts (admin batch view),
-- plus an undo log for bulk topic changes.
ALTER TABLE posts ADD COLUMN review_score INTEGER;
ALTER TABLE posts ADD COLUMN review_reason TEXT;
ALTER TABLE posts ADD COLUMN review_batch TEXT;        -- 'strong' | 'maybe' | 'reject'
ALTER TABLE posts ADD COLUMN review_title TEXT;        -- suggested headline (not applied)
CREATE INDEX IF NOT EXISTS idx_posts_review_batch ON posts(review_batch) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS topic_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, batch TEXT NOT NULL,
  old_topics TEXT NOT NULL,   -- JSON [{topic,suggested}]
  new_topics TEXT NOT NULL,   -- JSON [topic]
  changed_at INTEGER NOT NULL);
