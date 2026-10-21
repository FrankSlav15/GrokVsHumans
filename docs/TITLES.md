# Post titles

Format: `Grok vs. @handle: topic` (topic 2-6 words, ideally a short question; ~60 chars max).

**Rule: `@handle` is the main human participant**, the human who did the arguing: the one Grok answered
most often (most back-and-forth with Grok). It is NOT automatically whoever asked the opening question.
If the opener asked once and someone else carried the debate, title it after that someone else.
Ties: the first of the tied humans in the chain.

- Code: `mainHuman()` in `server/v2.js`, same rule as `buildChain()` in `workers/fetch` (stored as `posts.human_handle`).
  gvh-fetch AI titles (`aiHeadline`) and the fallback (`suggestHeadline`) use it; rebuilds re-sync `human_handle`.
- Check: `/admin/queue` (list and batch view) flags `⚠ title @ is not main human @…` when the headline's (or the
  suggested review title's) @handle differs from `posts.human_handle`.
- Manual reviews / pre-reviews (docs/review-*.md, suggested titles in `posts.review_title`): apply the same rule.
