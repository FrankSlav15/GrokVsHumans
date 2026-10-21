// /admin/queue "Projects" tab: review submitted projects (preview, edit, approve, skip, hide, delete). Data: /api/admin/projects.
(function () {
  const $ = s => document.querySelector(s), L = () => $('#list');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SUBS = [['pending', 'Pending'], ['approved', 'Approved'], ['skipped', 'Skipped'], ['hidden', 'Hidden / auto-hidden']];
  const FIELDS = [['name', 'Name', 80, 1], ['url', 'Project link', 500, 1], ['description', 'Description', 500, 3], ['si_usage', 'How SI is used', 300, 3], ['image_url', 'Screenshot image URL (https)', 500, 1], ['donate_url', 'Donation link (Ko-fi, Patreon, GitHub Sponsors, Buy Me a Coffee, Open Collective, Liberapay)', 500, 1]];
  let sub = 'pending', P = null;
  const ERR = { bad_url: 'Project link must be an http(s) URL', bad_image_url: 'Image must be an https URL', bad_donate_url: 'Donation link must be https on an allowed platform' };
  function preview(p) {
    return `<div class="pj-pv"><div class="pj-pv__img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'image failed to load'}))">` : '<span>no image</span>'}</div>
      <b>${esc(p.name)}</b> <small>by @${esc(p.handle || '[deleted]')}</small><p>${esc(p.description)}</p><p><i>How SI is used:</i> ${esc(p.si_usage)}</p>
      <p class="pj-pv__l"><a href="${esc(p.url)}" target="_blank" rel="noopener nofollow ugc">${esc(p.url)}</a>${p.donate_url ? ` · <a href="${esc(p.donate_url)}" target="_blank" rel="noopener nofollow ugc">Donate ↗</a>` : ''}</p></div>`;
  }
  function card(p) {
    const A = sub === 'pending' ? '<button class="ok" data-pa="approve">✓ Approve</button><button data-pa="save">Save edits</button><button data-pa="skip">Skip</button><button class="danger" data-pa="hide">Hide</button>'
      : sub === 'approved' ? '<button data-pa="save">Save edits</button><button class="danger" data-pa="hide">Hide</button>'
      : '<button data-pa="restore">Back to pending</button><button class="ok" data-pa="approve">✓ Approve</button>';
    return `<article class="card pj" data-pid="${p.id}"><div class="meta"><span>#${p.id}</span><span>@${esc(p.handle || '[deleted]')}</span>${p.banned ? '<span class="mid">banned user</span>' : ''}<span>${new Date(p.created_at * 1000).toLocaleString()}</span>
      ${p.mod_state && p.mod_state !== 'ok' ? `<span class="mid">AI: ${esc(p.mod_state)}${p.mod_category ? ' · ' + esc(p.mod_category) : ''}${p.mod_reason ? ' · ' + esc(p.mod_reason) : ''}</span>` : ''}
      ${p.hidden_by ? `<span>hidden by ${esc(p.hidden_by)}</span>` : ''}${p.feature ? `<span class="rb">★ ${esc(p.feature)}</span>` : ''}${sub === 'approved' ? `<span>▲${p.up || 0} ▼${p.down || 0}</span>` : ''}</div>
      <div class="pj-grid"><div class="pj-ed">${FIELDS.map(([k, l, max, rows]) => `<label class="pj-f"><span>${l} <em data-cnt="${k}">${[...(p[k] || '')].length}/${max}</em></span>${rows > 1
        ? `<textarea class="h" data-f="${k}" maxlength="${max}" rows="${rows}">${esc(p[k] || '')}</textarea>` : `<input class="h" data-f="${k}" maxlength="${max}" value="${esc(p[k] || '')}">`}</label>`).join('')}</div>
      <div class="pj-prev" aria-label="Preview">${preview(p)}</div></div><div class="acts">${A}<button class="sm danger" data-pa="delete">Delete</button></div></article>`;
  }
  window.loadProjects = async function () {
    const r = await fetch('/api/admin/projects?status=' + sub, { cache: 'no-store' }); const d = await r.json().catch(() => null);
    if (!r.ok || !d) { L().innerHTML = '<div class="empty">Error ' + r.status + '</div>'; return; }
    P = d; $('#stats').innerHTML = '<span class="pj-subs">' + SUBS.map(([k, l]) => `<button class="sm${k === sub ? ' on' : ''}" data-psub="${k}">${l} (${d.counts[k] || 0})</button>`).join('') + '</span>';
    L().innerHTML = `<p class="pj-note">Free-speech policy: only threats, doxxing, CSAM and spam are auto-hidden. Edits are validated like a submission; every action is logged.</p>`
      + (d.projects.length ? d.projects.map(card).join('') : '<div class="empty">No projects here.</div>');
  };
  const vals = c => Object.fromEntries([...c.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.value]));
  document.addEventListener('input', e => { const i = e.target.closest('.pj [data-f]'); if (!i) return; const c = i.closest('.pj'), p = P.projects.find(x => String(x.id) === c.dataset.pid);
    const cnt = c.querySelector(`[data-cnt="${i.dataset.f}"]`); if (cnt) cnt.textContent = [...i.value].length + '/' + i.maxLength;
    c.querySelector('.pj-prev').innerHTML = preview({ ...p, ...vals(c) }); });
  document.addEventListener('click', async e => {
    const s = e.target.closest('[data-psub]'); if (s) { sub = s.dataset.psub; return window.loadProjects(); }
    const b = e.target.closest('[data-pa]'); if (!b) return; const c = b.closest('.pj'), a = b.dataset.pa, id = Number(c.dataset.pid);
    if (a === 'delete' && !confirm('Delete project #' + id + ' with its votes and comments? This cannot be undone.')) return;
    const body = { id, action: a, ...(['save', 'approve', 'skip'].includes(a) ? vals(c) : {}) };
    b.disabled = true; const r = await fetch('/api/admin/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); b.disabled = false;
    if (!r.ok) return window.toast('Failed: ' + (ERR[d.error] || d.error || r.status));
    window.toast(a + ' ✓' + (d.edited?.length ? ' (edited ' + d.edited.join(', ') + ')' : ''));
    if (a !== 'save') { c.remove(); if (P.counts[sub]) P.counts[sub]--; }
  });
  const st = document.createElement('style');
  st.textContent = `.pj-grid{display:grid;grid-template-columns:1fr;gap:.7rem}@media (min-width:760px){.pj-grid{grid-template-columns:1fr 1fr}main{max-width:1100px}}
  .pj-f{display:block;font-size:.78rem;color:#a1a1aa}.pj-f span{display:flex;justify-content:space-between;margin-bottom:.2rem}.pj-f em{font-style:normal}.pj-f .h{font-weight:400;font-size:16px}
  .pj-prev{background:#09090b;border:1px solid #27272a;border-radius:.8rem;padding:.6rem;font-size:.9rem;min-width:0}.pj-pv p{margin:.35rem 0;white-space:pre-wrap;word-break:break-word}.pj-pv small{color:#a1a1aa}
  .pj-pv__img{aspect-ratio:16/9;background:#18181b;border-radius:.6rem;overflow:hidden;display:grid;place-items:center;color:#71717a;font-size:.8rem;margin-bottom:.4rem}.pj-pv__img img{width:100%;height:100%;object-fit:cover}
  .pj-pv__l{word-break:break-all;font-size:.82rem}.pj-subs{display:flex;gap:.35rem;flex-wrap:wrap}.pj-note{font-size:.8rem;color:#a1a1aa;margin:.2rem 0 .7rem}`;
  document.head.appendChild(st);
})();
