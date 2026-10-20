// gvh-fetch: discovers @grok reply threads on X, rebuilds the chain, stores them as *pending*
// posts for the /admin/queue. Nothing is public until an admin approves it.
//
// Cost model (X pay-per-use): $0.005 per post read, $0.010 per user object. All tweet data comes from
// the paid X API v2 (no syndication scraping); the public site shows posts as official X embeds.
// Every paid request is pre-checked against DAILY_CAP_USD / MONTHLY_CAP_USD using fetch_log
// (conservative: no credit for X's 24h de-duplication), then logged with the real result count.
import { suggestTopics, suggestHeadline, insertPost, oembedAlive, cleanText } from '../../../server/v2.js';

const API_DEFAULT = 'https://api.x.com/2';
let API = API_DEFAULT;
const POST_USD = 0.005, USER_USD = 0.010;
const MAX_CHAIN = 20, MAX_UP = 20;          // whole Grok-vs-human exchange, up to 20 turns
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
      t._anchor = anchor; t._eng = score(t, e);
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
const LOOKUP_FIELDS = 'created_at,conversation_id,referenced_tweets,author_id,in_reply_to_user_id,note_tweet,attachments';
const MEDIA_FIELDS = 'type,url,preview_image_url,variants,width,height,alt_text';
const mediaMap = j => Object.fromEntries((j.includes?.media || []).map(m => [m.media_key, m]));
// Media exactly as the API returns it: photos (url), videos/GIFs (preview + best mp4 variant).
const apiMedia = (t, media) => (t.attachments?.media_keys || []).map(k => media[k]).filter(Boolean).map(m => ({
  type: m.type, url: m.url || m.preview_image_url || null, alt: m.alt_text || null,
  video: m.type === 'photo' ? null : ((m.variants || []).filter(v => v.content_type === 'video/mp4').sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0))[0]?.url || null) }));
