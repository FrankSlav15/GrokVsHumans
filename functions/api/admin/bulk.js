// POST /api/admin/bulk {ids: [..], action: approve | skip}   (admins only)
// Batch-view helper: runs the same per-post logic as /api/admin/post (server/postaction.js), so approving a
// mid-thread post queues the normal rebuild-on-approve (gvh-fetch honours the daily/monthly X API caps and
// retries after the daily reset). Max 10 ids per call to stay inside per-request D1 query limits; the UI chunks.
import { json, readJsonPost, requireAdmin, auditStmt } from '../../../server/lib.js';
import { applyPostAction } from '../../../server/postaction.js';

export const BULK_MAX = 10;
export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const action = String(body?.action || '');
  if (!['approve', 'skip'].includes(action)) return json({ error: 'bad_action' }, 400);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number))].filter(n => Number.isInteger(n) && n > 0) : [];
  if (!ids.length || ids.length > BULK_MAX) return json({ error: 'bad_request', max: BULK_MAX }, 400);
  // Each id is handled on its own (security review M2): an error on one post is reported for that id and the rest continue.
  // Each successful post writes its own admin_log row (via: 'bulk') in the same batch as its change.
  const results = [];
  for (const id of ids) {
    try {
      const p = await env.DB.prepare('SELECT status, rebuild_state FROM posts WHERE id = ?1').bind(id).first();
      if (!p) { results.push({ id, ok: false, error: 'not_found' }); continue; }
      if (p.status !== 'pending' || p.rebuild_state === 'queued') { results.push({ id, ok: false, error: 'not_pending' }); continue; }
      const r = await applyPostAction(env, id, action, {}, admin.x_id, 'bulk');
      results.push(r.status === 200 ? { id, ...r.body, ok: true } : { id, ok: false, error: r.body?.error || 'http_' + r.status });
    } catch (e) {
      results.push({ id, ok: false, error: 'exception', message: String(e?.message || e).slice(0, 200) });
    }
  }
  try {
    await auditStmt(env, admin.x_id, 'bulk.' + action, null, { ids, ok: results.filter(r => r.ok).map(r => r.id), failed: results.filter(r => !r.ok).map(r => ({ id: r.id, error: r.error })) }).run();
  } catch { /* the per-post rows are already written; never fail the response over the summary row */ }
  return json({ ok: results.every(r => r.ok), action, results });
}
