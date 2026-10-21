// assets/js/social.js - comments, likes/dislikes and reports (Sign in with X required to act).
// Battles: rendered inside the battle modal. Memes: a "Comments" button opens a bottom sheet.
(function () {
  const PAGE_FOR = { battle: 'battles', meme: 'memes' };
  const ERR = {
    sign_in_required: 'Please sign in with X first.',
    banned: 'Your account cannot post or react.',
    rate_limited: 'Slow down: max 5 comments per 10 minutes.',
    too_long: 'Comments are limited to 500 characters.',
    empty: 'Write something first.',
    too_many_links: 'Max 2 links per comment.',
    own_comment: 'You cannot report your own comment.',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function ago(sec) {
    const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm';
    if (d < 86400) return Math.floor(d / 3600) + 'h';
    if (d < 86400 * 30) return Math.floor(d / 86400) + 'd';
    return new Date(sec * 1000).toLocaleDateString();
  }
  function toast(m) { if (window.showToast) window.showToast(m); }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // Send a signed-out visitor to X and bring them back to this exact item.
  function promptSignIn(type, id, what) {
    toast(`Sign in with X to ${what} 🗳️`);
    const back = `/${PAGE_FOR[type]}#${id}`;
    if (type === 'meme') sessionStorage.setItem('gvh_open_comments', `meme:${id}`);
    setTimeout(() => { location.href = '/auth/login?return=' + encodeURIComponent(back); }, 900);
  }

  function reactBar(kind, id, r, extraClass) {
    const cls = v => `react-btn ${r.mine === v ? 'react-btn--on' : ''}`;
    return `<div class="react-bar ${extraClass || ''}" data-kind="${kind}" data-id="${esc(id)}">
      <button type="button" class="${cls(1)}" data-v="1" aria-label="Like"><i class="fa-solid fa-thumbs-up"></i><span>${r.likes}</span></button>
      <button type="button" class="${cls(-1)}" data-v="-1" aria-label="Dislike"><i class="fa-solid fa-thumbs-down"></i><span>${r.dislikes}</span></button>
    </div>`;
  }

  function commentHtml(c) {
    if (c.deleted || !c.user) return `<li class="cmt cmt--deleted" data-cid="${c.id}"><span class="cmt__avatar cmt__avatar--none"></span><div class="cmt__main"><div class="cmt__head"><em>[deleted account]</em> <span class="cmt__time">${ago(c.created_at)}</span></div><p class="cmt__body"><em>[deleted]</em></p></div></li>`;
    const avatar = /^https:\/\//.test(c.user.avatar || '') ? `<img class="cmt__avatar" src="${esc(c.user.avatar)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<span class="cmt__avatar cmt__avatar--none"></span>';
    return `<li class="cmt ${c.hidden ? 'cmt--hidden' : ''}" data-cid="${c.id}">
      ${avatar}
      <div class="cmt__main">
        <div class="cmt__head">
          <a class="cmt__handle" href="https://x.com/${encodeURIComponent(c.user.handle)}" target="_blank" rel="noopener noreferrer">@${esc(c.user.handle)}</a>
          <span class="cmt__time">${ago(c.created_at)}</span>
          ${c.hidden ? '<span class="cmt__flag">hidden – only you can see this</span>' : ''}
        </div>
        <p class="cmt__body">${esc(c.body)}</p>
        <div class="cmt__actions">
          ${c.hidden ? '' : reactBar('comment', c.id, c, 'react-bar--small')}
          ${c.own ? '<button type="button" class="cmt__link" data-act="delete">Delete</button>'
                  : '<button type="button" class="cmt__link" data-act="report">Report</button>'}
        </div>
      </div>
    </li>`;
  }

  function render(root, st) {
    const u = window.currentUser;
    const count = st.comments.filter(c => !c.hidden).length;
    const draftKey = `gvh_draft_${st.type}_${st.id}`;
    root.innerHTML = `
      <div class="social__item">
        <span class="social__label">Rate this ${st.type}</span>
        ${reactBar(st.type, st.id, st.item)}
      </div>
      <h3 class="social__title"><i class="fa-regular fa-comment"></i> Comments <span class="social__count">${count}</span></h3>
      ${u ? `<form class="cmt-form" novalidate>
          <textarea class="cmt-form__input" maxlength="500" rows="2" placeholder="Add a comment as @${esc(u.handle)}…"></textarea>
          <div class="cmt-form__row"><span class="cmt-form__left">500</span><button type="submit" class="cmt-form__send">Post</button></div>
        </form>`
        : `<button type="button" class="social__signin" data-act="signin">${'<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'} Sign in with X to comment, like or dislike</button>`}
      <ul class="cmt-list">${st.comments.map(commentHtml).join('') || '<li class="cmt-empty">No comments yet. Be the first!</li>'}</ul>
      <p class="social__rules">Be civil. No hate, harassment, spam or illegal content. See the <a href="/tos">Terms</a>.</p>`;

    const ta = root.querySelector('.cmt-form__input');
    if (ta) {
      const left = root.querySelector('.cmt-form__left');
      const upd = () => { left.textContent = 500 - [...ta.value].length; sessionStorage.setItem(draftKey, ta.value); };
      ta.value = sessionStorage.getItem(draftKey) || '';
      upd();
      ta.addEventListener('input', upd);
      root.querySelector('.cmt-form').addEventListener('submit', async e => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return toast(ERR.empty);
        const btn = root.querySelector('.cmt-form__send');
        btn.disabled = true;
        const r = await post('/api/comments', { type: st.type, id: st.id, body: text });
        btn.disabled = false;
        if (r.status === 401) return promptSignIn(st.type, st.id, 'comment');
        if (!r.ok) return toast(ERR[r.data.error] || 'Comment could not be posted.');
        sessionStorage.removeItem(draftKey);
        st.comments.push(r.data.comment);
        render(root, st);
        toast('Comment posted 💬');
      });
    }
  }

  async function handleClick(root, st, e) {
    const signin = e.target.closest('[data-act="signin"]');
    if (signin) { e.preventDefault(); return promptSignIn(st.type, st.id, 'comment'); }

    const rb = e.target.closest('.react-btn');
    if (rb) {
      e.preventDefault(); e.stopPropagation();
      const bar = rb.closest('.react-bar');
      const kind = bar.dataset.kind, id = bar.dataset.id;
      if (!window.currentUser) return promptSignIn(st.type, st.id, 'like or dislike');
      const target = kind === 'comment' ? st.comments.find(c => String(c.id) === id) : st.item;
      const v = Number(rb.dataset.v);
      const value = target.mine === v ? 0 : v;           // tap again to undo
      bar.querySelectorAll('button').forEach(b => b.disabled = true);
      const r = await post('/api/react', { type: kind, id, value });
      if (r.status === 401) return promptSignIn(st.type, st.id, 'like or dislike');
      if (!r.ok) { toast(ERR[r.data.error] || 'Could not save that.'); }
      else { target.likes = r.data.likes; target.dislikes = r.data.dislikes; target.mine = r.data.mine; }
      return render(root, st);
    }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    e.preventDefault();
    const li = act.closest('.cmt');
    const cid = Number(li && li.dataset.cid);
    if (act.dataset.act === 'delete') {
      if (!confirm('Delete your comment? This cannot be undone.')) return;
      const r = await post('/api/comment-delete', { id: cid });
      if (!r.ok) return toast(ERR[r.data.error] || 'Could not delete.');
      st.comments = st.comments.filter(c => c.id !== cid);
      render(root, st);
      toast('Comment deleted.');
    } else if (act.dataset.act === 'report') {
      if (!window.currentUser) return promptSignIn(st.type, st.id, 'report comments');
      const reason = prompt('Report this comment? Optional: tell us why.', '');
      if (reason === null) return;
      const r = await post('/api/report', { id: cid, reason });
      if (r.status === 401) return promptSignIn(st.type, st.id, 'report comments');
      if (!r.ok) return toast(ERR[r.data.error] || 'Could not report.');
      if (r.data.hidden) { st.comments = st.comments.filter(c => c.id !== cid); render(root, st); }
      toast(r.data.already ? 'You already reported this.' : 'Thanks, reported. 🚩');
    }
  }

  let seq = 0;
  async function mount(root, type, id) {
    if (!root) return;
    const my = ++seq;
    root.innerHTML = '<div class="social__loading">Loading comments…</div>';
    if (window.loadAuthPromise) await window.loadAuthPromise();
    let data;
    try {
      const res = await fetch(`/api/comments?type=${type}&id=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
    } catch (e) {
      if (my === seq) root.innerHTML = '<div class="social__loading">Comments are unavailable right now.</div>';
      return;
    }
    if (my !== seq) return;                          // user already moved to another item
    const st = { type, id: String(id), item: data.item, comments: data.comments };
    root.onclick = e => handleClick(root, st, e);
    render(root, st);
  }

  // ---- meme bottom sheet ----
  function ensureSheet() {
    let sheet = document.getElementById('social-sheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'social-sheet';
    sheet.className = 'social-sheet';
    sheet.innerHTML = `<div class="social-sheet__panel" role="dialog" aria-label="Comments">
        <button type="button" class="social-sheet__close" aria-label="Close comments">✕</button>
        <div class="social social--sheet" id="social-sheet-body"></div></div>`;
    sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('.social-sheet__close')) closeSheet(); });
    document.body.appendChild(sheet);
    return sheet;
  }
  function openSheet(type, id) {
    const sheet = ensureSheet();
    sheet.classList.add('social-sheet--open');
    mount(document.getElementById('social-sheet-body'), type, id);
  }
  function closeSheet() {
    const sheet = document.getElementById('social-sheet');
    if (sheet) sheet.classList.remove('social-sheet--open');
  }

  window.Social = { mount, openSheet, closeSheet };
  window.openMemeComments = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (window.currentMemeId) openSheet('meme', String(window.currentMemeId));
  };

  // Hook into the existing modal openers without rewriting them.
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__social) return;
    const w = function (...args) { const r = orig.apply(this, args); try { after(...args); } catch (e) { console.warn(e); } return r; };
    w.__social = true;
    window[name] = w;
  }
  function install() {
    wrap('openBattleModal', id => mount(document.getElementById('battle-social'), 'battle', String(id)));
    wrap('openMemeModal', id => {
      closeSheet();
      const pending = sessionStorage.getItem('gvh_open_comments');
      if (pending === `meme:${id}`) { sessionStorage.removeItem('gvh_open_comments'); openSheet('meme', String(id)); }
    });
    wrap('closeMemeModal', closeSheet);
  }
  install();
  document.addEventListener('DOMContentLoaded', install);
})();
