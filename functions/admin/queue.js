// GET /admin/queue - approval queue for fetched posts. Admins (ADMIN_X_IDS) only;
// signed out -> sign-in page (401), signed in non-admin -> 404. Data via /api/admin/queue.
import { getSessionUser, isAdmin } from '../../server/lib.js';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const CSS = `*{box-sizing:border-box}body{margin:0;background:#09090b;color:#e4e4e7;font:15px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:#18181bf2;border-bottom:1px solid #3b0764;padding:.7rem 1rem;backdrop-filter:blur(8px)}
h1{font-size:1.1rem;margin:0 0 .45rem;color:#c084fc}a{color:#c084fc}.row{display:flex;gap:.4rem;overflow-x:auto}
button{font:inherit;border:1px solid #3f3f46;background:#27272a;color:#fff;border-radius:999px;padding:.5rem .9rem;cursor:pointer;flex:0 0 auto}
button.on{background:#7e22ce;border-color:#a855f7}.ok{border-color:#15803d;color:#86efac}.gold{border-color:#a16207;color:#fde68a}.danger{border-color:#9f1239;color:#fda4af}
main{padding:.8rem;max-width:720px;margin:0 auto}.card{background:#18181b;border:1px solid #27272a;border-radius:1rem;padding:.8rem;margin-bottom:.9rem}
.meta{font-size:.78rem;color:#a1a1aa;display:flex;flex-wrap:wrap;gap:.3rem .7rem;margin-bottom:.5rem}.stats{font-size:.78rem;color:#a1a1aa;margin-top:.4rem}
input.h{width:100%;font:inherit;font-weight:600;background:#09090b;color:#fff;border:1px solid #3f3f46;border-radius:.6rem;padding:.55rem .65rem;margin-bottom:.6rem}
.tw{display:flex;gap:.5rem;margin:.45rem 0}.tw img.av{width:30px;height:30px;border-radius:50%;flex:0 0 30px;background:#27272a}
.tw .b{background:#202024;border-radius:.8rem;padding:.45rem .65rem;min-width:0;flex:1}.tw.g .b{background:#2e1065}.tw .n{font-size:.78rem;color:#a1a1aa}
.tw .t{white-space:pre-wrap;word-break:break-word}.tw .m{max-width:100%;max-height:220px;border-radius:.6rem;margin-top:.35rem;display:block}
.tops{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0}.tops button{padding:.3rem .7rem;font-size:.82rem}.tops button.sug{border-style:dashed}
.acts{display:flex;flex-wrap:wrap;gap:.45rem}.empty{color:#a1a1aa;text-align:center;padding:2rem}
.toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);background:#18181b;border:1px solid #a855f7;padding:.6rem 1rem;border-radius:1rem;display:none;z-index:9}`;
const page = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Queue · Grok vs. Humans</title><style>${CSS}</style></head><body>${b}</body></html>`;

const APP = `<header><h1>Approval queue <a href="/" style="font-size:.8rem;margin-left:.5rem">site</a> <a href="/admin" style="font-size:.8rem;margin-left:.5rem">comments</a></h1>
<div class="row" id="tabs"></div><div class="stats" id="stats"></div></header><main id="list"><div class="empty">Loading…</div></main><div class="toast" id="toast"></div>
<script>
const TABS=[['pending','Pending'],['approved','Approved'],['skipped','Skipped'],['blocked','Never'],['hidden','Hidden']];
let status=location.hash.slice(1)||'pending',D=null;const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',2000);}
function tabs(){$('#tabs').innerHTML=TABS.map(([k,l])=>'<button data-tab="'+k+'" class="'+(k===status?'on':'')+'">'+l+(D&&D.counts[k]!=null?' ('+D.counts[k]+')':'')+'</button>').join('');}
function tw(w){const m=(w.media||[]).map(x=>x.video?'<video class="m" src="'+esc(x.video)+'" poster="'+esc(x.url)+'" controls preload="none" playsinline></video>':'<img class="m" src="'+esc(x.url)+'" loading="lazy" referrerpolicy="no-referrer">').join('');
 return '<div class="tw '+(w.is_grok?'g':'')+'"><img class="av" src="'+esc(w.author_avatar)+'" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.visibility=\\'hidden\\'"><div class="b"><div class="n">'+esc(w.author_name||'')+' @'+esc(w.author_handle)+'</div><div class="t">'+esc(w.text)+'</div>'+m+'</div></div>';}
