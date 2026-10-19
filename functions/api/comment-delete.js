// POST /api/comment-delete {id}  -> the author (or an admin) deletes a comment for good.
import { json, readJsonPost, getSessionUser, isAdmin } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const user = await getSessionUser(env, request);   // banned users may still delete their own comments
  if (!user) return json({ error: 'sign_in_required' }, 401);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);

  const c = await env.DB.prepare('SELECT x_id FROM comments WHERE id = ?1').bind(id).first();
  if (!c) return json({ error: 'not_found' }, 404);
  if (c.x_id !== user.x_id && !isAdmin(env, user.x_id)) return json({ error: 'forbidden' }, 403);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM reactions WHERE target_type = 'comment' AND target_id = ?1").bind(String(id)),
    env.DB.prepare('DELETE FROM reports WHERE comment_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM comments WHERE id = ?1').bind(id),
  ]);
  return json({ ok: true, id });
}
