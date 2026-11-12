// Deferred admin quick-adds (suggestions.note = QA_NOTE).
// Bookmark imports stay queued until an admin approves them. Cap-deferred quick-adds
// (the admin already asked to add the link) still build on the maintenance cron.
// Previews use the public syndication endpoint (one call includes the parent post)
// and fall back to the same oEmbed endpoint the liveness check uses. Neither spends the X API.

import { TOPICS } from './v2.js';

export const QA_NOTE = 'admin quick-add (deferred)';
export const BOOKMARK_WAITING = 'waiting: bookmark import';
export const APPROVED_WAITING = 'waiting: approved';
export const BUILDING = 'building';
export const BUILDING_STALE_SEC = 900;
export const PREVIEW_TTL_SEC = 6 * 3600;
export const PREVIEW_GONE_TTL_SEC = 3600;
export const TITLE_MAX = 120;

// Oldest queued deferred row the cron may build. Excludes unreviewed bookmark imports
// and a build that is already in flight. ?1 = QA_NOTE, ?2 = now - BUILDING_STALE_SEC.
export const DEFERRED_READY_WHERE = `s.state = 'queued' AND s.note = ?1 AND COALESCE(s.result, '') <> '${BOOKMARK_WAITING}' AND NOT (COALESCE(s.result, '') = '${BUILDING}' AND COALESCE(s.updated_at, 0) > ?2)`;

const CAPS = new Set(['admin_cap', 'month_cap', 'day_cap']);

export function deferredBuildable(row, nowSec = Math.floor(Date.now() / 1000)) {
  if (!row || row.state !== 'queued' || row.note !== QA_NOTE) return false;
  const result = row.result || '';
  if (result === BOOKMARK_WAITING) return false;
  if (result === BUILDING && nowSec - Number(row.updated_at || 0) < BUILDING_STALE_SEC) return false;
  return true;
}

export function capReason(result) {
  const m = String(result || '').match(/^waiting: (admin_cap|month_cap|day_cap)\b/);
  return m ? m[1] : null;
}

// What the Fetching card should say, and which actions are safe.
export function deferredStatus(row) {
  const result = row?.result || '';
  if (result === BUILDING) return { kind: 'building', label: 'Building this thread now.' };
  if (result === BOOKMARK_WAITING) return { kind: 'bookmark', label: 'From your bookmarks. Nothing is fetched until you approve it.' };
  if (result === APPROVED_WAITING) return { kind: 'approved', label: 'Approved. The next run (8:30 AM or 6:30 PM CST) builds it if the admin allowance allows.' };
  const cap = capReason(result);
  if (cap === 'admin_cap') return { kind: 'capped', cap, label: 'Waiting on the admin allowance ($1 a day, unused amount rolls over until the 1st). The next run builds it when there is room.' };
  if (cap === 'month_cap') return { kind: 'capped', cap, label: 'Waiting on the $45 monthly cap. The next run builds it once that cap allows.' };
  if (cap === 'day_cap') return { kind: 'capped', cap, label: 'Waiting on today’s cap. The next run builds it once that cap allows.' };
  if (row?.state === 'failed') return { kind: 'failed', label: 'The last build failed' + (result ? ': ' + result : '') + '. Edit the link and try again, or approve it for the next run.' };
  if (row?.state === 'rejected') return { kind: 'rejected', label: 'Rejected. Approve puts it back for the next run.' };
  return { kind: 'queued', label: 'Queued. The next run builds it if the admin allowance allows.' };
}

export function deferredActions(row) {
  const kind = deferredStatus(row).kind;
  const busy = kind === 'building';
  return {
    preview: true,
    edit: !busy,
    build: !busy,
    // "Approve" marks an unreviewed (or failed / rejected) row for the cron. Rows already
    // waiting on a cap or already approved would only be a duplicate tap.
    approve: !busy && (kind === 'bookmark' || kind === 'failed' || kind === 'rejected'),
    reject: !busy && row?.state !== 'rejected',
  };
}

export function normalizeTitle(value) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return t || null;
}

export function normalizeTopics(value) {
  let arr = value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { arr = s.split(','); }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    const name = TOPICS.find(t => t.toLowerCase() === String(item || '').trim().toLowerCase());
    if (name && !out.includes(name)) out.push(name);
    if (out.length === 2) break;
  }
  return out;
}

export function suggestionPrefs(row) {
  return { title: normalizeTitle(row?.title), topics: normalizeTopics(row?.topics) };
}

