// POST /api/admin/quickadd {url}   (admins only: requireAdmin checks ADMIN_X_IDS server-side)
// Admin quick-add from /admin/queue: dedupe, fetch the thread root-first, main-human title, AI topic(s), store as pending
// (source 'admin'). Runs in gvh-fetch over the service binding FETCH (entrypoint QuickAdd) with its own admin allowance.
import { json, readJsonPost, requireAdmin, auditStmt } from '../../../server/lib.js';
import { parseStatusUrl } from '../../../server/config.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const url = String(body?.url || '').trim().slice(0, 500);
  const tweetId = parseStatusUrl(url);
  if (!tweetId) return json({ error: 'bad_url' }, 400);
  if (!env.FETCH?.add) return json({ error: 'not_configured' }, 503);
  const r = await env.FETCH.add({ url, adminXId: admin.x_id, adminHandle: admin.handle || null, dryRun: body?.dry_run === true }).catch(e => ({ error: 'worker_error', message: String(e.message || e).slice(0, 120) }));
  await auditStmt(env, admin.x_id, 'post.quickadd', r.post_id ? 'post:' + r.post_id : 'tweet:' + tweetId,
    { tweet_id: tweetId, ok: !!r.ok, deferred: !!r.deferred, dry_run: !!r.dry_run, error: r.error || null, cost: r.cost ?? null, partial: r.partial || false }).run();
  if (r.ok) {
    const p = await env.DB.prepare('SELECT id, headline, human_handle, status FROM posts WHERE id = ?1').bind(r.post_id).first();
    const t = await env.DB.prepare('SELECT topic FROM post_topics WHERE post_id = ?1').bind(r.post_id).all();
    return json({ ...r, post: { ...p, topics: t.results.map(x => x.topic) } });
  }
  if (r.deferred || r.dry_run) return json(r, r.deferred ? 202 : 200);
  const code = r.error === 'duplicate_waiting' ? 409 : r.error === 'duplicate' ? 409 : r.error === 'admin_cap' || r.error === 'month_cap' ? 429 : r.error === 'bad_url' ? 400 : 502;
  return json(r, code);
}
