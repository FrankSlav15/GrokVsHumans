// v2 feed MOCKUP: one scrolling feed, topic chips, Hot/New/Top/Hall of Fame.
// Data: /data/v2-sample.json (placeholder examples). All interactions are local only.
(function () {
  const S = { view: 'hot', topic: 'All', hof: 'all', posts: [], topics: [], signedIn: false, mine: {} };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

  window.mockToast = function (m) {
    const t = $('#toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(mockToast.t); mockToast.t = setTimeout(() => t.classList.remove('show'), 2400); return false;
  };
  const ago = h => h < 1 ? Math.round(h * 60) + 'm' : h < 24 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd';
  const total = p => p.votes.grok + p.votes.human;
  const score = p => total(p) + p.likes * 2 + p.comments * 3 - p.dislikes;          // "rated" = engagement
  const hot = p => score(p) / Math.pow(p.hoursAgo + 2, 1.5);                         // decays with age

  function renderAuth() {
    $('#auth').innerHTML = S.signedIn
      ? `<span class="me"><img src="/assets/images/users/@SlavisTon.webp" alt="">@SlavisTon</span>`
      : `<button class="btn-x" id="signin">${X_SVG} Sign in with X</button>`;
    const b = $('#signin'); if (b) b.onclick = () => { S.signedIn = true; renderAuth(); mockToast('Mockup: pretend-signed in as @SlavisTon'); };
    const me = $('.me'); if (me) me.onclick = () => { S.signedIn = false; renderAuth(); mockToast('Signed out (mockup)'); };
  }

  function renderChips() {
    $('#chips').innerHTML = ['All', ...S.topics].map(t => `<button class="chip ${t === S.topic ? 'is-on' : ''}" data-topic="${esc(t)}">${esc(t)}</button>`).join('');
  }

  function msg(side, m, title) {
    const long = m.text.length > 220;
    return `<div class="msg msg--${side}">
      <img class="msg__av" src="${esc(m.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
      <div class="msg__b">
        <div class="msg__h">${side === 'grok' ? '🤖 ' : ''}${esc(m.handle)}</div>
        <p class="msg__t ${long ? 'clamp' : ''}">${esc(m.text)}</p>
        ${long ? '<button class="more" data-act="more">Show more</button>' : ''}
        ${m.media ? `<img class="msg__m" src="${esc(m.media)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
      </div></div>`;
  }

  function card(p, rank) {
    const mine = S.mine[p.id] || {};
    const t = total(p) || 1, gp = Math.round(p.votes.grok / t * 100);
    return `<article class="post" data-id="${p.id}">
      <div class="post__top">
        ${rank ? `<span class="rank">#${rank}</span>` : ''}
        ${p.topics.map(x => `<button class="topic" data-topic="${esc(x)}">${esc(x)}</button>`).join('')}
        ${p.example ? '<span class="example">EXAMPLE</span>' : ''}
        <span class="post__time">${ago(p.hoursAgo)}</span>
      </div>
      <h3 class="post__title">${esc(p.title)}</h3>
      <div class="ex">${msg('human', p.human, p.title)}${msg('grok', p.grok, p.title)}</div>
      <div class="vote">
        <button class="v-grok ${mine.vote === 'grok' ? 'is-mine' : ''}" data-act="vote" data-v="grok">Grok won <span class="n">${p.votes.grok}</span></button>
        <button class="v-human ${mine.vote === 'human' ? 'is-mine' : ''}" data-act="vote" data-v="human"><span class="n">${p.votes.human}</span> Human won</button>
      </div>
      <div class="vote__pct" title="${gp}% Grok"><span style="width:${gp}%"></span></div>
      <div class="acts">
        <button class="act ${mine.react === 1 ? 'is-like' : ''}" data-act="react" data-v="1" aria-label="Like"><i class="fa-solid fa-thumbs-up"></i>${p.likes}</button>
        <button class="act ${mine.react === -1 ? 'is-dislike' : ''}" data-act="react" data-v="-1" aria-label="Dislike"><i class="fa-solid fa-thumbs-down"></i>${p.dislikes}</button>
        <button class="act" data-act="comments" aria-label="Comments"><i class="fa-regular fa-comment"></i>${p.comments}</button>
        <button class="act" data-act="share" aria-label="Share"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
        <a class="act" href="${esc(p.xLink)}" target="_blank" rel="noopener noreferrer" aria-label="Open on X">${X_SVG} Open</a>
      </div>
    </article>`;
  }

  function list() {
    let ps = S.posts.filter(p => S.topic === 'All' || p.topics.includes(S.topic));
    if (S.view === 'hall') {
      if (S.hof === 'week') ps = ps.filter(p => p.hoursAgo <= 168);
      return ps.sort((a, b) => score(b) - score(a)).slice(0, 10);
    }
    if (S.view === 'new') return ps.sort((a, b) => a.hoursAgo - b.hoursAgo);
    if (S.view === 'top') return ps.sort((a, b) => score(b) - score(a));
    return ps.sort((a, b) => hot(b) - hot(a));
  }

  function render() {
    const ps = list();
    const head = S.view === 'hall'
      ? `<div class="hof-head"><h2>🏆 Hall of Fame${S.topic !== 'All' ? ' · ' + esc(S.topic) : ''}</h2>
           <div class="seg"><button data-hof="all" class="${S.hof === 'all' ? 'is-on' : ''}">All-time</button><button data-hof="week" class="${S.hof === 'week' ? 'is-on' : ''}">This week</button></div></div>`
      : '';
    $('#feed').innerHTML = head + (ps.length ? ps.map((p, i) => card(p, S.view === 'hall' ? i + 1 : 0)).join('')
      : `<div class="empty">No ${esc(S.topic)} posts yet.</div>`);
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-on', b.dataset.view === S.view));
    renderChips();
  }

  function setState(patch) {
    Object.assign(S, patch);
    const h = new URLSearchParams();
    if (S.view !== 'hot') h.set('view', S.view);
    if (S.topic !== 'All') h.set('topic', S.topic);
    if (S.view === 'hall' && S.hof !== 'all') h.set('hof', S.hof);
    history.replaceState(null, '', location.pathname + (h.toString() ? '?' + h : ''));
    render();
  }

  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab'); if (tab) return setState({ view: tab.dataset.view }), window.scrollTo({ top: 0 });
    const chip = e.target.closest('[data-topic]'); if (chip) return setState({ topic: chip.dataset.topic }), window.scrollTo({ top: 0 });
    const hof = e.target.closest('[data-hof]'); if (hof) return setState({ hof: hof.dataset.hof });
    const a = e.target.closest('[data-act]'); if (!a) return;
    const post = a.closest('.post'); const p = S.posts.find(x => x.id === post?.dataset.id);
    const act = a.dataset.act;
    if (act === 'more') { const t = a.previousElementSibling; t.classList.toggle('clamp'); a.textContent = t.classList.contains('clamp') ? 'Show more' : 'Show less'; return; }
    if (act === 'share') return mockToast('Share sheet (copy link / post to X)');
    if (act === 'comments') return mockToast('Comments open in a sheet (same as current site)');
    if (!S.signedIn) return mockToast('Sign in with X to vote or react');
    const m = S.mine[p.id] ||= {};
    if (act === 'vote') {
      if (m.vote) p.votes[m.vote]--;
      m.vote = m.vote === a.dataset.v ? null : a.dataset.v;
      if (m.vote) p.votes[m.vote]++;
    } else if (act === 'react') {
      const v = Number(a.dataset.v);
      if (m.react === 1) p.likes--; if (m.react === -1) p.dislikes--;
      m.react = m.react === v ? 0 : v;
      if (m.react === 1) p.likes++; if (m.react === -1) p.dislikes++;
    }
    render();
  });

  fetch('/data/v2-sample.json').then(r => r.json()).then(d => {
    S.posts = d.posts; S.topics = d.topics;
    const q = new URLSearchParams(location.search);
    S.view = ['hot', 'new', 'top', 'hall'].includes(q.get('view')) ? q.get('view') : 'hot';
    S.topic = S.topics.includes(q.get('topic')) ? q.get('topic') : 'All';
    S.hof = q.get('hof') === 'week' ? 'week' : 'all';
    if (q.get('demo') === 'signedin') { S.signedIn = true; S.mine = { ex19: { vote: 'human', react: 1 }, ex15: { vote: 'grok' } }; S.posts.find(p => p.id === 'ex19').likes++; }
    renderAuth(); render();
  });
})();