// Which write the admin API should do. Deferred rows are not the user-suggestion queue.
export function deferredDecision(row, action) {
  const deferred = row?.note === QA_NOTE;
  const open = !!row && ['queued', 'failed', 'rejected'].includes(row.state);
  if (action === 'build') {
    if (!deferred || !open || deferredStatus(row).kind === 'building') return { error: 'bad_state' };
    return { op: 'build' };
  }
  if (action === 'edit') {
    if (!deferred || !open || deferredStatus(row).kind === 'building') return { error: 'bad_state' };
    return { op: 'edit' };
  }
  if (action === 'approve' || action === 'retry') {
    if (deferred && open && deferredStatus(row).kind !== 'building') return { op: 'mark' };
    if (!row || !['new', 'failed', 'rejected'].includes(row.state)) return { error: 'bad_state' };
    return { op: 'queue-user' };
  }
  if (action === 'reject') return { op: 'reject' };
  return { error: 'bad_action' };
}

export function capWaiting(reason) {
  return CAPS.has(reason) ? 'waiting: ' + reason : null;
}

// --- free preview -----------------------------------------------------------

export const synToken = id => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : _; })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : _; })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function syndicationText(t) {
  if (!t) return '';
  const note = t.note_tweet?.text;
  if (typeof note === 'string' && note.trim()) return note.slice(0, 4000);
  let s = String(t.text || '');
  const range = t.display_text_range;
  if (Array.isArray(range) && range[0] > 0) {
    const chars = [...s];
    const end = Number.isFinite(Number(range[1])) ? Number(range[1]) : chars.length;
    if (range[0] < chars.length) s = chars.slice(range[0], end).join('');
  }
  return s.slice(0, 4000);
}

export function tweetFromSyn(t) {
  if (!t || !t.id_str) return null;
  return {
    tweet_id: String(t.id_str),
    name: t.user?.name || '',
    handle: t.user?.screen_name || '',
    text: syndicationText(t),
  };
}

// Oldest-first chain using only posts already nested in this payload. nextId is a parent
// we know about but do not have text for yet.
export function chainFromTweet(tweet, limit = 3) {
  const posts = [];
  const seen = new Set();
  let node = tweet;
  while (node && posts.length < limit) {
    const view = tweetFromSyn(node);
    if (!view?.tweet_id || seen.has(view.tweet_id)) break;
    seen.add(view.tweet_id);
    posts.unshift(view);
    const parentId = node.in_reply_to_status_id_str || node.parent?.id_str || null;
    if (!parentId || seen.has(String(parentId))) return { posts, nextId: null };
    if (node.parent && String(node.parent.id_str) === String(parentId)) { node = node.parent; continue; }
    return { posts, nextId: String(parentId) };
  }
  return { posts, nextId: null };
}

export function oembedText(html) {
  const m = String(html || '').match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return '';
  return decodeEntities(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\u00a0/g, ' ').trim().slice(0, 4000);
}

export function previewFromOembed(body) {
  if (!body || typeof body !== 'object') return null;
  const handle = String(body.author_url || '').match(/\/([A-Za-z0-9_]{1,15})\/?$/)?.[1] || '';
  const text = oembedText(body.html);
  const name = String(body.author_name || '');
  if (!text && !name && !handle) return null;
  return {
    source: 'oembed', gone: false, more: false, context: false,
    posts: [{ tweet_id: '', name, handle, text }],
  };
}

const SYN_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; GrokVsHumans/2.0)', Accept: 'application/json' };

async function readJson(res) {
  const t = await res.text();
  if (!t || t === '{}') return { empty: true };
  try { return { json: JSON.parse(t) }; } catch { return { bad: true }; }
}

export async function fetchSyndication(tweetId, fetchImpl = fetch) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=${synToken(tweetId)}`;
  let res;
  try { res = await fetchImpl(url, { headers: SYN_HEADERS, redirect: 'manual' }); }
  catch { return { error: 'preview_unavailable' }; }
  if (res.status === 404) return { gone: true, reason: 'deleted' };
  if (!res.ok) return { error: res.status };
  const parsed = await readJson(res);
  if (parsed.empty) return { gone: true, reason: 'deleted' };
  if (parsed.bad || !parsed.json) return { error: 'bad_json' };
  const j = parsed.json;
  if (j.__typename && j.__typename !== 'Tweet') return { gone: true, reason: j.__typename === 'TweetTombstone' ? 'deleted' : 'unavailable' };
  if (!j.id_str) return { error: 'bad_json' };
  return { tweet: j };
}

async function fetchOembed(tweetId, fetchImpl) {
  const url = `https://publish.x.com/oembed?url=${encodeURIComponent('https://x.com/i/status/' + tweetId)}&omit_script=1`;
  let res;
  try { res = await fetchImpl(url, { redirect: 'manual' }); }
  catch { return { error: 'preview_unavailable' }; }
  if (res.status === 404) return { gone: true, reason: 'deleted' };
  if (res.status === 403) return { gone: true, reason: 'protected' };
  if (!res.ok) return { error: res.status };
  const parsed = await readJson(res);
  if (!parsed.json) return { error: 'bad_json' };
  const preview = previewFromOembed(parsed.json);
  return preview || { error: 'bad_json' };
}

