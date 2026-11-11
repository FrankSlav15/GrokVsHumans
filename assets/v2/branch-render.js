// Layout E for a thread with 2+ public battles. One battle never reaches this function:
// the feed keeps the existing card. Full text, no "Show full thread".
// voteLabel is duplicated from server/qualify.js so this file can load in the browser
// (Pages does not publish /server). A test asserts the two copies match.

export function voteLabel(handles) {
  const m = [];
  for (const h of handles || []) {
    const x = String(h || '').replace(/^@/, '').trim();
    if (x && !m.some(y => y.toLowerCase() === x.toLowerCase())) m.push(x);
  }
  if (m.length <= 1) {
    const who = '@' + (m[0] || 'human');
    return { who, plus: '', full: who, text: who };
  }
  if (m.length === 2) {
    const who = '@' + m[0] + ' & @' + m[1];
    return { who, plus: '', full: who, text: who };
  }
  return { who: '@' + m[0], plus: '+' + (m.length - 1), full: m.map(h => '@' + h).join(', '), text: '@' + m[0] + ' +' + (m.length - 1) };
}

const FLAG = { crude: '⚠️ Crude humor', insults: '⚠️ Insults in thread' };

export function renderBranchThread(p, h) {
  const esc = h.esc;
  const battles = p.battles || [];
  const cur = battles.find(b => String(b.id) === String(h.featuredId)) || battles[0];
  const idx = Math.max(0, battles.indexOf(cur));
  const nxt = battles[(idx + 1) % battles.length];
  const rank = h.rank ? `<span class="rank">#${h.rank}</span>` : '';
  const topics = (p.topics || []).map(x => `<button class="topic" data-topic="${esc(x)}">${esc(x)}</button>`).join('');
  const seen = h.isSeen && h.view !== 'hot' ? '<span class="seen-tag" title="You have seen this post">✓ Seen</span>' : '';
  const promo = p.promoted ? `<div class="promo" title="Paid placement until ${esc(p.promoted.until ? new Date(p.promoted.until * 1000).toLocaleString() : '')}"><span class="promo__star" aria-hidden="true">⭐</span> Featured <span class="promo__paid">Paid placement</span></div>` : '';
  const rootBits = [];
  if (p.root) rootBits.push(h.turn({ ...p.root, _branch: true }));
  if (p.grok_answer) rootBits.push(h.turn({ ...p.grok_answer, _branch: true }));
  const map = battles.length >= 3 ? `<section class="map"><h3>🗺️ ${battles.length} battles in this thread</h3><ul class="tree">${battles.map(b => {
    const lab = voteLabel(b.mains || []);
    return `<li><button type="button" class="node${b === cur ? ' on' : ''}" data-act="branch" data-bid="${esc(b.id)}"><img src="${esc((b.tweets && b.tweets.find(t => !t.grok)?.avatar) || '')}" alt=""><b>vs. ${esc(lab.text)}</b><small>${(b.tweets || []).length} posts</small></button></li>`;
  }).join('')}</ul></section>` : '';
  const rest = battles.filter(b => b !== cur);
  const more = rest.length ? `<div class="sec">More battles from this thread (${rest.length})</div>` + rest.map(b => {
    const voted = b.mine && b.mine.vote ? ' · voted' : '';
    const av = (b.tweets || []).find(t => !t.grok)?.avatar || '';
    return `<button type="button" class="mini" data-act="branch" data-bid="${esc(b.id)}" data-top><img src="${esc(av)}" alt=""><span><b>${esc(b.headline || '')}</b><small>${esc(b.kind || 'battle')} · ${(b.tweets || []).length} posts${voted}</small></span></button>`;
  }).join('') : '';
  return `<article class="post post--branches${p.promoted ? ' post--promo' : ''}${h.isSeen ? ' is-seen' : ''}" data-id="${esc(p.id)}" id="p${esc(p.id)}">
    ${promo}
    <div class="post__top">${rank}${p.featured ? '<span class="rank">★</span>' : ''}${topics}${seen}<span class="post__time">${esc(h.ago(p.created_at))}</span></div>
    <section class="branch-root"><div class="post__top"><span class="topic"><span class="pe">🧵</span> Where it started</span></div>
      <h2 class="post__title">${esc(p.root_title || p.headline || 'Thread')}</h2>
      <div class="ex">${rootBits.join('')}</div></section>
    ${map}
    <div class="sec">⚔️ Featured battle</div>
    ${battleBlock(cur, h, nxt)}
    ${more}
  </article>`;
}

