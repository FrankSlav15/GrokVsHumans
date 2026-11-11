-- Tweets that X no longer serves (deleted: oEmbed 404, protected/private account: 403) stay on the site from the
-- saved copy instead of hiding the whole post. NULL = live (or never checked).
ALTER TABLE post_tweets ADD COLUMN gone TEXT;        -- 'deleted' | 'protected' | NULL
ALTER TABLE post_tweets ADD COLUMN gone_at INTEGER;  -- unix seconds when first seen gone
