-- Optional edits on a deferred admin quick-add, applied when the fetch worker builds it.
-- NULL title: the worker writes the headline. NULL or empty topics: the worker picks topics.
-- Not applied to production by this change. Apply with the other v2 migrations when deploying.
ALTER TABLE suggestions ADD COLUMN title TEXT;
ALTER TABLE suggestions ADD COLUMN topics TEXT;
