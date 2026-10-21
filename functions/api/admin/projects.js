// GET  /api/admin/projects?status=pending|approved|skipped|hidden     (admins only)
// POST /api/admin/projects {id, action: save|approve|skip|hide|restore|delete, name?, url?, description?, si_usage?, image_url?, donate_url?}
//   save/approve/skip may carry edited fields (validated like a submission). Every action is written to admin_log.
import { json, now, readJsonPost, requireAdmin, auditStmt } from '../../../server/lib.js';
import { validateProject } from '../../../server/projects.js';

const STATUSES = ['pending', 'approved', 'skipped', 'hidden'];
export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const status = STATUSES.includes(new URL(request.url).searchParams.get('status')) ? new URL(request.url).searchParams.get('status') : 'pending';
  const [rows, counts] = await env.DB.batch([
    env.DB.prepare(`SELECT p.*, u.banned,
        (SELECT SUM(value = 1) FROM project_votes v WHERE v.project_id = p.id) up, (SELECT SUM(value = -1) FROM project_votes v WHERE v.project_id = p.id) down,
        (SELECT code || ' · ' || tier || ' · ' || state FROM feature_requests f WHERE f.project_id = p.id ORDER BY f.id DESC LIMIT 1) feature
      FROM projects p LEFT JOIN users u ON u.x_id = p.x_id WHERE p.status = ?1 ORDER BY ${status === 'pending' ? 'p.id' : 'COALESCE(p.approved_at, p.updated_at) DESC'} LIMIT 200`).bind(status),
    env.DB.prepare('SELECT status, COUNT(*) n FROM projects GROUP BY status'),
  ]);
  return json({ status, counts: Object.fromEntries(counts.results.map(r => [r.status, r.n])), projects: rows.results.map(p => ({ ...p, banned: !!p.banned })) }, 200, { 'Cache-Control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [admin, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const id = Number(body?.id), action = String(body?.action || ''), t = now(), DB = env.DB;
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const p = await DB.prepare('SELECT * FROM projects WHERE id = ?1').bind(id).first();
  if (!p) return json({ error: 'not_found' }, 404);
  const log = detail => auditStmt(env, admin.x_id, 'project.' + action, 'project:' + id, detail);
  const edits = ['name', 'url', 'description', 'si_usage', 'image_url', 'donate_url'].some(k => body?.[k] !== undefined);
  let f = null;
  if (edits) { const [v, err] = validateProject({ ...p, ...body }); if (err) return json({ error: err }, 400); f = v; }
  const upd = f ? DB.prepare('UPDATE projects SET name = ?2, url = ?3, description = ?4, si_usage = ?5, image_url = ?6, donate_url = ?7, updated_at = ?8 WHERE id = ?1')
    .bind(id, f.name, f.url, f.description, f.si_usage, f.image_url, f.donate_url, t) : null;
  const changed = f ? Object.keys(f).filter(k => (f[k] || null) !== (p[k] || null)) : [];
  const S = (status, extra = '') => DB.prepare(`UPDATE projects SET status = ?2, updated_at = ?3${extra} WHERE id = ?1`).bind(id, status, t);
  let stmts;
  if (action === 'save') { if (!upd) return json({ error: 'bad_request' }, 400); stmts = [upd]; }
  else if (action === 'approve') stmts = [...(upd ? [upd] : []), S('approved', ', approved_at = COALESCE(approved_at, ?3), hidden_by = NULL')];
  else if (action === 'skip') stmts = [...(upd ? [upd] : []), S('skipped')];
  else if (action === 'hide') stmts = [S('hidden', ", hidden_by = 'admin'")];
  else if (action === 'restore') stmts = [S('pending', ', hidden_by = NULL')];
  else if (action === 'delete') stmts = [
    DB.prepare(`DELETE FROM reactions WHERE target_type = 'comment' AND target_id IN (SELECT CAST(id AS TEXT) FROM comments WHERE item_type = 'project' AND item_id = ?1)`).bind(String(id)),
    DB.prepare('UPDATE feature_requests SET project_id = NULL WHERE project_id = ?1').bind(id),   // payment records stay, like posts
    DB.prepare(`DELETE FROM reports WHERE comment_id IN (SELECT id FROM comments WHERE item_type = 'project' AND item_id = ?1)`).bind(String(id)),
    DB.prepare(`DELETE FROM comments WHERE item_type = 'project' AND item_id = ?1`).bind(String(id)),
    DB.prepare(`DELETE FROM translations WHERE kind = 'project' AND item_id IN (?1 || ':d', ?1 || ':s')`).bind(String(id)),
    DB.prepare('DELETE FROM project_votes WHERE project_id = ?1').bind(id),
    DB.prepare('DELETE FROM projects WHERE id = ?1').bind(id)];
  else return json({ error: 'bad_action' }, 400);
  await DB.batch([...stmts, log(changed.length ? { edited: changed } : null)]);
  return json({ ok: true, id, action, edited: changed });
}
