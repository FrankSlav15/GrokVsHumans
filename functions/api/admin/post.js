// POST /api/admin/post {id, action, headline?, topics?}   (admins only)
// action: approve (mid-thread chains are rebuilt by gvh-fetch first, then published; force=true skips) | rebuild | feature | unfeature | skip | never (block author + skip all their pending) | hide | restore | headline | topics
import { json, now, readJsonPost, requireAdmin } from '../../../server/lib.js';
import { TOPICS } from '../../../server/v2.js';

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const id = Number(body?.id), action = String(body?.action || '');
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const p = await env.DB.prepare('SELECT * FROM posts WHERE id = ?1').bind(id).first();
  if (!p) return json({ error: 'not_found' }, 404);
  const t = now(), DB = env.DB, st = [];

  if (typeof body?.headline === 'string' && ['approve', 'feature', 'headline', 'topics'].includes(action)) {
    const h = body.headline.replace(/\s+/g, ' ').trim().slice(0, 120);
    st.push(DB.prepare('UPDATE posts SET headline = ?2 WHERE id = ?1').bind(id, h || null));
  }
  if (Array.isArray(body?.topics) && ['approve', 'feature', 'topics'].includes(action)) {
    const tops = [...new Set(body.topics.filter(x => TOPICS.includes(x)))].slice(0, 3);
    st.push(DB.prepare('DELETE FROM post_topics WHERE post_id = ?1').bind(id));
    for (const x of tops) st.push(DB.prepare('INSERT INTO post_topics (post_id, topic, suggested) VALUES (?1, ?2, 0)').bind(id, x));
  }
  // Free check: the stored chain does not open on the conversation root -> rebuild before publishing.
  const midThread = async () => !!p.conversation_id && (await DB.prepare('SELECT tweet_id FROM post_tweets WHERE post_id = ?1 AND pos = 0').bind(id).first())?.tweet_id !== p.conversation_id;
  if (p.status === 'pending' && (action === 'approve' || action === 'feature') && body?.force !== true && p.rebuild_state !== 'failed' && await midThread()) {
    st.push(DB.prepare("UPDATE posts SET rebuild_state='queued', rebuild_publish=1, rebuild_feature=?2, rebuild_note=NULL, rebuild_at=?3 WHERE id=?1").bind(id, action === 'feature' ? 1 : 0, t));
    await DB.batch(st);
    return json({ ok: true, id, action, rebuilding: true });
  }
  switch (action) {
    case 'rebuild':
      if (p.status !== 'pending') return json({ error: 'not_pending' }, 400);
      st.push(DB.prepare("UPDATE posts SET rebuild_state='queued', rebuild_publish=0, rebuild_feature=0, rebuild_note=NULL, rebuild_at=?2 WHERE id=?1").bind(id, t)); break;
    case 'approve': st.push(DB.prepare("UPDATE posts SET status='approved', approved_at=COALESCE(approved_at, ?2), hidden_reason=NULL WHERE id=?1").bind(id, t)); break;
    case 'feature': st.push(DB.prepare("UPDATE posts SET status='approved', featured=1, approved_at=COALESCE(approved_at, ?2), hidden_reason=NULL WHERE id=?1").bind(id, t)); break;
    case 'unfeature': st.push(DB.prepare('UPDATE posts SET featured=0 WHERE id=?1').bind(id)); break;
    case 'skip': st.push(DB.prepare("UPDATE posts SET status='skipped' WHERE id=?1").bind(id)); break;
    case 'hide': st.push(DB.prepare("UPDATE posts SET status='hidden', hidden_reason='admin' WHERE id=?1").bind(id)); break;
    case 'restore': st.push(DB.prepare("UPDATE posts SET status='pending', featured=0, rebuild_state=NULL, rebuild_publish=0, approved_at=NULL, hidden_reason=NULL WHERE id=?1").bind(id)); break;
    case 'never': {
      if (!p.human_handle) return json({ error: 'no_author' }, 400);
      st.push(DB.prepare('INSERT OR REPLACE INTO blocked_authors (x_id, handle, reason, created_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(p.human_x_id, p.human_handle.toLowerCase(), 'admin: never from author', t));
      st.push(DB.prepare("UPDATE posts SET status='blocked' WHERE id=?1 OR (status='pending' AND lower(human_handle)=lower(?2))").bind(id, p.human_handle));
      break;
    }
    case 'unblock': st.push(DB.prepare('DELETE FROM blocked_authors WHERE handle = lower(?1)').bind(String(body?.handle || p.human_handle || ''))); break;
    case 'headline': case 'topics': break;
    default: return json({ error: 'bad_action' }, 400);
  }
  if (st.length) await DB.batch(st);
  return json({ ok: true, id, action });
}
