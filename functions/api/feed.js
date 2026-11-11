// GET /api/feed?view=hot|new|top|hall|grok|human&range=all|week&topic=Science&limit=10&offset=0
//   &order=1     -> only the ranked ids [[id, engagement, promoted 0/1], ...] of the whole view (client splits unseen/seen)
//   &ids=1,2,3   -> details for exactly these ids, in that order (pages of the client-side order; max 30)
// Only approved posts. Returns each post with its full chain, topics, vote totals, reactions,
// comment count and (when signed in) the viewer's own vote/reaction.
// M2: ranking runs over at most CANDIDATES recent approved posts (SQL LIMIT); chains, topics and the
// viewer's own state are then loaded only for the posts on the page. Anonymous responses are edge-cached.
import { json, getSessionUser, getCookie, SESSION_COOKIE, now } from '../../server/lib.js';
import { TOPICS, engagement, hotScore } from '../../server/v2.js';
import { MAX_ACTIVE_FEATURED } from '../../server/config.js';
import { groupFeedPosts } from '../../server/qualify.js';
import { hasBranchSchema } from '../../server/branchdb.js';

const VIEWS = ['hot', 'new', 'top', 'hall', 'grok', 'human'];
// Wilson lower bound (95%) of the leading side's share: rewards both margin and vote volume (1-0 ~0.21, 40-10 ~0.67).
const wilson = (w, n) => { if (!n) return 0; const z = 1.96, ph = w / n; return (ph + z * z / (2 * n) - z * Math.sqrt((ph * (1 - ph) + z * z / (4 * n)) / n)) / (1 + z * z / n); };
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
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'hot';
  const range = q.get('range') === 'week' ? 'week' : 'all';
  const topic = TOPICS.includes(q.get('topic')) ? q.get('topic') : null;
  const one = /^[0-9]{1,9}$/.test(q.get('id') || '') ? q.get('id') : null;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 30, 1), 60);
  const offset = Math.min(Math.max(Math.floor(Number(q.get('offset'))) || 0, 0), 5000);
  const orderOnly = q.get('order') === '1';
  const want = (q.get('ids') || '').split(',').filter(x => /^[0-9]{1,9}$/.test(x)).slice(0, 30);
  const viewer = await getSessionUser(env, request);
  const me = viewer ? viewer.x_id : '';
  const t = now();
  const branched = await hasBranchSchema(env);
  const bcols = branched ? ', p.thread_id, p.battle_score, p.battle_kind, p.battle_flags, p.battle_reason, p.battle_mains, p.battle_context, p.battle_borderline' : '';

  // 1) candidates + aggregates in one bounded query
  const minApproved = view === 'hall' && range === 'week' ? t - 7 * 86400 : 0;
  const candStmt = env.DB.prepare(
    `WITH c AS (
       SELECT p.id, p.headline, p.featured, p.approved_at, p.tweet_created_at, p.grok_tweet_id${bcols} FROM posts p
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
  );
  const { results: cand } = await candStmt.bind(topic || '', one || '', CANDIDATES, minApproved, t - 7 * 86400).all();
  // Paid featured spots (owner-approved, unexpired): pinned on Hot, and on topic pages when pin_topics is set.
  const promo = new Map();
  if (view === 'hot' && !one) {
    const { results: fr } = await env.DB.prepare(`SELECT f.post_id, MAX(f.ends_at) ends_at, MAX(f.pin_topics) pin_topics, MIN(f.starts_at) s FROM feature_requests f
        JOIN posts p ON p.id = f.post_id AND p.status = 'approved' WHERE f.state = 'active' AND f.ends_at > ?1
          AND (?2 = '' OR f.post_id IN (SELECT post_id FROM post_topics WHERE topic = ?2))
        GROUP BY f.post_id ORDER BY s LIMIT ?3`).bind(t, topic || '', MAX_ACTIVE_FEATURED).all();
    for (const r of fr) if (!topic || r.pin_topics) promo.set(String(r.post_id), r.ends_at);
    const have = new Set(cand.map(c => String(c.id)));
    for (const id of promo.keys()) if (!have.has(id)) { const x = await candStmt.bind(topic || '', id, 1, 0, t - 7 * 86400).all(); cand.push(...x.results); }
  }

  const rowPost = p => ({
    id: String(p.id), headline: p.headline, featured: !!p.featured, approved_at: p.approved_at,
    created_at: p.tweet_created_at || p.approved_at, url: `https://x.com/grok/status/${p.grok_tweet_id}`,
    votes: { grok: p.g || 0, human: p.h || 0 }, week_votes: p.w || 0, likes: p.l || 0, dislikes: p.d || 0, comments: p.n || 0,
    thread_id: p.thread_id || null, mains: mainsOf(p.battle_mains), kind: p.battle_kind || null,
    flags: p.battle_flags ? String(p.battle_flags).split(',').filter(Boolean) : [], context: jsonOf(p.battle_context),
  });
  let list = cand.map(rowPost);
  if (view === 'new') list.sort((a, b) => b.approved_at - a.approved_at);
  else if (view === 'top') list.sort((a, b) => engagement(b) - engagement(a) || b.approved_at - a.approved_at);
  else if (view === 'grok' || view === 'human') {   // live from current vote counts; ties and 0-0 excluded
    const lead = p => view === 'grok' ? p.votes.grok - p.votes.human : p.votes.human - p.votes.grok;
    const sc = p => wilson(Math.max(p.votes.grok, p.votes.human), p.votes.grok + p.votes.human);
    list = list.filter(p => lead(p) > 0).sort((a, b) => sc(b) - sc(a) || lead(b) - lead(a) || b.approved_at - a.approved_at);
  }
  else if (view === 'hall') list = list.filter(p => engagement(p) > 0 || p.featured)
    .sort((a, b) => engagement(b) - engagement(a) || b.featured - a.featured).slice(0, 10);
  else list.sort((a, b) => hotScore(b, t) - hotScore(a, t));
  if (branched && list.some(p => p.thread_id)) list = await pullBattleSiblings(env, list, topic, rowPost);
  list = groupFeedPosts(list, { preferId: one });
  if (promo.size && list.some(p => p.battles?.length > 1)) {
    const ids = [...promo.keys()];
    const hit = p => ids.includes(p.id) || (p.battles || []).some(b => ids.includes(b.id));
    list = [...list.filter(hit), ...list.filter(p => !hit(p))];
    for (const p of list) {
      const id = [p.id, ...(p.battles || []).map(b => b.id)].find(x => promo.has(x));
      if (id) p.promoted = { until: promo.get(id) };
    }
  } else if (promo.size) { const ids = [...promo.keys()];
    list = [...ids.map(id => list.find(p => p.id === id)).filter(Boolean), ...list.filter(p => !promo.has(p.id))];
    for (const p of list) if (promo.has(p.id)) p.promoted = { until: promo.get(p.id) }; }
  const total = list.length;
  if (orderOnly) return json({ view, range, topic, topics: TOPICS, order: list.map(p => [p.id, engagement(p), p.promoted ? 1 : 0]), total });
  let page, next;
  if (want.length) { const by = new Map(list.map(p => [p.id, p])); page = want.map(id => by.get(id)).filter(Boolean); next = null; }
  else { page = list.slice(offset, offset + limit); next = offset + page.length < total ? offset + page.length : null; }

  // 2) details only for the page (every battle of a grouped thread, not just the featured one)
  if (page.length) {
    const ids = [...new Set(page.flatMap(p => (p.battles?.length > 1 ? p.battles : [p]).map(b => String(b.id))))];
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
      id: r.tweet_id, pos: r.pos, handle: r.author_handle, name: r.author_name, avatar: r.author_avatar, verified: !!r.verified,
      grok: !!r.is_grok, text: r.text, ...goneMedia(r), created_at: r.created_at, ...(r.gone ? { gone: r.gone } : {}) });
    const fill = p => {
      p.topics = (T[p.id] || []).sort((a, b) => TOPICS.indexOf(a) - TOPICS.indexOf(b));
      p.tweets = W[p.id] || [];
      // Link the deepest stored reply: X renders its whole parent chain above it.
      const live = p.tweets.filter(w => !w.gone);
      if (live.length) p.url = `https://x.com/i/status/${live[live.length - 1].id}`;
      p.mine = { vote: M[p.id]?.v || null, react: Number(M[p.id]?.r || 0) };
    };
    for (const p of page) {
      if (p.battles?.length > 1) for (const b of p.battles) fill(b);
      fill(p);
    }
    if (branched) await attachThreadRoots(env, page);
  }
  // keep the previous field order for clients. Battle fields are added only when a thread has 2+ public battles.
  const posts = page.map(publishPost);
  return json({ view, range, topic, topics: TOPICS, signedIn: !!viewer, posts, total, offset, next });
}

