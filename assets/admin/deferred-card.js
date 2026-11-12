// Cards for deferred admin quick-adds on /admin/featured (Suggestions → Fetching).
// Status text and which buttons to show come from the API (server/deferred.js), so this file
// stays a static module the browser can load (server/ is not deployed).

export const SUGGEST_HELP = {
  new: 'Approve queues the link for the fetch worker. It runs at 8:30 AM and 6:30 PM CST, within the X spend caps. The thread then shows in the approval queue as “suggested by @user”.',
  queued: 'The fetch worker runs at 8:30 AM and 6:30 PM CST. Bookmark imports stay here until you approve them. Previews use the free public post lookup, not the paid X API. Build now uses the admin allowance only when it has room ($1 a day, unused amount rolls over this month, $45 a month, about $0.60 a build). If it does not, the link waits for the next run. A link you already tried to add is built on its own once that allowance allows.',
  fetched: 'Built threads are in the approval queue, or already approved.',
  duplicate: 'These links are already on the site, or already waiting to be built.',
  failed: 'The build did not finish. On a deferred quick-add you can edit the link and try again. Approve queues it for the next run.',
  rejected: 'Rejected links stay here. Approve queues a user suggestion, or puts a deferred quick-add back, for the next run.',
};

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function postBlock(w, label) {
  const who = w.missing
    ? (w.handle ? '@' + esc(w.handle) : 'an earlier post')
    : (w.handle ? '<b>@' + esc(w.handle) + '</b>' + (w.name ? ' · ' + esc(w.name) : '') : esc(w.name || 'Post'));
  const text = w.missing ? 'Couldn’t load this post.' : (String(w.text || '').trim() ? esc(w.text) : '<span class="meta">No text in the free preview.</span>');
  return `<div class="${label === 'This post' ? 'me' : 'ctx'}"><div class="meta">${esc(label)}</div><div class="who">${who}</div><div class="tx">${text}</div></div>`;
}

export function previewBlock(p) {
  if (!p) return '<div class="pvw" aria-live="polite"><div class="meta">Loading preview…</div></div>';
  if (p.error) return '<div class="pvw" aria-live="polite"><div class="meta">Preview didn’t load. </div><button type="button" data-retry>Retry</button></div>';
  if (p.gone) {
    const why = p.reason === 'protected' ? 'private' : 'gone or private';
    return `<div class="pvw" aria-live="polite"><div class="meta">This post looks ${why} on X, so there is nothing to preview.</div></div>`;
  }
  const posts = p.posts || [];
  if (!posts.length) return '<div class="pvw" aria-live="polite"><div class="meta">No preview text.</div></div>';
  const body = posts.map((w, i) => {
    const last = i === posts.length - 1;
    const label = last ? 'This post' : (posts.length === 2 ? 'Replying to' : (i === 0 ? 'Earlier in the thread' : 'Then'));
    return postBlock(w, label);
  }).join('');
  const more = p.more ? '<div class="meta">The thread continues above this. The build still starts from the link below.</div>' : '';
  const note = p.context === false ? '<div class="meta">Reply context isn’t in this free preview.</div>' : '';
  return `<div class="pvw" aria-live="polite">${body}${more}${note}</div>`;
}

export function deferredCard(s, topicNames) {
  const act = s.actions || {};
  const topics = s.topic_list || [];
  const names = topicNames || [];
  const savedTopics = topics.join(',');
  const chips = names.map(t => `<button type="button" data-topic="${esc(t)}" class="${topics.includes(t) ? 'on' : ''}" aria-pressed="${topics.includes(t)}">${esc(t)}</button>`).join('');
  const buttons = [
    act.build ? '<button type="button" class="ok' + (act.approve ? '' : ' full') + '" data-s="build">Build now</button>' : '',
    act.approve ? '<button type="button" class="gold" data-s="approve">Approve</button>' : '',
    act.edit ? '<button type="button" data-edit>Edit</button>' : '',
    act.reject ? '<button type="button" class="danger" data-s="reject">Reject</button>' : '',
  ].filter(Boolean).join('');
  return `<div class="card" data-id="${Number(s.id)}" data-defer="1" data-saved-url="${esc(s.url || '')}" data-saved-title="${esc(s.title || '')}" data-saved-topics="${esc(savedTopics)}">`
    + `<div class="meta"><span>#${Number(s.id)}</span><span>@${esc(s.handle)}${s.banned ? ' (banned)' : ''}</span><span>${esc(s.when || '')}</span><a href="${esc(s.url || '#')}" target="_blank" rel="noopener">open on X</a></div>`
    + `<div class="note df-status">${esc(s.status_label || '')}</div>`
    + (s.title ? `<div class="note">${esc(s.title)}</div>` : '')
    + (topics.length ? `<div class="meta">Topic: ${topics.map(esc).join(', ')}</div>` : '')
    + `<div data-pv>${previewBlock(null)}</div>`
    + `<div class="df-edit" hidden><label for="u${Number(s.id)}">Start from this post</label>`
    + `<input id="u${Number(s.id)}" data-url type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="500" value="${esc(s.url || '')}">`
    + `<p class="meta">Paste a different status link to build from another post in the thread.</p>`
    + `<label for="t${Number(s.id)}">Title <span class="meta">(optional, used when this becomes one post)</span></label>`
    + `<textarea id="t${Number(s.id)}" data-title class="h" rows="2" maxlength="120">${esc(s.title || '')}</textarea>`
    + `<div class="meta">Topics <span>(optional, up to 2 — otherwise picked when it builds)</span></div><div class="tops">${chips}</div>`
    + `<div class="acts"><button type="button" class="ok" data-s="edit">Save</button></div></div>`
    + `<div class="acts">${buttons}</div></div>`;
}
