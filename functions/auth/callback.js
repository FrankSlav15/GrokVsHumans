// GET /auth/callback?code=...&state=...
// Finishes "Sign in with X": exchanges the code, reads /2/users/me once,
// stores the user, creates a session and throws the X tokens away.
import {
  OAUTH_COOKIE, OAUTH_TTL, SESSION_COOKIE, SESSION_TTL,
  getCookie, setCookie, clearCookie, randomToken, sha256hex, now,
} from '../../server/lib.js';

function back(returnTo, flag, extraCookies = []) {
  const [path, hash] = returnTo.split('#');
  const u = new URL(path, 'https://x.invalid');
  u.searchParams.set('login', flag);
  const location = u.pathname + u.search + (hash ? '#' + hash : '');
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', clearCookie(OAUTH_COOKIE));
  for (const c of extraCookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const cookieState = getCookie(request, OAUTH_COOKIE);

  // The state must match the one bound to this browser, and exist in D1.
  if (!state || !cookieState || state !== cookieState) return back('/', 'error');
  const row = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?1').bind(state).first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?1').bind(state).run();
  if (!row || row.created_at < now() - OAUTH_TTL) return back('/', 'expired');
  const returnTo = row.return_to || '/';

  if (url.searchParams.get('error')) return back(returnTo, 'cancelled');   // user tapped "Cancel"
  if (!code) return back(returnTo, 'error');

  // 1) code -> access token (confidential client: HTTP Basic with id:secret)
  let accessToken;
  try {
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: row.redirect_uri,
        code_verifier: row.code_verifier,
        client_id: env.X_CLIENT_ID,
      }),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.access_token) {
      console.log('token exchange failed', tokenRes.status, JSON.stringify(tok).slice(0, 300));
      return back(returnTo, 'error');
    }
    accessToken = tok.access_token;
  } catch (e) {
    console.log('token exchange error', String(e));
    return back(returnTo, 'error');
  }

  // 2) the only billable X call: one User read for /2/users/me
  let me;
  try {
    const meRes = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,verified', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !body.data || !body.data.id) {
      console.log('users/me failed', meRes.status, JSON.stringify(body).slice(0, 300));
      return back(returnTo, 'error');
    }
    me = body.data;
  } catch (e) {
    console.log('users/me error', String(e));
    return back(returnTo, 'error');
  } finally {
    accessToken = null;   // never stored anywhere
  }

  const avatar = me.profile_image_url ? me.profile_image_url.replace('_normal.', '_400x400.') : null;
  const token = randomToken(32);
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (x_id, handle, name, avatar_url, verified, created_at, last_login)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(x_id) DO UPDATE SET handle = excluded.handle, name = excluded.name,
         avatar_url = excluded.avatar_url, verified = excluded.verified, last_login = excluded.last_login`
    ).bind(String(me.id), me.username, me.name || null, avatar, me.verified ? 1 : 0, t),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(t),
    env.DB.prepare('INSERT INTO sessions (token_hash, x_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(await sha256hex(token), String(me.id), t, t + SESSION_TTL),
  ]);

  return back(returnTo, 'ok', [setCookie(SESSION_COOKIE, token, SESSION_TTL)]);
}
