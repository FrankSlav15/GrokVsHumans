// GET  /api/seen                       -> signed-in viewer's seen/interacted posts: {items: [[post_id, eng, acted, seen_at], ...]}
// POST /api/seen {items:[{id, e, a}]}  -> batch upsert (max 50 per request, rate limited, max SEEN_CAP rows per user)
// POST /api/seen {reset: true}         -> forget all of this viewer's seen posts
// Signed-out readers keep this in localStorage only. Rows are deleted with the account (server/account.js).
import { json, now, readJsonPost, getSessionUser, rateLimit, rateLimited, clientIp } from '../../server/lib.js';

export const SEEN_CAP = 2000, SEEN_BATCH = 50, SEEN_LIMIT = { max: 30, win: 60 };
const H = { 'Cache-Control': 'no-store' };

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ items: [] }, 200, H);
  const { results } = await env.DB.prepare('SELECT post_id, eng, acted, seen_at FROM seen_posts WHERE x_id = ?1 ORDER BY seen_at DESC LIMIT ?2').bind(user.x_id, SEEN_CAP).all();
  return json({ items: results.map(r => [r.post_id, r.eng, r.acted, r.seen_at]) }, 200, H);
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: 'sign_in_required' }, 401);
  if (!(await rateLimit(env, `seen:u:${user.x_id}`, SEEN_LIMIT)) || !(await rateLimit(env, `seen:ip:${clientIp(request)}`, { max: SEEN_LIMIT.max * 4, win: SEEN_LIMIT.win })))
    return rateLimited(SEEN_LIMIT.win);
  if (body?.reset === true) { await env.DB.prepare('DELETE FROM seen_posts WHERE x_id = ?1').bind(user.x_id).run(); return json({ ok: true, reset: true }); }
  const raw = Array.isArray(body?.items) ? body.items : null;
  if (!raw || !raw.length) return json({ error: 'bad_request' }, 400);
  if (raw.length > SEEN_BATCH) return json({ error: 'too_many', max: SEEN_BATCH }, 413);
  const seen = new Map();
  for (const i of raw) {
    const id = String(i?.id ?? ''); if (!/^[0-9]{1,9}$/.test(id)) return json({ error: 'bad_request' }, 400);
    seen.set(id, { id, e: Math.max(-1e6, Math.min(1e7, Math.round(Number(i.e) || 0))), a: i.a ? 1 : 0 });
  }
  const t = now(), items = [...seen.values()];
  // only approved posts are stored (one query for the batch)
  const ok = new Set((await env.DB.prepare(`SELECT CAST(id AS TEXT) id FROM posts WHERE status = 'approved' AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?1))`)
    .bind(JSON.stringify(items.map(i => i.id))).all()).results.map(r => r.id));
  const rows = items.filter(i => ok.has(i.id));
  if (rows.length) await env.DB.batch([
    ...rows.map(i => env.DB.prepare(`INSERT INTO seen_posts (x_id, post_id, seen_at, eng, acted) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(x_id, post_id) DO UPDATE SET seen_at = excluded.seen_at, eng = excluded.eng, acted = MAX(acted, excluded.acted)`).bind(user.x_id, i.id, t, i.e, i.a)),
    // cap: keep the newest SEEN_CAP rows of this user
    env.DB.prepare(`DELETE FROM seen_posts WHERE x_id = ?1 AND post_id NOT IN (SELECT post_id FROM seen_posts WHERE x_id = ?1 ORDER BY seen_at DESC LIMIT ?2)`).bind(user.x_id, SEEN_CAP),
  ]);
  return json({ ok: true, stored: rows.length });
}
