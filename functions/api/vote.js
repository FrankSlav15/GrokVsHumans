// POST /api/vote  {"id":"21","choice":"grok"|"human"}
// Signed-in X users only; one vote per user per battle (changing it is allowed).
import { getSessionUser, checkOrigin, getBattleIds, voteTotals, json, now, limitWrite } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return json({ error: 'bad_origin' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'bad_content_type' }, 415);

  const user = await getSessionUser(env, request);
  if (!user) return json({ error: 'sign_in_required' }, 401);
  if (user.banned) return json({ error: 'banned' }, 403);
  const limited = await limitWrite(env, request, user, 'vote');
  if (limited) return limited;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const id = String(body?.id ?? '');
  const choice = body?.choice;
  if (!/^[0-9]{1,6}$/.test(id) || (choice !== 'grok' && choice !== 'human')) return json({ error: 'bad_request' }, 400);
  if (!(await getBattleIds(env, request)).has(id)) return json({ error: 'unknown_battle' }, 404);

  const t = now();
  await env.DB.prepare(
    `INSERT INTO votes (item_type, item_id, x_id, choice, created_at, updated_at)
     VALUES ('battle', ?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(item_type, item_id, x_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`
  ).bind(id, user.x_id, choice, t).run();

  const totals = await voteTotals(env, id);
  return json({ ok: true, id, mine: choice, totals: totals[id] || { grok: 0, human: 0, legacy_grok: 0, legacy_human: 0 } });
}
