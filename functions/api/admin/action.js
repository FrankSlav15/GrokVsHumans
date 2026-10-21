// POST /api/admin/action {kind: 'comment'|'user', id, action}   (ADMIN_X_IDS only)
//   comment: hide | unhide (approve) | dismiss (clear flag, stays visible) | delete      user: ban | unban | purge
//   purge = 'Delete data, keep ban': same deletion as self-service, only for ids on the ban list; the entry stays
import { json, readJsonPost, requireAdmin, isAdmin, auditStmt } from '../../../server/lib.js';
import { deleteAccountData } from '../../../server/account.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  const log = (a, target, detail) => auditStmt(env, admin.x_id, a, target, detail);
  if (denied) return denied;
  const { kind, action } = body || {};
  const DB = env.DB;

  if (kind === 'comment') {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
    if (!(await DB.prepare('SELECT 1 FROM comments WHERE id = ?1').bind(id).first())) return json({ error: 'not_found' }, 404);
    if (action === 'hide') {
      await DB.batch([DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'admin', mod_reviewed = 1 WHERE id = ?1").bind(id), log('comment.' + action, 'comment:' + id)]);
    } else if (action === 'unhide') {
      // Approving a comment clears its reports so it does not get auto-hidden again.
      await DB.batch([
        DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id),
        DB.prepare("UPDATE comments SET status = 'visible', hidden_by = NULL, report_count = 0, mod_reviewed = 1 WHERE id = ?1").bind(id),
        log('comment.unhide', 'comment:' + id),
      ]);
    } else if (action === 'dismiss') {
      await DB.batch([DB.prepare('UPDATE comments SET mod_reviewed = 1 WHERE id = ?1').bind(id), log('comment.' + action, 'comment:' + id)]);
    } else if (action === 'delete') {
      await DB.batch([
        DB.prepare("DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ?1").bind(String(id)),
        DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id),
        DB.prepare('DELETE FROM comments WHERE id = ?1').bind(id),
        log('comment.delete', 'comment:' + id),
      ]);
    } else return json({ error: 'bad_action' }, 400);
    return json({ ok: true, kind, id, action });
  }

  if (kind === 'user') {
    const xId = String(body.id || '');
    if (!/^[0-9]{1,25}$/.test(xId)) return json({ error: 'bad_request' }, 400);
    const hasUser = !!(await DB.prepare('SELECT 1 FROM users WHERE x_id = ?1').bind(xId).first());
    const listed = !!(await DB.prepare('SELECT 1 FROM banned_ids WHERE x_id = ?1').bind(xId).first());
    // a deleted account can still be on the ban list (unban only); ban needs an existing user
    if (!hasUser && !(listed && action === 'unban')) return json({ error: 'not_found' }, 404);
    if (action === 'ban') {
      const reason = body.reason ? String(body.reason).trim().slice(0, 200) || null : null;
      if (isAdmin(env, xId)) return json({ error: 'cannot_ban_admin' }, 400);
      await DB.batch([
        DB.prepare('UPDATE users SET banned = 1 WHERE x_id = ?1').bind(xId),
        DB.prepare('INSERT INTO banned_ids (x_id, banned_at, reason) VALUES (?1, unixepoch(), ?2) ON CONFLICT(x_id) DO UPDATE SET reason = COALESCE(excluded.reason, banned_ids.reason)').bind(xId, reason),
        DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'ban' WHERE x_id = ?1 AND status = 'visible'").bind(xId),
        DB.prepare('DELETE FROM sessions WHERE x_id = ?1').bind(xId),   // M4: ban signs the user out everywhere
        log('user.ban', 'user:' + xId, { reason }),
      ]);
    } else if (action === 'unban') {
      await DB.batch([
        DB.prepare('UPDATE users SET banned = 0 WHERE x_id = ?1').bind(xId),
        DB.prepare('DELETE FROM banned_ids WHERE x_id = ?1').bind(xId),
        DB.prepare("UPDATE comments SET status = 'visible', hidden_by = NULL WHERE x_id = ?1 AND hidden_by = 'ban'").bind(xId),
        log('user.unban', 'user:' + xId),
      ]);
    } else if (action === 'purge') {
      if (!listed) return json({ error: 'not_banned' }, 400);
      if (isAdmin(env, xId)) return json({ error: 'cannot_purge_admin' }, 400);
      if (body.confirm !== xId) return json({ error: 'confirm_required' }, 400);   // client confirm step echoes the id
      await log('user.purge.start', 'user:' + xId, { x_id: xId }).run();   // logged first so an interrupted purge is still on record
      await deleteAccountData(env, xId);
      await log('user.purge', 'user:' + xId, { x_id: xId, kept_ban: true }).run();
    } else return json({ error: 'bad_action' }, 400);
    return json({ ok: true, kind, id: xId, action });
  }
  return json({ error: 'bad_request' }, 400);
}
