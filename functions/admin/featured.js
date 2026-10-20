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
.note{white-space:pre-wrap;word-break:break-word;margin:.3rem 0 .5rem}.acts{display:flex;flex-wrap:wrap;gap:.45rem}.empty{color:#a1a1aa;text-align:center;padding:2rem}
table{width:100%;border-collapse:collapse;font-size:.8rem}td,th{border-bottom:1px solid #27272a;padding:.4rem .3rem;text-align:left;vertical-align:top}
.toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);background:#18181b;border:1px solid #a855f7;padding:.6rem 1rem;border-radius:1rem;display:none;z-index:9}`;
const page = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Suggestions & featured · Grok vs. Humans</title><style>${CSS}${NAV_CSS}</style></head><body>${b}</body></html>`;

const APP = `<header>${navHtml('featured')}<h1>Suggestions &amp; featured</h1>
<div class="row" id="tabs"></div><div class="row" id="sub"></div><div class="stats" id="stats"></div></header><main id="list"><div class="empty">Loading…</div></main><div class="toast" id="toast"></div>
<script>
const TABS=[['suggestions','💡 Suggestions'],['features','⭐ Featured'],['payments','💵 Payments']];
const SSUB=[['new','New'],['queued','Fetching'],['fetched','Fetched'],['duplicate','Duplicate'],['failed','Failed'],['rejected','Rejected']];
const FSUB=[['all','All'],['pending_payment','Pending payment'],['paid','Paid'],['awaiting_approval','Awaiting approval'],['active','Active'],['expired','Expired'],['refund_needed','Refund needed']];
const LBL=Object.fromEntries(FSUB.concat([['refunded','Refunded'],['cancelled','Cancelled'],['rejected','Rejected']]));
let [tab,sub]=(location.hash.slice(1)||'suggestions').split(':');const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=s=>s?new Date(s*1000).toLocaleString():'';
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',2200);}
function bar(){$('#tabs').innerHTML=TABS.map(([k,l])=>'<button data-tab="'+k+'" class="'+(k===tab?'on':'')+'">'+l+'</button>').join('');}
function subs(list,counts){if(!sub)sub=list[0][0];$('#sub').innerHTML=list.map(([k,l])=>'<button data-sub="'+k+'" class="'+(k===sub?'on':'')+'">'+l+(counts&&counts[k]!=null?' ('+counts[k]+')':'')+'</button>').join('');}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok){toast('Failed: '+(d.error||r.status));return false;}toast(body.action+' ✓');load();return true;}
async function load(){bar();const L=$('#list');L.innerHTML='<div class="empty">Loading…</div>';
 if(tab==='suggestions'){const r=await fetch('/api/admin/suggestions?state='+(sub||'new'),{cache:'no-store'});const d=await r.json();subs(SSUB,d.counts);
  $('#stats').textContent='Approve queues the link for the fetch worker (every 10 min, within the X spend caps). The thread then appears in the approval queue as "suggested by @user".';
  L.innerHTML=d.suggestions.length?d.suggestions.map(s=>'<div class="card" data-id="'+s.id+'"><div class="meta"><span>#'+s.id+'</span><span>@'+esc(s.handle)+(s.banned?' (banned)':'')+'</span><span>'+when(s.created_at)+'</span><a href="'+esc(s.url)+'" target="_blank" rel="noopener">open on X</a>'+(s.post_id?'<a href="/admin/queue#'+(s.post_status==='approved'?'approved':'pending')+'">post #'+s.post_id+' ('+esc(s.post_status)+')</a>':'')+'</div>'
   +(s.note?'<div class="note">“'+esc(s.note)+'”</div>':'')+(s.feature?'<div class="meta">⭐ feature request '+esc(s.feature)+'</div>':'')+(s.result?'<div class="meta">result: '+esc(s.result)+'</div>':'')
   +'<div class="acts">'+(['new','failed','rejected'].includes(s.state)?'<button class="ok" data-s="approve">✓ Approve &amp; fetch</button>':'')+(s.state!=='rejected'&&s.state!=='fetched'?'<button class="danger" data-s="reject">Reject</button>':'')+'</div></div>').join(''):'<div class="empty">Nothing here.</div>';
 } else if(tab==='features'){const r=await fetch('/api/admin/features?status='+(sub||'all'),{cache:'no-store'});const d=await r.json();subs(FSUB,Object.assign({all:Object.values(d.counts).reduce((a,b)=>a+b,0)},d.counts));
  $('#stats').textContent='Paid placements need your approval. Rejecting a paid request marks it "refund needed": refund in Ko-fi/PayPal, then tap "Refunded".';
  L.innerHTML=d.features.length?d.features.map(f=>'<div class="card" data-id="'+f.id+'"><div class="meta"><span class="pill s-'+f.status+'">'+esc(LBL[f.status]||f.status)+'</span><b style="color:#fff">'+esc(f.code)+'</b><span>@'+esc(f.handle)+'</span><span>'+esc(f.tier)+' · $'+f.amount_usd+' · paid $'+(f.paid_usd||0)+'</span>'+(f.pin_topics?'<span>+ topics</span>':'')+'</div>'
   +'<div class="note">'+(f.post_id?'<a href="/#p'+f.post_id+'" target="_blank">#'+f.post_id+'</a> '+esc(f.headline||'')+' ('+esc(f.post_status)+')':'Suggestion: <a href="'+esc(f.suggestion_url||'#')+'" target="_blank" rel="noopener">'+esc(f.suggestion_url||'?')+'</a> ('+esc(f.suggestion_state||'')+')')+'</div>'
   +'<div class="meta"><span>requested '+when(f.created_at)+'</span>'+(f.paid_at?'<span>paid '+when(f.paid_at)+'</span>':'')+(f.ends_at?'<span>'+(f.status==='active'?'until ':'ended ')+when(f.ends_at)+'</span>':'')+(f.admin_note?'<span style="color:#fcd34d">'+esc(f.admin_note)+'</span>':'')+'</div>'
   +'<div class="acts">'+(f.status==='awaiting_approval'?'<button class="ok" data-f="approve">✓ Approve feature</button>':'')+(['pending_payment','paid','awaiting_approval','active'].includes(f.status)?'<button class="danger" data-f="reject">Reject</button>':'')+(f.status==='active'?'<button data-f="expire">End now</button>':'')+(f.status==='refund_needed'?'<button class="gold" data-f="refunded">Refunded</button>':'')+'</div></div>').join(''):'<div class="empty">Nothing here.</div>';
 } else {$('#sub').innerHTML='<a class="btn gold" href="/api/admin/payments?format=csv">⬇ Export CSV</a>';const r=await fetch('/api/admin/payments',{cache:'no-store'});const d=await r.json();
  const tot=d.payments.reduce((a,p)=>(a[p.currency]=(a[p.currency]||0)+p.amount,a),{});$('#stats').textContent=d.payments.length+' payments · '+Object.entries(tot).map(([c,v])=>v.toFixed(2)+' '+c).join(' · ');
  L.innerHTML=d.payments.length?'<div class="card"><table><tr><th>Date</th><th>Amount</th><th>Type</th><th>Post / code</th><th>From</th></tr>'+d.payments.slice().reverse().map(p=>'<tr><td>'+when(p.received_at)+'</td><td>'+p.amount.toFixed(2)+' '+esc(p.currency)+'</td><td>'+esc(p.kind)+'</td><td>'+(p.post_id?'#'+p.post_id+' ':'')+esc(p.code||'')+'</td><td>'+esc(p.from_name||'')+'<br><small style="color:#71717a">'+esc(p.kofi_txn_id)+'</small></td></tr>').join('')+'</table></div>':'<div class="empty">No payments yet.</div>';}
}
document.addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(t){tab=t.dataset.tab;sub=null;location.hash=tab;return load();}
 const s=e.target.closest('[data-sub]');if(s){sub=s.dataset.sub;location.hash=tab+':'+sub;return load();}
 const a=e.target.closest('[data-s],[data-f]');if(!a)return;const id=Number(a.closest('.card').dataset.id);
 if(a.dataset.s){if(a.dataset.s==='reject'&&!confirm('Reject this suggestion?'))return;return post('/api/admin/suggestions',{id,action:a.dataset.s});}
 const act=a.dataset.f;if(act==='reject'&&!confirm('Reject this featured request? If it was paid it will be marked "refund needed".'))return;
 post('/api/admin/features',{id,action:act,note:act==='reject'?prompt('Reason (optional, shown only here)')||undefined:undefined});});
addEventListener('hashchange',()=>{const [t,u]=(location.hash.slice(1)||'suggestions').split(':');if(t!==tab||u!==sub){tab=t;sub=u;load();}});
load();
</script>`;

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return new Response(page('<main><div class="card" style="margin-top:3rem;text-align:center"><h1>Admins only</h1><p><a href="/auth/login?return=%2Fadmin%2Ffeatured">Sign in with X</a></p></div></main>'), { status: 401, headers: HEADERS });
  if (!isAdmin(env, user.x_id)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  return new Response(page(APP), { headers: HEADERS });
}
