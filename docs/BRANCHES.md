# Branching battles

An X conversation often has several separate arguments with @grok hanging off the opening post. This change stores each qualifying argument as its own battle. A thread with one battle looks and behaves like a post does today. A thread with two or more approved battles uses the approved layout: the opening post, a featured battle, a "Next battle" button, the other battles as a list, and a mini map when there are three or more.

Nothing here is deployed. Do not apply the migration against production until the steps below are what you mean to run.

## What a visitor sees

- One qualifying argument (every post already on the site, a later-post add, or an opening post that produced only one battle): the existing card. Same title, same vote buttons ("Grok won" / "Human won"), same "Show full thread" truncation, same likes and comments. Votes, likes and comments stay on `posts.id`.
- Two or more approved battles: one feed card. The opening post is shown in full. Each battle is titled `Grok vs. @name` (`@a & @b` for two humans, `@a +N` for three or more). A group pushing the same line is one battle and every human on that line is credited, under the vote button. Each battle has its own vote, like, dislike and comments, using the same `/api/vote`, `/api/react` and `/api/comments` calls as a post. A battle that starts under some other human's post shows that post above the exchange, dimmed, labelled context. It is not part of the vote. `@grok` mentions are highlighted. A human post that calls @grok gets a "Called @grok" badge. X's hidden reply prefix is collapsed so `@alice @grok @grok hello` shows as `@grok hello`. Long posts are not truncated. Crude or insulting battles that still qualify show a label. They are not hidden.
- A score of 6 is stored as borderline and waits in `/admin/queue`, the same as a 7 or higher. Nothing is published automatically. Score 5 or lower is not a post. The reason is logged on the thread and shown at the bottom of the pending queue for 14 days.

While only one battle of a multi-battle thread is approved, the public card is the normal single-post card. The layout switches to the multi-battle card when a second battle is approved.

## What an add does

Admin quick-add (`POST /api/admin/quickadd`) and the suggestion fetcher both go through `suggestionOne` in `workers/fetch`.

- The URL is the opening post (its id is the conversation id): one recent search, `conversation_id:<id> (from:grok OR to:grok)`, finds every Grok reply and every post addressed to Grok. Chains are built from reply links, pre-filtered with no model call, and at most six survivors are scored. Each score of 6 or more becomes a pending post under one `threads` row.
- The URL is a later post: the existing single-chain build. Unchanged.
- The scheduled discovery cron still searches for replies to @grok, which are later posts, so it still stores one chain.
- Adding an opening URL for a conversation that is already on the site returns duplicate. Old posts are not re-split.

Qualification lives in `server/qualify.js` (length, questions-only, near-duplicate, crude/insult flags, the 3-post / 2-reply / 2-transition minimum, group credit when several short chains reply to the same post). Hard clamps are applied in code after the model responds: fewer than 3 debate posts caps the score at 5, unfunny low-brow caps it at 4.

## Cost of one opening-post add

Prices are the ones `gvh-fetch` already logs: **$0.005 per post read**, **$0.010 per user object**. The pre-check does not credit X's 24-hour dedupe, same as every other call. The add still has to fit the admin allowance ($1 per UTC day, unused amount rolls over within the month, resets on the 1st), the **$45/month** cap, and the **$0.60 per-add** cap. The search page is shrunk so the worst-case estimate fits what is left of that $0.60.

| Step | Calls | Typical cost |
|---|---|---|
| Lookup of the URL (already done for every quick-add) | 1 | about $0.02–$0.04 |
| One conversation search, at most 80 posts | 1 | about $0.15–$0.35 for a normal thread (roughly 30 posts and under 10 authors). A busy thread costs more, but the page is cut so the estimate cannot pass $0.60 including the lookup. |
| Missing context parents, only if the search did not already include them | 0 or 1, at most 6 ids | about $0.03, and only when the allowance still covers it |
| Workers AI score | at most 6 short JSON calls | `@cf/ibm-granite/granite-4.0-h-micro`, separate from the title/topic model. If the call fails, a free heuristic scores the chain. Topics use the existing keyword list, not another model call. |

A reasonable expectation for a normal opening-post add is **about $0.25**. The ceiling is the existing **$0.60 per add**. A later-post add is unchanged and is usually well under $0.20.

The title/topic model constant in `workers/fetch/src/index.js` is not changed, so this does not collide with the granite title/tag change.

## Data

Migration: `migrations-v2/0017_branches.sql`.

