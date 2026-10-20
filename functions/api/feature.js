// POST /api/feature {post_id, tier, pin_topics?} -> feature request for an approved post; returns the Ko-fi code
import { json, now, requireUser, readJsonPost, limitWrite } from '../../server/lib.js';
import { tiers, FEATURE_REQ_PER_DAY } from '../../server/config.js';
import { createFeature } from './suggest.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'feature');
  if (limited) return limited;
  const id = Number(body?.post_id), tier = tiers(env).find(x => x.id === body?.tier);
  if (!Number.isInteger(id) || id <= 0 || !tier) return json({ error: 'bad_request' }, 400);
  if (!(await env.DB.prepare("SELECT 1 FROM posts WHERE id = ?1 AND status = 'approved'").bind(id).first())) return json({ error: 'not_found' }, 404);
  const t = now();
  const day = await env.DB.prepare('SELECT COUNT(*) n FROM feature_requests WHERE x_id = ?1 AND created_at > ?2').bind(user.x_id, t - 86400).first();
  if ((day?.n || 0) >= FEATURE_REQ_PER_DAY) return json({ error: 'daily_limit' }, 429);
  // reuse an unpaid request by the same user for the same post + tier instead of piling up codes
  const open = await env.DB.prepare("SELECT id, code FROM feature_requests WHERE x_id = ?1 AND post_id = ?2 AND tier = ?3 AND state = 'pending_payment'").bind(user.x_id, id, tier.id).first();
  if (open) { const f = await createFeatureView(env, open, tier); return json({ ok: true, feature: f }); }
  return json({ ok: true, feature: await createFeature(env, user, { post_id: id, tier, pin_topics: body?.pin_topics !== false }) }, 201);
}
async function createFeatureView(env, r, tier) {
  const { kofiUrl, kofiConfigured } = await import('../../server/config.js');
  return { id: r.id, code: r.code, tier: tier.id, label: tier.label, usd: tier.usd, kofi_url: kofiUrl(env), kofi_ready: kofiConfigured(env) };
}
