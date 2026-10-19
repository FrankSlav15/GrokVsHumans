// GET /api/me -> { user: null } or { user: { id, handle, name, avatar, verified, admin } }
import { getSessionUser, publicUser, json } from '../../server/lib.js';

export async function onRequestGet({ request, env }) {
  const u = await getSessionUser(env, request);
  return json({ user: u ? publicUser(env, u) : null });
}