- New `threads` table (one row per opening-post add) and `branch_rejects` (scores that did not qualify).
- New nullable columns on `posts`: `thread_id`, `battle_score`, `battle_kind`, `battle_flags`, `battle_reason`, `battle_mains`, `battle_context`, and `battle_borderline` (default 0).
- No `UPDATE` of existing rows. `thread_id` stays NULL, which the feed treats as a one-battle thread.
- `votes`, `reactions` and `comments` are not modified. They stay keyed by `posts.id`. Each new battle is a post, so it gets its own vote, likes and comments the same way.

The feed and the admin queue check for the `thread_id` column. If this code is deployed before the migration, they keep the old queries. Opening-post adds fail until the migration is applied. Later-post adds keep working.

## Tests

The repo did not have a test runner. New tests:

```bash
npm test
```

which runs `server/qualify.test.js`, `assets/v2/branch-render.test.js` and `workers/fetch/src/branches.test.js` (mock X search JSON, no network). They cover opening-vs-later, the qualification filters, score clamps, the single-vs-multiple display decision, and that an opening-post add writes pending posts only.

## Preview, then production

Run these from the repo root. They use the same wrangler invocation as `docs/DEPLOY.md`. Confirm the Pages **Preview** environment's `DB` and `FETCH` bindings before you start. `gvh-v2` is the database the fetch worker uses. Applying `0017` there is a schema change on that database even though it only adds columns and tables. Take a bookmark first. Do not deploy the worker under its production name until you mean to.

### 1. Bookmark (rollback point)

```bash
npx -y -p node@22 -p wrangler@latest -- wrangler d1 time-travel info gvh-v2 --remote -c d1/wrangler.toml
```

Save the latest bookmark id from that output.

### 2. Migration

```bash
npx -y -p node@22 -p wrangler@latest -- wrangler d1 migrations list gvh-v2 --remote -c d1/wrangler.toml
npx -y -p node@22 -p wrangler@latest -- wrangler d1 migrations apply gvh-v2 --remote -c d1/wrangler.toml
```

`0017_branches.sql` should be the one applied. Do not use `d1 execute --file` for this numbered file.

### 3. Preview worker (does not replace `gvh-fetch`)

```bash
cd workers/fetch
npx -y -p node@22 -p wrangler@latest -- wrangler deploy --name gvh-fetch-branches
```

In the Pages project, **Preview** environment only, point the service binding `FETCH` at service `gvh-fetch-branches`, entrypoint `QuickAdd`. Leave Production on `gvh-fetch`.

The preview worker needs the same `X_BEARER_TOKEN`, `RUN_KEY`, `DB` (`gvh-v2`) and Workers AI binding as production. `wrangler deploy --name` keeps the `wrangler.toml` bindings. Set secrets on the new name if they are not already there:

```bash
npx -y -p node@22 -p wrangler@latest -- wrangler secret put X_BEARER_TOKEN --name gvh-fetch-branches
npx -y -p node@22 -p wrangler@latest -- wrangler secret put RUN_KEY --name gvh-fetch-branches
```

### 4. Preview site (branch alias `branches`)

```bash
bash scripts/build-deploy.sh /tmp/gvh-site
npx -y -p node@22 -p wrangler@latest -- wrangler pages deploy /tmp/gvh-site --project-name grokvshumans --branch branches
```

Preview URL: `https://branches.grokvshumans.pages.dev`

Quick-add on that preview calls the Preview `FETCH` binding. An opening-post URL should land as two or more pending posts under one thread in `/admin/queue`, still not public. A later-post URL should land as one pending post, same as today.

### 5. Production, later

```bash
bash scripts/build-deploy.sh /tmp/gvh-site
npx -y -p node@22 -p wrangler@latest -- wrangler pages deploy /tmp/gvh-site --project-name grokvshumans --branch main
cd workers/fetch && npx -y -p node@22 -p wrangler@latest -- wrangler deploy
```

Deploy the worker only after step 2. Point Production `FETCH` at `gvh-fetch` (unchanged) once that deploy is the production worker.

### Rollback

Restore the database to the bookmark from step 1. This puts back the schema and the rows as they were at that bookmark, including any posts added after it, so only do this if that is acceptable:

```bash
npx -y -p node@22 -p wrangler@latest -- wrangler d1 time-travel restore gvh-v2 --bookmark BOOKMARK_ID --remote -c d1/wrangler.toml
```

Put the site back by redeploying the previous Pages production deployment (or `main` before this branch). Put the worker back with `wrangler rollback` in `workers/fetch`, or by deploying the previous commit. The preview worker `gvh-fetch-branches` can be left unused or removed; it is not what the cron runs unless Production `FETCH` was pointed at it.
