// POST /auth/logout  (same-origin only)
import { SESSION_COOKIE, getCookie, clearCookie, sha256hex, checkOrigin, json } from '../../server/lib.js';

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request)) return json({ error: 'bad_origin' }, 403);
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
