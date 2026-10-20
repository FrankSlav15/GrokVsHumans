// Owner-editable settings for suggestions and paid featured spots.
// KOFI_URL and the tiers can also be overridden per environment with the Pages variables
// KOFI_URL and FEATURE_TIERS_JSON (e.g. [{"id":"day","label":"24 hours","usd":5,"days":1}]).
export const KOFI_URL_PLACEHOLDER = 'https://ko-fi.com/YOUR_KOFI_PAGE';
export const KOFI_URL_DEFAULT = 'https://ko-fi.com/grokvshumans';
export const FEATURE_TIERS = [
  { id: 'day', label: '24 hours', usd: 5, days: 1 },
  { id: 'week', label: '7 days', usd: 15, days: 7 },
  { id: 'month', label: '30 days', usd: 40, days: 30 },
];
export const SUGGEST_PER_DAY = 5;          // suggestions per user per 24 h
export const FEATURE_REQ_PER_DAY = 5;      // feature requests per user per 24 h
export const MAX_ACTIVE_FEATURED = 3;      // pinned at most at once (oldest approval first)

export const kofiUrl = env => (env.KOFI_URL && /^https:\/\/(www\.)?ko-fi\.com\/\w/.test(env.KOFI_URL)) ? env.KOFI_URL : KOFI_URL_DEFAULT;
export const kofiConfigured = env => kofiUrl(env) !== KOFI_URL_PLACEHOLDER;
export function tiers(env) {
  try { const t = JSON.parse(env.FEATURE_TIERS_JSON || 'null'); if (Array.isArray(t) && t.every(x => x.id && x.usd > 0 && x.days > 0)) return t; } catch {}
  return FEATURE_TIERS;
}
// x.com / twitter.com status link -> tweet id (or null)
export function parseStatusUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol)) return null;
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})(?:\/|$)/);
  return m ? m[1] : null;
}
// Short human-typable code, no look-alike characters.
export function featureCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(6));
  return 'GVH-' + [...b].map(x => A[x % A.length]).join('');
}
