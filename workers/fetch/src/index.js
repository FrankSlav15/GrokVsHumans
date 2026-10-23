import { WorkerEntrypoint } from 'cloudflare:workers';
import { digest, chicagoHour } from './digest.js';
import { buildProfile, loadProfile, likeness, queryTerms } from './learn.js';
import { rebuildConfig, parseStatusUrl } from '../../../server/config.js';
// gvh-fetch: discovers @grok reply threads on X, rebuilds the chain, stores them as *pending*
// posts for the /admin/queue. Nothing is public until an admin approves it.
//
// Cost model (X pay-per-use): $0.005 per post read, $0.010 per user object. All tweet data comes from
// the paid X API v2 (no syndication scraping); the public site shows posts as official X embeds.
// Every paid request is pre-checked against DAILY_CAP_USD / MONTHLY_CAP_USD using fetch_log
// (conservative: no credit for X's 24h de-duplication), then logged with the real result count.
import { TOPICS, suggestTopics, suggestHeadline, mainHuman, insertPost, oembedAlive, cleanText, turnText } from '../../../server/v2.js';

const API_DEFAULT = 'https://api.x.com/2';
let API = API_DEFAULT;
const POST_USD = 0.005, USER_USD = 0.010;
const MAX_CHAIN = 40, MAX_UP_LOOKUPS = 12;  // stored posts per thread (root..leaf); paid lookups allowed while walking up to the root
const GROK_ID = '1720665183188922368';
const SUB_BUDGET = 45;                       // free plan: 50 external subrequests per invocation

const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
// Initial-fill boost: higher daily cap / bigger runs through BOOST_UNTIL (inclusive, UTC date); reverts automatically.
const boosted = env => !!env.BOOST_UNTIL && ymd() <= env.BOOST_UNTIL;
const ym = (d = new Date()) => d.toISOString().slice(0, 7);
const now = () => Math.floor(Date.now() / 1000);

