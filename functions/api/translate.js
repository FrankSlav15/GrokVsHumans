// POST /api/translate {kind: 'post_turn'|'comment', id, target}
//   post_turn id = "<post_id>:<pos>" of an approved post; comment id = a visible comment on an existing item.
// Cached in D1 `translations` per (kind, id, target, sha256(source text)); rate-limited per IP and per signed-in user.
import { json, now, readJsonPost, getSessionUser, rateLimit, clientIp, sha256hex, itemExists } from '../../server/lib.js';
import { normLang } from '../../server/lang.js';
import { TRANSLATE_MODEL, MAX_TRANSLATE, TRANSLATE_LIMIT, sourceLang, translateText, langName } from '../../server/translate.js';

async function loadText(env, request, kind, id) {
  if (kind === 'post_turn') {
    const m = /^([0-9]{1,9}):([0-9]{1,2})$/.exec(id); if (!m) return null;
    const r = await env.DB.prepare(`SELECT t.text FROM post_tweets t JOIN posts p ON p.id = t.post_id
      WHERE t.post_id = ?1 AND t.pos = ?2 AND p.status = 'approved'`).bind(Number(m[1]), Number(m[2])).first();
    return r ? r.text : null;
  }
  if (!/^[0-9]{1,12}$/.test(id)) return null;
  const c = await env.DB.prepare("SELECT body, item_type, item_id FROM comments WHERE id = ?1 AND status = 'visible'").bind(Number(id)).first();
  if (!c || !(await itemExists(env, request, c.item_type, c.item_id))) return null;
  return c.body;
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const kind = String(body?.kind || ''), id = String(body?.id ?? ''), target = normLang(body?.target);
  if (kind !== 'post_turn' && kind !== 'comment') return json({ error: 'bad_kind' }, 400);
  if (!target) return json({ error: 'bad_target' }, 400);

  const user = await getSessionUser(env, request);
  if (!(await rateLimit(env, `translate:ip:${clientIp(request)}`, TRANSLATE_LIMIT))
    || (user && !(await rateLimit(env, `translate:u:${user.x_id}`, TRANSLATE_LIMIT))))
    return json({ error: 'rate_limited', retry_after: TRANSLATE_LIMIT.win }, 429, { 'Retry-After': String(TRANSLATE_LIMIT.win) });

  const text = await loadText(env, request, kind, id);
  if (text == null) return json({ error: 'not_found' }, 404);
  if ([...text].length > MAX_TRANSLATE) return json({ error: 'too_long' }, 413);

  const hash = await sha256hex(text);
  const hit = await env.DB.prepare('SELECT source, text FROM translations WHERE kind = ?1 AND item_id = ?2 AND target = ?3 AND hash = ?4')
    .bind(kind, id, target, hash).first();
  if (hit) return json({ kind, id, target, source: hit.source, source_name: langName(hit.source), text: hit.text, cached: true });

  const source = await sourceLang(env, text);
  if (source === target) return json({ kind, id, target, source, source_name: langName(source), text, same: true });
  let out;
  try { out = await translateText(env, text, source || 'en', target); }
  catch (e) { console.log('translate failed', e?.message); return json({ error: 'translate_failed' }, 502); }
  await env.DB.prepare(`INSERT OR REPLACE INTO translations (kind, item_id, target, hash, source, text, model, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(kind, id, target, hash, source, out, TRANSLATE_MODEL, now()).run();
  return json({ kind, id, target, source, source_name: langName(source), text: out, cached: false });
}
