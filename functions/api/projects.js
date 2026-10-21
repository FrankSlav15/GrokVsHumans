// GET  /api/projects?view=hot|new|top&limit=10&offset=0   approved projects (same paging as /api/feed)
//        &order=1 -> ranked ids [[id, engagement, promoted], ...]   &ids=1,2,3 -> these projects in this order   &id=N -> one
// POST /api/projects {name, url, description, si_usage, image_url?, donate_url?, tier?}  -> pending project (signed-in)
// Submissions: same-origin JSON, signed-in and not banned, account-age waiting period + burst limit (limitWrite),
// 3 per day, AI moderation (threats, doxxing, CSAM, spam only: auto-hidden, never published without approval).
import { json, now, getSessionUser, getCookie, SESSION_COOKIE, requireUser, readJsonPost, limitWrite } from '../../server/lib.js';
import { tiers, kofiUrl, kofiConfigured, FEATURE_REQ_PER_DAY } from '../../server/config.js';
import { moderate } from '../../server/moderation.js';
import { validateProject, checkImage, projShape, projHot, projScore, projEngagement, PROJECTS_PER_DAY, PROJECT_LIMITS, DONATE_HOSTS } from '../../server/projects.js';
import { createFeature } from './suggest.js';

const VIEWS = ['hot', 'new', 'top'], ANON_TTL = 30, CANDIDATES = 500;

export async function onRequestGet(ctx) {
  const { request } = ctx;
  const anon = !getCookie(request, SESSION_COOKIE);
  const cache = anon && typeof caches !== 'undefined' ? caches.default : null;
  const key = cache ? new Request(new URL(request.url).toString(), { method: 'GET' }) : null;
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const res = await list(ctx);
  if (cache && res.status === 200) { const out = new Response(res.body, res); out.headers.set('Cache-Control', `public, max-age=0, s-maxage=${ANON_TTL}`); ctx.waitUntil?.(cache.put(key, out.clone())); return out; }
  return res;
}

async function list({ request, env }) {
  const q = new URL(request.url).searchParams;
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'hot';
  const limit = Math.min(Math.max(Number(q.get('limit')) || 10, 1), 30);
  const offset = Math.min(Math.max(Math.floor(Number(q.get('offset'))) || 0, 0), 5000);
  const one = /^[0-9]{1,9}$/.test(q.get('id') || '') ? q.get('id') : '';
  const want = (q.get('ids') || '').split(',').filter(x => /^[0-9]{1,9}$/.test(x)).slice(0, 30);
  const viewer = await getSessionUser(env, request), t = now();
  const { results } = await env.DB.prepare(`SELECT p.*,
      (SELECT SUM(value = 1) FROM project_votes v WHERE v.project_id = p.id) up,
      (SELECT SUM(value = -1) FROM project_votes v WHERE v.project_id = p.id) down,
      (SELECT COUNT(*) FROM comments m WHERE m.item_type = 'project' AND m.item_id = CAST(p.id AS TEXT) AND m.status = 'visible') n,
      (SELECT MAX(f.ends_at) FROM feature_requests f WHERE f.project_id = p.id AND f.state = 'active' AND f.ends_at > ?3) promo
    FROM projects p WHERE p.status = 'approved' AND (?1 = '' OR p.id = CAST(?1 AS INTEGER)) ORDER BY p.approved_at DESC LIMIT ?2`).bind(one, CANDIDATES, t).all();
  let rows = results.map(r => ({ r, p: projShape(r) }));
  for (const x of rows) if (x.r.promo) x.p.promoted = { until: x.r.promo };
  const P = rows.map(x => x.p);
  if (view === 'new') P.sort((a, b) => b.approved_at - a.approved_at);
  else if (view === 'top') P.sort((a, b) => projScore(b) - projScore(a) || b.comments - a.comments || b.approved_at - a.approved_at);
  else P.sort((a, b) => projHot(b, t) - projHot(a, t));
  const list = view === 'hot' ? [...P.filter(p => p.promoted), ...P.filter(p => !p.promoted)] : P;
  const base = { view, kind: 'project', signedIn: !!viewer, total: list.length, disclaimer: true };
  if (q.get('order') === '1') return json({ ...base, order: list.map(p => [p.id, projEngagement(p), p.promoted ? 1 : 0]) });
  let page, next = null;
  if (want.length) { const by = new Map(list.map(p => [p.id, p])); page = want.map(id => by.get(id)).filter(Boolean); }
  else { page = list.slice(offset, offset + limit); next = offset + page.length < list.length ? offset + page.length : null; }
  if (viewer && page.length) {
    const ph = page.map((_, i) => '?' + (i + 2)).join(',');
    const { results: mine } = await env.DB.prepare(`SELECT project_id, value FROM project_votes WHERE x_id = ?1 AND project_id IN (${ph})`).bind(viewer.x_id, ...page.map(p => Number(p.id))).all();
    const M = Object.fromEntries(mine.map(m => [String(m.project_id), m.value])); for (const p of page) p.mine = { vote: M[p.id] || 0 };
  }
  return json({ ...base, posts: page, offset, next });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);   // signed in, not banned
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'project');   // burst limit + account-age waiting period
  if (limited) return limited;
  const [f, err] = validateProject(body);
  if (err) return json({ error: err, limits: PROJECT_LIMITS }, 400);
  const tier = body?.tier ? tiers(env).find(x => x.id === body.tier) : null;
  if (body?.tier && !tier) return json({ error: 'bad_tier' }, 400);
  const t = now();
  const day = await env.DB.prepare('SELECT COUNT(*) n FROM projects WHERE x_id = ?1 AND created_at > ?2').bind(user.x_id, t - 86400).first();
  if ((day?.n || 0) >= PROJECTS_PER_DAY) return json({ error: 'daily_limit', limit: PROJECTS_PER_DAY }, 429);
  if (await env.DB.prepare("SELECT 1 FROM projects WHERE url = ?1 AND status IN ('pending','approved')").bind(f.url).first()) return json({ error: 'already_submitted' }, 409);
  if (f.image_url) { const ie = await checkImage(f.image_url); if (ie) return json({ error: ie }, 400); }
  const m = await moderate(env, [f.name, f.description, f.si_usage, f.url, f.donate_url || ''].join('\n'), user);
  const hide = m.state === 'hidden';
  const row = await env.DB.prepare(`INSERT INTO projects (x_id, handle, name, url, description, si_usage, image_url, donate_url, status, hidden_by, mod_state, mod_category, mod_reason, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14) RETURNING id`)
    .bind(user.x_id, user.handle, f.name, f.url, f.description, f.si_usage, f.image_url, f.donate_url, hide ? 'hidden' : 'pending', hide ? 'auto' : null, m.state, m.category, m.reason, t).first();
  let feature = null;
  if (tier && !hide) {
    const fday = await env.DB.prepare('SELECT COUNT(*) n FROM feature_requests WHERE x_id = ?1 AND created_at > ?2').bind(user.x_id, t - 86400).first();
    if ((fday?.n || 0) < FEATURE_REQ_PER_DAY) feature = await createFeature(env, user, { project_id: row.id, tier, pin_topics: false });
  }
  return json({ ok: true, id: row.id, status: 'pending', feature }, 201);
}
// config for the form (tiers, limits, allowed donation platforms)
export const DONATE_PLATFORMS = ['Ko-fi', 'Patreon', 'GitHub Sponsors', 'Buy Me a Coffee', 'Open Collective', 'Liberapay'];
