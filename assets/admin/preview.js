// Batch-view preview modal for /admin/queue (admins only; every write goes through /api/admin/post, which checks
// admin + same origin and writes admin_log). The post renders with the live feed's markup and /assets/v2/feed.css
// inside a shadow root, so it looks like the feed and the admin styles cannot leak in either direction.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  const TITLE_RE = /^Grok vs\. @\w{1,15}: \S.*$/;
  // --- feed rendering (same markup/classes as assets/v2/feed.js turn()/card(); keep in sync) ---
  const linkX = s => esc(s)
    .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u.replace(/^https?:\/\//, '').slice(0, 40)}${u.length > 48 ? '…' : ''}</a>`)
    .replace(/(^|[^\w/])@(\w{1,15})\b/g, (m, pre, h) => `${pre}<a href="https://x.com/${h}" target="_blank" rel="noopener noreferrer">@${h}</a>`)
    .replace(/(^|[^\w&/])#(\w{1,80})/g, (m, pre, h) => `${pre}<a href="https://x.com/hashtag/${encodeURIComponent(h)}" target="_blank" rel="noopener noreferrer">#${h}</a>`);
  const stamp = sec => sec ? new Date(sec * 1000).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric' }) : 'View post';
  const quote = q => `<a class="tw__q" href="https://x.com/${encodeURIComponent(q.handle || 'i')}/status/${encodeURIComponent(q.id)}" target="_blank" rel="noopener noreferrer"><span class="tw__qh">${q.name ? `<b>${esc(q.name)}</b> ` : ''}${q.handle ? '@' + esc(q.handle) : 'Quoted post'}</span><span class="tw__qt">${q.text ? esc(q.text) : 'View the quoted post on X'}</span></a>`;
  const media = m => (m || []).map(x => x.type === 'quote' ? quote(x) : x.video
    ? `<video class="tw__m" src="${esc(x.video)}" ${x.url ? `poster="${esc(x.url)}"` : ''} controls preload="none" playsinline></video>`
    : x.url ? `<img class="tw__m" src="${esc(x.url)}" alt="${esc(x.alt || '')}" loading="lazy" referrerpolicy="no-referrer">` : '').join('');
  function turn(w) {
    const url = `https://x.com/${encodeURIComponent(w.handle || 'i')}/status/${encodeURIComponent(w.id)}`;
    const hasText = !!String(w.text || '').trim(), hasMedia = (w.media || []).length > 0;
    return `<div class="tw ${w.grok ? 'tw--grok' : 'tw--human'}"><div class="tw__h">
      <a href="https://x.com/${encodeURIComponent(w.handle)}" target="_blank" rel="noopener noreferrer" class="tw__who"><img class="tw__av" src="${esc(w.avatar || '')}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="tw__n">${esc(w.name || w.handle)}${w.verified ? ' <span class="tw__v" aria-label="verified">✔</span>' : ''}</span><span class="tw__u">@${esc(w.handle)}</span>${w.grok ? '<span class="tw__badge" aria-hidden="true">Grok</span>' : ''}</a>
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="tw__x" aria-label="View on X">${X_SVG}</a></div>
      ${hasText ? `<p class="tw__t">${linkX(w.text)}</p>` : hasMedia ? '' : `<p class="tw__t tw__t--none">This reply has no text. <a href="${url}" target="_blank" rel="noopener noreferrer">View it on X</a></p>`}${media(w.media)}
      <a class="tw__time" href="${url}" target="_blank" rel="noopener noreferrer">${esc(stamp(w.created_at))}</a></div>`;
  }
  const feedCard = (p, title, tags) => `<article class="post"><div class="post__top">${tags.map(x => `<button class="topic" tabindex="-1">${esc(x)}</button>`).join('')}<span class="post__time">preview</span></div>
    <h2 class="post__title">${esc(title || 'Grok vs. a human')}</h2><div class="ex">${p.tweets.map(turn).join('') || '<p class="tw__t tw__t--none">No stored posts.</p>'}</div>
    <div class="vote"><button class="v-grok" tabindex="-1">Grok won <span class="n">0</span></button><button class="v-human" tabindex="-1"><span class="n">0</span> Human won</button></div>
    <div class="vote__pct"><span style="width:50%"></span></div>
    <a class="xlink" href="${esc(p.tweets?.length ? 'https://x.com/i/status/' + p.tweets[p.tweets.length - 1].id : (p.url || ('https://x.com/i/status/' + p.grok_tweet_id)))}" target="_blank" rel="noopener noreferrer">${X_SVG} View thread on X</a></article>`;
  const SHADOW_CSS = ':host{--bg:#09090b;--card:#18181b;--card2:#202024;--line:#27272a;--muted:#a1a1aa;--grok:#6b21a8;--grok-l:#c084fc;--human:#9f1239;--human-l:#fb7185;--grad:linear-gradient(90deg,#a855f7,#22d3ee);display:block;color:#e4e4e7;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif}a{color:inherit}button{font:inherit;color:inherit}.post{margin:0 auto;max-width:640px}.vote button{pointer-events:none}';

  // --- modal state ---
  const M = { open: false, list: [], i: 0, cache: new Map(), cur: null, tags: [], two: false, busy: false, dirty: false, TOPICS: [] };
  const $m = s => document.querySelector('#pv ' + s);
  function shell() {
    if (document.getElementById('pv')) return;
    const d = document.createElement('div'); d.id = 'pv'; d.hidden = true; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'pv-h');
    d.innerHTML = `<div class="pv__box"><div class="pv__bar"><button class="sm" data-pv="prev" aria-label="Previous post">‹ Prev</button><span id="pv-h" class="pv__pos"></span><button class="sm" data-pv="next" aria-label="Next post">Next ›</button><span class="pv__sp"></span><button class="sm" data-pv="close" aria-label="Close preview">✕</button></div>
      <div class="pv__tabs" role="tablist"><button role="tab" data-pvtab="ed" aria-selected="true">Edit</button><button role="tab" data-pvtab="prev" aria-selected="false">Preview</button></div>
      <div class="pv__body"><section class="pv__ed"><div class="pv__meta"></div>
        <label class="pv__lbl" for="pv-title">Title</label><textarea id="pv-title" class="h" rows="2" maxlength="120" autocomplete="off" spellcheck="true"></textarea>
        <div class="pv__warn" hidden>Format: Grok vs. @user: topic</div>
        <div class="pv__sug" hidden><span></span><button class="sm gold" data-pv="sug">Use suggested</button></div>
        <div class="pv__lbl">Tags <label class="pv__two"><input type="checkbox" id="pv-two"> allow a second tag</label></div><div class="tops pv__tags"></div>
        <div class="pv__keys">Keys: ← → prev/next · ⌘/Ctrl+S or S save · A approve · X skip · U use suggested · 1–9 tag · Esc close</div></section>
      <section class="pv__prev"><div class="pv__lbl">As it will look on the feed</div><div class="pv__host"></div></section></div>
      <div class="pv__acts"><button data-pv="save">Save</button><button class="ok" data-pv="approve">✓ Approve</button><button class="danger" data-pv="skip">✕ Skip / Reject</button></div></div>`;
    document.body.appendChild(d);
    const host = d.querySelector('.pv__host'), sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = `<link rel="stylesheet" href="/assets/v2/feed.css"><style>${SHADOW_CSS}</style><div class="root"></div>`;
    d.addEventListener('click', onClick);
    d.querySelector('#pv-title').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    d.querySelector('#pv-title').addEventListener('input', e => { if (/\n/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*\n\s*/g, ' '); M.dirty = true; paintPreview(); fmt(); });
    d.querySelector('#pv-two').addEventListener('change', e => { M.two = e.target.checked; if (!M.two && M.tags.length > 1) { M.tags = M.tags.slice(-1); M.dirty = true; } paintTags(); paintPreview(); });
    d.addEventListener('mousedown', e => { if (e.target === d) close(); });
    document.addEventListener('keydown', onKey);
    // Size to the *visible* viewport (iPad toolbars, on-screen keyboard): visualViewport when available, CSS dvh/svh/vh otherwise.
    const vv = window.visualViewport;
    const fit = () => { if (!vv || !M.open) return; d.style.setProperty('--vvh', vv.height + 'px'); d.style.setProperty('--vvw', vv.width + 'px'); d.style.setProperty('--vvt', vv.offsetTop + 'px'); d.style.setProperty('--vvl', vv.offsetLeft + 'px'); };
    M.fit = fit; if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    d.querySelector('#pv-title').addEventListener('focus', e => setTimeout(() => { fit(); e.target.scrollIntoView({ block: 'nearest' }); }, 350));
  }
  function tab(t) { const d = document.getElementById('pv'); d.dataset.tab = t; d.querySelectorAll('[data-pvtab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pvtab === t))); }
  const fmt = () => { const v = $m('#pv-title').value.trim(); $m('.pv__warn').hidden = !v || TITLE_RE.test(v); };
  async function fetchPost(id) {
    if (M.cache.has(id)) return M.cache.get(id);
    const pr = fetch('/api/admin/queue?id=' + id, { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); M.TOPICS = d.topics; return d.post; });
    M.cache.set(id, pr); pr.catch(() => M.cache.delete(id)); return pr;
  }
  function paintTags() {
    $m('#pv-two').checked = M.two;
    $m('.pv__tags').innerHTML = M.TOPICS.map((t, i) => `<button class="${M.tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}" aria-pressed="${M.tags.includes(t)}">${i < 9 ? `<span class="pv__k">${i + 1}</span>` : ''}${esc(t)}</button>`).join('');
  }
  function toggleTag(t) {
    if (M.tags.includes(t)) { if (M.tags.length > 1) M.tags = M.tags.filter(x => x !== t); }
    else M.tags = M.two ? [...M.tags, t].slice(-2) : [t];
    M.dirty = true; paintTags(); paintPreview();
  }
  function paintPreview() { if (!M.cur) return; $m('.pv__host').shadowRoot.querySelector('.root').innerHTML = feedCard(M.cur, $m('#pv-title').value.trim(), M.tags); }
  async function show(i) {
    if (M.dirty && !confirm('Discard unsaved title/tag changes?')) return false;
    M.i = (i + M.list.length) % M.list.length; const id = M.list[M.i];
    $m('.pv__pos').textContent = '#' + id + ' · ' + (M.i + 1) + ' / ' + M.list.length;
    $m('.pv__host').shadowRoot.querySelector('.root').innerHTML = '<p style="color:#a1a1aa;padding:1rem">Loading…</p>';
    let p; try { p = await fetchPost(id); } catch (e) { $m('.pv__host').shadowRoot.querySelector('.root').innerHTML = '<p style="color:#fda4af;padding:1rem">Could not load: ' + esc(e.message) + '</p>'; return; }
    if (M.list[M.i] !== id) return;                       // user moved on while loading
    M.cur = p; M.tags = p.topics.slice(0, 2); M.two = M.tags.length > 1; M.dirty = false;
    const t = $m('#pv-title'); t.value = p.headline || ''; t.placeholder = 'Grok vs. @' + (p.human_handle || 'user') + ': topic';
    const sg = $m('.pv__sug'); sg.hidden = !p.review_title || p.review_title === p.headline; sg.querySelector('span').textContent = 'Suggested: ' + (p.review_title || '');
    $m('.pv__meta').innerHTML = [p.review_score != null ? `<span class="sc">${p.review_score}/5</span>` : '', p.review_reason ? `<span>${esc(p.review_reason)}</span>` : '',
      p.rebuild_state === 'queued' ? '<span class="rb">↻ rebuilding</span>' : p.mid_thread ? '<span class="mid">⤴ starts mid-thread: approve rebuilds it first (paid X API, within the daily cap)</span>' : '',
      p.status !== 'pending' ? `<span class="mid">status: ${esc(p.status)}</span>` : ''].join('');
    const pend = p.status === 'pending' && p.rebuild_state !== 'queued';
    $m('[data-pv=approve]').disabled = !pend; $m('[data-pv=skip]').disabled = !pend;
    fmt(); paintTags(); paintPreview();
    $m('.pv__ed').scrollTop = 0; $m('.pv__body').scrollTop = 0; $m('.pv__prev').scrollTop = 0;
    const n = M.list[(M.i + 1) % M.list.length]; if (n !== id) fetchPost(n).catch(() => {});   // prefetch next
    return true;
  }
  function open(id, list) {
    shell(); M.list = list.length ? list : [id]; M.open = true; M.dirty = false;
    const d = document.getElementById('pv'); d.hidden = false; tab('ed');
    M.scrollY = window.scrollY; const bs = document.body.style; bs.position = 'fixed'; bs.top = -M.scrollY + 'px'; bs.left = '0'; bs.right = '0'; bs.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    M.fit && M.fit();
    show(Math.max(0, M.list.indexOf(id)));
    setTimeout(() => d.querySelector('[data-pv=close]').focus(), 0);
  }
  function close() {
    if (M.dirty && !confirm('Discard unsaved title/tag changes?')) return;
    M.open = false; M.dirty = false; document.getElementById('pv').hidden = true;
    const bs = document.body.style; bs.position = bs.top = bs.left = bs.right = bs.overflow = ''; document.documentElement.style.overflow = ''; window.scrollTo(0, M.scrollY || 0);
    const c = document.querySelector('.bc[data-id="' + M.list[M.i] + '"]'); if (c) { c.scrollIntoView({ block: 'nearest' }); c.querySelector('[data-preview]')?.focus({ preventScroll: true }); }
  }
  async function post(action) {
    const id = M.list[M.i]; if (M.busy || !M.cur) return;
    const headline = $m('#pv-title').value.replace(/\s+/g, ' ').trim();
    const body = { id, action, headline, topics: M.tags };
    if (action === 'approve') {
      if (!M.tags.length) return window.toast('Pick a tag first');
      const r = window.QUEUE_B?.rebuild_max_usd || 0.7, s = window.QUEUE_B?.spend, left = s ? Math.max(0, s.caps.day - (s.today || 0)) : null;
      if (M.cur.mid_thread && !confirm('Approve #' + id + '?\n\nIt starts mid-thread, so it is rebuilt from the root before publishing (paid X API, up to $' + r.toFixed(2) + ').' + (left != null ? '\nDaily cap left today: $' + left.toFixed(2) + '. Over the cap it waits for the daily reset.' : ''))) return;
    }
    if (action === 'skip' && !confirm('Skip / reject #' + id + '? It moves to Skipped; no X API cost.')) return;
    if (action === 'topics' && !M.tags.length) return window.toast('Pick a tag first');
    M.busy = true; document.querySelectorAll('#pv [data-pv]').forEach(b => b.dataset.pv !== 'close' && (b.disabled = true));
    let r, d; try { r = await fetch('/api/admin/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { r = { ok: false }; d = { error: 'network' }; }
    M.busy = false; document.querySelectorAll('#pv [data-pv]').forEach(b => b.disabled = false);
    if (!r.ok) { $m('[data-pv=approve]').disabled = $m('[data-pv=skip]').disabled = M.cur.status !== 'pending' || M.cur.rebuild_state === 'queued'; return window.toast('Failed: ' + (d.error || r.status)); }
    M.cur.headline = headline || null; M.cur.topics = M.tags.slice(); M.dirty = false;
    const patch = { headline: headline || null, topics: M.tags.slice() };
    if (action === 'approve') { if (d.rebuilding) { patch.rebuild_state = 'queued'; M.cur.rebuild_state = 'queued'; } else { patch._gone = 'approved'; M.cur.status = 'approved'; } }
    if (action === 'skip') { patch._gone = 'skipped'; M.cur.status = 'skipped'; }
    window.updateBatchCard(id, patch);
    window.toast(action === 'topics' ? 'Saved #' + id : action === 'skip' ? 'Skipped #' + id : d.rebuilding ? 'Approved #' + id + ' · rebuilding full thread first' : 'Approved #' + id);
    if (action !== 'topics') { if (patch._gone) { M.list.splice(M.i, 1); if (!M.list.length) return close(); show(M.i % M.list.length); } else show(M.i + 1); }
    else show(M.i);
  }
  function onClick(e) {
    const tb = e.target.closest('[data-pvtab]'); if (tb) return tab(tb.dataset.pvtab);
    const tg = e.target.closest('[data-tag]'); if (tg) return toggleTag(tg.dataset.tag);
    const b = e.target.closest('[data-pv]'); if (!b || b.disabled) return;
    const a = b.dataset.pv;
    if (a === 'close') return close();
    if (a === 'prev') return show(M.i - 1);
    if (a === 'next') return show(M.i + 1);
    if (a === 'sug') { $m('#pv-title').value = M.cur.review_title; M.dirty = true; fmt(); return paintPreview(); }
    if (a === 'save') return post('topics');
    if (a === 'approve') return post('approve');
    if (a === 'skip') return post('skip');
  }
  function onKey(e) {
    if (!M.open) return;
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return post('topics'); }
    if (e.target.closest('input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'k') { e.preventDefault(); return show(M.i - 1); }
    if (k === 'ArrowRight' || k === 'j') { e.preventDefault(); return show(M.i + 1); }
    if (k === 's') return post('topics');
    if (k === 'a') return post('approve');
    if (k === 'x') return post('skip');
    if (k === 'u' && M.cur?.review_title) { $m('#pv-title').value = M.cur.review_title; M.dirty = true; fmt(); return paintPreview(); }
    if (/^[1-9]$/.test(k) && M.TOPICS[k - 1]) return toggleTag(M.TOPICS[k - 1]);
  }
  window.openPreview = open;
})();
