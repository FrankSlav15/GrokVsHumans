// GET  /api/admin/suggestions?state=new|queued|fetched|duplicate|failed|rejected   (admins only)
// POST /api/admin/suggestions {id, action: approve (queue for the fetch worker) | reject | retry}
import { json, now, readJsonPost, requireAdmin, auditStmt } from '../../../server/lib.js';
const STATES = ['new', 'queued', 'fetched', 'duplicate', 'failed', 'rejected'];

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const st = new URL(request.url).searchParams.get('state');
  const state = STATES.includes(st) ? st : 'new';
  const [rows, counts] = await env.DB.batch([
    env.DB.prepare(`SELECT s.*, u.handle, u.banned, p.status AS post_status, p.headline,
        (SELECT code || ' · ' || state || ' · $' || amount_usd FROM feature_requests f WHERE f.suggestion_id = s.id ORDER BY id DESC LIMIT 1) AS feature
      FROM suggestions s JOIN users u ON u.x_id = s.x_id LEFT JOIN posts p ON p.id = s.post_id WHERE s.state = ?1 ORDER BY s.id DESC LIMIT 100`).bind(state),
    env.DB.prepare('SELECT state, COUNT(*) n FROM suggestions GROUP BY state'),
  ]);
  return json({ state, suggestions: rows.results, counts: Object.fromEntries(counts.results.map(r => [r.state, r.n])) });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const id = Number(body?.id), action = String(body?.action || '');
  const s = Number.isInteger(id) ? await env.DB.prepare('SELECT * FROM suggestions WHERE id = ?1').bind(id).first() : null;
  if (!s) return json({ error: 'not_found' }, 404);
  const t = now();
  if (action === 'approve' || action === 'retry') {
    if (!['new', 'failed', 'rejected'].includes(s.state)) return json({ error: 'bad_state', state: s.state }, 400);
    await env.DB.prepare("UPDATE suggestions SET state = 'queued', result = NULL, updated_at = ?2 WHERE id = ?1").bind(id, t).run();
  } else if (action === 'reject') {
    await env.DB.batch([
      env.DB.prepare("UPDATE suggestions SET state = 'rejected', updated_at = ?2 WHERE id = ?1").bind(id, t),
      // a paid feature request tied to a rejected suggestion needs a refund
      env.DB.prepare(`UPDATE feature_requests SET refund_needed = CASE WHEN paid_usd > 0 THEN 1 ELSE 0 END,
          state = CASE WHEN paid_usd > 0 THEN 'rejected' ELSE 'cancelled' END, updated_at = ?2
        WHERE suggestion_id = ?1 AND state IN ('pending_payment','paid')`).bind(id, t),
    ]);
  } else return json({ error: 'bad_action' }, 400);
  await auditStmt(env, admin.x_id, 'suggestion.' + action, 'suggestion:' + id, typeof body?.note === 'string' ? { note: body.note.slice(0, 200) } : null).run();
  return json({ ok: true, id, action });
}
