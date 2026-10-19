// POST /api/admin/action {kind: 'comment'|'user', id, action}   (ADMIN_X_IDS only)
//   comment: hide | unhide | delete      user: ban | unban
import { json, readJsonPost, requireAdmin, isAdmin } from '../../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const { kind, action } = body || {};
  const DB = env.DB;

  if (kind === 'comment') {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
    if (!(await DB.prepare('SELECT 1 FROM comments WHERE id = ?1').bind(id).first())) return json({ error: 'not_found' }, 404);
    if (action === 'hide') {
      await DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'admin' WHERE id = ?1").bind(id).run();
    } else if (action === 'unhide') {
      // Approving a comment clears its reports so it does not get auto-hidden again.
      await DB.batch([
        DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id),
        DB.prepare("UPDATE comments SET status = 'visible', hidden_by = NULL, report_count = 0 WHERE id = ?1").bind(id),
      ]);
    } else if (action === 'delete') {
      await DB.batch([
        DB.prepare("DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ?1").bind(String(id)),
        DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id),
        DB.prepare('DELETE FROM comments WHERE id = ?1').bind(id),
      ]);
    } else return json({ error: 'bad_action' }, 400);
    return json({ ok: true, kind, id, action });
  }

  if (kind === 'user') {
    const xId = String(body.id || '');
    if (!/^[0-9]{1,25}$/.test(xId)) return json({ error: 'bad_request' }, 400);
    if (!(await DB.prepare('SELECT 1 FROM users WHERE x_id = ?1').bind(xId).first())) return json({ error: 'not_found' }, 404);
    if (action === 'ban') {
      if (isAdmin(env, xId)) return json({ error: 'cannot_ban_admin' }, 400);
      await DB.batch([
        DB.prepare('UPDATE users SET banned = 1 WHERE x_id = ?1').bind(xId),
        DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'ban' WHERE x_id = ?1 AND status = 'visible'").bind(xId),
        DB.prepare('DELETE FROM sessions WHERE x_id = ?1').bind(xId),   // M4: ban signs the user out everywhere
      ]);
    } else if (action === 'unban') {
      await DB.batch([
        DB.prepare('UPDATE users SET banned = 0 WHERE x_id = ?1').bind(xId),
        DB.prepare("UPDATE comments SET status = 'visible', hidden_by = NULL WHERE x_id = ?1 AND hidden_by = 'ban'").bind(xId),
      ]);
    } else return json({ error: 'bad_action' }, 400);
    return json({ ok: true, kind, id: xId, action });
  }
  return json({ error: 'bad_request' }, 400);
}
