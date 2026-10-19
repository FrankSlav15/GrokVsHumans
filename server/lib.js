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

// Hosts whose /auth/callback is registered in the X app (exact match).
export const OAUTH_HOSTS = new Set([
  'grokvshumans.pages.dev',
  'grokvshumans.com',
  'www.grokvshumans.com',
]);
export const CANONICAL_HOST = 'grokvshumans.pages.dev';

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
    `SELECT u.x_id, u.handle, u.name, u.avatar_url, u.verified, u.banned, s.expires_at
       FROM sessions s JOIN users u ON u.x_id = s.x_id
      WHERE s.token_hash = ?1`
  ).bind(hash).first();
  if (!row || row.expires_at < now()) return null;
  return { ...row, token_hash: hash };
}

export function isAdmin(env, xId) {
  return String(env.ADMIN_X_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(xId));
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
export const ITEM_TYPES = new Set(Object.keys(ITEM_FILES));

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
  const ph = ids.map((_, i) => '?' + (i + 2)).join(',');
  const { results } = await env.DB.prepare(
    `SELECT target_id, SUM(value = 1) AS likes, SUM(value = -1) AS dislikes,
            MAX(CASE WHEN x_id = ?1 THEN value END) AS mine
       FROM reactions WHERE target_type = '${targetType}' AND target_id IN (${ph}) GROUP BY target_id`
  ).bind(xId || '', ...ids.map(String)).all();
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
