// Shared admin nav bar for /admin, /admin/queue, /admin/featured. Badges load from /api/admin/counts.
const LINKS = [
  ['site', '/', '← Site', null],
  ['queue', '/admin/queue', '📥 Queue', 'queue'],
  ['moderation', '/admin', '🛡️ Moderation', 'moderation'],
  ['featured', '/admin/featured', '⭐ Featured & Suggestions', 'featured'],
  ['payments', '/admin/featured#payments', '💵 Payments', null],
];
export const NAV_CSS = `.anav{display:flex;gap:.35rem;overflow-x:auto;scrollbar-width:none;margin:-.2rem -.25rem .55rem;padding:.2rem .25rem;-webkit-overflow-scrolling:touch}
.anav::-webkit-scrollbar{display:none}
.anav a{flex:0 0 auto;display:inline-flex;align-items:center;gap:.4rem;min-height:44px;padding:0 .85rem;border-radius:999px;border:1px solid #3f3f46;background:#141318;color:#d4d4d8;font:600 .86rem/1 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s}
.anav a:hover{background:#1f1d26;border-color:#6b21a8;color:#fff}
.anav a.on{background:linear-gradient(135deg,#7e22ce,#6d28d9);border-color:#c084fc;color:#fff;box-shadow:0 0 14px -3px rgba(168,85,247,.7)}
.anav a.site{color:#c4b5fd;border-style:dashed}
.anav b{min-width:1.35rem;height:1.35rem;padding:0 .35rem;border-radius:999px;background:#f43f5e;color:#fff;font-size:.72rem;display:inline-grid;place-items:center}
.anav b:empty{display:none}.anav a.on b{background:#fff;color:#6d28d9}
.anav a:focus-visible{outline:2px solid #c084fc;outline-offset:2px}
@media (max-width:899px){.anav{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);padding-right:1.5rem}}
@media (min-width:900px){.anav{flex-wrap:wrap;overflow:visible}}`;
export function navHtml(current) {
  return `<nav class="anav" aria-label="Admin">${LINKS.map(([k, href, label, badge]) =>
    `<a href="${href}" data-nav="${k}" class="${k === 'site' ? 'site' : ''}${k === current ? ' on' : ''}"${k === current ? ' aria-current="page"' : ''}>${label}${badge ? `<b data-badge="${badge}" aria-label="pending"></b>` : ''}</a>`).join('')}</nav>
<script>(()=>{const n=document.querySelector('.anav');
 // featured page: Payments vs Featured & Suggestions follows the hash
 const sync=()=>{if(location.pathname!=='/admin/featured')return;const pay=location.hash.startsWith('#payments');n.querySelector('[data-nav=payments]').classList.toggle('on',pay);n.querySelector('[data-nav=featured]').classList.toggle('on',!pay);};
 sync();addEventListener('hashchange',sync);const on=n.querySelector('a.on');if(on&&n.scrollWidth>n.clientWidth)n.scrollLeft=on.offsetLeft-12;
 fetch('/api/admin/counts',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(!d)return;for(const[k,v]of Object.entries(d)){const b=n.querySelector('[data-badge="'+k+'"]');if(b&&v>0){b.textContent=v>99?'99+':v;b.setAttribute('aria-label',v+' pending');}}}).catch(()=>{});})();</script>`;
}
