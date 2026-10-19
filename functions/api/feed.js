// GET /api/feed?view=hot|new|top|hall&range=all|week&topic=Science&limit=30
// Only approved posts. Returns each post with its full chain, topics, vote totals, reactions,
// comment count and (when signed in) the viewer's own vote/reaction.
import { json, getSessionUser, now } from '../../server/lib.js';
import { TOPICS, engagement, hotScore } from '../../server/v2.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const view = ['hot', 'new', 'top', 'hall'].includes(q.get('view')) ? q.get('view') : 'hot';
  const range = q.get('range') === 'week' ? 'week' : 'all';
  const topic = TOPICS.includes(q.get('topic')) ? q.get('topic') : null;
  const one = /^[0-9]{1,9}$/.test(q.get('id') || '') ? q.get('id') : null;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 30, 1), 60);
  const viewer = await getSessionUser(env, request);
  const me = viewer ? viewer.x_id : '';
  const t = now();

  const filt = " AND (?2 = '' OR p.id IN (SELECT post_id FROM post_topics WHERE topic = ?2)) AND (?3 = '' OR p.id = CAST(?3 AS INTEGER))";
  const args = [me, topic || '', one || ''];
  const [posts, tweets, topics, votes, reacts, comments, mine] = await env.DB.batch([
    env.DB.prepare(`SELECT p.id, p.headline, p.featured, p.approved_at, p.tweet_created_at, p.grok_tweet_id FROM posts p WHERE p.status = 'approved'${filt} AND ?1 = ?1`).bind(...args),
    env.DB.prepare(`SELECT t.* FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE p.status = 'approved'${filt} AND ?1 = ?1 ORDER BY t.post_id, t.pos`).bind(...args),
    env.DB.prepare(`SELECT pt.post_id, pt.topic FROM post_topics pt JOIN posts p ON p.id = pt.post_id WHERE p.status = 'approved'`),
    env.DB.prepare(`SELECT item_id, SUM(choice='grok') g, SUM(choice='human') h, SUM(choice='grok' AND updated_at > ?1) gw, SUM(choice='human' AND updated_at > ?1) hw FROM votes WHERE item_type='post' GROUP BY item_id`).bind(t - 7 * 86400),
    env.DB.prepare(`SELECT target_id, SUM(value=1) l, SUM(value=-1) d FROM reactions WHERE target_type='post' GROUP BY target_id`),
    env.DB.prepare(`SELECT item_id, COUNT(*) n FROM comments WHERE item_type='post' AND status='visible' GROUP BY item_id`),
    env.DB.prepare(`SELECT 'v' k, item_id id, choice val FROM votes WHERE item_type='post' AND x_id=?1 UNION ALL SELECT 'r', target_id, value FROM reactions WHERE target_type='post' AND x_id=?1`).bind(me),
  ]);
  const by = (rs, key) => Object.fromEntries(rs.results.map(r => [String(r[key]), r]));
  const V = by(votes, 'item_id'), R = by(reacts, 'target_id'), C = by(comments, 'item_id');
  const M = {}; for (const r of mine.results) (M[r.id] ||= {})[r.k] = r.val;
  const T = {}; for (const r of topics.results) (T[r.post_id] ||= []).push(r.topic);
  const W = {}; for (const r of tweets.results) (W[r.post_id] ||= []).push({
    id: r.tweet_id, handle: r.author_handle, name: r.author_name, avatar: r.author_avatar, verified: !!r.verified,
    grok: !!r.is_grok, text: r.text, media: JSON.parse(r.media_json || '[]'), created_at: r.created_at });

  let list = posts.results.map(p => {
    const id = String(p.id), v = V[id] || {}, r = R[id] || {};
    return { id, headline: p.headline, featured: !!p.featured, approved_at: p.approved_at, created_at: p.tweet_created_at || p.approved_at,
      url: `https://x.com/grok/status/${p.grok_tweet_id}`, topics: (T[p.id] || []).sort((a, b) => TOPICS.indexOf(a) - TOPICS.indexOf(b)),
      tweets: W[p.id] || [], votes: { grok: v.g || 0, human: v.h || 0 }, week_votes: (v.gw || 0) + (v.hw || 0),
      likes: r.l || 0, dislikes: r.d || 0, comments: C[id]?.n || 0, mine: { vote: M[id]?.v || null, react: Number(M[id]?.r || 0) } };
  });
  if (view === 'new') list.sort((a, b) => b.approved_at - a.approved_at);
  else if (view === 'top') list.sort((a, b) => engagement(b) - engagement(a) || b.approved_at - a.approved_at);
  else if (view === 'hall') {
    if (range === 'week') list = list.filter(p => p.approved_at > t - 7 * 86400);
    list = list.filter(p => engagement(p) > 0 || p.featured)
      .sort((a, b) => engagement(b) - engagement(a) || b.featured - a.featured).slice(0, 10);
  } else list.sort((a, b) => hotScore(b, t) - hotScore(a, t));
  return json({ view, range, topic, topics: TOPICS, signedIn: !!viewer, posts: list.slice(0, limit), total: list.length });
}
