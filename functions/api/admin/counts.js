// GET /api/admin/counts -> badge numbers for the admin nav (admins only). One cheap aggregate query.
import { json, requireAdmin, now } from '../../../server/lib.js';
export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE status = 'pending') AS posts,
      (SELECT COUNT(*) FROM projects WHERE status = 'pending') AS projects,
      (SELECT COUNT(*) FROM comments WHERE mod_reviewed = 0 AND (hidden_by = 'auto' OR mod_state IN ('flagged','error'))) AS moderation,
      (SELECT COUNT(*) FROM suggestions WHERE state = 'new') AS suggestions,
      (SELECT COUNT(*) FROM feature_requests WHERE (state = 'paid' AND (post_id IS NOT NULL OR project_id IS NOT NULL)) OR (refund_needed = 1 AND refunded_at IS NULL)) AS features`).first();
  return json({ queue: r.posts + r.projects, moderation: r.moderation, featured: r.suggestions + r.features, ...r, at: now() }, 200, { 'Cache-Control': 'no-store' });
}
