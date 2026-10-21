// POST /api/account/delete {confirm: "<handle>" | "DELETE"}  (signed-in, same-origin, JSON only)
// Deletes the account and personal data; comments stay as '[deleted]' placeholders with the author removed;
// feature requests / Ko-fi payment records are kept for bookkeeping with the user id dropped.
import { SESSION_COOKIE, getSessionUser, readJsonPost, clearCookie, json } from '../../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);     // Origin must equal the site origin + application/json
  if (bad) return bad;
  const user = await getSessionUser(env, request);    // banned users may delete their account too
  if (!user) return json({ error: 'sign_in_required' }, 401);
  const c = String(body?.confirm ?? '').trim().replace(/^@/, '');
  if (!(c === 'DELETE' || c.toLowerCase() === String(user.handle).toLowerCase())) return json({ error: 'confirm_required' }, 400);

  const id = user.x_id, DB = env.DB;
  const own = "SELECT CAST(id AS TEXT) FROM comments WHERE x_id = ?1";
  await DB.batch([
    // translations cache of this user's comments (keyed only by their comment ids)
    DB.prepare(`DELETE FROM translations WHERE kind = 'comment' AND item_id IN (${own})`).bind(id),
    // likes/dislikes others left on their comments go with the content; their own reactions cascade below
    DB.prepare(`DELETE FROM reactions WHERE target_type = 'comment' AND target_id IN (${own})`).bind(id),
    DB.prepare(`DELETE FROM reports WHERE comment_id IN (SELECT id FROM comments WHERE x_id = ?1)`).bind(id),
    DB.prepare(`UPDATE comments SET body = '[deleted]', x_id = NULL, deleted_at = unixepoch(), report_count = 0,
                       mod_category = NULL, mod_reason = NULL WHERE x_id = ?1`).bind(id),
    DB.prepare('UPDATE feature_requests SET x_id = NULL, admin_note = TRIM(COALESCE(admin_note, \'\') || \' [account deleted]\') WHERE x_id = ?1').bind(id),
    DB.prepare('UPDATE posts SET suggested_by_x_id = NULL, suggested_by_handle = NULL WHERE suggested_by_x_id = ?1').bind(id),
    DB.prepare('DELETE FROM reactions WHERE x_id = ?1').bind(id),
    DB.prepare('DELETE FROM votes WHERE x_id = ?1').bind(id),
    DB.prepare('DELETE FROM reports WHERE x_id = ?1').bind(id),
    DB.prepare('DELETE FROM suggestions WHERE x_id = ?1').bind(id),
    DB.prepare('DELETE FROM sessions WHERE x_id = ?1').bind(id),
    DB.prepare("DELETE FROM rate_limits WHERE key LIKE '%:u:' || ?1").bind(id),
    DB.prepare('DELETE FROM users WHERE x_id = ?1').bind(id),
  ]);
  return json({ ok: true, deleted: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE), 'Cache-Control': 'no-store' });
}
