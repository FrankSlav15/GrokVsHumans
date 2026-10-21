// GET /admin/queue - approval queue for fetched posts. Admins (ADMIN_X_IDS) only;
// signed out -> sign-in page (401), signed in non-admin -> 404. Data via /api/admin/queue.
import { getSessionUser, isAdmin } from '../../server/lib.js';
import { NAV_CSS, navHtml } from '../../server/adminnav.js';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const CSS = `.qa{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0}.qa input{flex:1 1 220px;min-width:0;font-size:16px;padding:.6rem .7rem;border-radius:10px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7}.qa button{min-height:44px;padding:0 1.1rem;font-size:16px}.qa-msg{flex-basis:100%;font-size:.85rem;color:#a1a1aa;overflow-wrap:anywhere}.qa-msg.ok{color:#86efac}.qa-msg.err{color:#fda4af}*{box-sizing:border-box}body{margin:0;background:#09090b;color:#e4e4e7;font:15px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:#18181bf2;border-bottom:1px solid #3b0764;padding:.7rem 1rem;backdrop-filter:blur(8px)}
h1{font-size:1.1rem;margin:0 0 .45rem;color:#c084fc}a{color:#c084fc}.row{display:flex;gap:.4rem;overflow-x:auto}
button{font:inherit;border:1px solid #3f3f46;background:#27272a;color:#fff;border-radius:999px;padding:.5rem .9rem;cursor:pointer;flex:0 0 auto}
button.on{background:#7e22ce;border-color:#a855f7}.ok{border-color:#15803d;color:#86efac}.gold{border-color:#a16207;color:#fde68a}.danger{border-color:#9f1239;color:#fda4af}
main{padding:.8rem;max-width:720px;margin:0 auto}.card{background:#18181b;border:1px solid #27272a;border-radius:1rem;padding:.8rem;margin-bottom:.9rem}
.meta{font-size:.78rem;color:#a1a1aa;display:flex;flex-wrap:wrap;gap:.3rem .7rem;margin-bottom:.5rem}.stats{font-size:.78rem;color:#a1a1aa;margin-top:.4rem}
.meta .mid{color:#fcd34d;border:1px solid #a16207;border-radius:999px;padding:0 .45rem}.meta .rb{color:#86efac;border:1px solid #15803d;border-radius:999px;padding:0 .45rem}button.sm{font-size:.8rem;min-height:36px;padding:.3rem .7rem}
input.h,textarea.h{width:100%;font:inherit;font-weight:600;background:#09090b;color:#fff;border:1px solid #3f3f46;border-radius:.6rem;padding:.55rem .65rem;margin-bottom:.6rem}
.tw{display:flex;gap:.5rem;margin:.45rem 0}.tw img.av{width:30px;height:30px;border-radius:50%;flex:0 0 30px;background:#27272a}
.tw .b{background:#202024;border-radius:.8rem;padding:.45rem .65rem;min-width:0;flex:1}.tw.g .b{background:#2e1065}.tw .n{font-size:.78rem;color:#a1a1aa}
.tw .t{white-space:pre-wrap;word-break:break-word}.tw .m{max-width:100%;max-height:220px;border-radius:.6rem;margin-top:.35rem;display:block}
.tops{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0}.tops button{padding:.3rem .7rem;font-size:.82rem}.tops button.sug{border-style:dashed}
.acts{display:flex;flex-wrap:wrap;gap:.45rem}.empty{color:#a1a1aa;text-align:center;padding:2rem}
.toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);background:#18181b;border:1px solid #a855f7;padding:.6rem 1rem;border-radius:1rem;display:none;z-index:60}
.bv h2{font-size:1rem;margin:1.1rem 0 .4rem;display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .7rem}.bv h2 small{color:#a1a1aa;font-weight:400;font-size:.78rem}
.bh{position:sticky;top:0}.bacts{display:flex;flex-wrap:wrap;gap:.4rem;margin:.3rem 0 .6rem}
.bc{display:flex;gap:.6rem;align-items:flex-start;background:#18181b;border:1px solid #27272a;border-radius:.8rem;padding:.55rem .65rem;margin-bottom:.45rem}
.bc input[type=checkbox]{width:22px;height:22px;flex:0 0 22px;margin-top:.1rem;accent-color:#a855f7}.bc .bd{min-width:0;flex:1}
.bc .tt{font-weight:600;font-size:.92rem;line-height:1.3;word-break:break-word}.bc .rs{font-size:.82rem;color:#d4d4d8;margin:.2rem 0}
.bc .sg{font-size:.76rem;color:#fde68a}.chips{display:flex;flex-wrap:wrap;gap:.25rem .35rem;font-size:.72rem;margin-top:.25rem}
.chips span{border:1px solid #3f3f46;border-radius:999px;padding:0 .45rem;color:#a1a1aa}.chips .sc{color:#fff;border-color:#7e22ce;background:#3b0764}
.chips .mid{color:#fcd34d;border-color:#a16207}.chips .rb{color:#86efac;border-color:#15803d}
".bc.fail{border-color:#9f1239}.bc .fe{color:#fda4af;font-size:.78rem;margin-top:.2rem}.failbox{background:#2a0a12;border:1px solid #9f1239;color:#fecdd3;border-radius:.8rem;padding:.55rem .7rem;margin:.6rem 0;font-size:.85rem}
.bc .ck{display:flex;align-items:flex-start;padding:.1rem;margin:-.1rem}.bc .bd{cursor:pointer}.bc .pvb{flex:0 0 auto;align-self:center}.bc.flash{border-color:#a855f7;box-shadow:0 0 0 2px #a855f766}.bc.done{opacity:.5}.chips .gone{color:#fff;border-color:#52525b;background:#3f3f46}
#pv{position:fixed;z-index:50;background:#000c;display:flex;align-items:center;justify-content:center;top:0;left:0;width:100vw;height:100vh;height:100svh;height:100dvh;top:var(--vvt,0);left:var(--vvl,0);width:var(--vvw,100vw);height:var(--vvh,100dvh);overscroll-behavior:contain;
 padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))}
#pv[hidden],#pv [hidden]{display:none!important}#pv textarea.h{display:block;resize:none;line-height:1.35;font-size:16px}
.pv__box{background:#111113;border:1px solid #3b0764;border-radius:1rem;width:100%;max-width:1200px;height:100%;max-height:100%;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.pv__bar{flex:none;display:flex;align-items:center;gap:.45rem;padding:.45rem .6rem;border-bottom:1px solid #27272a;background:#18181b}.pv__bar button{min-height:40px}.pv__pos{font-size:.85rem;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.pv__sp{flex:1}
.pv__tabs{display:none}
.pv__body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.pv__ed,.pv__prev{min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:.7rem}.pv__ed{border-right:1px solid #27272a}.pv__prev{background:#09090b}
.pv__lbl{font-size:.75rem;color:#a1a1aa;text-transform:uppercase;letter-spacing:.04em;margin:.5rem 0 .3rem;display:flex;justify-content:space-between;align-items:center;gap:.5rem}
.pv__two{text-transform:none;letter-spacing:0;font-size:.8rem;color:#d4d4d8;display:flex;align-items:center;gap:.3rem;min-height:36px}.pv__two input{width:18px;height:18px;accent-color:#a855f7}
.pv__warn{color:#fcd34d;font-size:.8rem;margin:-.35rem 0 .5rem}.pv__sug{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;font-size:.84rem;color:#fde68a;margin-bottom:.4rem}.pv__sug span{flex:1 1 180px}
.pv__tags button{min-height:38px}.pv__tags button.on{background:#7e22ce;border-color:#c084fc}.pv__k{display:inline-block;font-size:.65rem;color:#a1a1aa;margin-right:.3rem}.pv__tags button.on .pv__k{color:#e9d5ff}
.pv__meta{display:flex;flex-wrap:wrap;gap:.3rem;font-size:.78rem;color:#d4d4d8}.pv__meta span{border:1px solid #3f3f46;border-radius:.6rem;padding:.1rem .45rem}.pv__meta .sc{border-color:#7e22ce;background:#3b0764;color:#fff}.pv__meta .mid{color:#fcd34d;border-color:#a16207}.pv__meta .rb{color:#86efac;border-color:#15803d}
.pv__acts{flex:none;display:flex;gap:.45rem;padding:.5rem .6rem;border-top:1px solid #27272a;background:#18181b}.pv__acts button{min-height:44px;flex:0 1 auto}.pv__acts button:disabled,.pv__bar button:disabled{opacity:.45}
.pv__keys{font-size:.72rem;color:#71717a;margin-top:.8rem}@media (hover:none){.pv__keys,.pv__k{display:none}}
@media (max-width:899px){#pv{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}.pv__box{max-width:none;border-radius:0;border:0}
 .pv__tabs{flex:none;display:flex;border-bottom:1px solid #27272a;background:#18181b}.pv__tabs button{flex:1;border:0;border-radius:0;background:none;border-bottom:3px solid transparent;color:#a1a1aa;min-height:40px;padding:.35rem}.pv__tabs button[aria-selected=true]{color:#fff;border-bottom-color:#a855f7}
 .pv__body{display:block;position:relative}.pv__ed,.pv__prev{position:absolute;inset:0;border:0}#pv[data-tab=ed] .pv__prev,#pv[data-tab=prev] .pv__ed{display:none}
 .pv__acts button{flex:1 1 0;padding:.5rem .3rem;min-width:0}}
@media (max-height:520px){.pv__bar button,.pv__acts button{min-height:36px}.pv__acts,.pv__bar{padding-top:.3rem;padding-bottom:.3rem}}
dialog{background:#18181b;color:#e4e4e7;border:1px solid #a855f7;border-radius:1rem;max-width:min(92vw,420px)}dialog::backdrop{background:#000a}`;
const page = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Queue · Grok vs. Humans</title><style>${CSS}${NAV_CSS}</style></head><body>${b}</body></html>`;

const APP = `<header>${navHtml('queue')}<h1>Approval queue</h1>
<div id="qa" class="qa"><input type="url" inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Add a thread: paste an x.com status link" aria-label="X status link"><button class="ok" type="button">Add</button><div class="qa-msg" aria-live="polite"></div></div>
<div class="row" id="tabs"></div><div class="stats" id="stats"></div></header><main id="list"><div class="empty">Loading…</div></main><div class="toast" id="toast"></div>
<script>
const TABS=[['batches','Batches'],['pending','Pending'],['approved','Approved'],['skipped','Skipped'],['blocked','Never'],['hidden','Hidden'],['projects','🛠️ Projects']];
let status=location.hash.slice(1)||'batches',D=null;const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.toast=toast;function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',2000);}
function tabs(){$('#tabs').innerHTML=TABS.map(([k,l])=>'<button data-tab="'+k+'" class="'+(k===status?'on':'')+'">'+l+(D&&D.counts[k]!=null?' ('+D.counts[k]+')':'')+'</button>').join('');}
function tw(w){const m=(w.media||[]).map(x=>x.type==='quote'?'<div class="q" style="border:1px solid #3f3f46;border-radius:10px;padding:.4rem .6rem;margin-top:.3rem;font-size:.85rem"><b>'+esc(x.name||'Quoted post')+'</b> @'+esc(x.handle||'')+'<br>'+esc(x.text||'(open on X)')+'</div>':x.video?'<video class="m" src="'+esc(x.video)+'" poster="'+esc(x.url)+'" controls preload="none" playsinline></video>':'<img class="m" src="'+esc(x.url)+'" loading="lazy" referrerpolicy="no-referrer">').join('');
 return '<div class="tw '+(w.is_grok?'g':'')+'"><img class="av" src="'+esc(w.author_avatar)+'" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.visibility=\\'hidden\\'"><div class="b"><div class="n">'+esc(w.author_name||'')+' @'+esc(w.author_handle)+'</div><div class="t">'+(String(w.text||'').trim()?esc(w.text):(w.media||[]).length?'':'<em style="color:#a1a1aa">(no text, view on X)</em>')+'</div>'+m+'</div></div>';}
