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
