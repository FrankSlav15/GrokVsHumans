# gvh-fetch title and topic model

Worker: `gvh-fetch` (`workers/fetch`). Pages moderation and translation are different models and are not part of this switch.

| | Model | Input | Output |
|---|---|---|---|
| Current in this branch | `@cf/ibm-granite/granite-4.0-h-micro` | $0.017 / M tokens | $0.112 / M tokens |
| Retiring | `@cf/meta/llama-3.2-3b-instruct` | $0.0509 / M tokens | $0.335 / M tokens |

Granite is about 67% below the retiring Llama rates on both input and output. Official catalog: [granite-4.0-h-micro](https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/). Cloudflare retires Llama 3.2 3B Instruct on **20 November 2026**. After that, requests fail with HTTP **410 Gone**, error code **5028** ([deprecation notice](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)).

The constant is `AI_MODEL` in `workers/fetch/src/tagging.js`. Headline and topics stay **two calls** (20 and 16 max tokens, same prompts and checks). A bad title still falls back on its own, and a bad topic list still falls back to the keyword list. X API caps (`DAILY_CAP_USD`, `MONTHLY_CAP_USD`, admin allowance) are unchanged; Workers AI is not billed through `fetch_log`.

Merging this branch does not deploy anything. The live worker keeps serving the build already on Cloudflare until the command below.

## Switch (when you want production to move)

From a checkout of the commit you reviewed, deploy **only** this Worker. Do not deploy the Pages project, do not apply D1 migrations, and do not put secrets on the command line.

```sh
cd workers/fetch
npx wrangler deploy
```

That uploads and activates `gvh-fetch` at 100% of its traffic. The next expand, suggestion, quick-add, or auto-headline rebuild calls Granite. Posts already stored keep their headline and topics until something rebuilds them. Confirm the deployment in the dashboard (Workers & Pages → `gvh-fetch` → Deployments) or with `npx wrangler deployments status` from `workers/fetch`.

No new Wrangler var is required. Do not set the retired Llama id as a var.

## Rollback

Worker rollback restores a previous **version of this Worker** (code and bindings config). It does not change D1 data. From `workers/fetch`:

```sh
npx wrangler deployments list
npx wrangler rollback <VERSION_ID> --message "restore gvh-fetch before the Granite title model"
```

`<VERSION_ID>` is the `gvh-fetch` version that was active before the Granite deploy (the list shows the recent deployments). Omit the id only if that previous version is the one Wrangler would select by default, and keep `--message` so the command does not prompt.

**Before 20 November 2026** that previous version still has a live model, so titles and topics go back to Llama 3.2 3B Instruct.

**On and after 20 November 2026** that rollback is not a permanent fix. The retired model answers 410 Gone. The old code catches the error and stores the cleaned-question headline plus keyword topics, so new posts are still saved, but model titles and topics stop. Put Granite (this Worker version) back with `npx wrangler rollback <GRANITE_VERSION_ID> --message "restore Granite title model"`, or deploy this commit again. Do not leave production pointed at `@cf/meta/llama-3.2-3b-instruct`.

Dashboard path for the same rollback: Workers & Pages → `gvh-fetch` → Deployments → ⋯ on the version → Rollback. Only the last 100 published versions can be selected.

## What “fallback” means after this change

- No `env.AI`, or the model throws (including a 410): the post still stores. Headline uses `suggestHeadline`. Topics use `suggestTopics`. The Worker logs `gvh-fetch ai headline` or `gvh-fetch ai topics` plus the error text.
- The model returns text that fails the existing checks (length, word count, `@` / `#` / URL, or a topic outside the allow-list): same fallbacks, no shape error.
- The body is `{ response: "..." }` **or** an OpenAI chat completion (`choices[0].message.content`, including text-part arrays). Both are read. A blank `response` does not hide text that arrived on `choices`.
- The body is some other object (no readable `response` or `choices` text): the Worker logs `gvh-fetch ai shape` and then uses the same fallbacks. It does not treat that object as an empty answer and it does not copy an unrelated string out of it.

A fenced or bare JSON object is accepted only as `topic` / `title` for the headline call and `tags` / `topics` for the topic call, then the same checks. That covers a Granite reply shaped like `{"topic":"Gas Price Drop Post-Midterms","tags":["Politics","Money"]}`. It is not a combined prompt: each call still sends its own instructions.

## Checks before you deploy

Mocked tests (no Workers AI and no X API spend):

```sh
node --experimental-default-type=module --test workers/fetch/test/tagging.test.js
```

Leave `server/moderation.js` (`llama-guard-3-8b`, `llama-3.1-8b-instruct-fast`) and `server/translate.js` (`m2m100-1.2b`) as they are.