function card(p){const on=new Set(p.topics.map(t=>t.topic)),sug=new Set(p.topics.filter(t=>t.suggested).map(t=>t.topic));
 const A=status==='pending'?'<button class="ok" data-a="approve">✓ Approve</button><button class="gold" data-a="feature">★ Approve + feature</button><button data-a="headline">Save title</button><button data-a="skip">Skip</button><button class="sm" data-a="rebuild" title="Re-fetch from the root post (paid X API, within the daily cap)">↻ Rebuild thread</button><button class="danger" data-a="never">⛔ Never from @'+esc(p.human_handle)+'</button>'
  :status==='approved'?'<button data-a="topics">Save headline/topics</button><button class="gold" data-a="'+(p.featured?'unfeature':'feature')+'">'+(p.featured?'Unfeature':'★ Feature')+'</button><button class="danger" data-a="hide">Hide</button>'
  :'<button data-a="restore">Back to pending</button>'+(status==='blocked'?'<button data-a="unblock">Unblock @'+esc(p.human_handle)+'</button>':'');
 return '<article class="card" data-id="'+esc(p.id)+'"><div class="meta"><span>#'+esc(p.id)+'</span><span>'+esc(p.source)+'</span><span>X engagement '+esc(p.x_engagement)+'</span><span>'+esc(p.tweets.length)+' posts</span>'+(p.rebuild_state==='queued'?'<span class="rb">'+(p.rebuild_publish?'Approved'+(p.rebuild_feature?' + featured':'')+' · rebuilding full thread…':'↻ rebuild queued…')+(p.rebuild_note?' ('+esc(p.rebuild_note)+')':'')+'</span>':'')+(p.rebuild_state==='failed'?'<span class="mid">⚠ rebuild failed'+(p.rebuild_note?': '+esc(p.rebuild_note):'')+'</span>':'')+(p.mid_thread&&p.rebuild_state!=='queued'?'<span class="mid" title="The first stored post is not the root of the conversation">⤴ starts mid-thread</span>':'')+(p.low_priority?'<span style="color:#fda4af">⚠ explicit?</span>':'')+(p.added_by_admin?'<span style="color:#93c5fd">➕ added by admin</span>':'')+(p.title_mismatch?'<span class="mid">⚠ title @ is not main human @'+esc(p.human_handle)+'</span>':'')+(p.featured?'<span>★ featured</span>':'')+(p.suggested_by_handle?'<span style="color:#fde68a">💡 suggested by @'+esc(p.suggested_by_handle)+'</span>':'')+(p.hidden_reason?'<span>hidden: '+esc(p.hidden_reason)+'</span>':'')+'<a href="https://x.com/i/status/'+esc(p.grok_tweet_id)+'" target="_blank" rel="noopener">open on X</a></div>'
 +'<input class="h" maxlength="120" value="'+esc(p.headline||'')+'" placeholder="Headline">'+p.tweets.map(tw).join('')
 +'<div class="tops">'+D.topics.map(t=>'<button data-t="'+esc(t)+'" class="'+(on.has(t)?'on ':'')+(sug.has(t)?'sug':'')+'">'+esc(t)+'</button>').join('')+'</div><div class="acts">'+A+'</div></article>';}
