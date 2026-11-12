// GET /admin/featured - user suggestions, paid featured requests and the payments ledger. Admins only.
import { getSessionUser, isAdmin } from '../../server/lib.js';
import { NAV_CSS, navHtml } from '../../server/adminnav.js';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const CSS = `*{box-sizing:border-box}body{margin:0;background:#09090b;color:#e4e4e7;font:15px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:#18181bf2;border-bottom:1px solid #3b0764;padding:.7rem 1rem;backdrop-filter:blur(8px)}
h1{font-size:1.1rem;margin:0 0 .45rem;color:#c084fc}a{color:#c084fc}.row{display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.2rem}
button,.btn{font:inherit;border:1px solid #3f3f46;background:#27272a;color:#fff;border-radius:999px;padding:.5rem .9rem;cursor:pointer;flex:0 0 auto;min-height:44px;text-decoration:none;display:inline-flex;align-items:center}
button.on{background:#7e22ce;border-color:#a855f7}.ok{border-color:#15803d;color:#86efac}.gold{border-color:#a16207;color:#fde68a}.danger{border-color:#9f1239;color:#fda4af}
main{padding:.8rem;max-width:720px;margin:0 auto}.card{background:#18181b;border:1px solid #27272a;border-radius:1rem;padding:.8rem;margin-bottom:.8rem}
.meta{font-size:.8rem;color:#a1a1aa;display:flex;flex-wrap:wrap;gap:.3rem .7rem;margin-bottom:.4rem}.stats{font-size:.78rem;color:#a1a1aa;margin-top:.3rem}
.pill{font-size:.72rem;font-weight:700;padding:.12rem .55rem;border-radius:999px;background:#3f3f46;color:#fff}
.s-pending_payment{background:#3f3f46}.s-paid{background:#1d4ed8}.s-awaiting_approval{background:#a16207}.s-active{background:#15803d}.s-expired{background:#52525b}.s-refund_needed{background:#9f1239}.s-refunded,.s-cancelled,.s-rejected{background:#27272a;color:#a1a1aa}
.note{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:.3rem 0 .5rem}.acts{display:flex;flex-wrap:wrap;gap:.45rem}.empty{color:#a1a1aa;text-align:center;padding:2rem}
.card .acts button{flex:1 1 calc(50% - .45rem);justify-content:center;text-align:center}
.card .acts button.full{flex-basis:100%}
.df-edit{margin:.2rem 0 .6rem}.df-edit label{display:block;font-size:.78rem;color:#a1a1aa;margin:.45rem 0 .2rem}
.df-edit input,.df-edit textarea{width:100%;font:inherit;font-size:16px;background:#09090b;color:#fff;border:1px solid #3f3f46;border-radius:.7rem;padding:.55rem .65rem}
.df-edit textarea{resize:vertical;min-height:2.6rem}
.tops{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0 .2rem}.tops button{padding:.35rem .7rem;font-size:.82rem;min-height:40px}.tops button.on{background:#7e22ce;border-color:#a855f7}
.pvw{background:#09090b;border:1px solid #27272a;border-radius:.8rem;padding:.55rem .65rem;margin:.35rem 0 .5rem}
.pvw .who{font-size:.86rem;color:#e4e4e7}.pvw .who b{color:#fff}
.pvw .tx{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:.15rem 0 .35rem;max-height:8.5rem;overflow:auto}
.pvw .ctx{border-left:3px solid #3f3f46;padding-left:.55rem;margin:.25rem 0 .45rem}
.pvw .me{margin-top:.15rem}
table{width:100%;border-collapse:collapse;font-size:.8rem}td,th{border-bottom:1px solid #27272a;padding:.4rem .3rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.toast{position:fixed;left:50%;bottom:max(1rem,env(safe-area-inset-bottom));transform:translateX(-50%);background:#18181b;border:1px solid #a855f7;padding:.6rem 1rem;border-radius:1rem;display:none;z-index:9;max-width:min(92vw,28rem);text-align:center}`;
const page = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Suggestions & featured · Grok vs. Humans</title><style>${CSS}${NAV_CSS}</style></head><body>${b}</body></html>`;

const APP = `<header>${navHtml('featured')}<h1>Suggestions &amp; featured</h1>
<div class="row" id="tabs"></div><div class="row" id="sub"></div><div class="stats" id="stats"></div></header><main id="list"><div class="empty">Loading…</div></main><div class="toast" id="toast"></div>
<script type="module" src="/assets/admin/featured-app.js"></script>`;

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return new Response(page('<main><div class="card" style="margin-top:3rem;text-align:center"><h1>Admins only</h1><p><a href="/auth/login?return=%2Fadmin%2Ffeatured">Sign in with X</a></p></div></main>'), { status: 401, headers: HEADERS });
  if (!isAdmin(env, user.x_id)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  return new Response(page(APP), { headers: HEADERS });
}
