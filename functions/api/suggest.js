// GET  /api/suggest          -> config (tiers, Ko-fi) + the viewer's own suggestions / feature requests (in-app status)
// POST /api/suggest {url, note?, tier?}  -> new pending suggestion (signed-in); optional paid feature request
// POST /api/suggest {seen: true}         -> mark the viewer's status updates as seen
import { json, now, getSessionUser, requireUser, readJsonPost, limitWrite } from '../../server/lib.js';
import { parseStatusUrl, tiers, kofiUrl, kofiConfigured, featureCode, SUGGEST_PER_DAY, FEATURE_REQ_PER_DAY } from '../../server/config.js';

export async function onRequestGet({ request, env }) {
  const viewer = await getSessionUser(env, request);
  const out = { tiers: tiers(env), kofi_url: kofiUrl(env), kofi_ready: kofiConfigured(env), per_day: SUGGEST_PER_DAY, signedIn: !!viewer };
  if (viewer) {
    const [s, f] = await env.DB.batch([
      env.DB.prepare(`SELECT s.id, s.url, s.state, s.post_id, s.created_at, s.updated_at, s.seen_at, p.status AS post_status FROM suggestions s
                      LEFT JOIN posts p ON p.id = s.post_id WHERE s.x_id = ?1 ORDER BY s.id DESC LIMIT 20`).bind(viewer.x_id),
      env.DB.prepare(`SELECT id, code, post_id, suggestion_id, tier, amount_usd, days, state, refund_needed, ends_at, created_at, paid_at, updated_at, seen_at
                      FROM feature_requests WHERE x_id = ?1 ORDER BY id DESC LIMIT 20`).bind(viewer.x_id),
    ]);
    out.suggestions = s.results.map(r => ({ ...r, live: r.post_status === 'approved', unseen: !!r.updated_at && (r.seen_at || 0) < r.updated_at }));
    out.features = f.results.map(r => ({ ...r, unseen: !!r.updated_at && (r.seen_at || 0) < r.updated_at }));
  }
  return json(out, 200, { 'Cache-Control': 'no-store' });
}

export async function onRequestPost({ request, env }) {
  const [body, bad] = await readJsonPost(request);
  if (bad) return bad;
  const [user, denied] = await requireUser(env, request);
  if (denied) return denied;
  const t = now();
  if (body?.seen === true) {
    await env.DB.batch([
      env.DB.prepare('UPDATE suggestions SET seen_at = ?2 WHERE x_id = ?1').bind(user.x_id, t),
      env.DB.prepare('UPDATE feature_requests SET seen_at = ?2 WHERE x_id = ?1').bind(user.x_id, t),
    ]);
    return json({ ok: true });
  }
  const limited = await limitWrite(env, request, user, 'suggest');
  if (limited) return limited;

  const tweetId = parseStatusUrl(body?.url);
  if (!tweetId) return json({ error: 'bad_url' }, 400);
  const note = typeof body?.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 280) || null : null;
  const tier = body?.tier ? tiers(env).find(x => x.id === body.tier) : null;
  if (body?.tier && !tier) return json({ error: 'bad_tier' }, 400);

  const day = await env.DB.prepare('SELECT COUNT(*) n FROM suggestions WHERE x_id = ?1 AND created_at > ?2').bind(user.x_id, t - 86400).first();
  if ((day?.n || 0) >= SUGGEST_PER_DAY) return json({ error: 'daily_limit', limit: SUGGEST_PER_DAY }, 429);

  // dedupe: already on the site (any turn of any stored thread) or already suggested
  const onSite = await env.DB.prepare(`SELECT p.id, p.status FROM post_tweets t JOIN posts p ON p.id = t.post_id WHERE t.tweet_id = ?1
                                       UNION ALL SELECT id, status FROM posts WHERE grok_tweet_id = ?1 LIMIT 1`).bind(tweetId).first();
  if (onSite) return json({ error: 'already_on_site', post_id: onSite.status === 'approved' ? String(onSite.id) : null }, 409);
  const prev = await env.DB.prepare('SELECT id FROM suggestions WHERE tweet_id = ?1').bind(tweetId).first();
  if (prev) return json({ error: 'already_suggested' }, 409);

  const url = `https://x.com/i/status/${tweetId}`;
  const row = await env.DB.prepare(`INSERT INTO suggestions (x_id, tweet_id, url, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(user.x_id, tweetId, url, note, t).first();
  let feature = null;
  if (tier) {
    const fday = await env.DB.prepare('SELECT COUNT(*) n FROM feature_requests WHERE x_id = ?1 AND created_at > ?2').bind(user.x_id, t - 86400).first();
    if ((fday?.n || 0) < FEATURE_REQ_PER_DAY) feature = await createFeature(env, user, { suggestion_id: row.id, tier, pin_topics: body?.pin_topics !== false });
  }
  return json({ ok: true, id: row.id, feature }, 201);
}

export async function createFeature(env, user, { post_id = null, suggestion_id = null, project_id = null, tier, pin_topics = true }) {
  for (let i = 0; i < 4; i++) {
    const code = featureCode();
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO feature_requests (code, x_id, post_id, suggestion_id, tier, amount_usd, days, pin_topics, created_at, project_id)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id, code`).bind(code, user.x_id, post_id, suggestion_id, tier.id, tier.usd, tier.days, pin_topics ? 1 : 0, now(), project_id).first();
    if (r) return { id: r.id, code: r.code, tier: tier.id, label: tier.label, usd: tier.usd, kofi_url: kofiUrl(env), kofi_ready: kofiConfigured(env) };
  }
  throw new Error('code collision');
}