async function load(){tabs();if(status==='batches')return loadBatches();if(status==='projects')return window.loadProjects();const r=await fetch('/api/admin/queue?status='+status,{cache:'no-store'});D=await r.json().catch(()=>null);
 if(!r.ok){$('#list').innerHTML='<div class="empty">Error '+r.status+'</div>';return;}tabs();
 const s=D.spend;$('#stats').textContent='X spend (est.) today $'+(s.today||0).toFixed(2)+' / $'+s.caps.day+(s.caps.boost_until?' (boost until '+s.caps.boost_until+')':'')+' · month $'+(s.month||0).toFixed(2)+' / $'+s.caps.month+(s.last_run?' · last fetch '+new Date(s.last_run*1000).toLocaleString():'')+' · blocked authors '+D.blocked.length;
 $('#list').innerHTML=D.posts.length?D.posts.map(card).join(''):'<div class="empty">Nothing here.</div>';}

const BATCHES=[['strong','Strong picks: approve all'],['maybe','Maybe: skim'],['reject','Recommend reject'],['none','Not reviewed']];let B=null;
async function loadBatches(){const r=await fetch('/api/admin/queue?view=batch',{cache:'no-store'});B=await r.json().catch(()=>null);window.QUEUE_B=B;
 if(!r.ok||!B){$('#list').innerHTML='<div class="empty">Error '+r.status+'</div>';return;}
 const s=B.spend;$('#stats').textContent='Pending '+B.posts.length+' · X spend (est.) today $'+(s.today||0).toFixed(2)+' / $'+s.caps.day+' · month $'+(s.month||0).toFixed(2)+' / $'+s.caps.month+' · rebuild ≤ $'+B.rebuild_max_usd.toFixed(2)+'/post';
 $('#list').innerHTML='<div class="bv">'+BATCHES.map(([k,l])=>{const ps=B.posts.filter(p=>(p.review_batch||'none')===k);if(!ps.length)return '';const m=ps.filter(p=>p.mid_thread).length;
  return '<section data-batch="'+k+'"><h2>'+esc(l)+' <small>'+ps.length+' posts · '+m+' mid-thread · est. rebuild ≤ $'+(m*B.rebuild_max_usd).toFixed(2)+'</small></h2><div class="bacts"><label class="sm"><input type="checkbox" data-all="'+k+'"> Select all in batch</label><button class="ok sm" data-bulk="approve" data-b="'+k+'">✓ Approve selected</button><button class="danger sm" data-bulk="skip" data-b="'+k+'">✕ Reject selected</button></div>'+ps.map(bcard).join('')+'</section>';}).join('')+'</div>';}
