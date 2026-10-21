// Shared helpers for the Pages Functions in /functions.
// Bindings (set on the Pages project, Production):
//   DB              D1 database "gvh-db"
//   X_CLIENT_ID     OAuth 2.0 client id (plain text)
//   X_CLIENT_SECRET OAuth 2.0 client secret (secret)
//   ADMIN_X_IDS     comma-separated X user ids with admin rights (plain text)

export const SESSION_COOKIE = '__Host-gvh_sess';
export const OAUTH_COOKIE = '__Host-gvh_oauth';
export const SESSION_TTL = 60 * 60 * 24 * 30;   // 30 days
export const OAUTH_TTL = 60 * 10;               // 10 minutes
export const ADMIN_SESSION_TTL = 60 * 60 * 24;  // admin sessions: max 24 h from sign-in (M4)

// Abuse controls (M1/M3). Account age = X account creation date when known
// (requested at login), else the first sign-in on this site.
export const MIN_AGE_WRITE = 3 * 86400;     // votes, reactions, comments
export const MIN_AGE_REPORT = 30 * 86400;   // a report only counts towards auto-hide from accounts this old
export const LIMITS = {
  suggest: { max: 10, win: 3600 },  // burst guard; the daily cap lives in server/config.js
  feature: { max: 10, win: 3600 },
  project: { max: 10, win: 3600 },  // burst guard; the daily cap (3) lives in server/projects.js
  login:   { max: 20,  win: 600 },   // per IP
  vote:    { max: 120, win: 600 },   // per user (and 4x per IP)
  react:   { max: 120, win: 600 },
  comment: { max: 20,  win: 600 },   // per IP (per-user cap lives in moderation.js)
  report:  { max: 20,  win: 3600 },
};

// Hosts whose /auth/callback is registered in the X app (exact match).
export const OAUTH_HOSTS = new Set([
  'grokvshumans.pages.dev',
  'grokvshumans.com',
  'www.grokvshumans.com',
]);
export const CANONICAL_HOST = 'grokvshumans.com';

export const now = () => Math.floor(Date.now() / 1000);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return new Uint8Array(buf);
}

export async function sha256hex(str) {
  return [...(await sha256(str))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }   // malformed -> treat as absent
  }
  return null;
}

// __Host- cookies: Secure, Path=/, no Domain attribute.
export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie(name) {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Only same-site relative paths are allowed as post-login destinations.
// Normalise first (WHATWG URL resolves ./, ../ and %2e), then validate the result:
// it must be "/" or start with a single "/" followed by a char that is neither "/" nor "\\".
export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\r\n\t\\]/.test(value)) return '/';
  if (!/^\/(?![\/\\])/.test(value) && value !== '/') return '/';
  let u;
  try { u = new URL(value, 'https://x.invalid'); } catch { return '/'; }
  if (u.origin !== 'https://x.invalid') return '/';
  const out = u.pathname + u.search + u.hash;
  if (!(out === '/' || /^\/[^\/\\]/.test(out))) return '/';
  if (/^\/(auth|api)(\/|$)/i.test(out)) return '/';
  return out;
}

// CSRF protection for state-changing requests: the browser-sent Origin must
// equal this deployment's own origin.
export function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  return !!origin && origin === new URL(request.url).origin;
}

