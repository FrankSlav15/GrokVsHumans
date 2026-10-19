// gvh-fetch: discovers @grok reply threads on X, rebuilds the chain, stores them as *pending*
// posts for the /admin/queue. Nothing is public until an admin approves it.
//
// Cost model (X pay-per-use): $0.005 per post read. We never request user objects
// (author names/avatars come from the free syndication endpoint), so users_read stays 0.
// Every paid request is pre-checked against DAILY_CAP_USD / MONTHLY_CAP_USD using fetch_log
// (conservative: no credit for X's 24h de-duplication), then logged with the real result count.
import { suggestTopics, suggestHeadline, syndicationTweet, tweetFromSyndication, insertPost, oembedAlive, cleanText } from '../../../server/v2.js';

const API_DEFAULT = 'https://api.x.com/2';
let API = API_DEFAULT;
const POST_USD = 0.005, USER_USD = 0.010;
const MAX_CHAIN = 10, MAX_UP = 7;
const SUB_BUDGET = 45;                       // free plan: 50 external subrequests per invocation

const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
const ym = (d = new Date()) => d.toISOString().slice(0, 7);
const now = () => Math.floor(Date.now() / 1000);

class Budget {
  constructor(env, runId, opts = {}) {
    this.env = env; this.runId = runId; this.sub = 0;
    this.dayCap = Number(env.DAILY_CAP_USD || 1.5); this.monthCap = Number(env.MONTHLY_CAP_USD || 45);
    this.runCap = opts.runCap ?? null;     // seeding run: explicit budget (replaces the daily cap, month cap still applies)
    this.spent = 0;
  }
  async totals() {
    const r = await this.env.DB.prepare(`SELECT SUM(CASE WHEN day=?1 THEN est_cost END) d, SUM(CASE WHEN month=?2 THEN est_cost END) m FROM fetch_log`).bind(ymd(), ym()).first();
    return { day: r?.d || 0, month: r?.m || 0 };
  }
  async allow(est) {
    const t = await this.totals();
    if (t.month + est > this.monthCap) return 'month_cap';
    if (this.runCap != null) { if (this.spent + est > this.runCap) return 'run_cap'; }
    else if (t.day + est > this.dayCap) return 'day_cap';
    return null;
  }
  take(n = 1) { if (this.sub + n > SUB_BUDGET) return false; this.sub += n; return true; }
  async log(kind, endpoint, status, posts, users, candidates = 0, note = null) {
    const cost = posts * POST_USD + users * USER_USD; this.spent += cost;
    await this.env.DB.prepare(`INSERT INTO fetch_log (run_id, at, day, month, kind, endpoint, http_status, posts_read, users_read, est_cost, candidates, note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`)
      .bind(this.runId, now(), ymd(), ym(), kind, endpoint, status, posts, users, cost, candidates, note).run();
  }
}

async function xGet(env, b, path, params, kind, maxPosts) {
  const est = maxPosts * POST_USD;
  const why = await b.allow(est);
  if (why) { await b.log('note', path, 0, 0, 0, 0, `skipped: ${why} (est $${est.toFixed(3)})`); return { capped: why }; }
  if (!b.take()) return { capped: 'subrequests' };
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  const posts = (j.data?.length || 0) + (j.includes?.tweets?.length || 0);
  const users = j.includes?.users?.length || 0;
  await b.log(kind, path, r.status, posts, users, 0, r.ok ? (j.meta?.next_token ? 'next:' + j.meta.next_token : null) : JSON.stringify(j).slice(0, 300));
  return { ok: r.ok, status: r.status, json: j };
}

const TWEET_FIELDS = 'conversation_id,created_at,public_metrics,referenced_tweets,in_reply_to_user_id,context_annotations,author_id,attachments,lang';
const eng = m => (m?.like_count || 0) + (m?.retweet_count || 0) + (m?.reply_count || 0) + (m?.quote_count || 0);

