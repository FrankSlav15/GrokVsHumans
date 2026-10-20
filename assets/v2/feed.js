// Grok vs. Humans v2 feed. Data: /api/feed (approved posts only). Actions need Sign in with X.
(function () {
  const S = { view: 'hot', topic: 'All', hof: 'all', posts: [], next: null, busy: false, topics: [], user: null, open: new Set(), sheet: null };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  const ERR = { sign_in_required: 'Sign in with X first.', banned: 'Your account cannot post or react.', rate_limited: 'Slow down: max 5 comments per 10 minutes.',
    too_long: 'Comments are limited to 500 characters.', empty: 'Write something first.', too_many_links: 'Max 2 links per comment.', blocked_words: 'That comment contains words we do not allow.', own_comment: 'You cannot report your own comment.' };

  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
  window.mockToast = m => (toast(m), false);
  const ago = sec => { const d = Math.max(0, Date.now() / 1000 - sec); return d < 3600 ? Math.max(1, Math.round(d / 60)) + 'm' : d < 86400 ? Math.round(d / 3600) + 'h' : d < 86400 * 30 ? Math.round(d / 86400) + 'd' : new Date(sec * 1000).toLocaleDateString(); };
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u.replace(/^https?:\/\//, '').slice(0, 30)}</a>`);
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }
  const signIn = (back) => { location.href = '/auth/login?return=' + encodeURIComponent(back || location.pathname + location.search); };
  function needSignIn(what, back) { toast(`Sign in with X to ${what}`); setTimeout(() => signIn(back), 900); }

  function renderAuth() {
    const u = S.user;
    $('#auth').innerHTML = u
      ? `<button class="me" id="me" title="Sign out"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">@${esc(u.handle)}</button>${u.admin ? '<a class="me" href="/admin/queue" style="margin-left:.35rem">Queue</a>' : ''}`
      : `<button class="btn-x" id="signin">${X_SVG} Sign in with X</button>`;
    $('#signin') && ($('#signin').onclick = () => signIn());
    $('#me') && ($('#me').onclick = async () => { if (!confirm('Sign out?')) return; await post('/auth/logout', {}); S.user = null; renderAuth(); load(); });
  }
  const renderChips = () => { $('#chips').innerHTML = ['All', ...S.topics].map(t => `<button class="chip ${t === S.topic ? 'is-on' : ''}" data-topic="${esc(t)}">${esc(t)}</button>`).join(''); };

  // Native rendering of each turn from the paid X API data (X display requirements: name, @handle, avatar,
  // X logo, timestamp linking to the post, unaltered text with only mentions/hashtags/URLs linked, API media).
  const linkX = s => esc(s)
    .replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u.replace(/^https?:\/\//, '').slice(0, 40)}${u.length > 48 ? '…' : ''}</a>`)
    .replace(/(^|[^\w/])@(\w{1,15})\b/g, (m, pre, h) => `${pre}<a href="https://x.com/${h}" target="_blank" rel="noopener noreferrer">@${h}</a>`)
    .replace(/(^|[^\w&/])#(\w{1,80})/g, (m, pre, h) => `${pre}<a href="https://x.com/hashtag/${encodeURIComponent(h)}" target="_blank" rel="noopener noreferrer">#${h}</a>`);
  const stamp = sec => sec ? new Date(sec * 1000).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', year: 'numeric' }) : 'View post';
  function media(m) {
    return (m || []).map(x => x.type === 'quote' ? quote(x) : x.video
      ? `<video class="tw__m" src="${esc(x.video)}" ${x.url ? `poster="${esc(x.url)}"` : ''} controls preload="none" playsinline></video>`
      : x.url ? `<img class="tw__m" src="${esc(x.url)}" alt="${esc(x.alt || '')}" loading="lazy" referrerpolicy="no-referrer">` : '').join('');
  }
  // Quoted post as a nested card (text from the X API, linked to x.com).
  function quote(q) {
    const url = `https://x.com/${encodeURIComponent(q.handle || 'i')}/status/${encodeURIComponent(q.id)}`;
    return `<a class="tw__q" href="${url}" target="_blank" rel="noopener noreferrer"><span class="tw__qh">${q.name ? `<b>${esc(q.name)}</b> ` : ''}${q.handle ? '@' + esc(q.handle) : 'Quoted post'}</span>${q.text ? `<span class="tw__qt">${esc(q.text)}</span>` : '<span class="tw__qt">View the quoted post on X</span>'}</a>`;
  }
  function turn(w) {
    const hasText = !!String(w.text || '').trim(), hasMedia = (w.media || []).length > 0;
    const url = `https://x.com/${encodeURIComponent(w.handle || 'i')}/status/${encodeURIComponent(w.id)}`;
    return `<div class="tw ${w.grok ? 'tw--grok' : 'tw--human'}">
      <div class="tw__h">
        <a href="https://x.com/${encodeURIComponent(w.handle)}" target="_blank" rel="noopener noreferrer" class="tw__who">
          <img class="tw__av" src="${esc(w.avatar || '')}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="tw__n">${esc(w.name || w.handle)}${w.verified ? ' <i class="fa-solid fa-circle-check tw__v" aria-label="verified"></i>' : ''}</span>
          <span class="tw__u">@${esc(w.handle)}</span></a>
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="tw__x" aria-label="View on X">${X_SVG}</a>
      </div>
      ${hasText ? `<p class="tw__t">${linkX(w.text)}</p>` : hasMedia ? '' : `<p class="tw__t tw__t--none">This reply has no text. <a href="https://x.com/${encodeURIComponent(w.handle || 'i')}/status/${encodeURIComponent(w.id)}" target="_blank" rel="noopener noreferrer">View it on X</a></p>`}${media(w.media)}
      <a class="tw__time" href="${url}" target="_blank" rel="noopener noreferrer">${esc(stamp(w.created_at))}</a>
    </div>`;
  }
  // Threads over 5 turns show the first 2 and last 2; "Show full thread" expands inline (never leaves the site).
  const thread = p => { const w = p.tweets;
    if (w.length <= 5 || S.open.has(p.id)) return `<div class="ex">${w.map(turn).join('')}</div>`;
    return `<div class="ex">${w.slice(0, 2).map(turn).join('')}<button class="thread-more" data-act="expand">Show full thread (${w.length - 4} more of ${w.length})</button>${w.slice(-2).map(turn).join('')}</div>`; };
  // Infinite scroll: a sentinel after the last card loads the next page.
  let io = null;
  const watch = () => { const s = $('#more'); if (!s) return; io?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '800px 0px' }); io.observe(s); };
  function card(p, rank) {
    const t = p.votes.grok + p.votes.human, gp = t ? Math.round(p.votes.grok / t * 100) : 50;
    return `<article class="post" data-id="${p.id}" id="p${p.id}">
      <div class="post__top">
        ${rank ? `<span class="rank">#${rank}</span>` : ''}${p.featured ? '<span class="rank">★</span>' : ''}
        ${p.topics.map(x => `<button class="topic" data-topic="${esc(x)}">${esc(x)}</button>`).join('')}
        <span class="post__time">${ago(p.created_at)}</span>
      </div>
      <h2 class="post__title">${esc(p.headline || 'Grok vs. a human')}</h2>
      ${thread(p)}
      <div class="vote">
        <button class="v-grok ${p.mine.vote === 'grok' ? 'is-mine' : ''}" data-act="vote" data-v="grok">Grok won <span class="n">${p.votes.grok}</span></button>
        <button class="v-human ${p.mine.vote === 'human' ? 'is-mine' : ''}" data-act="vote" data-v="human"><span class="n">${p.votes.human}</span> Human won</button>
      </div>
      <div class="vote__pct" title="${gp}% Grok"><span style="width:${gp}%"></span></div>
      <div class="acts">
        <button class="act ${p.mine.react === 1 ? 'is-like' : ''}" data-act="react" data-v="1" aria-label="Like"><i class="fa-solid fa-thumbs-up"></i>${p.likes}</button>
        <button class="act ${p.mine.react === -1 ? 'is-dislike' : ''}" data-act="react" data-v="-1" aria-label="Dislike"><i class="fa-solid fa-thumbs-down"></i>${p.dislikes}</button>
        <button class="act" data-act="comments" aria-label="Comments"><i class="fa-regular fa-comment"></i>${p.comments}</button>
        <button class="act" data-act="share" aria-label="Share"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
      </div>
      <a class="xlink" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${X_SVG} View thread on X</a>
    </article>`;
  }
  function render() {
    const head = S.view === 'hall'
      ? `<div class="hof-head"><h2>🏆 Hall of Fame${S.topic !== 'All' ? ' · ' + esc(S.topic) : ''}</h2>
           <div class="seg"><button data-hof="all" class="${S.hof === 'all' ? 'is-on' : ''}">All-time</button><button data-hof="week" class="${S.hof === 'week' ? 'is-on' : ''}">This week</button></div></div>` : '';
    $('#feed').innerHTML = head + (S.posts.length ? S.posts.map((p, i) => card(p, S.view === 'hall' ? i + 1 : 0)).join('')
      + (S.next != null ? '<div id="more" class="more-wrap"><button class="load-more" data-act="more">Load more</button></div>' : '')
      : `<div class="empty">${S.view === 'hall' ? 'No votes yet – the Hall of Fame fills up as people vote.' : `No ${S.topic === 'All' ? '' : esc(S.topic) + ' '}posts yet.`}</div>`);
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.view === S.view; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    renderChips(); watch($('#feed'));
  }
  // Re-render only the post's chrome (votes, reactions, counts) and keep the already-rendered embeds.
  const rerender = (p, full) => { const el = document.getElementById('p' + p.id); if (!el) return; const i = S.posts.indexOf(p);
    const tmp = document.createElement('div'); tmp.innerHTML = card(p, S.view === 'hall' ? i + 1 : 0); const fresh = tmp.firstElementChild;
    if (!full) { const ex = el.querySelector('.ex'), nx = fresh.querySelector('.ex'); if (ex && nx) nx.replaceWith(ex); }
    el.replaceWith(fresh); if (full) watch(fresh); };

  const feedQ = extra => { const q = new URLSearchParams({ view: S.view, range: S.hof, ...extra }); if (S.topic !== 'All') q.set('topic', S.topic); return '/api/feed?' + q; };
  async function load() {
    const seq = load.seq = (load.seq || 0) + 1;
    const r = await fetch(feedQ({}), { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (seq !== load.seq) return;
    if (!r || !r.ok) { $('#feed').innerHTML = '<div class="empty">Could not load the feed. <button class="load-more" data-act="retry">Retry</button></div>'; return; }
    S.posts = d.posts; S.topics = d.topics; S.next = d.next ?? null; render();
    const h = location.hash.match(/^#p(\d+)$/);
    if (h && !load.jumped) { load.jumped = 1;
      if (!document.getElementById('p' + h[1])) {   // shared link to a post beyond the first page: fetch it on its own
        const one = await fetch('/api/feed?id=' + h[1], { credentials: 'same-origin' }).then(x => x.json()).catch(() => ({}));
        if (one.posts?.[0]) { S.posts = [one.posts[0], ...S.posts.filter(p => p.id !== one.posts[0].id)]; render(); }
      }
      document.getElementById('p' + h[1])?.scrollIntoView(); }
  }
  async function more() {
    if (S.busy || S.next == null) return; S.busy = true; const seq = load.seq;
    try {
      const d = await fetch(feedQ({ offset: S.next }), { credentials: 'same-origin', cache: 'no-store' }).then(x => x.ok ? x.json() : Promise.reject());
      if (seq !== load.seq) return;
      const have = new Set(S.posts.map(p => p.id)), add = d.posts.filter(p => !have.has(p.id)), base = S.posts.length;
      S.posts.push(...add); S.next = d.next ?? null;
      const m = $('#more'), tmp = document.createElement('div');
      tmp.innerHTML = add.map((p, i) => card(p, S.view === 'hall' ? base + i + 1 : 0)).join('');
      if (m) { m.before(...tmp.children); if (S.next == null) m.remove(); }
    } catch { toast('Could not load more posts.'); } finally { S.busy = false; watch(); }
  }
  function setState(patch) {
    Object.assign(S, patch);
    const h = new URLSearchParams();
    if (S.view !== 'hot') h.set('view', S.view);
    if (S.topic !== 'All') h.set('topic', S.topic);
    if (S.view === 'hall' && S.hof !== 'all') h.set('hof', S.hof);
    history.replaceState(null, '', location.pathname + (h.toString() ? '?' + h : ''));
    render(); load();
  }

  // ---- comments sheet ----
  function cmtHtml(c) {
    return `<li class="cmt" data-cid="${c.id}"><img class="cmt__av" src="${esc(c.user.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="cmt__main"><div class="cmt__head"><a href="https://x.com/${encodeURIComponent(c.user.handle)}" target="_blank" rel="noopener noreferrer">@${esc(c.user.handle)}</a> · ${ago(c.created_at)}${c.hidden ? ' · <em>hidden</em>' : ''}</div>
      <p class="cmt__body">${linkify(c.body)}</p>
      <div class="cmt__acts"><button data-c="like" class="${c.mine === 1 ? 'is-like' : ''}"><i class="fa-solid fa-thumbs-up"></i> ${c.likes}</button><button data-c="dislike" class="${c.mine === -1 ? 'is-dislike' : ''}"><i class="fa-solid fa-thumbs-down"></i> ${c.dislikes}</button>
      ${c.own || S.user?.admin ? '<button data-c="delete">Delete</button>' : ''}${!c.own ? '<button data-c="report">Report</button>' : ''}</div></div></li>`;
  }
  async function openSheet(p) {
    S.sheet = { p, comments: [] };
    const el = $('#sheet'); el.hidden = false; document.body.style.overflow = 'hidden';
    el.innerHTML = `<div class="sheet__bg" data-sh="close"></div><div class="sheet__panel" role="dialog" aria-label="Comments">
      <div class="sheet__head"><strong>Comments</strong><span>${esc(p.headline || '')}</span><button data-sh="close" aria-label="Close">✕</button></div>
      <ul class="sheet__list" id="cl"><li class="empty">Loading…</li></ul>
      <form class="sheet__form" id="cf">${S.user ? `<textarea maxlength="500" rows="2" placeholder="Add a comment as @${esc(S.user.handle)}" required></textarea><button type="submit">Post</button>`
        : `<button type="button" class="btn-x" data-sh="signin">${X_SVG} Sign in with X to comment</button>`}</form></div>`;
    const r = await fetch(`/api/comments?type=post&id=${p.id}`, { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({ comments: [] }));
    S.sheet.comments = d.comments || []; drawComments();
  }
  function drawComments() { const c = S.sheet.comments; $('#cl').innerHTML = c.length ? c.map(cmtHtml).join('') : '<li class="empty">No comments yet. Be the first.</li>'; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; document.body.style.overflow = ''; S.sheet = null; }
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'cf') return; e.preventDefault();
    const ta = e.target.querySelector('textarea'), p = S.sheet.p;
    const r = await post('/api/comments', { type: 'post', id: p.id, body: ta.value });
    if (!r.ok) return toast(ERR[r.data.error] || 'Could not post (' + r.status + ')');
    ta.value = ''; S.sheet.comments.push(r.data.comment); p.comments++; drawComments(); rerender(p);
  });

  document.addEventListener('click', async e => {
    const sh = e.target.closest('[data-sh]');
    if (sh) { if (sh.dataset.sh === 'close') return closeSheet(); return signIn(location.pathname + location.search + '#p' + S.sheet.p.id); }
    const cb = e.target.closest('[data-c]');
    if (cb && S.sheet) {
      const li = cb.closest('.cmt'), c = S.sheet.comments.find(x => String(x.id) === li.dataset.cid), k = cb.dataset.c;
      if (!S.user) return needSignIn('react', location.pathname + '#p' + S.sheet.p.id);
      if (k === 'delete') { if (!confirm('Delete this comment?')) return; const r = await post('/api/comment-delete', { id: c.id }); if (r.ok) { S.sheet.comments = S.sheet.comments.filter(x => x !== c); S.sheet.p.comments--; drawComments(); rerender(S.sheet.p); } return; }
      if (k === 'report') { if (!confirm('Report this comment?')) return; const r = await post('/api/report', { id: c.id }); return toast(r.ok ? 'Reported. Thanks.' : ERR[r.data.error] || 'Failed'); }
      const v = k === 'like' ? 1 : -1, r = await post('/api/react', { type: 'comment', id: String(c.id), value: c.mine === v ? 0 : v });
      if (r.ok) { Object.assign(c, { likes: r.data.likes, dislikes: r.data.dislikes, mine: r.data.mine }); drawComments(); } else toast(ERR[r.data.error] || 'Failed');
      return;
    }
    const tab = e.target.closest('.tab'); if (tab) return setState({ view: tab.dataset.view }), window.scrollTo({ top: 0 });
    const chip = e.target.closest('[data-topic]'); if (chip) return setState({ topic: chip.dataset.topic }), window.scrollTo({ top: 0 });
    const hof = e.target.closest('[data-hof]'); if (hof) return setState({ hof: hof.dataset.hof });
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'more') return more();
    if (a.dataset.act === 'retry') return load();
    const el = a.closest('.post'), p = S.posts.find(x => x.id === el?.dataset.id), act = a.dataset.act;
    if (act === 'expand') { S.open.add(p.id); return rerender(p, true); }
        if (act === 'comments') return openSheet(p);
    if (act === 'share') {
      const url = location.origin + '/#p' + p.id;
      if (navigator.share) return navigator.share({ title: p.headline || 'Grok vs. Humans', text: 'Who won? Vote:', url }).catch(() => {});
      return navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast(url));
    }
    if (!S.user) return needSignIn(act === 'vote' ? 'vote' : 'react', location.pathname + location.search + '#p' + p.id);
    if (act === 'vote') {
      const choice = p.mine.vote === a.dataset.v ? null : a.dataset.v;
      const r = await post('/api/vote', { type: 'post', id: p.id, choice });
      if (!r.ok) return toast(ERR[r.data.error] || 'Vote failed');
      p.votes = r.data.votes; p.mine.vote = r.data.mine; rerender(p);
    } else if (act === 'react') {
      const v = Number(a.dataset.v), r = await post('/api/react', { type: 'post', id: p.id, value: p.mine.react === v ? 0 : v });
      if (!r.ok) return toast(ERR[r.data.error] || 'Failed');
      Object.assign(p, { likes: r.data.likes, dislikes: r.data.dislikes }); p.mine.react = r.data.mine; rerender(p);
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

  const q = new URLSearchParams(location.search);
  S.view = ['hot', 'new', 'top', 'hall'].includes(q.get('view')) ? q.get('view') : 'hot';
  S.topic = q.get('topic') || 'All';
  S.hof = q.get('hof') === 'week' ? 'week' : 'all';
  const qs = new URLSearchParams(location.search);
  if (qs.get('login') === 'error') toast('Sign-in failed. Please try again.');
  fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()).then(d => { S.user = d.user; renderAuth(); }).catch(renderAuth);
  // Donate buttons stay hidden until a Ko-fi URL is configured in data-kofi-url.
  document.querySelectorAll('[data-kofi-url]').forEach(a => { const u = (a.dataset.kofiUrl || '').trim(); if (/^https:\/\/(www\.)?ko-fi\.com\//.test(u)) { a.href = u; a.hidden = false; } });
  renderAuth(); load();
})();
