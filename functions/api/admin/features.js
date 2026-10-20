// GET  /api/admin/features?status=all|pending_payment|paid|awaiting_approval|active|expired|refund_needed   (admins only)
// POST /api/admin/features {id, action: approve | reject | refunded | expire | cancel, note?}
import { json, now, readJsonPost, requireAdmin } from '../../../server/lib.js';

// Display status: "paid" = money in but the thread is not on the site yet (suggestion still being fetched/approved);
// "awaiting_approval" = paid and the post exists, waiting for the owner to approve the feature.
export const statusOf = (f, t = now()) =>
  f.refund_needed && !f.refunded_at ? 'refund_needed'
  : f.state === 'active' ? (f.ends_at > t ? 'active' : 'expired')
  : f.state === 'paid' ? (f.post_id ? 'awaiting_approval' : 'paid')
  : f.state === 'rejected' && f.refunded_at ? 'refunded' : f.state;

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const want = new URL(request.url).searchParams.get('status') || 'all';
  const { results } = await env.DB.prepare(`SELECT f.*, u.handle, p.headline, p.status AS post_status, s.url AS suggestion_url, s.state AS suggestion_state
      FROM feature_requests f JOIN users u ON u.x_id = f.x_id LEFT JOIN posts p ON p.id = f.post_id LEFT JOIN suggestions s ON s.id = f.suggestion_id
      ORDER BY f.id DESC LIMIT 300`).all();
  const t = now(), rows = results.map(f => ({ ...f, status: statusOf(f, t) }));
  const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  return json({ status: want, counts, features: want === 'all' ? rows : rows.filter(r => r.status === want) });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const id = Number(body?.id), action = String(body?.action || ''), t = now();
  const f = Number.isInteger(id) ? await env.DB.prepare('SELECT * FROM feature_requests WHERE id = ?1').bind(id).first() : null;
  if (!f) return json({ error: 'not_found' }, 404);
  const note = typeof body?.note === 'string' ? body.note.slice(0, 200) : null, DB = env.DB;
  if (action === 'approve') {
    if (f.state !== 'paid') return json({ error: 'not_paid', state: f.state }, 400);
    if (!f.post_id) return json({ error: 'no_post_yet' }, 400);
    await DB.batch([
      DB.prepare("UPDATE posts SET status = 'approved', approved_at = COALESCE(approved_at, ?2), hidden_reason = NULL WHERE id = ?1 AND status IN ('pending','approved')").bind(f.post_id, t),
      DB.prepare("UPDATE feature_requests SET state = 'active', starts_at = ?2, ends_at = ?2 + days * 86400, updated_at = ?2 WHERE id = ?1").bind(id, t),
    ]);
  } else if (action === 'reject') {
    await DB.prepare(`UPDATE feature_requests SET state = CASE WHEN paid_usd > 0 THEN 'rejected' ELSE 'cancelled' END,
        refund_needed = CASE WHEN paid_usd > 0 THEN 1 ELSE 0 END, admin_note = COALESCE(?3, admin_note), updated_at = ?2 WHERE id = ?1`).bind(id, t, note).run();
  } else if (action === 'refunded') {
    await DB.prepare('UPDATE feature_requests SET refunded_at = ?2, updated_at = ?2 WHERE id = ?1').bind(id, t).run();
  } else if (action === 'expire') {
    await DB.prepare("UPDATE feature_requests SET ends_at = MIN(COALESCE(ends_at, ?2), ?2), updated_at = ?2 WHERE id = ?1 AND state = 'active'").bind(id, t).run();
  } else if (action === 'cancel') {
    if (f.state !== 'pending_payment') return json({ error: 'bad_state' }, 400);
    await DB.prepare("UPDATE feature_requests SET state = 'cancelled', updated_at = ?2 WHERE id = ?1").bind(id, t).run();
  } else return json({ error: 'bad_action' }, 400);
  return json({ ok: true, id, action });
}
