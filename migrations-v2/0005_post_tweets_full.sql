-- Marks turns whose full text (note_tweet) and media were (re)fetched from the paid X API. Negative = not returned (deleted/protected).
ALTER TABLE post_tweets ADD COLUMN full_at INTEGER;
