// GET /api/admin/comments?filter=auto|flagged|reported|hidden|recent|banned   (ADMIN_X_IDS only)
import { json, requireAdmin } from '../../../server/lib.js';

const FILTERS = {
  auto: "c.hidden_by = 'auto' AND c.mod_reviewed = 0 ORDER BY c.created_at DESC",
  flagged: "c.mod_state IN ('flagged','error') AND c.mod_reviewed = 0 ORDER BY c.mod_state = 'flagged' DESC, c.created_at DESC",
  reported: "c.report_count > 0 ORDER BY c.status = 'hidden' DESC, c.report_count DESC, c.created_at DESC",
  hidden: "c.status = 'hidden' ORDER BY c.created_at DESC",
  recent: '1 = 1 ORDER BY c.created_at DESC',
};

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const filter = new URL(request.url).searchParams.get('filter') || 'reported';

  if (filter === 'banned') {
    const { results } = await env.DB.prepare(
      `SELECT x_id, handle, name, avatar_url, last_login,
              (SELECT COUNT(*) FROM comments c WHERE c.x_id = u.x_id) AS comments
         FROM users u WHERE banned = 1 ORDER BY last_login DESC LIMIT 200`).all();
    return json({ filter, users: results });
  }
  const where = FILTERS[filter];
  if (!where) return json({ error: 'bad_filter' }, 400);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.item_type, c.item_id, c.body, c.status, c.hidden_by, c.report_count, c.created_at, c.mod_state, c.mod_category, c.mod_reason, c.mod_reviewed,
            u.x_id, u.handle, u.name, u.banned,
            (SELECT GROUP_CONCAT(COALESCE(r.reason, ''), ' | ') FROM reports r WHERE r.comment_id = c.id) AS reasons
       FROM comments c LEFT JOIN users u ON u.x_id = c.x_id
      WHERE ${where} LIMIT 100`).all();
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM comments WHERE report_count > 0) AS reported,
            (SELECT COUNT(*) FROM comments WHERE hidden_by = 'auto' AND mod_reviewed = 0) AS auto,
            (SELECT COUNT(*) FROM comments WHERE mod_state IN ('flagged','error') AND mod_reviewed = 0) AS flagged,
            (SELECT COUNT(*) FROM comments WHERE status = 'hidden') AS hidden,
            (SELECT COUNT(*) FROM comments) AS total,
            (SELECT COUNT(*) FROM users WHERE banned = 1) AS banned,
            (SELECT COUNT(*) FROM users) AS users`).first();
  return json({ filter, comments: results, counts });
}
