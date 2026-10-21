// Projects (things people build with SI): validation, ranking and the public shape. Shared by /api/projects,
// /api/project-vote, /api/admin/projects and the account deletion.
export const PROJECT_LIMITS = { name: 80, description: 500, si_usage: 300, url: 500 };
export const PROJECTS_PER_DAY = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Donation links: https only, on these platforms (we never handle money for projects; we only link out).
export const DONATE_HOSTS = [
  [/^(www\.)?ko-fi\.com$/i, /^\/[\w.-]+\/?$/],
  [/^(www\.)?patreon\.com$/i, /^\/(c\/)?[\w.-]+\/?$/],
  [/^github\.com$/i, /^\/sponsors\/[\w-]+\/?$/],
  [/^(www\.)?buymeacoffee\.com$/i, /^\/[\w.-]+\/?$/],
  [/^(www\.)?opencollective\.com$/i, /^\/[\w.-]+\/?$/],
  [/^(www\.)?liberapay\.com$/i, /^\/[\w.-]+(\/donate)?\/?$/],
];
const clean = (s, max) => typeof s === 'string' ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim() : '';
export function httpUrl(raw, { httpsOnly = false } = {}) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!(u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:'))) return null;
  if (u.username || u.password || !u.hostname.includes('.') || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname)) return null;
  const s = u.toString(); return s.length <= PROJECT_LIMITS.url ? s : null;
}
export function donateUrl(raw) {
  const s = httpUrl(raw, { httpsOnly: true }); if (!s) return null;
  const u = new URL(s);
  return DONATE_HOSTS.some(([h, p]) => h.test(u.hostname) && p.test(u.pathname)) ? s : null;
}
// Returns [fields, error]. Lengths count characters (not bytes).
export function validateProject(b, { requireAll = true } = {}) {
  const f = { name: clean(b?.name), description: clean(b?.description), si_usage: clean(b?.si_usage) };
  for (const k of ['name', 'description', 'si_usage']) {
    if (!f[k] && requireAll) return [null, 'missing_' + k];
    if ([...f[k]].length > PROJECT_LIMITS[k]) return [null, 'too_long_' + k];
  }
  f.name = f.name.replace(/\s+/g, ' ');
  f.url = httpUrl(b?.url); if (!f.url) return [null, 'bad_url'];
  f.image_url = null;
  if (b?.image_url) { f.image_url = httpUrl(b.image_url, { httpsOnly: true }); if (!f.image_url) return [null, 'bad_image_url']; }
  f.donate_url = null;
  if (b?.donate_url) { f.donate_url = donateUrl(b.donate_url); if (!f.donate_url) return [null, 'bad_donate_url']; }
  return [f, null];
}
// Checks that an image URL really is a small image (type + size). No bytes are stored: R2 is not enabled on this
// account, so the card loads the image from its own host (no-referrer). Returns null or an error code.
export async function checkImage(url, fetchImpl = fetch) {
  let r;
  try { r = await fetchImpl(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-1023', Accept: IMAGE_TYPES.join(',') }, signal: AbortSignal.timeout(6000) }); }
  catch { return 'image_unreachable'; }
  if (!r.ok && r.status !== 206) return 'image_unreachable';
  const type = (r.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) return 'image_type';
  const total = Number((r.headers.get('Content-Range') || '').split('/')[1]) || Number(r.headers.get('Content-Length')) || 0;
  if (r.status === 200 && total > MAX_IMAGE_BYTES) return 'image_too_big';
  if (r.status === 206 && total > MAX_IMAGE_BYTES) return 'image_too_big';
  try { await r.body?.cancel(); } catch {}
  return null;
}
export const projEngagement = p => p.up + p.down + 3 * p.comments;
export const projScore = p => p.up - p.down;
export const projHot = (p, t) => (p.up - p.down + 2 * p.comments + 1) / Math.pow((t - p.approved_at) / 3600 + 2, 1.5);
export const projShape = (r, mine) => ({
  id: String(r.id), kind: 'project', name: r.name, url: r.url, description: r.description, si_usage: r.si_usage,
  image_url: r.image_url || null, donate_url: r.donate_url || null, handle: r.handle || null,
  created_at: r.approved_at || r.created_at, approved_at: r.approved_at, up: r.up || 0, down: r.down || 0, comments: r.n || 0,
  mine: { vote: mine ?? 0 }, promoted: null,
});
