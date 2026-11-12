// GET  /api/admin/suggestions?state=new|queued|fetched|duplicate|failed|rejected
// GET  /api/admin/suggestions?preview=<id>[&fresh=1]   free public preview of a deferred quick-add
// POST /api/admin/suggestions {id, action}
//   user suggestions: approve (queue for the fetch worker) | reject | retry
//   deferred admin quick-adds: approve (mark for the next run, no X spend) | build (spend the admin
//   allowance now, or mark for the next run if a cap blocks it) | edit | reject
import { json, now, readJsonPost, requireAdmin, auditStmt } from '../../../server/lib.js';
import { TOPICS } from '../../../server/v2.js';
import { parseStatusUrl } from '../../../server/config.js';
import {
  QA_NOTE, APPROVED_WAITING, applySuggestionPrefs, cachedPreview, deferredActions, deferredDecision, deferredStatus, normalizeTitle, normalizeTopics,
} from '../../../server/deferred.js';

const STATES = ['new', 'queued', 'fetched', 'duplicate', 'failed', 'rejected'];

function shape(s) {
  const deferred = s.note === QA_NOTE;
  const topic_list = normalizeTopics(s.topics);
  return {
    ...s, deferred, topic_list,
    status_label: deferred ? deferredStatus(s).label : null,
    actions: deferred ? deferredActions(s) : null,
  };
}

export async function handleSuggestionGet(env, url, fetchImpl = fetch) {
  const previewId = url.searchParams.get('preview');
  if (previewId) {
    const id = Number(previewId);
    if (!Number.isInteger(id)) return json({ error: 'bad_id' }, 400);
    const s = await env.DB.prepare('SELECT id, tweet_id, note, state FROM suggestions WHERE id = ?1').bind(id).first();
    if (!s) return json({ error: 'not_found' }, 404);
    if (s.note !== QA_NOTE) return json({ error: 'not_deferred' }, 400);
    const preview = await cachedPreview(env.DB, s.tweet_id, fetchImpl, { fresh: url.searchParams.get('fresh') === '1' });
    return json({ id: s.id, tweet_id: s.tweet_id, preview });
  }
  const st = url.searchParams.get('state');
  const state = STATES.includes(st) ? st : 'new';
  const [rows, counts] = await env.DB.batch([
    env.DB.prepare(`SELECT s.*, u.handle, u.banned, p.status AS post_status, p.headline,
        (SELECT code || ' · ' || state || ' · $' || amount_usd FROM feature_requests f WHERE f.suggestion_id = s.id ORDER BY id DESC LIMIT 1) AS feature
      FROM suggestions s JOIN users u ON u.x_id = s.x_id LEFT JOIN posts p ON p.id = s.post_id WHERE s.state = ?1 ORDER BY s.id DESC LIMIT 100`).bind(state),
    env.DB.prepare('SELECT state, COUNT(*) n FROM suggestions GROUP BY state'),
  ]);
  return json({ state, topics: TOPICS, suggestions: rows.results.map(shape), counts: Object.fromEntries(counts.results.map(r => [r.state, r.n])) });
}

async function editDeferred(env, admin, row, body) {
  const tweetId = parseStatusUrl(body?.url);
  if (!tweetId) return json({ error: 'bad_url' }, 400);
  const title = normalizeTitle(typeof body?.title === 'string' ? body.title : '');
  const topics = normalizeTopics(body?.topics);
  if (tweetId !== row.tweet_id) {
    const other = await env.DB.prepare('SELECT id, state FROM suggestions WHERE tweet_id = ?1 AND id <> ?2').bind(tweetId, row.id).first();
    if (other) return json({ error: 'already_suggested', suggestion_id: other.id, state: other.state }, 409);
    const onSite = await env.DB.prepare(`SELECT p.id, p.status FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE t.tweet_id = ?1
      UNION ALL SELECT id, status FROM posts WHERE grok_tweet_id = ?1 LIMIT 1`).bind(tweetId).first();
    if (onSite) return json({ error: 'already_on_site', post_id: onSite.id, status: onSite.status }, 409);
  }
  const url = `https://x.com/i/status/${tweetId}`;
  const topicsJson = topics.length ? JSON.stringify(topics) : null;
  try {
    await env.DB.prepare('UPDATE suggestions SET url = ?2, tweet_id = ?3, title = ?4, topics = ?5, updated_at = ?6 WHERE id = ?1')
      .bind(row.id, url, tweetId, title, topicsJson, now()).run();
  } catch (e) {
    if (/no such column/i.test(String(e?.message || e))) return json({ error: 'migration_required' }, 503);
    throw e;
  }
  await auditStmt(env, admin.x_id, 'suggestion.edit', 'suggestion:' + row.id, { tweet_id: tweetId, title, topics }).run();
  return json({ ok: true, id: row.id, action: 'edit', url, title, topics });
}