// A tweet X no longer serves keeps its saved text; media is shown only when we host it (same-origin path),
// because X's CDN links for deleted/private posts break. media_gone = how many items were dropped.
function goneMedia(r) {
  const m = JSON.parse(r.media_json || '[]');
  if (!r.gone) return { media: m };
  const keep = m.filter(x => x.type === 'quote' ? true : typeof x.url === 'string' && x.url.startsWith('/') && !x.video);
  return { media: keep, media_gone: m.length - keep.length };
}
function mainsOf(raw) { const v = jsonOf(raw); return Array.isArray(v) ? v.map(x => String(x).replace(/^@/, '')).filter(Boolean) : []; }
function jsonOf(raw) { if (!raw) return null; if (typeof raw === 'object') return raw; try { return JSON.parse(raw); } catch { return null; } }
function publishPost(p) {
  const o = { id: p.id, headline: p.headline, featured: p.featured, approved_at: p.approved_at, created_at: p.created_at,
    url: p.url, topics: p.topics, tweets: p.tweets, votes: p.votes, week_votes: p.week_votes, likes: p.likes, dislikes: p.dislikes,
    comments: p.comments, mine: p.mine, promoted: p.promoted || null };
  if (p.battles?.length > 1) {
    o.battles = p.battles.map(b => ({ ...publishPost(b), mains: b.mains || [], kind: b.kind || null, flags: b.flags || [], context: b.context || null }));
    o.root = p.root || null; o.grok_answer = p.grok_answer || null; o.root_title = p.root_title || null;
  }
  return o;
}
// A thread can have an older approved battle outside the candidate window. Pull those in before grouping
// so the public page shows every approved battle, and a single approved battle stays one normal post.
async function pullBattleSiblings(env, list, topic, rowPost) {
  const tids = [...new Set(list.map(p => p.thread_id).filter(Boolean))];
  if (!tids.length) return list;
  const ph = tids.map(() => '?').join(',');
  const { results: counts } = await env.DB.prepare(
    `SELECT p.thread_id, p.id FROM posts p WHERE p.status = 'approved' AND p.thread_id IN (${ph})
       AND (? = '' OR p.id IN (SELECT post_id FROM post_topics WHERE topic = ?))`
  ).bind(...tids, topic || '', topic || '').all();
  const have = new Set(list.map(p => p.id));
  const missing = [...new Set(counts.map(r => String(r.id)).filter(id => !have.has(id)))].slice(0, 40);
  if (!missing.length) return list;
  const ip = missing.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.headline, p.featured, p.approved_at, p.tweet_created_at, p.grok_tweet_id, p.thread_id,
        p.battle_score, p.battle_kind, p.battle_flags, p.battle_reason, p.battle_mains, p.battle_context, p.battle_borderline,
        (SELECT SUM(choice='grok') FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(p.id AS TEXT)) g,
        (SELECT SUM(choice='human') FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(p.id AS TEXT)) h,
        (SELECT COUNT(*) FROM votes v WHERE v.item_type='post' AND v.item_id = CAST(p.id AS TEXT) AND v.updated_at > ?) w,
        (SELECT SUM(value=1) FROM reactions r WHERE r.target_type='post' AND r.target_id = CAST(p.id AS TEXT)) l,
        (SELECT SUM(value=-1) FROM reactions r WHERE r.target_type='post' AND r.target_id = CAST(p.id AS TEXT)) d,
        (SELECT COUNT(*) FROM comments m WHERE m.item_type='post' AND m.item_id = CAST(p.id AS TEXT) AND m.status='visible') n
      FROM posts p WHERE p.id IN (${ip})`
  ).bind(Math.floor(Date.now() / 1000) - 7 * 86400, ...missing).all();
  return list.concat(results.map(rowPost));
}
async function attachThreadRoots(env, page) {
  const tids = [...new Set(page.map(p => p.thread_id).filter(Boolean))];
  if (!tids.length) return;
  const ph = tids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id, headline, root_json, grok_answer_json FROM threads WHERE id IN (${ph})`).bind(...tids).all();
  const by = new Map(results.map(r => [r.id, r]));
  for (const p of page) {
    const th = by.get(p.thread_id);
    if (!th) continue;
    const root = jsonOf(th.root_json), ans = jsonOf(th.grok_answer_json);
    if (p.battles?.length > 1) { p.root = root; p.grok_answer = ans; p.root_title = th.headline || p.headline; }
    else if (root && !(p.tweets || []).some(w => w.id === root.id)) {
      const extra = [root];
      if (ans && !(p.tweets || []).some(w => w.id === ans.id) && ans.id !== root.id) extra.push(ans);
      p.tweets = [...extra, ...(p.tweets || [])];
    }
  }
}