function mergeChain(base, extra) {
  const map = new Map(base.map(p => [p.tweet_id, p]));
  const ids = [];
  for (const p of extra) if (p.tweet_id && !ids.includes(p.tweet_id)) ids.push(p.tweet_id);
  for (const p of base) if (p.tweet_id && !ids.includes(p.tweet_id)) ids.push(p.tweet_id);
  for (const p of extra) if (p.tweet_id) map.set(p.tweet_id, p);
  return ids.map(id => map.get(id)).filter(Boolean);
}

// At most two syndication calls: the bookmark, then one hop up when the nested parent
// does not already include the rest of the chain. oEmbed is only the fallback.
export async function loadPreview(tweetId, fetchImpl = fetch) {
  if (!/^\d{1,25}$/.test(String(tweetId || ''))) return { error: 'bad_id' };
  const first = await fetchSyndication(tweetId, fetchImpl);
  if (!first.tweet) {
    const oe = await fetchOembed(tweetId, fetchImpl);
    if (oe.posts) return oe;
    if (first.gone || oe.gone) return { source: oe.gone ? 'oembed' : 'syndication', gone: true, reason: oe.reason || first.reason || 'deleted', posts: [] };
    return { error: 'preview_unavailable', status: first.error || oe.error || null };
  }
  let walked = chainFromTweet(first.tweet, 3);
  let posts = walked.posts;
  let nextId = walked.nextId;
  let fetches = 0;
  // Nested parents omit their own parent. One extra call on the oldest post we have
  // picks up the post it replies to (the usual "thread start" for a short reply).
  if (!nextId && posts.length >= 1 && posts.length < 3 && posts[0].tweet_id !== String(tweetId)) {
    fetches += 1;
    const full = await fetchSyndication(posts[0].tweet_id, fetchImpl);
    if (full.tweet) {
      const again = chainFromTweet(full.tweet, 3);
      posts = mergeChain(posts, again.posts).slice(-3);
      nextId = again.nextId;
    }
  }
  while (nextId && posts.length < 3 && fetches < 1) {
    fetches += 1;
    const nxt = await fetchSyndication(nextId, fetchImpl);
    if (!nxt.tweet) break;
    const again = chainFromTweet(nxt.tweet, 3);
    posts = mergeChain(posts, again.posts).slice(-3);
    nextId = again.nextId && !posts.some(p => p.tweet_id === again.nextId) ? again.nextId : null;
  }
  return { source: 'syndication', gone: false, more: !!nextId, context: true, posts };
}

export async function cachedPreview(DB, tweetId, fetchImpl = fetch, { fresh = false, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const key = 'defer-preview:' + tweetId;
  if (!fresh) {
    const row = await DB.prepare('SELECT v FROM kv WHERE k = ?1').bind(key).first();
    if (row?.v) {
      try {
        const c = JSON.parse(row.v);
        const ttl = c.preview?.gone ? PREVIEW_GONE_TTL_SEC : PREVIEW_TTL_SEC;
        if (c.at && nowSec - c.at < ttl && c.preview && !c.preview.error) return { ...c.preview, cached: true };
      } catch { /* refill */ }
    }
  }
  const preview = await loadPreview(tweetId, fetchImpl);
  if (!preview.error) {
    await DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?1, ?2)').bind(key, JSON.stringify({ at: nowSec, preview })).run();
  }
  return preview;
}

// After a successful build: keep an admin title (one post only) and mark chosen topics
// as admin-set so a later rebuild does not replace them.
export async function applySuggestionPrefs(DB, postIds, row) {
  const ids = (postIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length || !DB) return { title: false, topics: false };
  const { title, topics } = suggestionPrefs(row);
  if (title && ids.length === 1) {
    await DB.prepare('UPDATE posts SET headline = ?2 WHERE id = ?1').bind(ids[0], title).run();
  }
  if (topics.length) {
    for (const id of ids) {
      const stmts = [DB.prepare('DELETE FROM post_topics WHERE post_id = ?1').bind(id)];
      for (const topic of topics) stmts.push(DB.prepare('INSERT OR IGNORE INTO post_topics (post_id, topic, suggested) VALUES (?1, ?2, 0)').bind(id, topic));
      await DB.batch(stmts);
    }
  }
  return { title: !!(title && ids.length === 1), topics: topics.length > 0, battles: ids.length };
}