// Stage 1: paid recent search for @grok replies -> fetch_candidates.
async function discover(env, b, { pages = 1, perPage = 50, minEng = 5 } = {}) {
  let token = null, added = 0, seen = 0;
  for (let i = 0; i < pages; i++) {
    const params = { query: 'from:grok is:reply -is:retweet lang:en', max_results: String(Math.min(100, Math.max(10, perPage))), sort_order: 'relevancy', 'tweet.fields': TWEET_FIELDS };
    if (token) params.next_token = token;
    const r = await xGet(env, b, '/tweets/search/recent', params, 'discover', Number(params.max_results));
    if (!r.ok) break;
    const data = r.json.data || []; seen += data.length;
    const stmts = [];
    for (const t of data) {
      if (eng(t.public_metrics) < minEng) continue;
      const parent = (t.referenced_tweets || []).find(x => x.type === 'replied_to')?.id;
      if (!parent) continue;
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO fetch_candidates (grok_tweet_id, conversation_id, human_x_id, payload, engagement, state, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, 'new', ?6 WHERE NOT EXISTS (SELECT 1 FROM posts WHERE grok_tweet_id = ?1 OR conversation_id = ?2)`)
        .bind(t.id, t.conversation_id, t.in_reply_to_user_id || null, JSON.stringify({ parent, annotations: t.context_annotations || [], created_at: t.created_at, text: t.text }), eng(t.public_metrics), now()));
    }
    if (stmts.length) { const res = await env.DB.batch(stmts); added += res.reduce((a, x) => a + (x.meta?.changes || 0), 0); }
    token = r.json.meta?.next_token; if (!token) break;
  }
  return { seen, added };
}

// Stage 2: rebuild the chain of one candidate. Upward = free syndication; downward = one paid
// conversation search limited to the two participants (max 10 posts).
async function expandOne(env, b, c) {
  const p = JSON.parse(c.payload);
  const g = await syndicationTweet(c.grok_tweet_id); b.take();
  if (!g.tweet) return 'gone';
  const chain = [tweetFromSyndication(g.tweet)];
  let up = chain[0].parent;
  while (up && chain.length < MAX_UP && b.take()) {
    const r = await syndicationTweet(up); if (!r.tweet) break;
    const w = tweetFromSyndication(r.tweet); chain.unshift(w); up = w.parent;
  }
  // The human is the author Grok answered (the tweet right above Grok's reply).
  const human = chain.length > 1 ? chain[chain.length - 2] : null;
  if (!human || human.author_handle.toLowerCase() === 'grok') return 'no_human';
  const blocked = await env.DB.prepare('SELECT 1 FROM blocked_authors WHERE handle = lower(?1) OR (x_id IS NOT NULL AND x_id = ?2)').bind(human.author_handle, human.author_id).first();
  if (blocked) return 'blocked';
  // Trim the upward part to the participants' own exchange where possible (keep the post Grok answered).
  while (chain.length > 2 && ![human.author_handle.toLowerCase(), 'grok'].includes(chain[0].author_handle.toLowerCase())
    && chain.slice(1, -2).some(w => w.author_handle.toLowerCase() === human.author_handle.toLowerCase())) chain.shift();

  const conv = c.conversation_id || chain[0].conversation_id;
  const upCount = chain.length;
  if (conv && env.X_BEARER_TOKEN) {
    const r = await xGet(env, b, '/tweets/search/recent', {
      query: `conversation_id:${conv} (from:grok OR from:${human.author_handle})`, max_results: '10',
      'tweet.fields': 'created_at,referenced_tweets,author_id,in_reply_to_user_id', since_id: c.grok_tweet_id,
    }, 'expand', 10);
    if (r.capped) return 'capped:' + r.capped;
    if (r.ok) {
      const have = new Set(chain.map(w => w.tweet_id));
      const later = (r.json.data || []).sort((a, b2) => (BigInt(a.id) < BigInt(b2.id) ? -1 : 1));
      for (const t of later) {
        if (chain.length - upCount >= MAX_CHAIN - 2) break;      // keep Grok's reply + the post it answered
        const parent = (t.referenced_tweets || []).find(x => x.type === 'replied_to')?.id;
        if (!parent || !have.has(parent) || have.has(t.id)) continue;   // must continue *this* branch
        let w = null;
        if (b.take()) { const s = await syndicationTweet(t.id); if (s.tweet) w = tweetFromSyndication(s.tweet); }
        if (!w) { const src = t.author_id === human.author_id ? human : chain.find(x => x.author_handle.toLowerCase() === 'grok');
          w = { ...src, tweet_id: t.id, text: cleanText(t.text), media: [], created_at: Math.floor(Date.parse(t.created_at) / 1000), parent }; }
        chain.push(w); have.add(t.id);
      }
    }
  }
  const tweets = chain.slice(-MAX_CHAIN);
  const topics = suggestTopics(tweets.map(w => w.text), p.annotations);
  const id = await insertPost(env.DB, {
    grok_tweet_id: c.grok_tweet_id, conversation_id: conv, human_x_id: human.author_id, human_handle: human.author_handle,
    headline: suggestHeadline(tweets), source: 'fetch', x_engagement: c.engagement, tweet_created_at: chain.find(w => w.tweet_id === c.grok_tweet_id)?.created_at, tweets, topics,
  });
  return id ? 'stored' : 'duplicate';
}

async function expand(env, b, max = 3) {
  const { results } = await env.DB.prepare("SELECT * FROM fetch_candidates WHERE state = 'new' ORDER BY engagement DESC LIMIT ?1").bind(max).all();
  const out = {};
  for (const c of results) {
    if (b.sub > SUB_BUDGET - 12) break;              // room for up to 7 up + 1 paid + a few down
    const res = await expandOne(env, b, c).catch(e => 'error:' + e.message);
    out[res] = (out[res] || 0) + 1;
    if (String(res).startsWith('capped')) break;
    await env.DB.prepare('UPDATE fetch_candidates SET state = ?2 WHERE grok_tweet_id = ?1').bind(c.grok_tweet_id, String(res).slice(0, 40)).run();
  }
  return out;
}

// Free daily re-check of approved posts via oEmbed: any deleted/protected tweet in the chain hides the post.
async function recheck(env, b) {
  const { results } = await env.DB.prepare(`SELECT id FROM posts WHERE status = 'approved' AND COALESCE(last_checked_at, 0) < ?1 ORDER BY COALESCE(last_checked_at, 0) LIMIT 10`).bind(now() - 86400).all();
  let checked = 0, hidden = 0;
  for (const { id } of results) {
    const { results: tw } = await env.DB.prepare('SELECT tweet_id FROM post_tweets WHERE post_id = ?1 ORDER BY pos').bind(id).all();
    if (b.sub + tw.length > SUB_BUDGET) break;
    let dead = null, unknown = false;
    for (const t of tw) { b.take(); const a = await oembedAlive(t.tweet_id); if (a === false) { dead = t.tweet_id; break; } if (a === null) unknown = true; }
    if (dead) { await env.DB.prepare("UPDATE posts SET status='hidden', hidden_reason=?2, last_checked_at=?3 WHERE id=?1").bind(id, 'x_deleted:' + dead, now()).run(); hidden++; }
    else if (!unknown) await env.DB.prepare('UPDATE posts SET last_checked_at=?2, check_failures=0 WHERE id=?1').bind(id, now()).run();
    checked++;
  }
  return { checked, hidden };
}

async function usage(env, b) {
  if (!b.take()) return null;
  const r = await fetch(`${API}/usage/tweets?days=1&usage.fields=daily_project_usage,cap_reset_day,project_usage,project_cap`, { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
  const j = await r.json().catch(() => ({}));
  await b.log('usage', '/usage/tweets', r.status, 0, 0, 0, JSON.stringify(j.data || j).slice(0, 900));
  return j;
}

export default {
  async scheduled(event, env, ctx) {
    API = env.X_API_BASE || API_DEFAULT;
    const b = new Budget(env, 'cron-' + Date.now());
    if (event.cron === '0 11,23 * * *') {
      if (!env.X_BEARER_TOKEN) return;
      await discover(env, b, { pages: 1, perPage: Number(env.DISCOVER_PER_RUN || 50), minEng: Number(env.MIN_ENGAGEMENT || 5) });
    } else {
      await expand(env, b, 3);
      await recheck(env, b);
    }
  },
  // Manual run (seeding / testing). POST /run  Authorization: Bearer <RUN_KEY>
  // body: {"stage":"discover"|"expand"|"recheck"|"usage"|"status", "budget":8, "pages":5, "perPage":100, "minEng":5, "max":3}
  async fetch(request, env) {
    API = env.X_API_BASE || API_DEFAULT;   // override only for local tests
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') return new Response('gvh-fetch', { status: 404 });
    const auth = request.headers.get('Authorization') || '';
    if (!env.RUN_KEY || auth !== `Bearer ${env.RUN_KEY}`) return new Response('unauthorized', { status: 401 });
    const o = await request.json().catch(() => ({}));
    const runCap = o.budget != null ? Math.min(Number(o.budget), 8) : null;          // hard ceiling: $8 per manual run
    const runId = String(o.run || 'manual-' + ymd());
    const b = new Budget(env, runId, { runCap: runCap == null ? null : Math.max(0, runCap - await spentInRun(env, runId)) });
    let result;
    if (o.stage === 'discover') result = await discover(env, b, { pages: Math.min(Number(o.pages) || 1, 10), perPage: Number(o.perPage) || 100, minEng: Number(o.minEng ?? 5) });
    else if (o.stage === 'expand') result = await expand(env, b, Math.min(Number(o.max) || 3, 5));
    else if (o.stage === 'recheck') result = await recheck(env, b);
    else if (o.stage === 'usage') result = await usage(env, b);
    else result = { candidates: (await env.DB.prepare('SELECT state, COUNT(*) n FROM fetch_candidates GROUP BY state').all()).results,
      spend: await b.totals(), run_spent: await spentInRun(env, runId) };
    return Response.json({ runId, spent_this_call: b.spent, subrequests: b.sub, result });
  },
};
async function spentInRun(env, runId) {
  return (await env.DB.prepare('SELECT COALESCE(SUM(est_cost),0) s FROM fetch_log WHERE run_id = ?1').bind(runId).first()).s;
}
