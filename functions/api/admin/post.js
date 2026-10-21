// POST /api/admin/post {id, action, headline?, topics?}   (admins only)
// action: approve (mid-thread chains are rebuilt by gvh-fetch first, then published; force=true skips) | rebuild | feature | unfeature | skip | never (block author + skip all their pending) | hide | restore | headline | topics
import { json, readJsonPost, requireAdmin } from '../../../server/lib.js';
import { applyPostAction } from '../../../server/postaction.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const id = Number(body?.id), action = String(body?.action || '');
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const r = await applyPostAction(env, id, action, body, admin.x_id, 'single');
  return json(r.body, r.status);
}