export async function getSessionUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT u.x_id, u.handle, u.name, u.avatar_url, u.verified, u.banned, u.created_at AS user_created_at, u.x_created_at,
            s.created_at AS session_created_at, s.expires_at
       FROM sessions s JOIN users u ON u.x_id = s.x_id
      WHERE s.token_hash = ?1`
  ).bind(hash).first();
  if (!row || row.expires_at < now()) return null;
  if (isAdmin(env, row.x_id) && row.session_created_at < now() - ADMIN_SESSION_TTL) return null;
  return { ...row, token_hash: hash };
}

export const clientIp = request => request.headers.get('CF-Connecting-IP') || 'unknown';
export const accountAge = u => now() - Number(u.x_created_at || u.user_created_at || now());

// D1 fixed-window counter. Over-limit requests only read; under-limit ones do one upsert.
// Fails open (logs) so a missing table or D1 hiccup never blocks the site.
export async function rateLimit(env, key, { max, win }) {
  try {
    const t = now(), w = Math.floor(t / win);
    const row = await env.DB.prepare('SELECT n FROM rate_limits WHERE key = ?1 AND win = ?2').bind(key, w).first();
    if ((row?.n || 0) >= max) return false;
    const stmts = [env.DB.prepare(
      `INSERT INTO rate_limits (key, win, n, expires_at) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(key, win) DO UPDATE SET n = n + 1`).bind(key, w, (w + 1) * win)];
    if (Math.random() < 0.02) stmts.push(env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(t));
    await env.DB.batch(stmts);
    return true;
  } catch (e) { console.log('rateLimit error', String(e)); return true; }
}
export const rateLimited = win => json({ error: 'rate_limited', retry_after: win }, 429, { 'Retry-After': String(win) });

// Per-user + per-IP limit for a write action. Returns an error Response or null.
export async function limitWrite(env, request, user, action) {
  const l = LIMITS[action];
  if (user && !(await rateLimit(env, `${action}:u:${user.x_id}`, l))) return rateLimited(l.win);
  if (!(await rateLimit(env, `${action}:ip:${clientIp(request)}`, { max: l.max * 4, win: l.win }))) return rateLimited(l.win);
  if (user && action !== 'report' && accountAge(user) < MIN_AGE_WRITE) return json({ error: 'account_too_new' }, 403);
  return null;
}

// Is this item id valid? Posts: one indexed lookup (no full-table scan); battles/memes: static JSON ids.
export async function itemExists(env, request, type, id) {
  if (!ITEM_TYPES.has(type)) return false;
  if (type === 'post' || type === 'project') {
    if (!/^[0-9]{1,9}$/.test(String(id))) return false;
    return !!(await env.DB.prepare(`SELECT 1 FROM ${type === 'post' ? 'posts' : 'projects'} WHERE id = ?1 AND status = 'approved'`).bind(Number(id)).first());
  }
  return (await getItemIds(env, request, type)).has(String(id));
}

export function isAdmin(env, xId) {
  return String(env.ADMIN_X_IDS || '').split(',').map(s => s.trim()).filter(s => /^[0-9]{1,25}$/.test(s)).includes(String(xId));   // numeric X ids only, never handles
}

export function publicUser(env, u) {
  return {
    id: u.x_id,
    handle: u.handle,
    name: u.name,
    avatar: u.avatar_url,
    verified: !!u.verified,
    admin: isAdmin(env, u.x_id),
  };
}

// Valid item ids come from the deployed /data/*.json files.
const ITEM_FILES = { battle: '/data/battles.json', meme: '/data/memes.json' };
const itemIdsCache = {};
export async function getItemIds(env, request, type) {
  if (type === 'post') {
    const { results } = await env.DB.prepare("SELECT id FROM posts WHERE status = 'approved'").all();
    return new Set(results.map(r => String(r.id)));
  }
  const file = ITEM_FILES[type];
  if (!file) return new Set();
  const c = itemIdsCache[type];
  if (c && c.at > Date.now() - 5 * 60 * 1000) return c.ids;
  const res = await env.ASSETS.fetch(new URL(file, request.url));
  if (!res.ok) throw new Error(file + ' not available');
  const ids = new Set(Object.keys(await res.json()));
  itemIdsCache[type] = { ids, at: Date.now() };
  return ids;
}
export const getBattleIds = (env, request) => getItemIds(env, request, 'battle');
export const ITEM_TYPES = new Set([...Object.keys(ITEM_FILES), 'post', 'project']);

// Parse a JSON body of a same-origin POST. Returns [body, errorResponse].
export async function readJsonPost(request) {
  if (!checkOrigin(request)) return [null, json({ error: 'bad_origin' }, 403)];
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return [null, json({ error: 'bad_content_type' }, 415)];
  try { return [await request.json(), null]; } catch { return [null, json({ error: 'bad_json' }, 400)]; }
}

// Signed-in, not banned user for write actions. Returns [user, errorResponse].
export async function requireUser(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) return [null, json({ error: 'sign_in_required' }, 401)];
  if (user.banned) return [null, json({ error: 'banned' }, 403)];
  return [user, null];
}

export async function requireAdmin(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) return [null, json({ error: 'sign_in_required' }, 401)];
  if (!isAdmin(env, user.x_id)) return [null, json({ error: 'forbidden' }, 403)];
  return [user, null];
}

// Like/dislike counts for many targets of one type, plus this user's own value.
export async function reactionCounts(env, targetType, ids, xId) {
  const out = {};
  for (const id of ids) out[id] = { likes: 0, dislikes: 0, mine: 0 };
  if (!ids.length) return out;
  const ph = ids.map((_, i) => '?' + (i + 3)).join(',');
  const { results } = await env.DB.prepare(
    `SELECT target_id, SUM(value = 1) AS likes, SUM(value = -1) AS dislikes,
            MAX(CASE WHEN x_id = ?1 THEN value END) AS mine
       FROM reactions WHERE target_type = ?2 AND target_id IN (${ph}) GROUP BY target_id`
  ).bind(xId || '', String(targetType), ...ids.map(String)).all();
  for (const r of results) out[r.target_id] = { likes: r.likes || 0, dislikes: r.dislikes || 0, mine: r.mine || 0 };
  return out;
}

// Totals per battle: legacy (anonymous Firebase) + signed-in votes.
export async function voteTotals(env, itemId = null) {
  const where = itemId === null ? '' : 'AND item_id = ?1';
  const stmtLive = env.DB.prepare(
    `SELECT item_id,
            SUM(choice = 'grok')  AS grok,
            SUM(choice = 'human') AS human
       FROM votes WHERE item_type = 'battle' ${where} GROUP BY item_id`);
  const stmtLegacy = env.DB.prepare(
    `SELECT item_id, grok, human FROM legacy_votes WHERE item_type = 'battle' ${where}`);
  const [live, legacy] = await env.DB.batch(
    itemId === null ? [stmtLive, stmtLegacy] : [stmtLive.bind(itemId), stmtLegacy.bind(itemId)]);
  const totals = {};
  const get = id => (totals[id] ||= { grok: 0, human: 0, legacy_grok: 0, legacy_human: 0 });
  for (const r of legacy.results) {
    const t = get(r.item_id);
    t.legacy_grok = r.grok; t.legacy_human = r.human;
    t.grok += r.grok; t.human += r.human;
  }
  for (const r of live.results) {
    const t = get(r.item_id);
    t.grok += r.grok || 0; t.human += r.human || 0;
  }
  return totals;
}

// Admin audit log (admin_log, migration 0014). Returns a prepared statement to put in the same DB.batch as the change.
export function auditStmt(env, adminXId, action, target, detail) {
  return env.DB.prepare('INSERT INTO admin_log (at, admin_x_id, action, target, detail) VALUES (unixepoch(), ?1, ?2, ?3, ?4)')
    .bind(String(adminXId || ''), String(action), target == null ? null : String(target), detail == null ? null : JSON.stringify(detail).slice(0, 2000));
}