function fromApi(t, users, media = {}) {
  const u = users[t.author_id] || {};
  return {
    tweet_id: t.id, author_id: t.author_id || null, author_handle: u.username || (t.author_id === GROK_ID ? 'grok' : '?'),
    author_name: u.name || null, author_avatar: u.profile_image_url ? u.profile_image_url.replace('_normal.', '_bigger.') : null,
    verified: u.verified ? 1 : 0, text: cleanText(t.note_tweet?.text || t.text || ''), media: apiMedia(t, media),
    created_at: t.created_at ? Math.floor(Date.parse(t.created_at) / 1000) : null,
    parent: (t.referenced_tweets || []).find(x => x.type === 'replied_to')?.id || null,
    conversation_id: t.conversation_id || null,
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
  const media = mediaMap(r.json);
  for (const t of [...(r.json.data || []), ...(r.json.includes?.tweets || [])]) out.set(t.id, fromApi(t, users, media));
  return { rows: out };
}

// Stage 2: rebuild the chain of one candidate, all via the paid X API: upward with tweet lookups
// (each call returns a post and its parent), downward with one conversation search limited to the participants.
// Paid conversation search restricted to the participants (both directions in one go), paginated.
async function conversation(env, b, conv, froms, pages = 1) {
  const map = new Map(); let token = null;
  for (let i = 0; i < pages; i++) {
    // only the human(s) and Grok's replies *to them* (a viral conversation can hold hundreds of other Grok replies)
    const hs = froms.filter(f => f !== 'grok');
    const params = { query: `conversation_id:${conv} (${hs.map(h => `from:${h} OR (from:grok to:${h})`).join(' OR ')})`, max_results: '100',
      'tweet.fields': 'created_at,referenced_tweets,author_id,in_reply_to_user_id,conversation_id,note_tweet,public_metrics,attachments', expansions: 'author_id,attachments.media_keys', 'user.fields': USER_FIELDS, 'media.fields': MEDIA_FIELDS };
    if (token) params.next_token = token;
    const r = await xGet(env, b, '/tweets/search/recent', params, 'expand', 60);
    if (r.capped) return { capped: r.capped, map };
    if (!r.ok) break;
    const users = Object.fromEntries((r.json.includes?.users || []).map(u => [u.id, u])), media = mediaMap(r.json);
    for (const t of r.json.data || []) map.set(t.id, fromApi(t, users, media));
    token = r.json.meta?.next_token; if (!token) break;
  }
  return { map };
}

// Rebuild the full exchange around one Grok post: ancestors (search results first, paid lookups only for gaps),
// then follow the alternating human <-> Grok replies down to the end of the conversation (max MAX_CHAIN turns).
async function buildChain(env, b, c) {
  const p = JSON.parse(c.payload);
  const first = await lookup(env, b, [c.grok_tweet_id], 'chain');
  if (first.capped) return { status: 'capped:' + first.capped };
  const g = first.rows.get(c.grok_tweet_id);
  if (!g) return { status: 'gone' };
  const known = first.rows;
  const asked = g.parent ? known.get(g.parent) : null;
  const humanIds = new Set([asked?.author_id, p.replier_id].filter(id => id && id !== GROK_ID));
  if (!humanIds.size) return { status: 'no_human' };
  const conv = c.conversation_id || g.conversation_id;
  const handles = [...new Set([asked?.author_handle, ...[...known.values()].filter(w => humanIds.has(w.author_id)).map(w => w.author_handle)].filter(h => h && h !== '?'))];
  if (conv && env.X_BEARER_TOKEN) {
    const r = await conversation(env, b, conv, ['grok', ...(handles.length ? handles : []), ...(p.replier_id && !handles.length ? [p.replier_id] : [])]);
    if (r.capped && !r.map.size) return { status: 'capped:' + r.capped };
    for (const [k, v] of r.map) if (!known.has(k)) known.set(k, v);
  }
  // upward
  const chain = [g];
  let up = g.parent;
  while (up && chain.length < MAX_UP) {
    if (!known.has(up)) { const r = await lookup(env, b, [up], 'chain'); if (r.capped) break; for (const [k, v] of r.rows) known.set(k, v); }
    const w = known.get(up); if (!w) break;
    chain.unshift(w); up = w.parent;
  }
  // downward: earliest reply to the last turn by the other side (human after Grok, Grok after a human)
  const kids = {}; for (const w of known.values()) if (w.parent) (kids[w.parent] ||= []).push(w);
  for (const k in kids) kids[k].sort((a, b2) => (BigInt(a.tweet_id) < BigInt(b2.tweet_id) ? -1 : 1));
  const seen = new Set(chain.map(w => w.tweet_id));
  while (chain.length < MAX_CHAIN + MAX_UP) {
    const last = chain[chain.length - 1], grokLast = last.author_id === GROK_ID;
    const next = (kids[last.tweet_id] || []).find(w => !seen.has(w.tweet_id) && (grokLast ? humanIds.has(w.author_id) : w.author_id === GROK_ID));
    if (!next) break;
    chain.push(next); seen.add(next.tweet_id);
  }
  // the human is whoever Grok answered most in this exchange
  const cnt = {}; chain.forEach((w, i) => { if (w.author_id === GROK_ID && i > 0 && chain[i - 1].author_id !== GROK_ID) cnt[chain[i - 1].author_id] = (cnt[chain[i - 1].author_id] || 0) + 1; });
  const hid = Object.entries(cnt).sort((a, b2) => b2[1] - a[1])[0]?.[0];
  const human = chain.find(w => w.author_id === hid);
  if (!human) return { status: 'no_human' };
  const blocked = await env.DB.prepare('SELECT 1 FROM blocked_authors WHERE handle = lower(?1) OR (x_id IS NOT NULL AND x_id = ?2)').bind(human.author_handle, human.author_id).first();
  if (blocked) return { status: 'blocked' };
  // drop leading posts by other people once the human's own exchange has started
  while (chain.length > 2 && chain[0].author_id !== human.author_id && chain[0].author_id !== GROK_ID
    && chain.slice(1, -1).some(w => w.author_id === human.author_id)) chain.shift();
  const tweets = chain.slice(0, MAX_CHAIN);
  return { status: 'ok', p, conv, human, tweets };
}
// Turns that alternate human/Grok, for ranking and stats.
const turns = tweets => tweets.reduce((n, w, i) => n + (i === 0 || (w.author_id === GROK_ID) !== (tweets[i - 1].author_id === GROK_ID) ? 1 : 0), 0);

async function expandOne(env, b, c) {
  const r = await buildChain(env, b, c);
  if (r.status !== 'ok') return r.status;
  const { p, conv, human, tweets } = r;
  if (conv && await env.DB.prepare('SELECT 1 FROM posts WHERE conversation_id = ?1').bind(conv).first()) return 'dup_conv';
  const topics = p.topics?.length ? p.topics : suggestTopics(tweets.map(w => w.text), p.annotations);
  const id = await insertPost(env.DB, {
    grok_tweet_id: c.grok_tweet_id, conversation_id: conv, human_x_id: human.author_id, human_handle: human.author_handle,
    headline: await aiHeadline(env, tweets), source: p.source || 'fetch', low_priority: p.low_priority ?? (tweets.some(w => EXPLICIT.test(w.text)) ? 1 : 0), x_engagement: c.engagement, tweet_created_at: tweets.find(w => w.tweet_id === c.grok_tweet_id)?.created_at, tweets, topics,
  });
  return id ? 'stored:' + tweets.length : 'duplicate';
}

// "Grok vs. @handle: <2-6 word topic>" via Workers AI (binding AI); falls back to the cleaned-question headline.
const AI_MODEL = '@cf/meta/llama-3.2-3b-instruct';
async function aiHeadline(env, tweets) {
  const human = tweets.find(w => String(w.author_handle).toLowerCase() !== 'grok' && w.author_handle && w.author_handle !== '?');
  if (!human || !env.AI) return suggestHeadline(tweets);
  try {
    const convo = tweets.slice(0, 6).map(w => `${String(w.author_handle).toLowerCase() === 'grok' ? 'Grok' : 'Human'}: ${String(w.text).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const r = await env.AI.run(AI_MODEL, { max_tokens: 20, temperature: 0.2, messages: [
      { role: 'system', content: 'You title debates. Reply with ONLY a 2-6 word topic summarizing what the thread is about, ideally a short question (e.g. "Does the universe have meaning?", "Are humans just meat computers?"). No quotes, no names, no hashtags, never copy the user\'s wording.' },
      { role: 'user', content: convo }] });
    let t = String(r?.response || '').split('\n')[0].replace(/^["'*\s]+|["'*\s]+$/g, '').replace(/^(topic|title)\s*:\s*/i, '').replace(/\s+/g, ' ');
    const words = t.split(' ').filter(Boolean).length;
    if (!t || words < 2 || words > 8 || t.length > 48 || /[@#<>]|https?:/.test(t)) return suggestHeadline(tweets);
    return `Grok vs. @${human.author_handle}: ${t.charAt(0).toUpperCase() + t.slice(1)}`;
  } catch { return suggestHeadline(tweets); }
}

// Re-build an existing pending post in place (chain + auto headline), keeping its id, votes and admin edits to topics.
async function rebuildPost(env, b, postId) {
  const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?1 AND status = 'pending'").bind(postId).first();
  if (!post) return 'not_pending';
  const old = (await env.DB.prepare('SELECT * FROM post_tweets WHERE post_id = ?1 ORDER BY pos').bind(postId).all()).results;
  const r = await buildChain(env, b, { grok_tweet_id: post.grok_tweet_id, conversation_id: post.conversation_id, payload: '{}', engagement: post.x_engagement });
  if (r.status !== 'ok') return r.status;
  if (r.tweets.length <= old.length) return 'same';
  const autoHead = !post.headline || post.headline === suggestHeadline(old);
  const st = [env.DB.prepare('DELETE FROM post_tweets WHERE post_id = ?1').bind(postId),
    ...r.tweets.map((w, i) => env.DB.prepare(`INSERT INTO post_tweets (post_id, pos, tweet_id, author_id, author_handle, author_name, author_avatar, verified, is_grok, text, media_json, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`).bind(postId, i, w.tweet_id, w.author_id, w.author_handle, w.author_name, w.author_avatar, w.verified ? 1 : 0, w.author_id === GROK_ID ? 1 : 0, w.text, JSON.stringify(w.media || []), w.created_at))];
  if (autoHead) st.push(env.DB.prepare('UPDATE posts SET headline = ?2 WHERE id = ?1').bind(postId, await aiHeadline(env, r.tweets)));
  await env.DB.batch(st);
  return 'rebuilt:' + old.length + '->' + r.tweets.length;
}

async function expand(env, b, max = 3, order = 'engagement') {
  const { results } = await env.DB.prepare(`SELECT * FROM fetch_candidates WHERE state = 'new' ORDER BY ${order === 'random' ? 'random()' : 'engagement DESC'} LIMIT ?1`).bind(max).all();
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
        const res = await rebuildPost(env, b, id).catch(e => 'error:' + e.message);
        if (String(res).startsWith('capped')) { capped = true; break; }
        done.add(id); (out.res ||= {})[id] = res;
      }
      out.done = [...done]; out.spent = await spentInRun(env, runId);
      await env.DB.prepare('UPDATE fetch_jobs SET state=?2, result=?3 WHERE id=?1').bind(job.id, capped || done.size >= spec.rebuild.length ? 'done' : 'new', JSON.stringify(out)).run();
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

export default {
  async scheduled(event, env, ctx) {
    API = env.X_API_BASE || API_DEFAULT;
    const b = new Budget(env, 'cron-' + Date.now());
    if (event.cron === '0 11,23 * * *') {
      if (!env.X_BEARER_TOKEN) return;
      await discover(env, b, { pages: 1, perPage: boosted(env) ? 100 : Number(env.DISCOVER_PER_RUN || 50), minEng: Number(env.MIN_ENGAGEMENT || 0), query: env.DISCOVER_QUERY || null, endHoursAgo: 24 });
    } else {
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
    else if (o.stage === 'recheck') result = await recheck(env, b);
    else if (o.stage === 'usage') result = await usage(env, b);
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