function battleBlock(b, h, nxt) {
  const esc = h.esc;
  const kind = b.kind === 'funny'
    ? '<span class="topic"><span class="pe">😂</span> Funny</span>'
    : '<span class="topic"><span class="pe">📚</span> Informative</span>';
  const flags = (b.flags || []).map(f => `<span class="flag">${esc(FLAG[f] || f)}</span>`).join('');
  const ctx = b.context ? `<div class="ctxlbl">↩ Replying to <a href="https://x.com/${encodeURIComponent(b.context.handle || 'i')}/status/${encodeURIComponent(b.context.id)}" target="_blank" rel="noopener noreferrer">@${esc(b.context.handle)}</a> · context, not part of the battle</div>${h.turn({ ...b.context, _branch: true, _ctx: true })}<div class="ctxsep"></div>` : '';
  const tweets = (b.tweets || []).map(t => h.turn({ ...t, _branch: true })).join('');
  const lab = voteLabel(b.mains && b.mains.length ? b.mains : []);
  const g = b.votes?.grok || 0, hum = b.votes?.human || 0, tot = g + hum, gp = tot ? Math.round(g / tot * 100) : 50;
  const plus = lab.plus ? `<span class="v-plus">${esc(lab.plus)}</span>` : '';
  const crew = (b.mains || []).length > 1 ? `<div class="crew"><b>Humans (${b.mains.length}), all credited:</b> ${b.mains.map(x => `<a href="https://x.com/${encodeURIComponent(x)}" target="_blank" rel="noopener noreferrer">@${esc(x)}</a>`).join(' · ')}</div>` : '';
  const mineG = b.mine?.vote === 'grok' ? ' is-mine' : '';
  const mineH = b.mine?.vote === 'human' ? ' is-mine' : '';
  const like = b.mine?.react === 1 ? ' is-like' : '';
  const dislike = b.mine?.react === -1 ? ' is-dislike' : '';
  const last = (b.tweets || [])[b.tweets.length - 1];
  const xurl = last ? 'https://x.com/i/status/' + last.id : (b.url || '#');
  const next = nxt ? `<button type="button" class="nextb" data-act="branch" data-bid="${esc(nxt.id)}" data-top>Next battle: vs. ${esc(voteLabel(nxt.mains || []).text)} →</button>` : '';
  return `<section class="branch" data-battle="${esc(b.id)}">
    <div class="post__top">${kind}${flags}<span class="post__time">${(b.tweets || []).length} posts</span></div>
    <h2 class="post__title">${esc(b.headline || 'Grok vs. a human')}</h2>
    <div class="ex">${ctx}${tweets}</div>
    <div class="vote">
      <button type="button" class="v-grok${mineG}" data-act="vote" data-v="grok">🤖 Grok <span class="n">${g}</span></button>
      <button type="button" class="v-human${mineH}" data-act="vote" data-v="human" title="Vote Humans: ${esc(lab.full)}" aria-label="Vote for the human side: ${esc(lab.full)}">🧑 <span class="v-who">${esc(lab.who)}</span>${plus} <span class="n">${hum}</span></button>
    </div>
    ${crew}
    <div class="vote__pct" title="${gp}% Grok"><span style="width:${gp}%"></span></div>
    <div class="acts">
      <button type="button" class="act${like}" data-act="react" data-v="1" aria-label="Like"><i class="fa-solid fa-thumbs-up"></i>${b.likes || 0}</button>
      <button type="button" class="act${dislike}" data-act="react" data-v="-1" aria-label="Dislike"><i class="fa-solid fa-thumbs-down"></i>${b.dislikes || 0}</button>
      <button type="button" class="act" data-act="comments" aria-label="Comments"><i class="fa-regular fa-comment"></i>${b.comments || 0}</button>
      <button type="button" class="act act--feat" data-act="feature" aria-label="Feature this battle"><i class="fa-solid fa-star"></i></button>
      <button type="button" class="act" data-act="share" aria-label="Share"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
    </div>
    <a class="xlink" href="${esc(xurl)}" target="_blank" rel="noopener noreferrer">${h.xSvg || ''} View thread on X</a>
    ${next}
  </section>`;
}