function bcard(p){return '<div class="bc" data-id="'+p.id+'"><label class="ck"><input type="checkbox" data-sel="'+p.id+'" aria-label="Select #'+p.id+'"'+(p.rebuild_state==='queued'?' disabled':'')+'></label>'+bbody(p)+'<button class="sm pvb" data-preview="'+p.id+'" aria-label="Preview #'+p.id+'">Preview</button></div>';}
function bbody(p){return '<div class="bd" data-open="'+p.id+'"><div class="tt">#'+p.id+' '+esc(p.headline||'(no title)')+'</div>'+(p.review_reason?'<div class="rs">'+esc(p.review_reason)+'</div>':'')+(p.review_title&&p.review_title!==p.headline?'<div class="sg">Suggested title: '+esc(p.review_title)+'</div>':'')
 +'<div class="chips">'+(p.review_score!=null?'<span class="sc">'+p.review_score+'/5</span>':'')+p.topics.map(t=>'<span class="tg">'+esc(t)+'</span>').join('')+(p.mid_thread&&p.rebuild_state!=='queued'?'<span class="mid">⤴ mid-thread</span>':'')+(p.rebuild_state==='queued'?'<span class="rb">↻ rebuilding</span>':'')+(p.added_by_admin?'<span style="color:#93c5fd">➕ added by admin</span>':'')+(p.title_mismatch?'<span class="mid" title="Titles must name the main human participant">⚠ title @ is not main human @'+esc(p.human_handle)+'</span>':'')+(p._gone?'<span class="gone">'+esc(p._gone)+'</span>':'')+'<span>'+p.n_tweets+' posts</span><a href="https://x.com/i/status/'+esc(p.grok_tweet_id)+'" target="_blank" rel="noopener">X</a></div></div>';}
