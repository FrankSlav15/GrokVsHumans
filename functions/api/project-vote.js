// POST /api/project-vote {id, value: 1|-1|0}  -> one up/down vote per signed-in user per approved project (0 removes it).
// The voter is always the session user (no user id in the body), so a request can only ever change the caller's own vote.
import { json, now, readJsonPost, requireUser, limitWrite } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'vote');
  if (limited) return limited;
  const id = String(body?.id ?? ''), value = Number(body?.value);
  if (!/^[0-9]{1,9}$/.test(id) || ![1, -1, 0].includes(value)) return json({ error: 'bad_request' }, 400);
  if (!(await env.DB.prepare("SELECT 1 FROM projects WHERE id = ?1 AND status = 'approved'").bind(Number(id)).first())) return json({ error: 'not_found' }, 404);
  if (value === 0) await env.DB.prepare('DELETE FROM project_votes WHERE project_id = ?1 AND x_id = ?2').bind(Number(id), user.x_id).run();
  else await env.DB.prepare(`INSERT INTO project_votes (project_id, x_id, value, created_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(project_id, x_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`).bind(Number(id), user.x_id, value, now()).run();
  const r = await env.DB.prepare('SELECT SUM(value = 1) up, SUM(value = -1) down FROM project_votes WHERE project_id = ?1').bind(Number(id)).first();
  return json({ ok: true, id, mine: value, up: r?.up || 0, down: r?.down || 0 });
}