async function markApproved(env, admin, row) {
  const t = now();
  await env.DB.prepare("UPDATE suggestions SET state = 'queued', result = ?2, updated_at = ?3 WHERE id = ?1").bind(row.id, APPROVED_WAITING, t).run();
  await auditStmt(env, admin.x_id, 'suggestion.approve', 'suggestion:' + row.id, { deferred: true, when: 'next_run' }).run();
  return json({ ok: true, id: row.id, action: 'approve', when: 'next_run' });
}

export async function handleSuggestionPost(env, admin, body) {
  const id = Number(body?.id), action = String(body?.action || '');
  const s = Number.isInteger(id) ? await env.DB.prepare('SELECT * FROM suggestions WHERE id = ?1').bind(id).first() : null;
  if (!s) return json({ error: 'not_found' }, 404);
  const decision = deferredDecision(s, action);
  if (decision.error) return json({ error: decision.error, state: s.state }, decision.error === 'bad_action' ? 400 : 400);
  if (decision.op === 'edit') return editDeferred(env, admin, s, body);
  if (decision.op === 'mark') return markApproved(env, admin, s);
  if (decision.op === 'build') {
    if (!env.FETCH?.buildDeferred) return json({ error: 'not_configured' }, 503);
    const r = await env.FETCH.buildDeferred({ suggestionId: id }).catch(e => ({ error: 'worker_error', message: String(e?.message || e).slice(0, 160) }));
    await auditStmt(env, admin.x_id, 'suggestion.build', r.post_id ? 'post:' + r.post_id : 'suggestion:' + id, {
      ok: !!r.ok, deferred: !!r.deferred, error: r.error || null, cost: r.cost ?? null, reason: r.reason || null,
    }).run();
    if (r.error === 'bad_state') return json(r, 400);
    if (r.error === 'busy') return json(r, 409);
    if (r.error === 'worker_error' || r.error === 'not_configured') return json(r, 503);
    let title_applied = null, battles = r.battles || (r.post_id ? 1 : 0);
    if (r.ok && r.post_id) {
      const ids = r.post_ids?.length ? r.post_ids : [r.post_id];
      const applied = await applySuggestionPrefs(env.DB, ids, s).catch(() => null);
      if (applied) { title_applied = applied.title; battles = applied.battles; }
    }
    const status = r.deferred ? 202 : 200;
    return json({ ...r, title_applied, battles }, status);
  }
  const t = now();
  if (decision.op === 'queue-user') {
    await env.DB.prepare("UPDATE suggestions SET state = 'queued', result = NULL, updated_at = ?2 WHERE id = ?1").bind(id, t).run();
  } else if (decision.op === 'reject') {
    await env.DB.batch([
      env.DB.prepare("UPDATE suggestions SET state = 'rejected', updated_at = ?2 WHERE id = ?1").bind(id, t),
      env.DB.prepare(`UPDATE feature_requests SET refund_needed = CASE WHEN paid_usd > 0 THEN 1 ELSE 0 END,
          state = CASE WHEN paid_usd > 0 THEN 'rejected' ELSE 'cancelled' END, updated_at = ?2
        WHERE suggestion_id = ?1 AND state IN ('pending_payment','paid')`).bind(id, t),
    ]);
  }
  await auditStmt(env, admin.x_id, 'suggestion.' + action, 'suggestion:' + id, typeof body?.note === 'string' ? { note: body.note.slice(0, 200) } : null).run();
  return json({ ok: true, id, action });
}

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  return handleSuggestionGet(env, new URL(request.url));
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  return handleSuggestionPost(env, admin, body);
}