function card(p){const on=new Set(p.topics.map(t=>t.topic)),sug=new Set(p.topics.filter(t=>t.suggested).map(t=>t.topic));
 const A=status==='pending'?'<button class="ok" data-a="approve">✓ Approve</button><button class="gold" data-a="feature">★ Approve + feature</button><button data-a="skip">Skip</button><button class="danger" data-a="never">⛔ Never from @'+esc(p.human_handle)+'</button>'
  :status==='approved'?'<button data-a="topics">Save headline/topics</button><button class="gold" data-a="'+(p.featured?'unfeature':'feature')+'">'+(p.featured?'Unfeature':'★ Feature')+'</button><button class="danger" data-a="hide">Hide</button>'
  :'<button data-a="restore">Back to pending</button>'+(status==='blocked'?'<button data-a="unblock">Unblock @'+esc(p.human_handle)+'</button>':'');
 return '<article class="card" data-id="'+p.id+'"><div class="meta"><span>#'+p.id+'</span><span>'+esc(p.source)+'</span><span>X engagement '+p.x_engagement+'</span><span>'+p.tweets.length+' posts</span>'+(p.low_priority?'<span style="color:#fda4af">⚠ explicit?</span>':'')+(p.featured?'<span>★ featured</span>':'')+(p.hidden_reason?'<span>hidden: '+esc(p.hidden_reason)+'</span>':'')+'<a href="https://x.com/i/status/'+p.grok_tweet_id+'" target="_blank" rel="noopener">open on X</a></div>'
 +'<input class="h" maxlength="120" value="'+esc(p.headline||'')+'" placeholder="Headline">'+p.tweets.map(tw).join('')
 +'<div class="tops">'+D.topics.map(t=>'<button data-t="'+esc(t)+'" class="'+(on.has(t)?'on ':'')+(sug.has(t)?'sug':'')+'">'+esc(t)+'</button>').join('')+'</div><div class="acts">'+A+'</div></article>';}
async function load(){tabs();const r=await fetch('/api/admin/queue?status='+status,{cache:'no-store'});D=await r.json().catch(()=>null);
 if(!r.ok){$('#list').innerHTML='<div class="empty">Error '+r.status+'</div>';return;}tabs();
 const s=D.spend;$('#stats').textContent='X spend (est.) today $'+(s.today||0).toFixed(2)+' / $'+s.caps.day+' · month $'+(s.month||0).toFixed(2)+' / $'+s.caps.month+(s.last_run?' · last fetch '+new Date(s.last_run*1000).toLocaleString():'')+' · blocked authors '+D.blocked.length;
 $('#list').innerHTML=D.posts.length?D.posts.map(card).join(''):'<div class="empty">Nothing here.</div>';}
document.addEventListener('click',async e=>{const tb=e.target.closest('[data-tab]');if(tb){status=tb.dataset.tab;location.hash=status;return load();}
 const t=e.target.closest('[data-t]');if(t){t.classList.toggle('on');return;}
 const b=e.target.closest('[data-a]');if(!b)return;const c=b.closest('.card'),a=b.dataset.a,p=D.posts.find(x=>String(x.id)===c.dataset.id);
 if(a==='never'&&!confirm('Never show posts from @'+p.human_handle+'? Their pending posts are removed from the queue.'))return;
 const body={id:Number(c.dataset.id),action:a,headline:c.querySelector('input.h').value,topics:[...c.querySelectorAll('[data-t].on')].map(x=>x.dataset.t),handle:p.human_handle};
 b.disabled=true;const r=await fetch('/api/admin/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));b.disabled=false;
 if(!r.ok)return toast('Failed: '+(d.error||r.status));toast(a+' ✓');if(['topics','unblock'].includes(a))return;c.remove();D.counts[status]--;tabs();});
load();
</script>`;

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return new Response(page('<main><div class="card" style="margin-top:3rem;text-align:center"><h1>Admins only</h1><p><a href="/auth/login?return=%2Fadmin%2Fqueue">Sign in with X</a></p></div></main>'), { status: 401, headers: HEADERS });
  if (!isAdmin(env, user.x_id)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  return new Response(page(APP), { headers: HEADERS });
}
