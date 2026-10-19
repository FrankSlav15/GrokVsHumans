// POST /api/report {id, reason?}  -> one report per user per comment; 3 reports auto-hide it.
import { json, now, readJsonPost, requireUser } from '../../server/lib.js';
import { AUTO_HIDE_REPORTS } from '../../server/moderation.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;

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
    env.DB.prepare('SELECT report_count, status FROM comments WHERE id = ?1').bind(id),
  ]);
  const rc = row.results[0]?.report_count || 0;
  let hidden = row.results[0]?.status === 'hidden';
  if (!hidden && rc >= AUTO_HIDE_REPORTS) {
    await env.DB.prepare("UPDATE comments SET status = 'hidden', hidden_by = 'reports' WHERE id = ?1 AND status = 'visible'").bind(id).run();
    hidden = true;
  }
  return json({ ok: true, hidden });
}
