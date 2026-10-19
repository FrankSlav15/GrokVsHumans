// POST /api/react {type: battle|meme|comment, id, value: 1|-1|0}  (0 removes your reaction)
import { json, now, readJsonPost, requireUser, itemExists, reactionCounts, limitWrite } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'react');
  if (limited) return limited;

  const type = String(body?.type || '');
  const id = String(body?.id ?? '');
  const value = Number(body?.value);
  if (![1, -1, 0].includes(value) || !/^[0-9]{1,10}$/.test(id)) return json({ error: 'bad_request' }, 400);

  if (type === 'comment') {
    const c = await env.DB.prepare("SELECT 1 FROM comments WHERE id = ?1 AND status = 'visible'").bind(Number(id)).first();
    if (!c) return json({ error: 'not_found' }, 404);
  } else if (!(await itemExists(env, request, type, id))) {
    return json({ error: 'unknown_item' }, 404);
  }

  if (value === 0) {
    await env.DB.prepare('DELETE FROM reactions WHERE target_type = ?1 AND target_id = ?2 AND x_id = ?3')
      .bind(type, id, user.x_id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO reactions (target_type, target_id, x_id, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(target_type, target_id, x_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
    ).bind(type, id, user.x_id, value, now()).run();
  }
  const counts = await reactionCounts(env, type, [id], user.x_id);
  return json({ ok: true, type, id, ...counts[id] });
}
