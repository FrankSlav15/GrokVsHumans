// POST /api/report {id, reason?}  -> one report per user per comment. Auto-hide needs AUTO_HIDE_REPORTS distinct
// reporters whose account is at least MIN_AGE_REPORT old (throwaway accounts are recorded for admins but do not count).
import { json, now, readJsonPost, requireUser, limitWrite, MIN_AGE_REPORT } from '../../server/lib.js';
import { AUTO_HIDE_REPORTS } from '../../server/moderation.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'report');
  if (limited) return limited;

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;

  const c = await env.DB.prepare('SELECT x_id, status FROM comments WHERE id = ?1').bind(id).first();
  if (!c) return json({ error: 'not_found' }, 404);
  if (c.x_id === user.x_id) return json({ error: 'own_comment' }, 400);

  const t = now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE x_id = ?1 AND created_at > ?2')
    .bind(user.x_id, t - 3600).first();
  if ((recent?.n || 0) >= 20) return json({ error: 'rate_limited' }, 429);

  const ins = await env.DB.prepare('INSERT OR IGNORE INTO reports (comment_id, x_id, reason, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, user.x_id, reason, t).run();
  if (!ins.meta.changes) return json({ ok: true, already: true });

  const [, row] = await env.DB.batch([
    env.DB.prepare('UPDATE comments SET report_count = (SELECT COUNT(*) FROM reports WHERE comment_id = ?1) WHERE id = ?1').bind(id),
    env.DB.prepare(`SELECT c.status, (SELECT COUNT(*) FROM reports r JOIN users u ON u.x_id = r.x_id
        WHERE r.comment_id = ?1 AND u.banned = 0 AND COALESCE(u.x_created_at, u.created_at) <= ?2) AS trusted
      FROM comments c WHERE c.id = ?1`).bind(id, t - MIN_AGE_REPORT),
  ]);
  const rc = row.results[0]?.trusted || 0;
  let hidden = row.results[0]?.status === 'hidden';
  if (!hidden && rc >= AUTO_HIDE_REPORTS) {
    await env.DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'reports' WHERE id = ?1 AND status = 'visible'").bind(id).run();
    hidden = true;
  }
  return json({ ok: true, hidden });
}
