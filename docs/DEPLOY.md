# Deploying GrokVsHumans (Cloudflare Pages + Functions + D1)

Pages project: `grokvshumans` (production branch `main`), account `a752240a4681be5abc21dfbaf81852ce`.

## Bindings (Pages project → Settings → Production)
Managed in the dashboard / Pages API, **not** in a wrangler.toml (there is deliberately no
wrangler.toml, so wrangler never overrides dashboard variables).

| Name | Type | Notes |
|---|---|---|
| `DB` | D1 binding | database `gvh-db` (`ad766697-0cf9-4eb0-868f-ffd4fdd21132`) |
| `X_CLIENT_ID` | plain text | X app "GvsHumans" OAuth 2.0 client id |
| `X_CLIENT_SECRET` | secret | OAuth 2.0 client secret |
| `X_BEARER_TOKEN` | secret | app-only token (feed worker, later phase) |
| `ADMIN_X_IDS` | plain text | comma-separated X user ids (`1477077739924594696` = @SlavisTon) |

No session-signing secret is needed: session cookies are random 256-bit tokens and only
their SHA-256 hash is stored in D1.

## Database
`migrations/*.sql` – apply in order (idempotent). `0002` is the one-time Firebase import.

## Build + deploy
1. `scripts/build-deploy.sh` → `/workspace/gvh-site` (static files + `_headers`, `_redirects`, `_routes.json`).
2. From the repo root (so `functions/` is found), run wrangler against the local mock to produce the payload:
   ```
   node scripts/pages-payload-mock.js &      # writes cap/deploy.bin, cap/hashes.json
   CLOUDFLARE_API_BASE_URL=http://127.0.0.1:8799 CLOUDFLARE_API_TOKEN=dummy \
   CLOUDFLARE_ACCOUNT_ID=a752240a4681be5abc21dfbaf81852ce \
   npx wrangler pages deploy /workspace/gvh-site --project-name grokvshumans --branch main
   ```
3. Through the Cloudflare connector: get `/pages/projects/grokvshumans/upload-token`, call
   `/pages/assets/check-missing`, upload any missing files, `upsert-hashes`, then POST the captured
   multipart body to `/pages/projects/grokvshumans/deployments`.

With a Cloudflare API token (Pages:Edit, D1:Edit) step 2–3 collapse into a normal
`npx wrangler pages deploy /workspace/gvh-site --project-name grokvshumans --branch main`.

`_routes.json` limits Functions to `/auth/*` and `/api/*`; everything else is served as free static assets.

## Phase 4 (comments, reactions, moderation)
- Migration `0003_comments_reactions_reports.sql`.
- Endpoints: `GET/POST /api/comments`, `POST /api/comment-delete`, `POST /api/react`, `POST /api/report`,
  admin-only `GET /api/admin/comments`, `POST /api/admin/action`, and the `/admin` page (Function).
- Rules live in `server/moderation.js` (500 chars, 5 per 10 min, banned words, 3 reports auto-hide).

## v2 (branch v2-feed) – preview only
- D1 `gvh-v2` (d1a0f66c-826e-4394-915a-b5f93971aa85) is bound as `DB` in the **Preview** environment only; schema `migrations-v2/0001_v2_schema.sql`.
- **v2 migrations are tracked in D1's `d1_migrations` table** (since 0016, 2026-10-21). 0001–0015 had been applied by hand with `d1 execute --file`; they were recorded as already applied (no-op ledger entries, same file names) and 0016 was then applied with `wrangler d1 migrations apply`. Time-travel bookmark taken just before: `0000013d-00000002-0000510b-11c77b51056da2eab112affe0b9f7d5e`. New migrations: add `migrations-v2/00NN_name.sql`, then run `wrangler d1 migrations list|apply gvh-v2 --remote -c d1/wrangler.toml` (via `npx -y -p node@22 -p wrangler@latest --`). Never `d1 execute --file` a numbered migration again, or the ledger goes out of sync.
- Preview vars: `X_CLIENT_ID`, `ADMIN_X_IDS`. Login on the preview also needs `X_CLIENT_SECRET` (Preview, secret) and the callback `https://v2-feed.grokvshumans.pages.dev/auth/callback` registered in the X app.
- Deploy: `bash scripts/build-deploy.sh /workspace/gvh-site && npx -y -p node@22 -p wrangler@latest -- wrangler pages deploy /workspace/gvh-site --project-name grokvshumans --branch v2-feed`
- Old battles: the one-time syndication-based history import was removed (no syndication scraping any more); posts imported earlier stay in gvh-v2. New posts come only from the fetch Worker (paid X API v2).
- Fetch Worker `workers/fetch` (`gvh-fetch`): `cd workers/fetch && wrangler deploy`; secrets `wrangler secret put X_BEARER_TOKEN` and `wrangler secret put RUN_KEY`.
  Crons: 11:00/23:00 UTC discovery (50 results, ≈$0.25/run), every 10 min expand 3 candidates (≈$0.05 each) + free oEmbed re-check.
  Caps: $1.50/day, $45/month (estimated from fetch_log, before every paid call). Manual run: `POST /run` with `Authorization: Bearer $RUN_KEY`, body `{"stage":"discover|expand|recheck|usage|status","budget":8}` (budget capped at $8 per UTC day for manual runs; the run id is server-chosen, `manual-YYYY-MM-DD`; key compared in constant time).

## Admin quick-add (/admin/queue "Add a thread")
- Pages Function `POST /api/admin/quickadd {url}` (requireAdmin → ADMIN_X_IDS; audit `post.quickadd`) calls gvh-fetch over the
  Pages service binding `FETCH` → service `gvh-fetch`, entrypoint `QuickAdd` (RPC; not reachable from workers.dev). Set on both Production and Preview.
- Budget: `ADMIN_DAILY_USD` (default $1, run ids `admin-*`) replaces the daily cap for these adds; the monthly cap still applies; max $0.60 per add.
- Stored as `source='manual'` + `suggested_by_x_id` = admin (posts.source has a CHECK constraint); shown as "➕ added by admin" at the top of the queue.
- Deferred quick-add: when the add is blocked by `admin_cap`/`month_cap`/`day_cap` the link is saved as a `suggestions` row
  (state `queued`, note `admin quick-add (deferred)`, x_id = admin) and the UI says "Saved — will fetch automatically when X budget allows".
  The */10 cron (`runDeferredAdds`, before rebuilds) runs it through the same admin-allowance path once budget allows (free D1 pre-check,
  no log spam while capped). Duplicates also cover links waiting in `suggestions` (`new`/`queued`) → `duplicate_waiting`.
  `{"url":..., "dry_run":true}` checks dedupe/caps without spending or saving. `ADMIN_MONTH_EXTRA_USD` (default 0) is a one-off
  override that raises the monthly cap for admin quick-adds only; set it with `wrangler deploy --var ADMIN_MONTH_EXTRA_USD:0.6` and redeploy without it afterwards.
