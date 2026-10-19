// GET /api/feed?view=hot|new|top|hall&range=all|week&topic=Science&limit=30
// Only approved posts. Returns each post with its full chain, topics, vote totals, reactions,
// comment count and (when signed in) the viewer's own vote/reaction.
// M2: ranking runs over at most CANDIDATES recent approved posts (SQL LIMIT); chains, topics and the
// viewer's own state are then loaded only for the posts on the page. Anonymous responses are edge-cached.
import { json, getSessionUser, getCookie, SESSION_COOKIE, now } from '../../server/lib.js';
import { TOPICS, engagement, hotScore } from '../../server/v2.js';

const CANDIDATES = 500;   // newest approved posts considered for ranking
const ANON_TTL = 30;      // seconds, anonymous edge cache

export async function onRequestGet(ctx) {
  const { request } = ctx;
  const anon = !getCookie(request, SESSION_COOKIE);
  const cache = anon && typeof caches !== 'undefined' ? caches.default : null;
  const key = cache ? new Request(new URL(request.url).toString(), { method: 'GET' }) : null;
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const res = await build(ctx);
  if (cache && res.status === 200) {
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', `public, max-age=0, s-maxage=${ANON_TTL}`);
    ctx.waitUntil?.(cache.put(key, out.clone()));
    return out;
  }
  return res;
}

async function build({ request, env }) {
  const q = new URL(request.url).searchParams;
  const view = ['hot', 'new', 'top', 'hall'].includes(q.get('view')) ? q.get('view') : 'hot';
  const range = q.get('range') === 'week' ? 'week' : 'all';
  const topic = TOPICS.includes(q.get('topic')) ? q.get('topic') : null;
  const one = /^[0-9]{1,9}$/.test(q.get('id') || '') ? q.get('id') : null;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 30, 1), 60);
  const viewer = await getSessionUser(env, request);
  const me = viewer ? viewer.x_id : '';
  const t = now();

  // 1) candidates + aggregates in one bounded query
  const minApproved = view === 'hall' && range === 'week' ? t - 7 * 86400 : 0;
  const { results: cand } = await env.DB.prepare(
    `WITH c AS (
       SELECT p.id, p.headline, p.featured, p.approved_at, p.tweet_created_at, p.grok_tweet_id FROM posts p
        WHERE p.status = 'approved' AND p.approved_at >= ?4
          AND (?1 = '' OR p.id IN (SELECT post_id FROM post_topics WHERE topic = ?1))
          AND (?2 = '' OR p.id = CAST(?2 AS INTEGER))
        ORDER BY p.approved_at DESC LIMIT ?3)
     SELECT c.*,
       (SELECT SUM(choice='grok') FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(c.id AS TEXT)) g,
       (SELECT SUM(choice='human') FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(c.id AS TEXT)) h,
       (SELECT COUNT(*) FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(c.id AS TEXT) AND v.updated_at > ?5) w,
       (SELECT SUM(value=1) FROM reactions r WHERE r.target_type='post' AND r.target_id = CAST(c.id AS TEXT)) l,
       (SELECT SUM(value=-1) FROM reactions r WHERE r.target_type='post' AND r.target_id = CAST(c.id AS TEXT)) d,
       (SELECT COUNT(*) FROM comments m WHERE m.item_type='post' AND m.item_id = CAST(c.id AS TEXT) AND m.status='visible') n
     FROM c`
  ).bind(topic || '', one || '', CANDIDATES, minApproved, t - 7 * 86400).all();

  let list = cand.map(p => ({
    id: String(p.id), headline: p.headline, featured: !!p.featured, approved_at: p.approved_at,
    created_at: p.tweet_created_at || p.approved_at, url: `https://x.com/grok/status/${p.grok_tweet_id}`,
    votes: { grok: p.g || 0, human: p.h || 0 }, week_votes: p.w || 0, likes: p.l || 0, dislikes: p.d || 0, comments: p.n || 0,
  }));
  if (view === 'new') list.sort((a, b) => b.approved_at - a.approved_at);
  else if (view === 'top') list.sort((a, b) => engagement(b) - engagement(a) || b.approved_at - a.approved_at);
  else if (view === 'hall') list = list.filter(p => engagement(p) > 0 || p.featured)
    .sort((a, b) => engagement(b) - engagement(a) || b.featured - a.featured).slice(0, 10);
  else list.sort((a, b) => hotScore(b, t) - hotScore(a, t));
  const total = list.length;
  const page = list.slice(0, limit);

  // 2) details only for the page
  if (page.length) {
    const ids = page.map(p => String(p.id));   // strings: D1 binds JS numbers as REAL, which breaks text id matches
    const ph = ids.map((_, i) => '?' + (i + 2)).join(',');
    const [tweets, topics, mine] = await env.DB.batch([
      env.DB.prepare(`SELECT * FROM post_tweets WHERE post_id IN (${ph}) AND ?1 = ?1 ORDER BY post_id, pos`).bind(me, ...ids),
      env.DB.prepare(`SELECT post_id, topic FROM post_topics WHERE post_id IN (${ph}) AND ?1 = ?1`).bind(me, ...ids),
      env.DB.prepare(`SELECT 'v' k, item_id id, choice val FROM votes WHERE item_type='post' AND x_id=?1 AND item_id IN (${ph})
                      UNION ALL SELECT 'r', target_id, value FROM reactions WHERE target_type='post' AND x_id=?1 AND target_id IN (${ph})`).bind(me, ...ids),
    ]);
    const M = {}; for (const r of mine.results) (M[r.id] ||= {})[r.k] = r.val;
    const T = {}; for (const r of topics.results) (T[r.post_id] ||= []).push(r.topic);
    const W = {}; for (const r of tweets.results) (W[r.post_id] ||= []).push({
      id: r.tweet_id, handle: r.author_handle, name: r.author_name, avatar: r.author_avatar, verified: !!r.verified,
      grok: !!r.is_grok, text: r.text, media: JSON.parse(r.media_json || '[]'), created_at: r.created_at });
    for (const p of page) {
      p.topics = (T[p.id] || []).sort((a, b) => TOPICS.indexOf(a) - TOPICS.indexOf(b));
      p.tweets = W[p.id] || [];
      p.mine = { vote: M[p.id]?.v || null, react: Number(M[p.id]?.r || 0) };
    }
  }
  // keep the previous field order for clients
  const posts = page.map(p => ({ id: p.id, headline: p.headline, featured: p.featured, approved_at: p.approved_at, created_at: p.created_at,
    url: p.url, topics: p.topics, tweets: p.tweets, votes: p.votes, week_votes: p.week_votes, likes: p.likes, dislikes: p.dislikes,
    comments: p.comments, mine: p.mine }));
  return json({ view, range, topic, topics: TOPICS, signedIn: !!viewer, posts, total });
}
