// GET /api/admin/queue?status=pending|approved|skipped|blocked|hidden  (admins only)
import { json, requireAdmin } from '../../../server/lib.js';
import { TOPICS } from '../../../server/v2.js';
import { rebuildConfig } from '../../../server/config.js';

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const status = ['pending', 'approved', 'skipped', 'blocked', 'hidden'].includes(q.get('status')) ? q.get('status') : 'pending';
  if (q.get('view') === 'batch') return batchView(env);
  if (q.get('id')) return onePost(env, Number(q.get('id')));
  const [posts, tweets, topics, counts, spend, blocked] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM posts WHERE status = ?1 ORDER BY ${status === 'pending' ? 'low_priority, x_engagement DESC, id' : 'COALESCE(approved_at, fetched_at) DESC'} LIMIT 100`).bind(status),
    env.DB.prepare(`SELECT t.* FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE p.status = ?1 ORDER BY t.post_id, t.pos`).bind(status),
    env.DB.prepare(`SELECT pt.* FROM post_topics pt JOIN posts p ON p.id = pt.post_id WHERE p.status = ?1`).bind(status),
    env.DB.prepare(`SELECT status, COUNT(*) n FROM posts GROUP BY status`),
    env.DB.prepare(`SELECT SUM(CASE WHEN day = strftime('%Y-%m-%d','now') THEN est_cost END) today, SUM(CASE WHEN month = strftime('%Y-%m','now') THEN est_cost END) month, MAX(at) last_run FROM fetch_log`),
    env.DB.prepare(`SELECT handle, reason, created_at FROM blocked_authors ORDER BY created_at DESC LIMIT 200`),
  ]);
  const caps = await env.DB.prepare("SELECT v FROM kv WHERE k = 'caps'").first().then(r => JSON.parse(r?.v || 'null')).catch(() => null) || { day: 1.5, month: 45 };
  const W = {}; for (const t of tweets.results) (W[t.post_id] ||= []).push({ ...t, media: JSON.parse(t.media_json || '[]'), media_json: undefined });
  const T = {}; for (const t of topics.results) (T[t.post_id] ||= []).push({ topic: t.topic, suggested: !!t.suggested });
  return json({
    status, topics: TOPICS,
    counts: Object.fromEntries(counts.results.map(r => [r.status, r.n])),
    spend: { today: spend.results[0]?.today || 0, month: spend.results[0]?.month || 0, last_run: spend.results[0]?.last_run || null, caps },
    blocked: blocked.results,
    // mid_thread: same free check the approve action uses (first stored post is not the conversation root)
    posts: posts.results.map(p => ({ ...p, tweets: W[p.id] || [], topics: T[p.id] || [], mid_thread: !!p.conversation_id && (W[p.id]?.[0]?.tweet_id || null) !== p.conversation_id })),
  });
}

// ?id=N: one post in the live feed's shape (tweets as /api/feed returns them) for the batch-view preview modal.
async function onePost(env, id) {
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const [posts, tweets, topics] = await env.DB.batch([
    env.DB.prepare("SELECT id, status, headline, COALESCE(tweet_created_at, fetched_at) AS created_at, 'https://x.com/grok/status/' || grok_tweet_id AS url, human_handle, grok_tweet_id, conversation_id, review_score, review_reason, review_batch, review_title, rebuild_state, rebuild_note, x_engagement FROM posts WHERE id = ?1").bind(id),
    env.DB.prepare('SELECT * FROM post_tweets WHERE post_id = ?1 ORDER BY pos').bind(id),
    env.DB.prepare('SELECT topic FROM post_topics WHERE post_id = ?1').bind(id),
  ]);
  const p = posts.results[0];
  if (!p) return json({ error: 'not_found' }, 404);
  const tw = tweets.results.map(r => ({ id: r.tweet_id, pos: r.pos, handle: r.author_handle, name: r.author_name, avatar: r.author_avatar, verified: !!r.verified,
    grok: !!r.is_grok, text: r.text, media: JSON.parse(r.media_json || '[]'), created_at: r.created_at }));
  return json({ topics: TOPICS, post: { ...p, tweets: tw, topics: topics.results.map(r => r.topic).sort((a, b) => TOPICS.indexOf(a) - TOPICS.indexOf(b)),
    mid_thread: !!p.conversation_id && (tw[0]?.id || null) !== p.conversation_id } });
}

// ?view=batch: every pending post as a compact card (no chain text) grouped by review batch, with rebuild-cost inputs.
async function batchView(env) {
  const [posts, topics, spend] = await env.DB.batch([
    env.DB.prepare(`SELECT p.id, p.headline, p.human_handle, p.x_engagement, p.grok_tweet_id, p.review_score, p.review_reason, p.review_batch, p.review_title, p.rebuild_state, p.rebuild_note, p.low_priority,
      (SELECT COUNT(*) FROM post_tweets t WHERE t.post_id = p.id) n_tweets,
      (p.conversation_id IS NOT NULL AND COALESCE((SELECT tweet_id FROM post_tweets t WHERE t.post_id = p.id AND t.pos = 0), '') != p.conversation_id) mid_thread
      FROM posts p WHERE p.status = 'pending' ORDER BY COALESCE(p.review_score, 0) DESC, p.x_engagement DESC, p.id`),
    env.DB.prepare(`SELECT pt.post_id, pt.topic FROM post_topics pt JOIN posts p ON p.id = pt.post_id WHERE p.status = 'pending'`),
    env.DB.prepare(`SELECT SUM(CASE WHEN day = strftime('%Y-%m-%d','now') THEN est_cost END) today, SUM(CASE WHEN month = strftime('%Y-%m','now') THEN est_cost END) month FROM fetch_log`),
  ]);
  const caps = await env.DB.prepare("SELECT v FROM kv WHERE k = 'caps'").first().then(r => JSON.parse(r?.v || 'null')).catch(() => null) || { day: 1.5, month: 45 };
  const T = {}; for (const t of topics.results) (T[t.post_id] ||= []).push(t.topic);
  return json({
    view: 'batch', rebuild_max_usd: rebuildConfig(env).maxUsd,
    spend: { today: spend.results[0]?.today || 0, month: spend.results[0]?.month || 0, caps },
    posts: posts.results.map(p => ({ ...p, mid_thread: !!p.mid_thread, topics: T[p.id] || [] })),
  });
}
