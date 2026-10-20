-- Translate feature: one cached translation per (kind, item id, target language, source-text hash).
CREATE TABLE IF NOT EXISTS translations (
  kind TEXT NOT NULL CHECK (kind IN ('post_turn','comment')),
  item_id TEXT NOT NULL,                 -- post_turn: "<post_id>:<pos>", comment: comment id
  target TEXT NOT NULL,                  -- ISO 639-1, e.g. 'en'
  hash TEXT NOT NULL,                    -- sha256 of the source text (edits invalidate)
  source TEXT,                           -- detected source language
  text TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, item_id, target, hash));
CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);