// Called by the preview modal after a save/approve/skip: patch the card in place, keep every checkbox as it was.
window.updateBatchCard=function(id,patch){const p=B&&B.posts.find(x=>x.id===id);if(!p)return;Object.assign(p,patch);const c=document.querySelector('.bc[data-id="'+id+'"]');if(!c)return;
 c.querySelector('.bd').outerHTML=bbody(p);const cb=c.querySelector('[data-sel]');if(p.rebuild_state==='queued'||p._gone){cb.checked=false;cb.disabled=true;}c.classList.toggle('done',!!p._gone);c.classList.add('flash');setTimeout(()=>c.classList.remove('flash'),900);};
function batchIds(id){const sec=document.querySelector('.bc[data-id="'+id+'"]').closest('[data-batch]');return [...sec.querySelectorAll('.bc:not(.done)')].map(c=>Number(c.dataset.id));}
async function bulk(action,k){const sec=document.querySelector('[data-batch="'+k+'"]');const ids=[...sec.querySelectorAll('[data-sel]:checked')].map(x=>Number(x.dataset.sel));if(!ids.length)return toast('Nothing selected');
 const ps=B.posts.filter(p=>ids.includes(p.id)),m=ps.filter(p=>p.mid_thread).length,cost=m*B.rebuild_max_usd,left=Math.max(0,B.spend.caps.day-(B.spend.today||0));
 const msg=action==='approve'?'Approve '+ids.length+' posts?\\n\\n'+m+' start mid-thread and will be rebuilt from the root before publishing (paid X API).\\nEstimated rebuild cost: up to $'+cost.toFixed(2)+' (≤ $'+B.rebuild_max_usd.toFixed(2)+' each).\\nDaily cap left today: $'+left.toFixed(2)+'. Rebuilds over the cap wait for the daily reset.\\n'+(ids.length-m)+' publish immediately.':'Reject (skip) '+ids.length+' posts? They move to Skipped; no X API cost.';
 if(!confirm(msg))return;let done=0,reb=0;const F=[];
 for(let i=0;i<ids.length;i+=10){const r=await fetch('/api/admin/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ids:ids.slice(i,i+10)})});const d=await r.json().catch(()=>({}));
  const chunk=ids.slice(i,i+10);if(!r.ok||!Array.isArray(d.results)){for(const id of chunk)F.push({id,error:d.error||('HTTP '+r.status)});continue;}for(const x of d.results){if(!x.ok||x.error)F.push(x);else if(x.rebuilding)reb++;else done++;}toast((action==='approve'?'Approving ':'Rejecting ')+(i+10<ids.length?i+10:ids.length)+'/'+ids.length+'…');}
 toast((action==='approve'?'Approved '+done+(reb?' · '+reb+' rebuilding first':''):'Rejected '+done)+(F.length?' · '+F.length+' failed':''));await loadBatches();showFails(F);}
function showFails(F){if(!F.length)return;for(const f of F){const c=document.querySelector('.bc[data-id="'+f.id+'"]');if(c){c.classList.add('fail');const d=document.createElement('div');d.className='fe';d.textContent='✕ failed: '+(f.error||'error')+(f.message?' ('+f.message+')':'');c.querySelector('.bd').appendChild(d);}}
 const box=document.createElement('div');box.className='failbox';box.innerHTML='<b>'+F.length+' failed</b> (left unchanged, safe to retry): '+F.map(f=>'#'+esc(f.id)+' '+esc(f.error||'error')).join(', ');document.querySelector('.bv').prepend(box);}
document.addEventListener('change',e=>{const a=e.target.closest('[data-all]');if(a){document.querySelectorAll('[data-batch="'+a.dataset.all+'"] [data-sel]:not(:disabled)').forEach(x=>x.checked=a.checked);}});
document.addEventListener('click',async e=>{const pv=e.target.closest('[data-preview],[data-open]');if(pv&&!e.target.closest('a,input,label.ck')){e.preventDefault();const id=Number(pv.dataset.preview||pv.dataset.open);return window.openPreview(id,batchIds(id));}const bb=e.target.closest('[data-bulk]');if(bb){e.preventDefault();return bulk(bb.dataset.bulk,bb.dataset.b);}const tb=e.target.closest('[data-tab]');if(tb){status=tb.dataset.tab;location.hash=status;return load();}
 const t=e.target.closest('[data-t]');if(t){t.classList.toggle('on');return;}
 const b=e.target.closest('[data-a]');if(!b)return;const c=b.closest('.card'),a=b.dataset.a,p=D.posts.find(x=>String(x.id)===c.dataset.id);
 if(a==='never'&&!confirm('Never show posts from @'+p.human_handle+'? Their pending posts are removed from the queue.'))return;
 const body={id:Number(c.dataset.id),action:a,headline:c.querySelector('input.h').value,topics:[...c.querySelectorAll('[data-t].on')].map(x=>x.dataset.t),handle:p.human_handle};
 b.disabled=true;const r=await fetch('/api/admin/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));b.disabled=false;
 if(!r.ok)return toast('Failed: '+(d.error||r.status));if(d.rebuilding||a==='rebuild'){toast(d.rebuilding?'Approved · rebuilding full thread first':'Rebuild queued');return load();}toast(a+' ✓');if(['topics','unblock','headline'].includes(a))return;c.remove();D.counts[status]--;tabs();});
// run after the deferred tab scripts below (projects.js defines window.loadProjects) so /admin/queue#projects works on a direct load
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",load,{once:true}):load();
</script><script src="/assets/admin/preview.js"></script><script src="/assets/admin/quickadd.js"></script><script src="/assets/admin/projects.js"></script>`;

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return new Response(page('<main><div class="card" style="margin-top:3rem;text-align:center"><h1>Admins only</h1><p><a href="/auth/login?return=%2Fadmin%2Fqueue">Sign in with X</a></p></div></main>'), { status: 401, headers: HEADERS });
  if (!isAdmin(env, user.x_id)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
  return new Response(page(APP), { headers: HEADERS });
}
