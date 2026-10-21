// POST /api/account/delete {confirm: "<handle>" | "DELETE"}  (signed-in, same-origin, JSON only)
// Deletes the account and personal data; comments stay as '[deleted]' placeholders with the author removed;
// feature requests / Ko-fi payment records are kept for bookkeeping with the user id dropped.
import { SESSION_COOKIE, getSessionUser, readJsonPost, clearCookie, json } from '../../../server/lib.js';
import { deleteAccountData } from '../../../server/account.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);     // Origin must equal the site origin + application/json
  if (bad) return bad;
  const user = await getSessionUser(env, request);    // banned users may delete their account too
  if (!user) return json({ error: 'sign_in_required' }, 401);
  const c = String(body?.confirm ?? '').trim().replace(/^@/, '');
  if (!(c === 'DELETE' || c.toLowerCase() === String(user.handle).toLowerCase())) return json({ error: 'confirm_required' }, 400);

  await deleteAccountData(env, user.x_id);
  return json({ ok: true, deleted: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE), 'Cache-Control': 'no-store' });
}
