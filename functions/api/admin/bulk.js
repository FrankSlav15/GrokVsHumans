// POST /api/admin/bulk {ids: [..], action: approve | skip}   (admins only)
// Batch-view helper: runs the same per-post logic as /api/admin/post (server/postaction.js), so approving a
// mid-thread post queues the normal rebuild-on-approve (gvh-fetch honours the daily/monthly X API caps and
// retries after the daily reset). Max 10 ids per call to stay inside per-request D1 query limits; the UI chunks.
import { json, readJsonPost, requireAdmin } from '../../../server/lib.js';
import { applyPostAction } from '../../../server/postaction.js';

export const BULK_MAX = 10;
export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const action = String(body?.action || '');
  if (!['approve', 'skip'].includes(action)) return json({ error: 'bad_action' }, 400);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number))].filter(n => Number.isInteger(n) && n > 0) : [];
  if (!ids.length || ids.length > BULK_MAX) return json({ error: 'bad_request', max: BULK_MAX }, 400);
  const results = [];
  for (const id of ids) {
    const p = await env.DB.prepare('SELECT status, rebuild_state FROM posts WHERE id = ?1').bind(id).first();
    if (!p) { results.push({ id, error: 'not_found' }); continue; }
    if (p.status !== 'pending' || p.rebuild_state === 'queued') { results.push({ id, error: 'not_pending' }); continue; }
    const r = await applyPostAction(env, id, action, {});
    results.push({ id, ...(r.body || {}) });
  }
  return json({ ok: true, action, results });
}
