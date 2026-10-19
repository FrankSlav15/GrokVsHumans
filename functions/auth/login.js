// GET /auth/login?return=/battles.html%2321
// Starts "Sign in with X" (OAuth 2.0 Authorization Code Flow with PKCE).
import {
  OAUTH_HOSTS, CANONICAL_HOST, OAUTH_COOKIE, OAUTH_TTL,
  randomToken, sha256, b64url, setCookie, safeReturnTo, now,
} from '../../server/lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('return') || '/');

  // Only hosts with a registered callback can complete the flow
  // (preview deployments get sent to the production hostname).
  if (!OAUTH_HOSTS.has(url.hostname)) {
    const target = new URL(`https://${CANONICAL_HOST}/auth/login`);
    target.searchParams.set('return', returnTo);
    return Response.redirect(target.toString(), 302);
  }
  if (!env.X_CLIENT_ID || !env.DB) {
    return new Response('Sign in is not configured on this deployment.', { status: 503 });
  }

  const state = randomToken(24);
  const codeVerifier = randomToken(48);              // 64 chars, RFC 7636 compliant
  const codeChallenge = b64url(await sha256(codeVerifier));
  const redirectUri = `https://${url.hostname}/auth/callback`;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?1').bind(now() - OAUTH_TTL),
    env.DB.prepare(
      'INSERT INTO oauth_states (state, code_verifier, redirect_uri, return_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(state, codeVerifier, redirectUri, returnTo, now()),
  ]);

  const authorize = new URL('https://x.com/i/oauth2/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.X_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'tweet.read users.read');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', codeChallenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  return new Response(null, {
    status: 302,
    headers: {
      // X expects spaces in scope as %20 (URLSearchParams would emit '+').
      Location: authorize.toString().replace(/\+/g, '%20'),
      'Set-Cookie': setCookie(OAUTH_COOKIE, state, OAUTH_TTL),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
