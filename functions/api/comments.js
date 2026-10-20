// GET  /api/comments?type=battle&id=21  -> item reactions + visible comments (everyone)
// POST /api/comments {type, id, body}    -> new comment (signed-in X users)
import {
  json, now, getSessionUser, requireUser, readJsonPost, itemExists, ITEM_TYPES, reactionCounts, isAdmin, limitWrite,
} from '../../server/lib.js';
import { cleanComment, moderate, RATE_WINDOW, RATE_MAX } from '../../server/moderation.js';

function shape(r, react, viewer) {
  return {
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    hidden: r.status !== 'visible',
    user: { handle: r.handle, name: r.name, avatar: r.avatar_url },
    likes: react.likes, dislikes: react.dislikes, mine: react.mine,
    own: !!viewer && viewer.x_id === r.x_id,
  };
}

async function validItem(env, request, type, id) {
  if (!ITEM_TYPES.has(type) || !/^[0-9]{1,6}$/.test(id)) return false;
  return itemExists(env, request, type, id);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  const id = url.searchParams.get('id') || '';
  if (!(await validItem(env, request, type, id))) return json({ error: 'unknown_item' }, 404);

  const viewer = await getSessionUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.x_id, c.body, c.status, c.created_at, u.handle, u.name, u.avatar_url
       FROM comments c JOIN users u ON u.x_id = c.x_id
      WHERE c.item_type = ?1 AND c.item_id = ?2 AND (c.status = 'visible' OR c.x_id = ?3)
      ORDER BY c.created_at ASC, c.id ASC LIMIT 300`
  ).bind(type, id, viewer ? viewer.x_id : '').all();

  const [item, cr] = await Promise.all([
    reactionCounts(env, type, [id], viewer && viewer.x_id),
    reactionCounts(env, 'comment', results.map(r => String(r.id)), viewer && viewer.x_id),
  ]);
  return json({
    item: item[id],
    comments: results.map(r => shape(r, cr[String(r.id)], viewer)),
    signedIn: !!viewer,
    admin: !!viewer && isAdmin(env, viewer.x_id),
  });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const limited = await limitWrite(env, request, user, 'comment');
  if (limited) return limited;

  const type = String(body?.type || '');
  const id = String(body?.id ?? '');
  if (!(await validItem(env, request, type, id))) return json({ error: 'unknown_item' }, 404);
  const [text, err] = cleanComment(body?.body);
  if (err) return json({ error: err }, 400);

  const t = now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE x_id = ?1 AND created_at > ?2')
    .bind(user.x_id, t - RATE_WINDOW).first();
  if ((recent?.n || 0) >= RATE_MAX) return json({ error: 'rate_limited', retry_after: RATE_WINDOW }, 429);

  // AI moderation (threats, doxxing, minors, spam only). Fails open: on model error the comment posts with a soft flag.
  const m = await moderate(env, text, user);
  const hide = m.state === 'hidden';
  const row = await env.DB.prepare(
    `INSERT INTO comments (item_type, item_id, x_id, body, created_at, status, hidden_by, mod_state, mod_category, mod_reason)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     RETURNING id, x_id, body, status, created_at`
  ).bind(type, id, user.x_id, text, t, hide ? 'hidden' : 'visible', hide ? 'auto' : null, m.state, m.category, m.reason).first();
  return json({ ok: true, comment: shape({ ...row, handle: user.handle, name: user.name, avatar_url: user.avatar_url },
    { likes: 0, dislikes: 0, mine: 0 }, user) }, 201);
}
