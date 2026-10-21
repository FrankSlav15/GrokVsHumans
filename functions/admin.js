// GET /admin  - moderation page. Rendered only for ADMIN_X_IDS; everyone else gets
// a sign-in prompt (signed out) or a plain 404 (signed in, not admin).
// All data comes from /api/admin/*, which check admin rights again on every call.
import { getSessionUser, isAdmin } from '../server/lib.js';
import { NAV_CSS, navHtml } from '../server/adminnav.js';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const STYLE = `
*{box-sizing:border-box}body{margin:0;background:#09090b;color:#e4e4e7;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;background:#18181b;border-bottom:1px solid #3b0764;padding:.75rem 1rem;z-index:5}
h1{font-size:1.15rem;margin:0 0 .5rem;color:#c084fc}a{color:#c084fc}
.tabs{display:flex;gap:.4rem;overflow-x:auto}.tabs button{flex:0 0 auto}
button{font:inherit;min-height:44px;border:1px solid #3f3f46;background:#27272a;color:#fff;border-radius:999px;padding:.45rem .85rem;cursor:pointer}
button.on{background:#7e22ce;border-color:#a855f7}button.danger{border-color:#9f1239;color:#fda4af}button.ok{border-color:#15803d;color:#86efac}
main{padding:1rem;max-width:760px;margin:0 auto}.card{background:#18181b;border:1px solid #27272a;border-radius:1rem;padding:.85rem;margin-bottom:.75rem}
.meta{font-size:.8rem;color:#a1a1aa;margin-bottom:.35rem;display:flex;flex-wrap:wrap;gap:.35rem .75rem}
.body{white-space:pre-wrap;word-break:break-word;margin:.25rem 0 .6rem}.acts{display:flex;flex-wrap:wrap;gap:.4rem}
.pill{font-size:.72rem;padding:.1rem .5rem;border-radius:999px;background:#3f3f46}.pill.h{background:#9f1239}.pill.r{background:#a16207}.pill.b{background:#7f1d1d}
.why{color:#fcd34d}.empty{color:#a1a1aa;text-align:center;padding:2rem}.stats{font-size:.8rem;color:#a1a1aa;margin-top:.4rem}
.toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);background:#18181b;border:1px solid #a855f7;padding:.6rem 1rem;border-radius:1rem;display:none}`;

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Admin - GrokVsHumans</title><style>${STYLE}${NAV_CSS}</style></head><body>${body}</body></html>`;
}

const APP = `
<header>${navHtml('moderation')}<h1>GrokVsHumans moderation</h1>
<div class="tabs" id="tabs"></div><div class="stats" id="stats"></div></header>
<main id="list"><div class="empty">Loading…</div></main><div class="toast" id="toast"></div>
<script>
const TABS=[['auto','Auto-hidden'],['flagged','Flagged'],['reported','Reported'],['hidden','Hidden'],['recent','Recent'],['banned','Banned users']];
let filter=location.hash.slice(1)||'auto';
const CAT={threat:'Threat / incitement',doxxing:'Doxxing',minors_sexual:'Minors (sexual)',spam:'Spam'};
const $=s=>document.querySelector(s);
function el(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v);}for(const k of kids)if(k!=null)e.append(k);return e;}
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',2200);}
function ago(s){const d=Math.floor(Date.now()/1000)-s;if(d<60)return d+'s';if(d<3600)return Math.floor(d/60)+'m';if(d<86400)return Math.floor(d/3600)+'h';return Math.floor(d/86400)+'d';}
function itemLink(c){const href=c.item_type==='post'?'/#p'+c.item_id:'/'+(c.item_type==='battle'?'battles':'memes')+'#'+c.item_id;return el('a',{href,target:'_blank'},c.item_type+' #'+c.item_id);}
async function act(kind,id,action,handle){
  if(action==='purge'){const v=prompt('Delete data, keep ban for @'+handle+'?\\n\\nRuns the same deletion as self-service account deletion: profile, sessions, votes, likes, reports and suggestions are removed; comments become [deleted]; Ko-fi records keep no user id. Only the ban-list entry (X id, date, reason) stays. This cannot be undone.\\n\\nType the handle to confirm:');
    if(v===null)return;if(v.trim().replace(/^@/,'').toLowerCase()!==String(handle).toLowerCase()){toast('Handle did not match, nothing deleted');return;}}
  if(action==='delete'&&!confirm('Delete this comment permanently?'))return;
  if(action==='ban'&&!confirm('Ban this user? Their comments will be hidden.'))return;
  const r=await fetch('/api/admin/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='purge'?{kind,id,action,confirm:id}:{kind,id,action})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){toast('Failed: '+(d.error||r.status));return;}
  toast(action+' ✓');load();
}
function renderTabs(){const t=$('#tabs');t.textContent='';for(const[k,l]of TABS)t.append(el('button',{class:k===filter?'on':'',onclick:()=>{filter=k;location.hash=k;renderTabs();load();}},l));}
async function load(){
  const list=$('#list');list.textContent='';list.append(el('div',{class:'empty'},'Loading…'));
  const r=await fetch('/api/admin/comments?filter='+filter,{cache:'no-store'});
  const d=await r.json().catch(()=>({}));list.textContent='';
  if(!r.ok){list.append(el('div',{class:'empty'},'Error: '+(d.error||r.status)));return;}
  if(d.counts)$('#stats').textContent=d.counts.auto+' auto-hidden · '+d.counts.flagged+' flagged · '+d.counts.total+' comments · '+d.counts.reported+' reported · '+d.counts.hidden+' hidden · '+d.counts.users+' users · '+d.counts.banned+' banned';
  if(filter==='banned'){
    if(!d.users.length)list.append(el('div',{class:'empty'},'No banned users.'));
    for(const u of d.users)list.append(el('div',{class:'card'},
      el('div',{class:'meta'},u.handle?el('a',{href:'https://x.com/'+encodeURIComponent(u.handle),target:'_blank',rel:'noopener'},'@'+u.handle):el('span',{},'Deleted account · X id '+u.x_id+(u.reason?' · '+u.reason:'')),el('span',{},u.comments+' comments')),
      el('div',{class:'acts'},el('button',{class:'ok',onclick:()=>act('user',u.x_id,'unban')},'Unban'),...(u.handle?[el('button',{class:'danger','data-purge':u.x_id,onclick:()=>act('user',u.x_id,'purge',u.handle)},'Delete data, keep ban')]:[]))));
    return;
  }
  if(!d.comments.length)list.append(el('div',{class:'empty'},'Nothing here. 🎉'));
  for(const c of d.comments){
    const pills=[];
    if(c.status==='hidden')pills.push(el('span',{class:'pill h'},'hidden'+(c.hidden_by?' ('+c.hidden_by+')':'')));
    if(c.report_count)pills.push(el('span',{class:'pill r'},c.report_count+' report'+(c.report_count>1?'s':'')));
    if(c.mod_state&&c.mod_state!=='ok')pills.push(el('span',{class:'pill '+(c.mod_state==='hidden'?'h':'r')},(c.mod_state==='error'?'AI unchecked':CAT[c.mod_category]||c.mod_category||c.mod_state)+(c.mod_reviewed?' ✓':'')));
    if(c.banned)pills.push(el('span',{class:'pill b'},'user banned'));
    list.append(el('div',{class:'card'},
      el('div',{class:'meta'},el('a',{href:'https://x.com/'+encodeURIComponent(c.handle),target:'_blank',rel:'noopener'},'@'+c.handle),itemLink(c),el('span',{},ago(c.created_at)+' ago'),...pills),
      el('div',{class:'body'},c.body),
      c.mod_reason?el('div',{class:'meta why'},'AI: '+c.mod_reason):null,
      c.reasons&&c.reasons.replace(/[ |]/g,'')?el('div',{class:'meta'},'Reasons: '+c.reasons):null,
      el('div',{class:'acts'},
        c.status==='hidden'?el('button',{class:'ok',onclick:()=>act('comment',c.id,'unhide')},'Approve (unhide)'):el('button',{onclick:()=>act('comment',c.id,'hide')},'Hide'),
        c.status!=='hidden'&&c.mod_state&&c.mod_state!=='ok'&&!c.mod_reviewed?el('button',{class:'ok',onclick:()=>act('comment',c.id,'dismiss')},'OK, keep'):null,
        el('button',{class:'danger',onclick:()=>act('comment',c.id,'delete')},'Delete'),
        c.banned?el('button',{class:'ok',onclick:()=>act('user',c.x_id,'unban')},'Unban @'+c.handle):el('button',{class:'danger',onclick:()=>act('user',c.x_id,'ban')},'Ban @'+c.handle))));
  }
}
renderTabs();load();
</script>`;

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) {
    return new Response(page(`<main><div class="card"><h1>Admin</h1><p>Sign in with X to continue.</p>
      <p><a href="/auth/login?return=%2Fadmin"><button class="on">Sign in with X</button></a></p></div></main>`),
      { status: 401, headers: HEADERS });
  }
  if (!isAdmin(env, user.x_id)) {
    return new Response(page('<main><div class="empty">404 – Not found</div></main>'), { status: 404, headers: HEADERS });
  }
  return new Response(page(APP), { status: 200, headers: HEADERS });
}