class Budget {
  constructor(env, runId, opts = {}) {
    this.env = env; this.runId = runId; this.sub = 0;
    this.dayCap = boosted(env) ? Number(env.BOOST_DAILY_CAP_USD || 5) : Number(env.DAILY_CAP_USD || 1.5); this.monthCap = Number(env.MONTHLY_CAP_USD || 45);
    this.runCap = opts.runCap ?? null;
    this.adminCap = opts.adminCap ?? null;  // admin quick-add: own small daily allowance (run ids 'admin-*') instead of the daily cap     // seeding run: explicit budget (replaces the daily cap, month cap still applies)
    // One-off admin override: ADMIN_MONTH_EXTRA_USD (default 0) raises the monthly cap for admin quick-adds only.
    if (this.adminCap != null) this.monthCap += Number(env.ADMIN_MONTH_EXTRA_USD || 0);
    this.spent = 0;
  }
  async totals() {
    const r = await this.env.DB.prepare(`SELECT SUM(CASE WHEN day=?1 THEN est_cost END) d, SUM(CASE WHEN month=?2 THEN est_cost END) m FROM fetch_log`).bind(ymd(), ym()).first();
    return { day: r?.d || 0, month: r?.m || 0 };
  }
  async allow(est) {
    const t = await this.totals();
    if (this.adminCap != null && t.month + est <= this.monthCap) {   // admin allowance replaces the daily cap
      const a = await this.env.DB.prepare("SELECT COALESCE(SUM(est_cost),0) s FROM fetch_log WHERE day = ?1 AND run_id LIKE 'admin-%'").bind(ymd()).first();
      if (a.s + est > this.adminCap) { this.capped = 'admin_cap'; return 'admin_cap'; }
      if (this.runCap != null && this.spent + est > this.runCap) { this.capped = 'run_cap'; return 'run_cap'; }
      return null;
    }
    const why = t.month + est > this.monthCap ? 'month_cap' : t.day + est > this.dayCap ? 'day_cap' : this.runCap != null && this.spent + est > this.runCap ? 'run_cap' : null;
    if (why) this.capped = why;            // remembered: a chain built after a capped call may be incomplete
    if (t.month + est > this.monthCap) return 'month_cap';
    // The daily cap always applies (it used to be replaced by a job/manual run budget, which let jobs and seeding
    // runs spend $11-18/day against a $5 cap). A run budget is an additional, smaller limit.
    if (t.day + est > this.dayCap) return 'day_cap';
    if (this.runCap != null && this.spent + est > this.runCap) return 'run_cap';
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
  if (r.status === 402 || r.status === 429) return { capped: 'x_' + r.status };   // out of credits / rate limited: stop
  return { ok: r.ok, status: r.status, json: j };
}

const TWEET_FIELDS = 'conversation_id,created_at,public_metrics,referenced_tweets,in_reply_to_user_id,context_annotations,author_id,attachments,lang,note_tweet';
const EXPLICIT = /\b(penis|dick|cock|pussy|vagina|cum|cumming|jerk(ing)? off|stroke my|masturbat\w*|porn\w*|nude[sz]?|naked|boobs?|tits|horny|blowjob|anal|fuck(ing|ed)?|rape\w*|nsfw|onlyfans|sex(ual|y)?)\b/i;
// Discovery ranking: prefer (a) deep multi-turn debates (a human replying to Grok, long/note text, debate words) and
// (b) funny ones (likes relative to impressions, playful words); push down one-shot "is this true" fact checks.
const DEBATE = /\b(conscious(ness)?|materialis\w*|emergen\w*|meaning|free will|philosoph\w*|moral\w*|god|soul|universe|argu\w*|logic\w*|evidence|you('re| are) wrong|disagree|contradict\w*|define|prove)\b/i;
const FUNNY = /(😂|🤣|💀|😭|\blol\b|\blmao\b|\brofl\b|\broast\w*|\bmeme\w*|\bbro\b|\bcook(ed|ing)\b|\bbased\b|\bunhinged\b|\bgoofy\b|\bjoke\w*|\bfunny\b)/i;
const FACTCHECK = /\b(is (this|that|it) (true|real|legit|accurate)|fact[- ]?check|true or false|is this ai)\b/i;
function score(t, e) {
  const m = t.public_metrics || {}, text = t.note_tweet?.text || t.text || '';
  let s = e;
  if (t.author_id !== GROK_ID && t.in_reply_to_user_id === GROK_ID) s += 15;          // the human answered Grok back = multi-turn
  if (text.length > 280) s += 8;
  if (DEBATE.test(text)) s += 10;
  if (FUNNY.test(text)) s += 10;
  if (m.impression_count > 50 && (m.like_count || 0) / m.impression_count > 0.02) s += 12;
  if (FACTCHECK.test(text) && text.length < 160) s -= 15;
  return Math.max(0, Math.round(s));
}
const eng = m => (m?.like_count || 0) + (m?.retweet_count || 0) + (m?.reply_count || 0) + (m?.quote_count || 0);

// Stage 1: paid recent search for @grok replies -> fetch_candidates.
async function discover(env, b, { pages = 1, perPage = 50, minEng = 5, start = null, query = null, endHoursAgo = 48, job = null } = {}) {
  let token = start, added = 0, seen = 0; const engs = []; let noParent = 0;
  const profile = await loadProfile(env);   // learned from manual adds / approvals; only affects ordering
  for (let i = 0; i < pages; i++) {
    const params = { query: query || 'from:grok is:reply -is:retweet lang:en', max_results: String(Math.min(100, Math.max(10, perPage))), sort_order: 'relevancy', 'tweet.fields': TWEET_FIELDS };
    if (token) params.next_token = token;
    if (endHoursAgo) params.end_time = new Date(Date.now() - endHoursAgo * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');   // let replies collect engagement first
    const r = await xGet(env, b, '/tweets/search/recent', params, 'discover', Number(params.max_results));
    if (!r.ok) break;
    const data = r.json.data || []; seen += data.length;
    const stmts = [];
    for (const t of data) {
      engs.push(eng(t.public_metrics));
      if (eng(t.public_metrics) < minEng) continue;
      let parent = (t.referenced_tweets || []).find(x => x.type === 'replied_to')?.id;
      if (!parent) { noParent++; continue; }
      let anchor = t.id, e = eng(t.public_metrics);
      if (t.author_id !== GROK_ID) {
        // Human replying to Grok = a multi-turn exchange. Anchor on the Grok post they answered.
        if (t.in_reply_to_user_id !== GROK_ID || cleanText(t.text).length < 40) continue;
        anchor = parent; parent = null; e += 1;
      }
      t._anchor = anchor; t._eng = score(t, e) + likeness(profile, t.note_tweet?.text || t.text || '', t.context_annotations || [], { multiTurn: t.author_id !== GROK_ID });
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO fetch_candidates (grok_tweet_id, conversation_id, human_x_id, payload, engagement, state, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?7, ?6 WHERE NOT EXISTS (SELECT 1 FROM posts WHERE grok_tweet_id = ?1 OR conversation_id = ?2)`)
        .bind(t._anchor, t.conversation_id, t.author_id === GROK_ID ? (t.in_reply_to_user_id || null) : t.author_id, JSON.stringify({ parent, reply_id: t.author_id === GROK_ID ? null : t.id, replier_id: t.author_id === GROK_ID ? null : t.author_id, annotations: t.context_annotations || [], created_at: t.created_at, text: t.text, ...(job ? { job, source: 'manual' } : {}) }), t._eng, now(), job ? 'job' : 'new'));
    }
    if (stmts.length) { const res = await env.DB.batch(stmts); added += res.reduce((a, x) => a + (x.meta?.changes || 0), 0); }
    token = r.json.meta?.next_token; if (!token) break;
  }
  engs.sort((a, b) => b - a);
  return { seen, added, noParent, eng_top: engs.slice(0, 15), eng_median: engs[engs.length >> 1] ?? null, next: token || null };
}

// X API v2 tweet -> our chain row. users: id -> user object from includes.users.
const USER_FIELDS = 'username,name,profile_image_url,verified';
const LOOKUP_FIELDS = 'created_at,conversation_id,referenced_tweets,author_id,in_reply_to_user_id,note_tweet,attachments,public_metrics';
const MEDIA_FIELDS = 'type,url,preview_image_url,variants,width,height,alt_text';
const mediaMap = j => Object.fromEntries((j.includes?.media || []).map(m => [m.media_key, m]));
// Media exactly as the API returns it: photos (url), videos/GIFs (preview + best mp4 variant).
const apiMedia = (t, media) => (t.attachments?.media_keys || []).map(k => media[k]).filter(Boolean).map(m => ({
  type: m.type, url: m.url || m.preview_image_url || null, alt: m.alt_text || null,
  video: m.type === 'photo' ? null : ((m.variants || []).filter(v => v.content_type === 'video/mp4').sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))[0]?.url || null) }));
// Quoted post (from includes.tweets of the same response) as a nested card entry in media_json.
function apiQuote(t, users, tweets = {}) {
  const qid = (t.referenced_tweets || []).find(x => x.type === 'quoted')?.id; if (!qid) return [];
  const q = tweets[qid], u = q ? users[q.author_id] || {} : {};
  return [{ type: 'quote', id: qid, handle: u.username || null, name: u.name || null, avatar: u.profile_image_url || null,
    text: q ? String(q.note_tweet?.text || q.text || '').replace(/\s*https:\/\/t\.co\/\w+$/, '') : null, created_at: q?.created_at ? Math.floor(Date.parse(q.created_at) / 1000) : null }];
}
function fromApi(t, users, media = {}, tweets = {}) {
  const u = users[t.author_id] || {}, m = [...apiMedia(t, media), ...apiQuote(t, users, tweets)];
  return {
    tweet_id: t.id, author_id: t.author_id || null, author_handle: u.username || (t.author_id === GROK_ID ? 'grok' : '?'),
    author_name: u.name || null, author_avatar: u.profile_image_url ? u.profile_image_url.replace('_normal.', '_bigger.') : null,
    verified: u.verified ? 1 : 0, text: turnText(t.note_tweet?.text || t.text || '', m), media: m,
    created_at: t.created_at ? Math.floor(Date.parse(t.created_at) / 1000) : null,
    parent: (t.referenced_tweets || []).find(x => x.type === 'replied_to')?.id || null,
    conversation_id: t.conversation_id || null,
    likes: t.public_metrics?.like_count || 0, replies: t.public_metrics?.reply_count || 0,
  };
}
// Paid lookup of up to N ids plus the posts they reply to (one level) and all authors. Returns Map id -> row.
async function lookup(env, b, ids, kind) {
  const r = await xGet(env, b, '/tweets', {
    ids: ids.join(','), 'tweet.fields': LOOKUP_FIELDS, expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys', 'user.fields': USER_FIELDS, 'media.fields': MEDIA_FIELDS,
  }, kind, ids.length * 2 + ids.length * 4);   // estimate: posts + parents, users at 2x post price
  if (r.capped) return { capped: r.capped };
  const out = new Map();
  if (!r.ok) return { rows: out };
  const users = Object.fromEntries((r.json.includes?.users || []).map(u => [u.id, u]));
  const media = mediaMap(r.json), all = [...(r.json.data || []), ...(r.json.includes?.tweets || [])];
  const byId = Object.fromEntries(all.map(t => [t.id, t]));
  for (const t of all) out.set(t.id, fromApi(t, users, media, byId));
  return { rows: out };
}

// Stage 2: rebuild the chain of one candidate, all via the paid X API: upward with tweet lookups
// (each call returns a post and its parent), downward with one conversation search limited to the participants.
// Paid conversation search restricted to the participants (both directions in one go), paginated.
async function conversation(env, b, conv, froms, pages = 1, { reserve = 0 } = {}) {
  const map = new Map(); let token = null;
  // Under a per-run budget, size the page to what is left (minus a reserve for the walk up), so the search fits the cap.
  let mr = 100;
  if (b.runCap != null) { mr = Math.min(100, Math.floor((b.runCap - b.spent - reserve) / (POST_USD * 1.4))); if (mr < 10) return { capped: 'run_cap', map }; }
  for (let i = 0; i < pages; i++) {
    // only the human(s) and Grok's replies *to them* (a viral conversation can hold hundreds of other Grok replies)
    const hs = froms.filter(f => f !== 'grok');
    const params = { query: `conversation_id:${conv} (${hs.map(h => `from:${h} OR (from:grok to:${h})`).join(' OR ')})`, max_results: String(mr),
      'tweet.fields': 'created_at,referenced_tweets,author_id,in_reply_to_user_id,conversation_id,note_tweet,public_metrics,attachments', expansions: 'author_id,attachments.media_keys', 'user.fields': USER_FIELDS, 'media.fields': MEDIA_FIELDS };
    if (token) params.next_token = token;
    const r = await xGet(env, b, '/tweets/search/recent', params, 'expand', Math.ceil(mr * 1.4));   // worst case: mr posts + ~20% users (2x post price)
    if (r.capped) return { capped: r.capped, map };
    if (!r.ok) break;
    const users = Object.fromEntries((r.json.includes?.users || []).map(u => [u.id, u])), media = mediaMap(r.json);
    for (const t of r.json.data || []) map.set(t.id, fromApi(t, users, media));
    token = r.json.meta?.next_token; if (!token) break;
  }
  return { map };
}

// Rebuild the full exchange around one Grok post:
//  1. the true root = the post whose id is the conversation_id (fetched by id via GET /2/tweets when it is not in the
//     search results, e.g. older than the 7-day recent-search window); the walk up from the anchor follows replied_to
//     parents (paid lookups only for gaps, batched with their own parents) until it reaches that root;
//  2. below the anchor, every branch of the known reply tree (conversation search limited to Grok + the asker(s)) is
//     scored and the best one is followed down to its leaf: engagement (likes, replies) + length, bonus for the
//     Grok <-> original-asker back-and-forth. Nothing is taken just because it came first.
function pickBranch(known, startId, { grokId = GROK_ID, askers = new Set(), maxDepth = MAX_CHAIN } = {}) {
  const kids = {}; for (const w of known.values()) if (w.parent && known.has(w.parent) && w.tweet_id !== startId) (kids[w.parent] ||= []).push(w);
  const val = w => 1 + Math.min(w.likes || 0, 50) / 5 + Math.min(w.replies || 0, 20) / 4;
  const memo = new Map();
  const best = (id, prevAuthor, depth) => {
    const key = id + '|' + depth; if (memo.has(key)) return memo.get(key);
    let top = { s: 0, path: [] };
    if (depth < maxDepth) for (const k of kids[id] || []) {
      const g = k.author_id === grokId, asker = askers.has(k.author_id);
      if (!g && !asker) continue;                                  // only Grok and the asker(s) continue the chain
      const alt = g !== (prevAuthor === grokId);                   // a real turn (human -> Grok -> human)
      const sub = best(k.tweet_id, k.author_id, depth + 1);
      const s = val(k) + (alt ? 3 : 0) + (asker || g ? 1 : 0) + sub.s;
      if (s > top.s || (s === top.s && sub.path.length + 1 > top.path.length)) top = { s, path: [k, ...sub.path] };
    }
    memo.set(key, top); return top;
  };
  const start = known.get(startId);
  return best(startId, start?.author_id, 0).path;
}

async function buildChain(env, b, c, { seed = [], search = true } = {}) {
  const p = JSON.parse(c.payload);
  // one batched lookup: the anchor, the root (conversation_id) and the first already-known post (to learn its parent)
  const ids = [...new Set([c.grok_tweet_id, c.conversation_id, seed[0]?.tweet_id].filter(Boolean))];
  const first = await lookup(env, b, ids, 'chain');
  if (first.capped) return { status: 'capped:' + first.capped };
  const g = first.rows.get(c.grok_tweet_id);
  if (!g) return { status: 'gone' };
  const known = first.rows;
  for (const w of seed) if (!known.has(w.tweet_id)) known.set(w.tweet_id, w);   // stored chain rows (free)
  const conv = g.conversation_id || c.conversation_id;
  // 1a. root by id (one paid lookup, only when it is not already known)
  if (conv && !known.has(conv)) { const r = await lookup(env, b, [conv], 'root'); if (r.capped) return { status: 'capped:' + r.capped }; for (const [k, v] of r.rows) if (!known.has(k)) known.set(k, v); }
  const root = conv ? known.get(conv) : null;
  const asked = g.parent ? known.get(g.parent) : null;
  const humanIds = new Set([root?.author_id, asked?.author_id, p.replier_id].filter(id => id && id !== GROK_ID));
  if (!humanIds.size) return { status: 'no_human' };
  const handles = [...new Set([...known.values()].filter(w => humanIds.has(w.author_id)).map(w => w.author_handle).filter(h => h && h !== '?'))];
  if (search && conv && env.X_BEARER_TOKEN && handles.length) {
    const r = await conversation(env, b, conv, ['grok', ...handles], 1, { reserve: 0.12 });   // keep ~4 lookups for the walk up
    if (r.capped && !r.map.size) return { status: 'capped:' + r.capped };
    for (const [k, v] of r.map) if (!known.has(k)) known.set(k, v);
  }
  // 1b. walk up to the root; gaps are looked up by id (each lookup also returns that post's parent)
  const chain = [g]; let up = g.parent, lookups = 0;
  while (up) {
    if (!known.has(up)) {
      if (lookups++ >= MAX_UP_LOOKUPS) break;
      const r = await lookup(env, b, [up], 'chain'); if (r.capped) break; for (const [k, v] of r.rows) if (!known.has(k)) known.set(k, v);
    }
    const w = known.get(up); if (!w || chain.some(x => x.tweet_id === w.tweet_id)) break;
    chain.unshift(w); up = w.parent;
  }
  const rootOk = !!root && chain[0].tweet_id === root.tweet_id;
  if (root && !rootOk) chain.unshift(root);                      // path not fully bridged: still open on the root post
  // 2. best branch below the anchor down to its leaf
  const askers = new Set([root?.author_id, asked?.author_id, p.replier_id].filter(id => id && id !== GROK_ID));
  for (const w of pickBranch(known, g.tweet_id, { askers, maxDepth: MAX_CHAIN })) chain.push(w);
  // the human is whoever Grok answered most in this exchange (falls back to the root author)
  const cnt = {}; chain.forEach((w, i) => { if (w.author_id === GROK_ID && i > 0 && chain[i - 1].author_id !== GROK_ID) cnt[chain[i - 1].author_id] = (cnt[chain[i - 1].author_id] || 0) + 1; });
  const hid = Object.entries(cnt).sort((a, b2) => b2[1] - a[1])[0]?.[0] || root?.author_id;
  const human = chain.find(w => w.author_id === hid);
  if (!human) return { status: 'no_human' };
  const blocked = await env.DB.prepare('SELECT 1 FROM blocked_authors WHERE handle = lower(?1) OR (x_id IS NOT NULL AND x_id = ?2)').bind(human.author_handle, human.author_id).first();
  if (blocked) return { status: 'blocked' };
  // too long: keep the root and the end of the exchange (the root is never dropped)
  const tweets = chain.length <= MAX_CHAIN ? chain : [chain[0], ...chain.slice(chain.length - (MAX_CHAIN - 1))];
  return { status: 'ok', p, conv, human, tweets, rootOk };
}
// Turns that alternate human/Grok, for ranking and stats.
const turns = tweets => tweets.reduce((n, w, i) => n + (i === 0 || (w.author_id === GROK_ID) !== (tweets[i - 1].author_id === GROK_ID) ? 1 : 0), 0);

async function expandOne(env, b, c) {
  const r = await buildChain(env, b, c);
  if (r.status !== 'ok') return r.status;
  const { p, conv, human, tweets } = r;
  if (conv && await env.DB.prepare('SELECT 1 FROM posts WHERE conversation_id = ?1').bind(conv).first()) return 'dup_conv';
  const topics = p.topics?.length ? p.topics : await aiTopics(env, tweets, p.annotations);
  const id = await insertPost(env.DB, {
    grok_tweet_id: c.grok_tweet_id, conversation_id: conv, human_x_id: human.author_id, human_handle: human.author_handle,
    headline: await aiHeadline(env, tweets, human), source: p.source || 'fetch', low_priority: p.low_priority ?? (tweets.some(w => EXPLICIT.test(w.text)) ? 1 : 0), x_engagement: c.engagement, tweet_created_at: tweets.find(w => w.tweet_id === c.grok_tweet_id)?.created_at, tweets, topics,
  });
  return id ? 'stored:' + tweets.length : 'duplicate';
}

// "Grok vs. @handle: <2-6 word topic>" via Workers AI (binding AI); falls back to the cleaned-question headline.
const AI_MODEL = '@cf/meta/llama-3.2-3b-instruct';
// TITLE RULE: the @handle is the main human participant (the one Grok answered most, = posts.human_handle from
// buildChain), never simply the opening asker. Callers pass that human; mainHuman() is the same rule as a fallback.
async function aiHeadline(env, tweets, humanIn) {
  const human = humanIn || mainHuman(tweets);
  if (!human || !env.AI) return suggestHeadline(tweets, human);
  try {
    const convo = tweets.slice(0, 6).map(w => `${String(w.author_handle).toLowerCase() === 'grok' ? 'Grok' : 'Human'}: ${String(w.text).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const r = await env.AI.run(AI_MODEL, { max_tokens: 20, temperature: 0.2, messages: [
      { role: 'system', content: 'You title debates. Reply with ONLY a 2-6 word topic summarizing what the thread is about, ideally a short question (e.g. "Does the universe have meaning?", "Are humans just meat computers?"). No quotes, no names, no hashtags, never copy the user\'s wording.' },
      { role: 'user', content: convo }] });
    let t = String(r?.response || '').split('\n')[0].replace(/^["'*\s]+|["'*\s]+$/g, '').replace(/^(topic|title)\s*:\s*/i, '').replace(/\s+/g, ' ');
    const words = t.split(' ').filter(Boolean).length;
    if (!t || words < 2 || words > 8 || t.length > 48 || /[@#<>]|https?:/.test(t)) return suggestHeadline(tweets, human);
    return `Grok vs. @${human.author_handle}: ${t.charAt(0).toUpperCase() + t.slice(1)}`;
  } catch { return suggestHeadline(tweets, human); }
}

// 1-2 topics from the root question + the overall thread: Workers AI picks from TOPICS, validated; keyword fallback.
async function aiTopics(env, tweets, annotations = []) {
  const kw = suggestTopics(tweets.map(w => w.text), annotations);
  if (!env.AI) return kw;
  try {
    const clean = s => String(s || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    const rest = tweets.slice(1).map(w => `${w.author_id === GROK_ID ? 'Grok' : 'Human'}: ${clean(w.text).slice(0, 160)}`).join('\n').slice(0, 2500);
    const r = await env.AI.run(AI_MODEL, { max_tokens: 16, temperature: 0, messages: [
      { role: 'system', content: `You categorize X threads. Allowed topics: ${TOPICS.join(', ')}. Judge mainly by what the ROOT post asks, then the thread as a whole; ignore passing jokes, emojis and side remarks. A famous person (e.g. Elon Musk) or a company being mentioned is not Politics; use Politics only for government, elections, parties, policy or wars. Reply with ONLY one topic, or two separated by a comma when both clearly apply. Use Wild Card only if nothing fits.` },
      { role: 'user', content: `ROOT: ${clean(tweets[0]?.text).slice(0, 500)}\n\nTHREAD:\n${rest}` }] });
    const out = [];
    for (const part of String(r?.response || '').split(/[,\n]/)) { const t = TOPICS.find(x => x.toLowerCase() === part.trim().replace(/[."*]/g, '').toLowerCase()); if (t && !out.includes(t)) out.push(t); }
    const res = out.filter(t => t !== 'Wild Card' || out.length === 1).slice(0, 2);
    return res.length ? res : kw;
  } catch { return kw; }
}

// Re-build an existing pending post in place (chain + auto headline), keeping its id, votes and admin edits to topics.
async function rebuildPost(env, b, postId, { search = true } = {}) {
  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?1 AND status = 'pending'").bind(postId).first();
  if (!post) return 'not_pending';
  const old = (await env.DB.prepare('SELECT * FROM post_tweets WHERE post_id = ?1 ORDER BY pos').bind(postId).all()).results;
  // seed with the stored chain (each row replies to the previous one); pos 0's parent comes from the batched lookup
  const seed = old.map((w, i) => ({ ...w, media: JSON.parse(w.media_json || '[]'), parent: i ? old[i - 1].tweet_id : null, likes: 0, replies: 0 }));
  const r = await buildChain(env, b, { grok_tweet_id: post.grok_tweet_id, conversation_id: post.conversation_id, payload: '{}', engagement: post.x_engagement }, { seed, search });
  if (r.status !== 'ok') return r.status;
  if (b.capped) return 'capped:' + b.capped + ':partial';
  if (r.tweets.map(w => w.tweet_id).join() === old.map(w => w.tweet_id).join()) return 'same';
  // auto headline = never edited: matches the fallback under the current rule or the old first-human rule
  const firstHuman = old.find(w => String(w.author_handle).toLowerCase() !== 'grok' && w.author_handle && w.author_handle !== '?');
  const autoHead = !post.headline || post.headline === suggestHeadline(old) || post.headline === suggestHeadline(old, firstHuman);
  const st = [env.DB.prepare('DELETE FROM post_tweets WHERE post_id = ?1').bind(postId),
    ...r.tweets.map((w, i) => env.DB.prepare(`INSERT INTO post_tweets (post_id, pos, tweet_id, author_id, author_handle, author_name, author_avatar, verified, is_grok, text, media_json, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`).bind(postId, i, w.tweet_id, w.author_id, w.author_handle, w.author_name, w.author_avatar, w.verified ? 1 : 0, w.author_id === GROK_ID ? 1 : 0, w.text, JSON.stringify(w.media || []), w.created_at))];
  if (autoHead) st.push(env.DB.prepare('UPDATE posts SET headline = ?2 WHERE id = ?1').bind(postId, await aiHeadline(env, r.tweets, r.human)));
  // keep the stored main human in sync with the rebuilt chain (the title rule and the batch-view check use it)
  st.push(env.DB.prepare('UPDATE posts SET human_x_id = ?2, human_handle = ?3 WHERE id = ?1').bind(postId, r.human.author_id, r.human.author_handle));
  // topics: re-suggest unless an admin set them (suggested = 0)
  const manual = await env.DB.prepare('SELECT 1 FROM post_topics WHERE post_id = ?1 AND suggested = 0').bind(postId).first();
  let topics = null;
  if (!manual) {
    topics = await aiTopics(env, r.tweets, []);
    st.push(env.DB.prepare('DELETE FROM post_topics WHERE post_id = ?1').bind(postId),
      ...topics.map(t => env.DB.prepare('INSERT OR IGNORE INTO post_topics (post_id, topic, suggested) VALUES (?1, ?2, 1)').bind(postId, t)));
  }
  await env.DB.batch(st);
  return 'rebuilt:' + old.length + '->' + r.tweets.length + (r.rootOk ? '' : ':root-gap') + (topics ? ':' + topics.join('/') : '');
}

// Free re-rank of queued candidates by likeness to the admin's manual adds / approvals (see docs/fetch-learning.md).
async function rankedCandidates(env, max, pool = 40) {
  const { results } = await env.DB.prepare(`SELECT * FROM fetch_candidates WHERE state = 'new' ORDER BY engagement DESC LIMIT ?1`).bind(Math.max(max, pool)).all();
  const profile = await loadProfile(env);
  for (const c of results) {
    let p = {}; try { p = JSON.parse(c.payload); } catch {}
    c._like = likeness(profile, p.text || '', p.annotations || [], { multiTurn: !!p.reply_id });
    c._rank = c.engagement + c._like;
  }
  return results.sort((a, b) => b._rank - a._rank).slice(0, max);
}

async function expand(env, b, max = 3, order = 'engagement') {
  const results = order === 'random'
    ? (await env.DB.prepare(`SELECT * FROM fetch_candidates WHERE state = 'new' ORDER BY random() LIMIT ?1`).bind(max).all()).results
    : await rankedCandidates(env, max);
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

// User suggestions approved in /admin/featured (state 'queued'): resolve the linked post to the Grok reply of its
// exchange, build the chain like any candidate (same Budget = same X spend caps), store a pending post "suggested by".
async function runSuggestions(env, b, max = 2) {
  const { results } = await env.DB.prepare(`SELECT s.*, u.handle FROM suggestions s JOIN users u ON u.x_id = s.x_id WHERE s.state = 'queued' AND COALESCE(s.note, '') <> ?2 ORDER BY s.id LIMIT ?1`).bind(max, QA_NOTE).all();
  const out = [];
  for (const s of results) {
    if (b.sub > SUB_BUDGET - 10) break;
    const res = await suggestionOne(env, b, s).catch(e => ({ state: 'failed', result: 'error:' + String(e.message || e).slice(0, 60) }));
    if (res.state === 'queued') { out.push({ id: s.id, capped: res.result }); break; }   // spend cap: try again on a later tick
    const t = now();
    await env.DB.prepare('UPDATE suggestions SET state = ?2, result = ?3, post_id = COALESCE(?4, post_id), updated_at = ?5 WHERE id = ?1').bind(s.id, res.state, res.result || null, res.post_id || null, t).run();
    if (res.post_id) await env.DB.prepare("UPDATE feature_requests SET post_id = ?2, updated_at = ?3 WHERE suggestion_id = ?1 AND post_id IS NULL").bind(s.id, res.post_id, t).run();
    out.push({ id: s.id, ...res });
  }
  return out;
}
async function suggestionOne(env, b, s) {
  const first = await lookup(env, b, [s.tweet_id], 'suggest');
  if (first.capped) return { state: 'queued', result: 'capped:' + first.capped };
  const w = first.rows.get(s.tweet_id);
  if (!w) return { state: 'failed', result: 'post not found (deleted, private or not visible to the API)' };
  let grok = null, conv = w.conversation_id;
  if (w.author_id === GROK_ID) grok = w.tweet_id;
  else if (w.parent && first.rows.get(w.parent)?.author_id === GROK_ID) grok = w.parent;
  else if (conv) {   // a human post: find Grok's reply to it (recent search covers the last 7 days)
    const r = await conversation(env, b, conv, ['grok', w.author_handle]);
    if (r.capped && !r.map.size) return { state: 'queued', result: 'capped:' + r.capped };
    const g = [...r.map.values()].filter(x => x.author_id === GROK_ID).sort((a, c) => (BigInt(a.tweet_id) < BigInt(c.tweet_id) ? -1 : 1));
    grok = (g.find(x => x.parent === w.tweet_id) || g[0])?.tweet_id || null;
  }
  if (!grok) return { state: 'failed', result: 'no Grok reply found in this thread' };
  const dup = await env.DB.prepare('SELECT id FROM posts WHERE grok_tweet_id = ?1 OR (conversation_id IS NOT NULL AND conversation_id = ?2) LIMIT 1').bind(grok, conv || '').first();
  if (dup) return { state: 'duplicate', result: 'already on the site', post_id: dup.id };
  const res = await expandOne(env, b, { grok_tweet_id: grok, conversation_id: conv, engagement: 0,
    payload: JSON.stringify({ source: s.source || 'manual', replier_id: w.author_id !== GROK_ID ? w.author_id : null, annotations: [] }) });
  if (String(res).startsWith('capped')) return { state: 'queued', result: res };
  if (!String(res).startsWith('stored')) return { state: res === 'dup_conv' || res === 'duplicate' ? 'duplicate' : 'failed', result: res };
  const p = await env.DB.prepare('SELECT id FROM posts WHERE grok_tweet_id = ?1').bind(grok).first();
  await env.DB.prepare('UPDATE posts SET suggested_by_x_id = ?2, suggested_by_handle = ?3 WHERE id = ?1').bind(p.id, s.x_id, s.handle).run();
  return { state: 'fetched', result: res, post_id: p.id };
}
// Rebuild-on-approve (posts.rebuild_state = 'queued', set by /admin/queue): rebuild the chain from its root, then
// publish if the admin approved it. Respects the daily/monthly caps (Budget) plus rebuildConfig().maxUsd per post; a capped
// rebuild stays queued and is retried on a later tick (i.e. after the UTC daily reset). On failure the existing chain
// is published (if approved) and the post is flagged rebuild_state = 'failed'.
async function runRebuilds(env, b0, max = 2) {
  const { results } = await env.DB.prepare("SELECT id, rebuild_publish, rebuild_feature FROM posts WHERE rebuild_state = 'queued' AND status = 'pending' ORDER BY rebuild_at, id LIMIT ?1").bind(max).all();
  const out = [];
  for (const q of results) {
    if (b0.sub > SUB_BUDGET - 16) break;
    const cfg = rebuildConfig(env);
    const b = new Budget(env, 'rebuild-' + q.id, { runCap: cfg.maxUsd }); b.sub = b0.sub;
    const res = String(await rebuildPost(env, b, q.id, { search: cfg.search }).catch(e => 'error:' + e.message));
    b0.sub = b.sub;
    if (res.startsWith('capped')) {
      // daily/monthly cap: retry later. Per-post budget exhausted: publish what we have (it is not going to get cheaper).
      if (!res.includes('run_cap')) { await env.DB.prepare('UPDATE posts SET rebuild_note = ?2 WHERE id = ?1').bind(q.id, 'waiting for daily cap reset').run(); out.push({ id: q.id, res }); break; }
    }
    const first = await env.DB.prepare('SELECT p.conversation_id c, t.tweet_id f FROM posts p LEFT JOIN post_tweets t ON t.post_id = p.id AND t.pos = 0 WHERE p.id = ?1').bind(q.id).first();
    const ok = (res.startsWith('rebuilt') || res === 'same') && !res.includes('root-gap') && first?.f === first?.c;
    const st = [env.DB.prepare('UPDATE posts SET rebuild_state = ?2, rebuild_note = ?3, rebuild_at = ?4 WHERE id = ?1').bind(q.id, ok ? 'done' : 'failed', ok ? null : res.slice(0, 80), now())];
    if (q.rebuild_publish) st.push(env.DB.prepare("UPDATE posts SET status = 'approved', featured = CASE WHEN ?2 = 1 THEN 1 ELSE featured END, approved_at = COALESCE(approved_at, ?3), hidden_reason = NULL, rebuild_publish = 0 WHERE id = ?1 AND status = 'pending'").bind(q.id, q.rebuild_feature, now()));
    await env.DB.batch(st);
    out.push({ id: q.id, res, ok, published: !!q.rebuild_publish });
  }
  return out;
}
// Paid featured spots end automatically (the feed also checks ends_at, this just records the state).
const expireFeatures = env => env.DB.prepare("UPDATE feature_requests SET state = 'expired', updated_at = ?1 WHERE state = 'active' AND ends_at <= ?1").bind(now()).run().catch(() => {});
// Admin-queued jobs (table fetch_jobs), run by the */10 cron with their own budget (run id job-<id>):
//   kind 'pick':   spec {items:[{grok, conv, topics?, low_priority?}]}  -> rebuild these chains as pending posts
//   kind 'search': spec {queries:[...], max:N}  -> recent search, rank by engagement + depth, expand the best N
async function runJob(env) {
  const job = await env.DB.prepare("SELECT * FROM fetch_jobs WHERE state IN ('new','expanding') ORDER BY id LIMIT 1").first();
  if (!job) return null;
  const spec = JSON.parse(job.spec), runId = 'job-' + job.id;
  const b = new Budget(env, runId, { runCap: Math.max(0, job.budget - await spentInRun(env, runId)) });
  const log = async (state, extra) => { const r = { ...(JSON.parse(job.result || '{}')), ...extra }; await env.DB.prepare('UPDATE fetch_jobs SET state=?2, result=?3 WHERE id=?1').bind(job.id, state, JSON.stringify(r)).run(); };
  if (job.state === 'new') {
    if (job.kind === 'pick' && spec.refix) {
      // Turns stored with empty text (mentions-only, quote posts, media-only): re-fetch with quotes, entities and authors.
      const { results } = await env.DB.prepare(`SELECT DISTINCT tweet_id FROM post_tweets WHERE length(trim(text)) = 0 LIMIT 100`).all();
      const ids = results.map(r => r.tweet_id), out = { ids: ids.length };
      if (ids.length) {
        const r = await xGet(env, b, '/tweets', { ids: ids.join(','), 'tweet.fields': 'note_tweet,attachments,entities,display_text_range,referenced_tweets,author_id,created_at',
          expansions: 'attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id', 'user.fields': USER_FIELDS, 'media.fields': MEDIA_FIELDS }, 'refix', ids.length * 4);
        if (r.ok) {
          const users = Object.fromEntries((r.json.includes?.users || []).map(u => [u.id, u])), media = mediaMap(r.json);
          const byId = Object.fromEntries([...(r.json.data || []), ...(r.json.includes?.tweets || [])].map(t => [t.id, t])), st = [], t0 = now();
          out.raw = {};
          for (const t of r.json.data || []) {
            const m = [...apiMedia(t, media), ...apiQuote(t, users, byId)];
            out.raw[t.id] = { text: t.text, quoted: m.some(x => x.type === 'quote'), media: m.filter(x => x.type !== 'quote').length };
            st.push(env.DB.prepare(`UPDATE post_tweets SET text = ?2, media_json = ?3, full_at = ?4 WHERE tweet_id = ?1`).bind(t.id, turnText(t.note_tweet?.text || t.text || '', m), JSON.stringify(m), t0));
          }
          out.missing = ids.filter(id => !byId[id]);
          for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
        } else out.error = r.capped || r.status;
      }
      out.spent = await spentInRun(env, runId);
      await env.DB.prepare("UPDATE fetch_jobs SET state='done', result=?2 WHERE id=?1").bind(job.id, JSON.stringify(out)).run();
      return { job: job.id, refix: out };
    }
    if (job.kind === 'pick' && spec.backfill) {
      // Full text (note_tweet) + media for stored turns that may be truncated; 100 ids per paid call, no user objects.
      const out = JSON.parse(job.result || '{}'); let calls = 0, capped = false;
      while (calls < 5) {
        const { results } = await env.DB.prepare(`SELECT t.tweet_id FROM post_tweets t JOIN posts p ON p.id = t.post_id
          WHERE p.status IN ('pending','approved') AND t.full_at IS NULL AND (length(t.text) BETWEEN 255 AND 300 OR t.text LIKE '%…') ORDER BY p.id DESC LIMIT 100`).all();
        if (!results.length) break;
        const ids = results.map(r => r.tweet_id);
        const r = await xGet(env, b, '/tweets', { ids: ids.join(','), 'tweet.fields': 'note_tweet,attachments', expansions: 'attachments.media_keys', 'media.fields': MEDIA_FIELDS }, 'backfill', ids.length);
        calls++;
        if (r.capped) { capped = true; break; }
        if (!r.ok) break;
        const media = mediaMap(r.json), got = new Map((r.json.data || []).map(t => [t.id, t])), t0 = now(), st = [];
        for (const id of ids) {
          const t = got.get(id);
          if (!t) { st.push(env.DB.prepare('UPDATE post_tweets SET full_at = ?2 WHERE tweet_id = ?1').bind(id, -t0)); continue; }   // gone: the daily check handles removal
          const m = apiMedia(t, media);
          st.push(env.DB.prepare(`UPDATE post_tweets SET text = ?2, media_json = CASE WHEN ?3 = '[]' THEN media_json ELSE ?3 END, full_at = ?4 WHERE tweet_id = ?1`)
            .bind(id, cleanText(t.note_tweet?.text || t.text || ''), JSON.stringify(m), t0));
          if (t.note_tweet) out.long = (out.long || 0) + 1;
        }
        for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
        out.updated = (out.updated || 0) + got.size;
      }
      const left = (await env.DB.prepare(`SELECT COUNT(*) n FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE p.status='pending' AND t.full_at IS NULL AND (length(t.text) BETWEEN 255 AND 300 OR t.text LIKE '%…')`).first()).n;
      out.left = left; out.spent = await spentInRun(env, runId);
      await env.DB.prepare('UPDATE fetch_jobs SET state=?2, result=?3 WHERE id=?1').bind(job.id, capped || !left ? 'done' : 'new', JSON.stringify(out)).run();
      return { job: job.id, backfill: out };
    }
    if (job.kind === 'pick' && spec.rebuild) {
      const out = JSON.parse(job.result || '{}'); const done = new Set(out.done || []); let capped = false;
      for (const id of spec.rebuild) {
        if (done.has(id)) continue;
        if (b.sub > SUB_BUDGET - 8) break;
        const res = await rebuildPost(env, b, id, { search: spec.search !== false }).catch(e => 'error:' + e.message);
        if (String(res).startsWith('capped')) { capped = true; break; }
        done.add(id); (out.res ||= {})[id] = res;
      }
      out.done = [...done]; out.spent = await spentInRun(env, runId);
      await env.DB.prepare('UPDATE fetch_jobs SET state=?2, result=?3 WHERE id=?1').bind(job.id, done.size >= spec.rebuild.length ? 'done' : 'new', JSON.stringify(out)).run();   // capped: retried on a later tick (after the daily reset)
      return { job: job.id, rebuild: done.size };
    }
    if (job.kind === 'pick') {
      await env.DB.batch(spec.items.map(it => env.DB.prepare(`INSERT OR REPLACE INTO fetch_candidates (grok_tweet_id, conversation_id, human_x_id, payload, engagement, state, created_at) VALUES (?1, ?2, NULL, ?3, 0, 'job', ?4)`)
        .bind(it.grok, it.conv || null, JSON.stringify({ job: job.id, source: 'manual', topics: it.topics || null, low_priority: it.low_priority ?? null, annotations: [] }), now())));
    } else {
      const found = [];
      for (const q of spec.queries) found.push(await discover(env, b, { pages: 1, perPage: 100, minEng: 0, query: q, endHoursAgo: 0, job: job.id }));
      // one candidate per conversation (the latest Grok post = longest chain), ranked by engagement + depth (hits per conversation)
      const { results } = await env.DB.prepare(`SELECT grok_tweet_id, conversation_id, engagement FROM fetch_candidates WHERE state='job' AND json_extract(payload,'$.job')=?1`).bind(job.id).all();
      const conv = {};
      for (const c of results) { const k = c.conversation_id || c.grok_tweet_id; const o = conv[k] ||= { best: c, hits: 0, eng: 0 }; o.hits++; o.eng = Math.max(o.eng, c.engagement); if (BigInt(c.grok_tweet_id) > BigInt(o.best.grok_tweet_id)) o.best = c; }
      const ranked = Object.values(conv).sort((a, b2) => (b2.eng + 5 * b2.hits) - (a.eng + 5 * a.hits));
      const keep = new Set(ranked.slice(0, spec.max || 20).map(o => o.best.grok_tweet_id));
      const drop = results.filter(c => !keep.has(c.grok_tweet_id));
      for (let i = 0; i < drop.length; i += 50) await env.DB.batch(drop.slice(i, i + 50).map(c => env.DB.prepare("UPDATE fetch_candidates SET state='job-skip' WHERE grok_tweet_id=?1").bind(c.grok_tweet_id)));
      for (const c of ranked.slice(0, spec.max || 20)) await env.DB.prepare('UPDATE fetch_candidates SET engagement=?2 WHERE grok_tweet_id=?1').bind(c.best.grok_tweet_id, c.eng + 5 * c.hits).run();
      await log('expanding', { discover: found.map(f => ({ seen: f.seen, added: f.added })), conversations: ranked.length, selected: keep.size });
      return { job: job.id, discovered: true };
    }
  }
  const { results: todo } = await env.DB.prepare(`SELECT * FROM fetch_candidates WHERE state='job' AND json_extract(payload,'$.job')=?1 ORDER BY engagement DESC`).bind(job.id).all();
  const out = JSON.parse(job.result || '{}').expand || {};
  let capped = false;
  for (const c of todo) {
    if (b.sub > SUB_BUDGET - 12) break;
    const res = await expandOne(env, b, c).catch(e => 'error:' + e.message);
    if (String(res).startsWith('capped')) { capped = true; out.capped = (out.capped || 0) + 1; break; }
    out[res] = (out[res] || 0) + 1;
    await env.DB.prepare('UPDATE fetch_candidates SET state = ?2 WHERE grok_tweet_id = ?1').bind(c.grok_tweet_id, 'job:' + String(res).slice(0, 36)).run();
  }
  const left = (await env.DB.prepare(`SELECT COUNT(*) n FROM fetch_candidates WHERE state='job' AND json_extract(payload,'$.job')=?1`).bind(job.id).first()).n;
  await log(left && !capped ? 'expanding' : 'done', { expand: out, left, spent: await spentInRun(env, runId) });
  return { job: job.id, out, left };
}

// Admin quick-add (/admin/queue "Add a thread"), called by the Pages Function /api/admin/quickadd over the
// service binding FETCH (entrypoint QuickAdd; RPC is not reachable from the public workers.dev URL).
// Same path as suggestions: resolve the Grok reply, rebuild the chain root-first, main-human title, AI topics, pending.
// Budget: ADMIN_DAILY_USD (default $1) per UTC day for admin runs, independent of the daily cap; the monthly cap still applies.
// Deferred quick-adds: a quick-add blocked by admin_cap/month_cap/day_cap is saved as a suggestions row (state 'queued',
// note QA_NOTE) and retried by the */10 cron through the same adminAdd() path once the budget allows.
const QA_NOTE = 'admin quick-add (deferred)';
const adminUsed = async env => (await env.DB.prepare("SELECT COALESCE(SUM(est_cost),0) s FROM fetch_log WHERE day = ?1 AND run_id LIKE 'admin-%'").bind(ymd()).first()).s;
const CAP_ERR = r => String(r || '').includes('month') ? 'month_cap' : String(r || '').includes('day_cap') ? 'day_cap' : 'admin_cap';
async function adminAdd(env, tweetId, adminXId, adminHandle) {
  const cap = Number(env.ADMIN_DAILY_USD || 1);
  // Size this add to what is left of today's allowance (max $0.60 per add): the conversation search shrinks its page to fit,
  // so a worst-case estimate cannot block an add that would really cost a few cents.
  const used = await adminUsed(env);
  const runCap = Math.min(0.6, cap - used);
  if (runCap < 0.1) return { error: 'admin_cap', tweet_id: tweetId, cost: 0, admin_spent_today: Math.round(used * 1000) / 1000, admin_cap: cap };
  const b = new Budget(env, 'admin-' + Date.now(), { adminCap: cap, runCap });
  const res = await suggestionOne(env, b, { tweet_id: tweetId, x_id: adminXId, handle: adminHandle || null, source: 'manual' })   // posts.source CHECK allows fetch|manual|...; 'added by admin' = manual + suggested_by_x_id in ADMIN_X_IDS
    .catch(e => ({ state: 'failed', result: 'error:' + String(e.message || e).slice(0, 80) }));
  const left = await adminUsed(env);
  const out = { tweet_id: tweetId, cost: Math.round(b.spent * 1000) / 1000, admin_spent_today: Math.round(left * 1000) / 1000, admin_cap: cap, result: res.result || null };
  if (res.state === 'fetched') {
    if (b.capped) await env.DB.prepare("UPDATE posts SET rebuild_note = 'quick-add hit the admin allowance; thread may be incomplete' WHERE id = ?1").bind(res.post_id).run();
    return { ok: true, post_id: res.post_id, partial: !!b.capped, ...out };
  }
  if (res.state === 'duplicate') return { error: 'duplicate', post_id: res.post_id || null, ...out };
  if (res.state === 'queued') return { error: CAP_ERR(res.result), ...out };
  return { error: 'failed', ...out };
}
// Cron: process the oldest deferred quick-add if budget allows. Free pre-check (D1 only) so a capped month does not log every tick.
async function runDeferredAdds(env) {
  const s = await env.DB.prepare(`SELECT s.*, u.handle FROM suggestions s JOIN users u ON u.x_id = s.x_id WHERE s.state = 'queued' AND s.note = ?1 ORDER BY s.id LIMIT 1`).bind(QA_NOTE).first();
  if (!s) return null;
  const probe = new Budget(env, 'admin-probe', { adminCap: Number(env.ADMIN_DAILY_USD || 1) });
  const t0 = await probe.totals();
  if (t0.month + 0.05 > probe.monthCap || Number(env.ADMIN_DAILY_USD || 1) - await adminUsed(env) < 0.1) return { id: s.id, waiting: true };
  const r = await adminAdd(env, s.tweet_id, s.x_id, s.handle);
  const t = now();
  if (/_cap$/.test(r.error || '') && !r.cost) {   // still capped and nothing spent: stay queued
    await env.DB.prepare('UPDATE suggestions SET result = ?2, updated_at = ?3 WHERE id = ?1').bind(s.id, 'waiting: ' + r.error, t).run();
    return { id: s.id, waiting: true, ...r };
  }
  const state = r.ok ? 'fetched' : r.error === 'duplicate' ? 'duplicate' : /_cap$/.test(r.error || '') ? 'queued' : 'failed';
  await env.DB.prepare('UPDATE suggestions SET state = ?2, result = ?3, post_id = COALESCE(?4, post_id), updated_at = ?5 WHERE id = ?1')
    .bind(s.id, state, String(r.result || r.error || '').slice(0, 80) + (r.ok ? ' (admin quick-add, deferred)' : ''), r.post_id || null, t).run();
  return { id: s.id, state, ...r };
}

// service binding FETCH (entrypoint QuickAdd; RPC is not reachable from the public workers.dev URL).
// Budget: ADMIN_DAILY_USD (default $1) per UTC day for admin runs, independent of the daily cap; the monthly cap still applies.
// Blocked by a spend cap -> saved as a deferred quick-add (see runDeferredAdds) instead of dropped.
export class QuickAdd extends WorkerEntrypoint {
  async add({ url, adminXId, adminHandle, dryRun = false }) {
    const env = this.env;
    API = env.X_API_BASE || API_DEFAULT;
    const tweetId = parseStatusUrl(url);
    if (!tweetId) return { error: 'bad_url' };
    const onSite = await env.DB.prepare(`SELECT p.id, p.status FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE t.tweet_id = ?1
                                         UNION ALL SELECT id, status FROM posts WHERE grok_tweet_id = ?1 LIMIT 1`).bind(tweetId).first();
    if (onSite) return { error: 'duplicate', post_id: onSite.id, status: onSite.status, cost: 0 };
    const waiting = await env.DB.prepare("SELECT id FROM suggestions WHERE tweet_id = ?1 AND state IN ('new','queued') LIMIT 1").bind(tweetId).first();
    if (waiting) return { error: 'duplicate_waiting', suggestion_id: waiting.id, cost: 0 };
    if (!env.X_BEARER_TOKEN) return { error: 'no_x_token' };
    const defer = async (why, extra = {}) => {
      if (dryRun) return { deferred: true, dry_run: true, reason: why, ...extra };
      const r = await env.DB.prepare("INSERT INTO suggestions (x_id, tweet_id, url, note, state, result, created_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6)")
        .bind(adminXId, tweetId, url, QA_NOTE, 'waiting: ' + why, now()).run();
      return { deferred: true, reason: why, suggestion_id: r.meta?.last_row_id ?? null, ...extra };
    };
    // free pre-check: monthly cap (admin view) and today's admin allowance
    const probe = new Budget(env, 'admin-probe', { adminCap: Number(env.ADMIN_DAILY_USD || 1) });
    const t0 = await probe.totals(), used0 = await adminUsed(env), cap = Number(env.ADMIN_DAILY_USD || 1);
    const info = { tweet_id: tweetId, cost: 0, admin_spent_today: Math.round(used0 * 1000) / 1000, admin_cap: cap };
    if (t0.month + 0.05 > probe.monthCap) return defer('month_cap', info);
    if (cap - used0 < 0.1) return defer('admin_cap', info);
    if (dryRun) return { dry_run: true, would: 'fetch', ...info };
    const r = await adminAdd(env, tweetId, adminXId, adminHandle);
    if (/^(admin|month|day)_cap$/.test(r.error || '')) return defer(r.error, r);
    return r;
  }
}

export default {
  async scheduled(event, env, ctx) {
    // Daily moderation digest at 08:00 America/Chicago (13:00 UTC in CDT, 14:00 UTC in CST; the other run is a no-op).
    if (event.cron === '0 13,14 * * *') {
      await buildProfile(env).catch(e => console.log('learn error', String(e)));   // free: D1 only
      if (chicagoHour() === 8) console.log('digest', JSON.stringify(await digest(env)));
      return;
    }
    // Effective caps for the admin queue header (boost-aware).
    await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('caps', ?1)").bind(JSON.stringify({ day: boosted(env) ? Number(env.BOOST_DAILY_CAP_USD || 5) : Number(env.DAILY_CAP_USD || 1.5), month: Number(env.MONTHLY_CAP_USD || 45), boost_until: boosted(env) ? env.BOOST_UNTIL : null })).run().catch(() => {});
    API = env.X_API_BASE || API_DEFAULT;
    const b = new Budget(env, 'cron-' + Date.now());
    if (event.cron === '0 11,23 * * *') {
      if (!env.X_BEARER_TOKEN) return;
      // The 23:00 UTC run narrows the same query with learned OR-terms (same max_results, so same cost); 11:00 stays broad.
      let query = env.DISCOVER_QUERY || null;
      if (query && env.LEARN_QUERY !== '0' && new Date().getUTCHours() === 23) { const t = queryTerms(await loadProfile(env)); if (t) query += ' ' + t; }
      await discover(env, b, { pages: 1, perPage: boosted(env) ? 100 : Number(env.DISCOVER_PER_RUN || 50), minEng: Number(env.MIN_ENGAGEMENT || 0), query, endHoursAgo: 24 });
    } else {
      await expireFeatures(env);
      // deferred admin quick-adds first (own admin allowance); a tick that spent on one ends here
      if (env.X_BEARER_TOKEN) { const d = await runDeferredAdds(env).catch(e => (console.log('deferred add error', String(e)), null)); if (d && !d.waiting) return; }
      // approved-but-mid-thread posts first: the owner is waiting for them
      if (env.X_BEARER_TOKEN && (await runRebuilds(env, b).catch(e => (console.log('rebuild error', String(e)), []))).some(x => x.ok !== undefined)) return;
      // a suggestion skipped by the spend cap must not starve admin jobs (they carry their own budget)
      if (env.X_BEARER_TOKEN && (await runSuggestions(env, b).catch(e => (console.log('suggest error', String(e)), []))).some(x => !x.capped)) return;
      if (env.X_BEARER_TOKEN && await runJob(env).catch(e => (console.log('job error', String(e)), null))) return;   // a job tick uses this invocation's subrequests
      const lim = boosted(env) ? Number(env.BOOST_EXPAND_PER_DAY || 60) : Number(env.EXPAND_PER_DAY || 20);
      const done = (await env.DB.prepare("SELECT COUNT(*) n FROM fetch_log WHERE kind='expand' AND day=?1 AND run_id LIKE 'cron-%'").bind(ymd()).first()).n;
      if (done < lim) await expand(env, b, Math.min(3, lim - done));
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
    if (!(await keyOk(auth, env.RUN_KEY))) return new Response('unauthorized', { status: 401 });
    const o = await request.json().catch(() => ({}));
    const runCap = o.budget != null ? Math.min(Math.max(Number(o.budget) || 0, 0), 8) : null;   // hard ceiling: $8 per manual run id
    // L1: the run id is server-chosen (one per UTC day), so callers cannot reset the per-run budget by picking a new id.
    const runId = 'manual-' + ymd();
    const b = new Budget(env, runId, { runCap: runCap == null ? null : Math.max(0, runCap - await spentInRun(env, runId)) });
    let result;
    if (o.stage === 'discover') result = await discover(env, b, { pages: Math.min(Number(o.pages) || 1, 10), perPage: Math.min(Math.max(Number(o.perPage) || 100, 10), 100), minEng: Number(o.minEng ?? 5), start: o.next || null, query: o.query || null, endHoursAgo: o.endHoursAgo ?? 48 });
    else if (o.stage === 'expand') result = await expand(env, b, Math.min(Number(o.max) || 3, 5), o.order);
    else if (o.stage === 'learn') {   // dry run, free: rebuild the profile and show the next candidates expand would pick
      const profile = await buildProfile(env);
      const next = (await rankedCandidates(env, Math.min(Number(o.max) || 10, 40))).map(c => { let p = {}; try { p = JSON.parse(c.payload); } catch {}
        return { id: c.grok_tweet_id, engagement: c.engagement, like: c._like, text: String(p.text || '').slice(0, 120) }; });
      result = { profile, query_terms: queryTerms(profile), next };
    }
    else if (o.stage === 'recheck') result = await recheck(env, b);
    else if (o.stage === 'usage') result = await usage(env, b);
    else if (o.stage === 'suggest') result = await runSuggestions(env, b, Math.min(Number(o.max) || 2, 5));
    else if (o.stage === 'digest') result = await digest(env, { send: o.send === true, force: o.force === true });   // default: dry run (store only)
    else result = { candidates: (await env.DB.prepare('SELECT state, COUNT(*) n FROM fetch_candidates GROUP BY state').all()).results,
      spend: await b.totals(), run_spent: await spentInRun(env, runId) };
    return Response.json({ runId, spent_this_call: b.spent, subrequests: b.sub, result });
  },
};
// L1: constant-time comparison of the Authorization header with "Bearer <RUN_KEY>".
async function keyOk(auth, key) {
  if (!key) return false;
  const enc = new TextEncoder();
  const a = enc.encode(String(auth)), b = enc.encode('Bearer ' + key);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
async function spentInRun(env, runId) {
  return (await env.DB.prepare('SELECT COALESCE(SUM(est_cost),0) s FROM fetch_log WHERE run_id = ?1').bind(runId).first()).s;
}
