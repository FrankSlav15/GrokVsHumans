# Fetch learning (gvh-fetch learns from the admin's picks)

**What it learns from:** posts the admin added by hand (`source='manual'`, weight 2) and approved posts (weight 1), newest 300.
Unapproved fetched posts (pending/skipped) are the background for comparison.

**Profile** (`workers/fetch/src/learn.js` `buildProfile`, kv row `learn_profile`), rebuilt free (D1 reads only) at every
13:00/14:00 UTC cron tick:
- topic shares (from `post_topics`)
- up to 40 distinctive words in the human turns (frequent in liked posts, rare in the background; `[word, lift, count]`)
- question share, multi-turn (2+ human turns) share, median turns, median human text length, median X engagement.

**How it is used** (ordering only, no extra X spend):
1. Discovery: each new candidate's `engagement` score gets `+likeness` (0–30): topic match ≤10, distinctive words ≤10,
   question ≤4, back-and-forth reply ≤4.
2. Expand (the paid step, capped by `EXPAND_PER_DAY` / daily $): picks from the top 40 queued candidates by
   `engagement + likeness`, so the ones most like the admin's picks are built first. Existing queued candidates are re-ranked too.
3. Query terms: the 23:00 UTC discovery (06:00/18:00 CDT runs = 11:00/23:00 UTC; this is the 18:00 CDT one) appends an OR-group of up to 6 distinctive words
   (each seen in ≥4 liked posts) to `DISCOVER_QUERY`. Same `max_results`, so same cost. The 11:00 UTC run stays broad.
   Turn off with `LEARN_QUERY = "0"` in `workers/fetch/wrangler.toml`.

**Not changed:** nothing is auto-approved; every built post is still `pending` in the admin queue. Spend caps are untouched.
No Workers AI / embeddings (keyword profile was enough and is free).

**Inspect (free):** `POST /run {"stage":"learn","max":10}` rebuilds the profile and lists the next candidates expand would pick.
Or: `wrangler d1 execute gvh-v2 --remote --command "SELECT v FROM kv WHERE k='learn_profile'"`.

**Rollback:** set `LEARN_QUERY="0"`; to drop ranking entirely, `DELETE FROM kv WHERE k='learn_profile'` and remove the
13:00 rebuild (with no profile, `likeness()` returns 0 and ordering is the old engagement order).
