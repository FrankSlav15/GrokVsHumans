// Grok vs. Humans v2 feed. Data: /api/feed (approved posts only). Actions need Sign in with X.
(function () {
  const S = { view: 'hot', topic: 'All', hof: 'all', posts: [], next: null, busy: false, topics: [], user: null, open: new Set(), sheet: null };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  const ERR = { sign_in_required: 'Sign in with X first.', banned: 'Your account cannot post or react.', rate_limited: 'Slow down: max 5 comments per 10 minutes.',
    too_long: 'Comments are limited to 500 characters.', empty: 'Write something first.', too_many_links: 'Max 2 links per comment.', own_comment: 'You cannot report your own comment.' };

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
    $('#auth').innerHTML = `<button class="lang-btn" data-lang aria-label="Language: ${esc(langName(RL()))}. Change language and translation settings"><span aria-hidden="true">🌐</span><span class="lang-btn__c">${esc(RL().toUpperCase())}</span></button>` + (u
      ? `${u.admin ? '<a class="queue" href="/admin/queue" aria-label="Admin: post queue"><i class="fa-solid fa-inbox" aria-hidden="true"></i><span class="queue__l">Admin</span><b class="queue__n" id="qn" hidden></b></a>' : ''}<button class="me" id="me" title="Sign out" aria-label="Signed in as @${esc(u.handle)}. Sign out"><img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer"><span class="me__h">@${esc(u.handle)}</span><span class="me__x">${X_SVG}</span></button>`
      : `<button class="btn-x" id="signin">${X_SVG} Sign in with X</button>`);
    if (u?.admin) fetch('/api/admin/counts', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { const n = d ? d.queue + d.moderation + d.featured : 0, b = $('#qn');
      if (b && n > 0) { b.textContent = n > 99 ? '99+' : n; b.hidden = false; b.parentNode.setAttribute('aria-label', `Admin: ${n} items need attention`); } }).catch(() => {});
    $('#signin') && ($('#signin').onclick = () => signIn());
    $('#me') && ($('#me').onclick = () => accountMenu());
  }
  // ---- account menu: sign out / delete my account ----
  function accountMenu() {
    const u = S.user; if (!u) return;
    const el = $('#sheet'); el.hidden = false; document.body.style.overflow = 'hidden';
    el.innerHTML = `<div class="sheet__bg" data-ac="close"></div><div class="sheet__panel acct" role="dialog" aria-modal="true" aria-labelledby="acct-t">
      <div class="sheet__head"><strong id="acct-t">Your account</strong><span>@${esc(u.handle)}</span><button data-ac="close" aria-label="Close">✕</button></div>
      <div class="acct__body" id="acct-b"><button class="acct__btn" data-ac="signout">Sign out</button>
      <button class="acct__btn acct__btn--danger" data-ac="ask" id="acct-del">Delete my account</button></div></div>`;
    const close = () => { el.hidden = true; el.innerHTML = ''; document.body.style.overflow = ''; };
    el.onclick = async e => {
      const a = e.target.closest('[data-ac]')?.dataset.ac;
      if (a === 'close') close();
      else if (a === 'signout') { await post('/auth/logout', {}); S.user = null; close(); renderAuth(); load(); }
      else if (a === 'ask') {
        $('#acct-t').textContent = 'Delete your account?';
        $('#acct-b').innerHTML = `<form id="acct-f" class="acct__f"><p>This permanently deletes your account <b>@${esc(u.handle)}</b>, your votes, likes, reports, suggestions and sessions. Your comments stay as <em>[deleted]</em> without your name so threads still make sense. Ko-fi payment records are kept for bookkeeping, without your account ID. This cannot be undone.</p>
          <label for="acct-c">Type <b>@${esc(u.handle)}</b> or <b>DELETE</b> to confirm</label>
          <input id="acct-c" name="c" autocomplete="off" autocapitalize="off" spellcheck="false" required>
          <p class="acct__err" id="acct-e" role="alert" hidden></p>
          <div class="acct__row"><button type="button" class="acct__btn" data-ac="close">Cancel</button><button type="submit" class="acct__btn acct__btn--danger" id="acct-go" disabled>Delete my account</button></div></form>`;
        const inp = $('#acct-c'), go = $('#acct-go'), ok = v => { v = v.trim().replace(/^@/, ''); return v === 'DELETE' || v.toLowerCase() === u.handle.toLowerCase(); };
        inp.oninput = () => { go.disabled = !ok(inp.value); }; inp.focus();
        $('#acct-f').onsubmit = async ev => { ev.preventDefault(); if (!ok(inp.value)) return; go.disabled = true; go.textContent = 'Deleting…';
          const r = await post('/api/account/delete', { confirm: inp.value.trim() }).catch(() => ({ ok: false, data: {} }));
          if (!r.ok) { const er = $('#acct-e'); er.hidden = false; er.textContent = 'Could not delete your account (' + (r.data?.error || 'network error') + '). Please try again.'; go.disabled = false; go.textContent = 'Delete my account'; return; }
          S.user = null; renderAuth(); load();
          $('#acct-t').textContent = 'Account deleted';
          $('#acct-b').innerHTML = '<p class="acct__done" role="status">Your account and personal data have been deleted and you are signed out.</p><button class="acct__btn" data-ac="close">Close</button>'; };
      }
    };
  }
  const TOPIC = { All: ['✨', 270], Politics: ['🏛️', 0], Technology: ['💻', 200], Memology: ['🐸', 120], Sports: ['⚽', 30], 'Pop Culture': ['🎬', 320], 'Life Advice': ['🧭', 170],
    History: ['📜', 40], Science: ['🔬', 190], Money: ['💸', 140], Health: ['🩺', 350], Religion: ['🕊️', 50], Philosophy: ['🤔', 260], AI: ['🤖', 280], Space: ['🚀', 230],
    Gaming: ['🎮', 300], Food: ['🍕', 20], Animals: ['🐾', 90], 'Wild Card': ['🃏', 330] };
  const renderChips = () => { $('#chips').innerHTML = ['All', ...S.topics].map(t => { const [e, h] = TOPIC[t] || ['#', 270];
    return `<button class="chip ${t === S.topic ? 'is-on' : ''}" style="--h:${h}" data-topic="${esc(t)}" aria-pressed="${t === S.topic}"><span class="chip__e" aria-hidden="true">${e}</span>${esc(t)}</button>`; }).join(''); };

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
    const k = 'post_turn|' + w._k, tr = TR.get(k), shown = tr && tr.on ? tr.text : w.text;
    const hasText = !!String(w.text || '').trim(), hasMedia = (w.media || []).length > 0;
    const url = `https://x.com/${encodeURIComponent(w.handle || 'i')}/status/${encodeURIComponent(w.id)}`;
    return `<div class="tw ${w.grok ? 'tw--grok' : 'tw--human'}" data-trk="${esc(k)}">
      <div class="tw__h">
        <a href="https://x.com/${encodeURIComponent(w.handle)}" target="_blank" rel="noopener noreferrer" class="tw__who">
          <img class="tw__av" src="${esc(w.avatar || '')}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="tw__n">${esc(w.name || w.handle)}${w.verified ? ' <i class="fa-solid fa-circle-check tw__v" aria-label="verified"></i>' : ''}</span>
          <span class="tw__u">@${esc(w.handle)}</span>${w.grok ? '<span class="tw__badge" aria-hidden="true">Grok</span>' : ''}</a>
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="tw__x" aria-label="View on X">${X_SVG}</a>
      </div>
      ${hasText ? `<p class="tw__t" data-trt>${linkX(shown)}</p>${trBar(k, w.text)}` : hasMedia ? '' : `<p class="tw__t tw__t--none">This reply has no text. <a href="https://x.com/${encodeURIComponent(w.handle || 'i')}/status/${encodeURIComponent(w.id)}" target="_blank" rel="noopener noreferrer">View it on X</a></p>`}${media(w.media)}
      <a class="tw__time" href="${url}" target="_blank" rel="noopener noreferrer">${esc(stamp(w.created_at))}</a>
    </div>`;
  }
  // Threads over 5 turns show the first 2 and last 2; "Show full thread" expands inline (never leaves the site).
  const thread = p => { const w = p.tweets; w.forEach((x, i) => { x._k = p.id + ':' + (x.pos ?? i); });
    if (w.length <= 5 || S.open.has(p.id)) return `<div class="ex">${w.map(turn).join('')}</div>`;
    return `<div class="ex">${w.slice(0, 2).map(turn).join('')}<button class="thread-more" data-act="expand"><span aria-hidden="true">⋯</span> Show full thread <span class="thread-more__n">+${w.length - 4}</span><span class="sr"> more of ${w.length}</span></button>${w.slice(-2).map(turn).join('')}</div>`; };
  // Infinite scroll: a sentinel after the last card loads the next page.
  let io = null;
  const watch = () => { const s = $('#more'); if (!s) return; io?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '800px 0px' }); io.observe(s); };
  function card(p, rank) {
    const t = p.votes.grok + p.votes.human, gp = t ? Math.round(p.votes.grok / t * 100) : 50;
    return `<article class="post${p.promoted ? ' post--promo' : ''}" data-id="${p.id}" id="p${p.id}">
      ${p.promoted ? `<div class="promo" title="Paid placement until ${esc(new Date(p.promoted.until * 1000).toLocaleString())}"><span class="promo__star" aria-hidden="true">⭐</span> Featured <span class="promo__paid">Paid placement</span></div>` : ''}
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
        <button class="act act--feat" data-act="feature" aria-label="Feature this thread"><i class="fa-solid fa-star"></i></button>
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
      : `<div class="empty">${S.view === 'grok' || S.view === 'human' ? `${S.view === 'grok' ? '🤖' : '🧑'} No ${S.topic === 'All' ? '' : esc(S.topic) + ' '}posts where ${S.view === 'grok' ? 'Grok' : 'the human'} leads the vote yet. Vote on a few threads and they will show up here.` : S.view === 'hall' ? 'No votes yet – the Hall of Fame fills up as people vote.' : `No ${S.topic === 'All' ? '' : esc(S.topic) + ' '}posts yet.`}</div>`);
    document.querySelectorAll('.tab').forEach(b => { const on = b.dataset.view === S.view; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && b.parentNode.scrollWidth > b.parentNode.clientWidth) b.parentNode.scrollTo({ left: b.offsetLeft - 16, behavior: 'smooth' }); });
    renderChips(); watch($('#feed')); autoWatch($('#feed'));
  }
  // Re-render only the post's chrome (votes, reactions, counts) and keep the already-rendered embeds.
  const rerender = (p, full) => { const el = document.getElementById('p' + p.id); if (!el) return; const i = S.posts.indexOf(p);
    const tmp = document.createElement('div'); tmp.innerHTML = card(p, S.view === 'hall' ? i + 1 : 0); const fresh = tmp.firstElementChild;
    if (!full) { const ex = el.querySelector('.ex'), nx = fresh.querySelector('.ex'); if (ex && nx) nx.replaceWith(ex); }
    el.replaceWith(fresh); if (full) watch(fresh); autoWatch(fresh); };

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
      const nodes = [...tmp.children]; if (m) { m.before(...nodes); if (S.next == null) m.remove(); } nodes.forEach(autoWatch);
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

  // ---- translate (POST /api/translate; cached server-side per item + language) ----
  const LANGS = { en: 'English', es: 'Español', de: 'Deutsch', fr: 'Français', pt: 'Português', it: 'Italiano', nl: 'Nederlands', pl: 'Polski',
    tr: 'Türkçe', sv: 'Svenska', ru: 'Русский', uk: 'Українська', ar: 'العربية', he: 'עברית', hi: 'हिन्दी', ja: '日本語', ko: '한국어', zh: '中文',
    id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ไทย', el: 'Ελληνικά', fa: 'فارسی', ro: 'Română', cs: 'Čeština' };
  const EN_NAMES = { en: 'English', es: 'Spanish', de: 'German', fr: 'French', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', sv: 'Swedish',
    ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai',
    el: 'Greek', fa: 'Persian', ro: 'Romanian', cs: 'Czech' };
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const norm = l => { const c = String(l || '').toLowerCase().split(/[-_]/)[0]; return LANGS[c] ? c : null; };
  const RL = () => norm(store.get('gvh_lang')) || norm(navigator.language) || 'en';   // reader language
  const AUTO = () => store.get('gvh_autotr') === '1';
  const langName = c => LANGS[c] || c;
  const srcName = c => !c ? 'another language' : EN_NAMES[c] || (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(c); } catch { return c; } })();   // site UI is English
  // Same heuristic as server/lang.js: script ranges, then stopword scoring. null = unsure.
  const SCRIPTS = [[/[\u3040-\u30ff]/g, 'ja'], [/[\uac00-\ud7af]/g, 'ko'], [/[\u4e00-\u9fff]/g, 'zh'], [/[\u0600-\u06ff]/g, 'ar'], [/[\u0590-\u05ff]/g, 'he'],
    [/[\u0900-\u097f]/g, 'hi'], [/[\u0e00-\u0e7f]/g, 'th'], [/[\u0370-\u03ff]/g, 'el'], [/[\u0400-\u04ff]/g, 'ru']];
  const STOP = Object.fromEntries(Object.entries({
    en: 'the and is are you that this what with for not have it was but they of to in be do does how why',
    es: 'el la los las que de y es en un una por para con no se lo como pero más muy está qué porque',
    de: 'der die das und ist nicht ich du sie ein eine mit auf für den dem zu auch wie aber was warum sehr',
    fr: 'le la les et est une des pas que qui pour avec dans ce je tu vous mais très pourquoi',
    pt: 'o os as que de e é em um uma não para com por mais muito você isso mas porque',
    it: 'il lo gli che di e è un una non per con sono ma più molto perché questo',
    nl: 'de het een en is niet dat van ik je met voor op maar ook wat waarom', pl: 'nie jest się to że na w i z do co jak ale tak',
    tr: 've bir bu da de ne için çok ama ben sen değil', sv: 'och är det att en som inte jag du med för på men',
    id: 'yang dan di ini itu tidak dengan untuk dari saya kamu ada' }).map(([k, v]) => [k, new Set(v.split(' '))]));
  function detect(text) {
    const s = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\w+/g, ' ');
    for (const [re, c] of SCRIPTS) { const m = s.match(re); if (m && m.length >= 2) return c === 'ru' && /[іїєґ]/i.test(s) ? 'uk' : c === 'ar' && /[پچژگ]/.test(s) ? 'fa' : c; }
    const words = s.toLowerCase().match(/[a-zà-ÿąćęłńóśźżçğışö]+/g) || []; if (words.length < 3) return null;
    const sc = {}; for (const w of words) for (const k in STOP) if (STOP[k].has(w)) sc[k] = (sc[k] || 0) + 1;
    if (/[ñ¿¡]/.test(s)) sc.es = (sc.es || 0) + 2; if (/[äöüß]/.test(s)) sc.de = (sc.de || 0) + 1.5; if (/[ãõ]/.test(s)) sc.pt = (sc.pt || 0) + 2;
    const top = Object.entries(sc).sort((a, b) => b[1] - a[1]);
    if (!top.length || top[0][1] < 2 || (top[1] && top[1][1] >= top[0][1] * 0.8)) return null;
    return top[0][0];
  }
  // Show "Translate" when the text looks like another language; when unsure, show it unless it is plain ASCII for an English reader.
  function needsTr(text) {
    const s = String(text || '').replace(/https?:\/\/\S+/g, '').replace(/[@#]\w+/g, '').trim();
    if (!/\p{L}{2,}/u.test(s)) return false;
    const d = detect(s), rl = RL();
    if (d) return d !== rl;
    return !(rl === 'en' && /^[\x00-\x7f\s\p{Extended_Pictographic}\u{FE0F}\u{200D}’‘“”…–—]*$/u.test(s));
  }
  const TR = new Map();   // key "kind|id" -> { text, source, on, busy, err, target }
  function trBar(k, text) {
    const t = TR.get(k);
    if (!t && !needsTr(text)) return '';
    if (t && t.target !== RL()) TR.delete(k);
    const x = TR.get(k);
    if (x?.busy) return `<div class="trx" data-trbar><span class="trx__s" role="status">🌐 Translating…</span></div>`;
    if (x?.on) return `<div class="trx" data-trbar><span class="trx__s">Translated from ${esc(srcName(x.source))}</span> · <button class="trx__b" data-tr>Show original</button></div>`;
    return `<div class="trx" data-trbar><button class="trx__b" data-tr${x?.err ? ' title="Translation failed, tap to retry"' : ''}>🌐 ${x?.err ? 'Retry translation' : 'Translate'}</button></div>`;
  }
  const origText = k => { const [kind, id] = k.split('|');
    if (kind === 'comment') return S.sheet?.comments?.find(c => String(c.id) === id)?.body;
    const [pid, pos] = id.split(':'); return S.posts.find(p => p.id === pid)?.tweets.find((w, i) => String(w.pos ?? i) === pos)?.text; };
  function paint(el) {
    const k = el.dataset.trk, src = origText(k); if (src == null) return; const t = TR.get(k);
    const p = el.querySelector('[data-trt]'), isC = k.startsWith('comment|');
    if (p) { p.innerHTML = (isC ? linkify : linkX)(t?.on ? t.text : src); p.lang = t?.on ? t.target : ''; }
    const tmp = document.createElement('div'); tmp.innerHTML = trBar(k, src);
    const old = el.querySelector('[data-trbar]'); if (old) old.replaceWith(...tmp.children); else if (p) p.after(...tmp.children);
  }
  async function toggleTr(el, auto) {
    if (!el) return; const k = el.dataset.trk, t = TR.get(k);
    if (t?.busy) return;
    if (t && t.text != null && t.target === RL()) { if (auto && t.on) return; t.on = !t.on; return paint(el); }
    const [kind, id] = k.split('|');
    TR.set(k, { busy: true, target: RL() }); paint(el);
    const r = await post('/api/translate', { kind, id, target: RL() }).catch(() => ({ ok: false, data: {} }));
    if (r.ok && !r.data.same) TR.set(k, { text: r.data.text, source: r.data.source, on: true, target: RL() });
    else { TR.set(k, { err: true, target: RL() });
      if (r.data?.same) TR.set(k, { text: origText(k), source: r.data.source, on: false, target: RL(), same: true });
      if (!auto) toast(r.data?.same ? 'This is already in ' + srcName(RL()) + '.' : r.status === 429 ? 'Too many translations. Try again in a minute.' : 'Translation failed. Try again.'); }
    document.querySelectorAll(`[data-trk="${CSS.escape(k)}"]`).forEach(paint);
  }
  // Auto-translate: only items that scroll into view (keeps under the 60/min limit).
  let aio = null;
  function autoWatch(root) {
    if (!AUTO() || !root || !('IntersectionObserver' in window)) return;
    aio ||= new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; aio.unobserve(e.target);
      if (e.target.querySelector('[data-tr]') && !TR.get(e.target.dataset.trk)) toggleTr(e.target, true); }), { rootMargin: '200px 0px' });
    root.querySelectorAll('[data-trk]').forEach(el => { if (el.querySelector('[data-tr]')) aio.observe(el); });
  }
  function openLang() {
    const cur = norm(store.get('gvh_lang')), br = norm(navigator.language) || 'en';
    panel('🌐 Language', `<form id="lgf" class="sx__form">
      <label class="fld"><span>Translate posts and comments into</span><select name="lang" class="lang-sel">
        <option value="">Browser default (${esc(langName(br))})</option>
        ${Object.entries(LANGS).map(([c, n]) => `<option value="${c}" ${cur === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="tgl"><input type="checkbox" name="auto" ${AUTO() ? 'checked' : ''}><span><b>Auto-translate everything</b><small>Translate posts and comments in other languages as they appear</small></span></label>
      <button class="pill-btn" type="submit">Save</button><p class="fine">Translations are machine-generated (Cloudflare Workers AI) and may be imperfect. Saved on this device only.</p></form>`);
  }
  document.addEventListener('submit', e => {
    if (e.target.id !== 'lgf') return; e.preventDefault();
    const fd = new FormData(e.target); store.set('gvh_lang', fd.get('lang') || null); store.set('gvh_autotr', fd.get('auto') ? '1' : null);
    TR.clear(); aio?.disconnect(); aio = null; closeSheet(); renderAuth(); render(); toast('Language: ' + langName(RL()) + (AUTO() ? ' · auto-translate on' : ''));
  });
  window.__gvhTr = { detect, needsTr, RL };

  // ---- comments sheet ----
  function cmtHtml(c) {
    const k = 'comment|' + c.id, tr = TR.get(k);
    if (c.deleted || !c.user) return `<li class="cmt cmt--deleted" data-cid="${c.id}"><span class="cmt__av" aria-hidden="true"></span><div class="cmt__main"><div class="cmt__head"><em>[deleted account]</em> · ${ago(c.created_at)}</div><p class="cmt__body"><em>[deleted]</em></p></div></li>`;
    return `<li class="cmt" data-cid="${c.id}" data-trk="${esc(k)}"><img class="cmt__av" src="${esc(c.user.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="cmt__main"><div class="cmt__head"><a href="https://x.com/${encodeURIComponent(c.user.handle)}" target="_blank" rel="noopener noreferrer">@${esc(c.user.handle)}</a> · ${ago(c.created_at)}${c.hidden ? ' · <em>hidden</em>' : ''}</div>
      <p class="cmt__body" data-trt>${linkify(tr && tr.on ? tr.text : c.body)}</p>${c.hidden ? '' : trBar(k, c.body)}
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
  function drawComments() { const c = S.sheet.comments; $('#cl').innerHTML = c.length ? c.map(cmtHtml).join('') : '<li class="empty">No comments yet. Be the first.</li>'; autoWatch($('#cl')); }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; document.body.style.overflow = ''; S.sheet = null; }
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'cf') return; e.preventDefault();
    const ta = e.target.querySelector('textarea'), p = S.sheet.p;
    const r = await post('/api/comments', { type: 'post', id: p.id, body: ta.value });
    if (!r.ok) return toast(ERR[r.data.error] || 'Could not post (' + r.status + ')');
    ta.value = ''; S.sheet.comments.push(r.data.comment); p.comments++; drawComments(); rerender(p);
  });

  document.addEventListener('click', async e => {
    const tb = e.target.closest('[data-tr]'); if (tb) return toggleTr(tb.closest('[data-trk]'));
    if (e.target.closest('[data-lang]')) return openLang();
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
    if (act === 'feature') return S.user ? openFeature(p) : needSignIn('feature a thread', location.pathname + '#p' + p.id);
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

  // ---- suggest a thread / paid featured spots ----
  let CFG = null;
  const cfg = async () => CFG || (CFG = await fetch('/api/suggest', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()).catch(() => ({ tiers: [] })));
  const SERR = { bad_url: 'Paste a link to a post on x.com, like https://x.com/user/status/123…', daily_limit: 'You reached today\'s limit of suggestions.', already_suggested: 'Someone already suggested this thread. Thanks!',
    already_on_site: 'This thread is already on the site.', rate_limited: 'Slow down a little and try again.', account_too_new: 'Your X account is too new to suggest threads.', sign_in_required: 'Sign in with X first.', banned: 'Your account cannot suggest threads.' };
  function panel(title, inner) {
    const el = $('#sheet'); el.hidden = false; document.body.style.overflow = 'hidden'; S.sheet = { p: S.sheet?.p || { id: '' }, panel: true };
    el.innerHTML = `<div class="sheet__bg" data-sh="close"></div><div class="sheet__panel sx" role="dialog" aria-label="${esc(title)}">
      <div class="sheet__head"><strong>${esc(title)}</strong><span></span><button data-sh="close" aria-label="Close">✕</button></div><div class="sx__body">${inner}</div></div>`;
  }
  const tierPicker = (tiers, name, none) => `<div class="tiers" role="radiogroup">${none ? `<label class="tier"><input type="radio" name="${name}" value="" checked><span><b>No thanks</b><small>Free suggestion</small></span></label>` : ''}
    ${tiers.map((t, i) => `<label class="tier"><input type="radio" name="${name}" value="${esc(t.id)}" ${!none && i === 0 ? 'checked' : ''}><span><b>$${t.usd}</b><small>${esc(t.label)}</small></span></label>`).join('')}</div>`;
  function payView(f) {
    return `<div class="pay"><p class="pay__lead">Almost done! Pay <b>$${f.usd}</b> on Ko-fi and put this code in the Ko-fi message:</p>
      <button class="pay__code" data-copy="${esc(f.code)}" aria-label="Copy code ${esc(f.code)}">${esc(f.code)} <i class="fa-regular fa-copy"></i></button>
      ${f.kofi_ready ? `<a class="pill-btn pill-btn--kofi" href="${esc(f.kofi_url)}" target="_blank" rel="noopener noreferrer">☕ Pay $${f.usd} on Ko-fi</a>` : '<p class="pay__soon">Ko-fi payments are not open yet. Your request is saved with this code.</p>'}
      <p class="fine">Featured spots are paid placements and are labelled as such. Every request is reviewed by the site owner; if it is declined you get a refund. The spot runs ${esc(f.label)} from approval.</p></div>`;
  }
  async function openSuggest() {
    if (!S.user) return needSignIn('suggest a thread', location.pathname + '?suggest=1');
    const c = await cfg();
    panel('💡 Suggest a thread', `<form id="sgf" class="sx__form">
      <label class="fld"><span>Link to the post on X</span><input name="url" type="url" inputmode="url" autocomplete="off" required placeholder="https://x.com/user/status/…"></label>
      <label class="fld"><span>Note <em>(optional)</em></span><textarea name="note" rows="2" maxlength="280" placeholder="Why is this one good?"></textarea></label>
      <fieldset class="fld"><legend>⭐ Feature it at the top of Hot? <em>(optional, paid)</em></legend>${tierPicker(c.tiers || [], 'tier', true)}</fieldset>
      <button class="pill-btn" type="submit">Send suggestion</button>
      <p class="fine">Up to ${c.per_day || 5} a day. We review every suggestion; approved threads show “suggested by @${esc(S.user.handle)}”.</p></form>`);
    setTimeout(() => $('#sgf input[name=url]')?.focus(), 50);
  }
  async function openFeature(p) {
    const c = await cfg();
    panel('⭐ Feature this thread', `<form id="ftf" class="sx__form" data-post="${esc(p.id)}"><p class="sx__t">${esc(p.headline || '')}</p>
      <fieldset class="fld"><legend>Pin it at the top of Hot (and its topics) for</legend>${tierPicker(c.tiers || [], 'tier', false)}</fieldset>
      <button class="pill-btn" type="submit">Continue</button><p class="fine">Paid placement, clearly labelled “Featured”. The owner approves every request; declined requests are refunded.</p></form>`);
  }
  document.addEventListener('submit', async e => {
    const f = e.target; if (f.id !== 'sgf' && f.id !== 'ftf') return; e.preventDefault();
    const fd = new FormData(f), btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const r = f.id === 'sgf' ? await post('/api/suggest', { url: fd.get('url'), note: fd.get('note'), tier: fd.get('tier') || undefined })
      : await post('/api/feature', { post_id: Number(f.dataset.post), tier: fd.get('tier') });
    btn.disabled = false;
    if (!r.ok) return toast(SERR[r.data.error] || ERR[r.data.error] || 'Could not send (' + r.status + ')');
    const ft = r.data.feature;
    $('.sx__body').innerHTML = (f.id === 'sgf' ? '<p class="done">✅ Thanks! Your suggestion is in the queue.</p>' : '') + (ft ? payView(ft) : '<button class="pill-btn" data-sh="close">Done</button>');
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-suggest]')) return openSuggest();
    const cp = e.target.closest('[data-copy]'); if (cp) navigator.clipboard?.writeText(cp.dataset.copy).then(() => toast('Code copied'), () => {});
  }, true);
  // In-app status updates for the viewer's own suggestions and featured requests.
  async function notify() {
    if (!S.user) return; CFG = null; const c = await cfg();
    const msg = [...(c.suggestions || []).filter(x => x.unseen && (x.state === 'fetched' || x.state === 'rejected' || x.live)).map(x => x.live ? '🎉 Your suggested thread is live!' : x.state === 'rejected' ? 'One of your suggestions was not picked.' : '👀 Your suggestion is being reviewed.'),
      ...(c.features || []).filter(x => x.unseen).map(x => x.state === 'active' ? '⭐ Your featured spot is live!' : x.state === 'paid' ? '💜 Payment received for ' + x.code + '. Awaiting approval.' : x.state === 'rejected' ? 'Featured request ' + x.code + ' was declined; a refund is on its way.' : x.state === 'expired' ? 'Your featured spot ' + x.code + ' has ended.' : '')].filter(Boolean);
    if (msg.length) { toast(msg[0] + (msg.length > 1 ? ` (+${msg.length - 1} more)` : '')); post('/api/suggest', { seen: true }); }
  }

  const q = new URLSearchParams(location.search);
  S.view = ['hot', 'new', 'top', 'hall', 'grok', 'human'].includes(q.get('view')) ? q.get('view') : 'hot';
  S.topic = q.get('topic') || 'All';
  S.hof = q.get('hof') === 'week' ? 'week' : 'all';
  const qs = new URLSearchParams(location.search);
  if (qs.get('login') === 'error') toast('Sign-in failed. Please try again.');
  fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()).then(d => { S.user = d.user; renderAuth(); notify();
    if (qs.get('suggest') === '1') { history.replaceState(null, '', location.pathname); openSuggest(); } }).catch(renderAuth);
  // Donate buttons stay hidden until a Ko-fi URL is configured in data-kofi-url.
  document.querySelectorAll('[data-kofi-url]').forEach(a => { const u = (a.dataset.kofiUrl || '').trim(); if (/^https:\/\/(www\.)?ko-fi\.com\//.test(u)) { a.href = u; a.hidden = false; } });
  renderAuth(); load();
})();
