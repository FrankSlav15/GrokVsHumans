// GET /api/admin/queue?status=pending|approved|skipped|blocked|hidden  (admins only)
import { json, requireAdmin } from '../../../server/lib.js';
import { TOPICS } from '../../../server/v2.js';

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const status = ['pending', 'approved', 'skipped', 'blocked', 'hidden'].includes(q.get('status')) ? q.get('status') : 'pending';
  const [posts, tweets, topics, counts, spend, blocked] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM posts WHERE status = ?1 ORDER BY ${status === 'pending' ? 'x_engagement DESC, id' : 'COALESCE(approved_at, fetched_at) DESC'} LIMIT 100`).bind(status),
    env.DB.prepare(`SELECT t.* FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE p.status = ?1 ORDER BY t.post_id, t.pos`).bind(status),
    env.DB.prepare(`SELECT pt.* FROM post_topics pt JOIN posts p ON p.id = pt.post_id WHERE p.status = ?1`).bind(status),
    env.DB.prepare(`SELECT status, COUNT(*) n FROM posts GROUP BY status`),
    env.DB.prepare(`SELECT SUM(CASE WHEN day = strftime('%Y-%m-%d','now') THEN est_cost END) today, SUM(CASE WHEN month = strftime('%Y-%m','now') THEN est_cost END) month, MAX(at) last_run FROM fetch_log`),
    env.DB.prepare(`SELECT handle, reason, created_at FROM blocked_authors ORDER BY created_at DESC LIMIT 200`),
  ]);
  const W = {}; for (const t of tweets.results) (W[t.post_id] ||= []).push({ ...t, media: JSON.parse(t.media_json || '[]'), media_json: undefined });
  const T = {}; for (const t of topics.results) (T[t.post_id] ||= []).push({ topic: t.topic, suggested: !!t.suggested });
  return json({
    status, topics: TOPICS,
    counts: Object.fromEntries(counts.results.map(r => [r.status, r.n])),
    spend: { today: spend.results[0]?.today || 0, month: spend.results[0]?.month || 0, last_run: spend.results[0]?.last_run || null, caps: { day: 1.5, month: 45 } },
    blocked: blocked.results,
    posts: posts.results.map(p => ({ ...p, tweets: W[p.id] || [], topics: T[p.id] || [] })),
  });
}
