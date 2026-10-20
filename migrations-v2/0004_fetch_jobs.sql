-- Admin-queued fetch jobs, processed by the gvh-fetch */10 cron (see runJob in workers/fetch/src/index.js).
CREATE TABLE IF NOT EXISTS fetch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('pick','search')),
  spec TEXT NOT NULL, budget REAL NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'new', result TEXT, created_at INTEGER NOT NULL);
