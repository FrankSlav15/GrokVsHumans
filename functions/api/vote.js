// POST /api/vote  {"id":"21","choice":"grok"|"human", "type":"battle"|"post"}  (choice null/"" on a post removes the vote)
// Signed-in X users only; one vote per user per battle (changing it is allowed).
import { getSessionUser, checkOrigin, getBattleIds, itemExists, voteTotals, json, now, limitWrite } from '../../server/lib.js';

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
  if (body?.type === 'post') return postVote(env, request, user, id, choice);
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

async function postVote(env, request, user, id, choice) {
  if (!/^[0-9]{1,9}$/.test(id) || ![ 'grok', 'human', null, '' ].includes(choice ?? null)) return json({ error: 'bad_request' }, 400);
  if (!(await itemExists(env, request, 'post', id))) return json({ error: 'unknown_item' }, 404);
  const t = now();
  if (!choice) await env.DB.prepare("DELETE FROM votes WHERE item_type='post' AND item_id=?1 AND x_id=?2").bind(id, user.x_id).run();
  else await env.DB.prepare(
    `INSERT INTO votes (item_type, item_id, x_id, choice, created_at, updated_at) VALUES ('post', ?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(item_type, item_id, x_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`
  ).bind(id, user.x_id, choice, t).run();
  const r = await env.DB.prepare("SELECT SUM(choice='grok') g, SUM(choice='human') h FROM votes WHERE item_type='post' AND item_id=?1").bind(id).first();
  return json({ ok: true, id, mine: choice || null, votes: { grok: r?.g || 0, human: r?.h || 0 } });
}
