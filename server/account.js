// Account data deletion, shared by self-service (POST /api/account/delete) and the admin
// 'Delete data, keep ban' action. Comments become '[deleted]' placeholders without author; feature requests
// (Ko-fi bookkeeping) are kept without the user id; banned_ids (X id, date, reason) is never touched here.
export async function deleteAccountData(env, id) {
  const DB = env.DB;
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
    DB.prepare('DELETE FROM seen_posts WHERE x_id = ?1').bind(id),
    DB.prepare('DELETE FROM sessions WHERE x_id = ?1').bind(id),
    DB.prepare("DELETE FROM rate_limits WHERE key LIKE '%:u:' || ?1").bind(id),
    DB.prepare('DELETE FROM users WHERE x_id = ?1').bind(id),
  ]);
}
