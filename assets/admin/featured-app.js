// /admin/featured client. Suggestions, paid featured requests, payments ledger.
import { SUGGEST_HELP, deferredCard, esc, previewBlock } from './deferred-card.js';
const CAP_TOAST = { admin_cap: 'admin allowance used up', month_cap: 'monthly cap reached', day_cap: 'daily cap reached' };

const TABS = [['suggestions', '💡 Suggestions'], ['features', '⭐ Featured'], ['payments', '💵 Payments']];
const SSUB = [['new', 'New'], ['queued', 'Fetching'], ['fetched', 'Fetched'], ['duplicate', 'Duplicate'], ['failed', 'Failed'], ['rejected', 'Rejected']];
const FSUB = [['all', 'All'], ['pending_payment', 'Pending payment'], ['paid', 'Paid'], ['awaiting_approval', 'Awaiting approval'], ['active', 'Active'], ['expired', 'Expired'], ['refund_needed', 'Refund needed']];
const LBL = Object.fromEntries(FSUB.concat([['refunded', 'Refunded'], ['cancelled', 'Cancelled'], ['rejected', 'Rejected']]));

const $ = s => document.querySelector(s);
const when = s => s ? new Date(s * 1000).toLocaleString() : '';
let [tab, sub] = (location.hash.slice(1) || 'suggestions').split(':');
let topicNames = [];

function toast(m) {
  const t = $('#toast'); t.textContent = m; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3200);
}
function bar() { $('#tabs').innerHTML = TABS.map(([k, l]) => '<button type="button" data-tab="' + k + '" class="' + (k === tab ? 'on' : '') + '">' + l + '</button>').join(''); }
function subs(list, counts) {
  if (!sub) sub = list[0][0];
  $('#sub').innerHTML = list.map(([k, l]) => '<button type="button" data-sub="' + k + '" class="' + (k === sub ? 'on' : '') + '">' + l + (counts && counts[k] != null ? ' (' + counts[k] + ')' : '') + '</button>').join('');
}
async function send(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    d._ok = r.ok;
    return d;
  } catch { toast('Failed: network'); return null; }
}
async function post(url, body) {
  const d = await send(url, body);
  if (!d || !d._ok) { toast('Failed: ' + (d?.error || 'error')); return false; }
  toast(body.action + ' ✓');
  load();
  return true;
}

function userCard(s) {
  return '<div class="card" data-id="' + s.id + '"><div class="meta"><span>#' + s.id + '</span><span>@' + esc(s.handle) + (s.banned ? ' (banned)' : '') + '</span><span>' + when(s.created_at) + '</span><a href="' + esc(s.url) + '" target="_blank" rel="noopener">open on X</a>' + (s.post_id ? '<a href="/admin/queue#' + (s.post_status === 'approved' ? 'approved' : 'pending') + '">post #' + s.post_id + ' (' + esc(s.post_status) + ')</a>' : '') + '</div>'
    + (s.note ? '<div class="note">“' + esc(s.note) + '”</div>' : '') + (s.feature ? '<div class="meta">⭐ feature request ' + esc(s.feature) + '</div>' : '') + (s.result ? '<div class="meta">result: ' + esc(s.result) + '</div>' : '')
    + '<div class="acts">' + (['new', 'failed', 'rejected'].includes(s.state) ? '<button type="button" class="ok" data-s="approve">✓ Approve &amp; fetch</button>' : '') + (s.state !== 'rejected' && s.state !== 'fetched' ? '<button type="button" class="danger" data-s="reject">Reject</button>' : '') + '</div></div>';
}

function editBody(card) {
  const url = card.querySelector('[data-url]').value.trim();
  const title = card.querySelector('[data-title]').value;
  const topics = [...card.querySelectorAll('[data-topic].on')].map(b => b.dataset.topic);
  const key = JSON.stringify({ url, title: title.replace(/\s+/g, ' ').trim(), topics });
  const saved = JSON.stringify({
    url: card.dataset.savedUrl || '',
    title: (card.dataset.savedTitle || '').replace(/\s+/g, ' ').trim(),
    topics: (card.dataset.savedTopics || '').split(',').filter(Boolean),
  });
  return { url, title, topics, dirty: key !== saved };
}
async function saveEdit(card, { reload = true } = {}) {
  const id = Number(card.dataset.id);
  const body = editBody(card);
  const d = await send('/api/admin/suggestions', { id, action: 'edit', url: body.url, title: body.title, topics: body.topics });
  if (!d || !d._ok) { toast('Failed: ' + (d?.error || 'error')); return false; }
  if (reload) { toast('Saved'); load(); }
  return true;
}
async function buildNow(card) {
  if (!confirm('Build this thread now? It uses the admin X allowance (up to about $0.60) when there is room. If the allowance or the monthly cap is used up, it waits for the next run instead.')) return;
  if (card.querySelector('.df-edit') && !card.querySelector('.df-edit').hidden && editBody(card).dirty) {
    if (!await saveEdit(card, { reload: false })) return;
  }
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  const d = await send('/api/admin/suggestions', { id: Number(card.dataset.id), action: 'build' });
  if (!d) { card.querySelectorAll('button').forEach(b => b.disabled = false); return; }
  if (d.ok) toast('Built. Post #' + d.post_id + ' is in the approval queue.' + (d.partial ? ' The thread may be incomplete.' : '') + (d.title_applied === false && d.battles > 1 ? ' Several battles were created, so the title you set was not applied.' : ''));
  else if (d.deferred) toast('No room right now (' + (CAP_TOAST[d.reason] || d.reason || 'cap') + '). Approved for the next run (8:30 AM or 6:30 PM CST).');
  else if (d.error === 'duplicate') toast('That thread is already on the site.');
  else if (d.error === 'busy') toast('This one is already building.');
  else toast('Not built: ' + (d.result || d.error || 'failed'));
  load();
}
async function approveDeferred(card) {
  if (card.querySelector('.df-edit') && !card.querySelector('.df-edit').hidden && editBody(card).dirty) {
    if (!await saveEdit(card, { reload: false })) return;
  }
  const d = await send('/api/admin/suggestions', { id: Number(card.dataset.id), action: 'approve' });
  if (!d || !d._ok) { toast('Failed: ' + (d?.error || 'error')); return; }
  toast('Approved for the next run');
  load();
}

async function loadPreview(card, fresh) {
  const id = card.dataset.id;
  const slot = card.querySelector('[data-pv]');
  if (!slot) return;
  slot.innerHTML = previewBlock(null);
  try {
    const r = await fetch('/api/admin/suggestions?preview=' + id + (fresh ? '&fresh=1' : ''), { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (card.dataset.id !== id) return;
    slot.innerHTML = r.ok ? previewBlock(d.preview) : previewBlock({ error: d.error || r.status });
  } catch {
    if (card.isConnected) slot.innerHTML = previewBlock({ error: 'network' });
  }
}
function fillPreviews() {
  const cards = [...document.querySelectorAll('[data-defer]')];
  let i = 0;
  const worker = async () => {
    while (i < cards.length) {
      const card = cards[i++];
      await loadPreview(card, false);
    }
  };
  worker(); worker();
}
function toggleTopic(btn) {
  const box = btn.closest('.tops');
  if (btn.classList.contains('on')) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); return; }
  const on = [...box.querySelectorAll('.on')];
  if (on.length >= 2) { on[0].classList.remove('on'); on[0].setAttribute('aria-pressed', 'false'); }
  btn.classList.add('on');
  btn.setAttribute('aria-pressed', 'true');
}

async function load() {
  bar();
  const L = $('#list');
  L.innerHTML = '<div class="empty">Loading…</div>';
  if (tab === 'suggestions') {
    const r = await fetch('/api/admin/suggestions?state=' + (sub || 'new'), { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) { L.innerHTML = '<div class="empty">Error ' + r.status + '</div>'; return; }
    topicNames = d.topics || [];
    subs(SSUB, d.counts);
    $('#stats').textContent = SUGGEST_HELP[sub || 'new'] || SUGGEST_HELP.new;
    L.innerHTML = d.suggestions.length ? d.suggestions.map(s => s.deferred ? deferredCard({ ...s, when: when(s.created_at) }, topicNames) : userCard(s)).join('') : '<div class="empty">Nothing here.</div>';
    fillPreviews();
  } else if (tab === 'features') {
    const r = await fetch('/api/admin/features?status=' + (sub || 'all'), { cache: 'no-store' });
    const d = await r.json();
    subs(FSUB, Object.assign({ all: Object.values(d.counts).reduce((a, b) => a + b, 0) }, d.counts));
    $('#stats').textContent = 'Paid placements need your approval. Rejecting a paid request marks it "refund needed": refund in Ko-fi/PayPal, then tap "Refunded".';
    L.innerHTML = d.features.length ? d.features.map(f => '<div class="card" data-id="' + f.id + '"><div class="meta"><span class="pill s-' + f.status + '">' + esc(LBL[f.status] || f.status) + '</span><b style="color:#fff">' + esc(f.code) + '</b><span>@' + esc(f.handle) + '</span><span>' + esc(f.tier) + ' · $' + f.amount_usd + ' · paid $' + (f.paid_usd || 0) + '</span>' + (f.pin_topics ? '<span>+ topics</span>' : '') + '</div>'
      + '<div class="note">' + (f.post_id ? '<a href="/#p' + f.post_id + '" target="_blank">#' + f.post_id + '</a> ' + esc(f.headline || '') + ' (' + esc(f.post_status) + ')' : 'Suggestion: <a href="' + esc(f.suggestion_url || '#') + '" target="_blank" rel="noopener">' + esc(f.suggestion_url || '?') + '</a> (' + esc(f.suggestion_state || '') + ')') + '</div>'
      + '<div class="meta"><span>requested ' + when(f.created_at) + '</span>' + (f.paid_at ? '<span>paid ' + when(f.paid_at) + '</span>' : '') + (f.ends_at ? '<span>' + (f.status === 'active' ? 'until ' : 'ended ') + when(f.ends_at) + '</span>' : '') + (f.admin_note ? '<span style="color:#fcd34d">' + esc(f.admin_note) + '</span>' : '') + '</div>'
      + '<div class="acts">' + (f.status === 'awaiting_approval' ? '<button type="button" class="ok" data-f="approve">✓ Approve feature</button>' : '') + (['pending_payment', 'paid', 'awaiting_approval', 'active'].includes(f.status) ? '<button type="button" class="danger" data-f="reject">Reject</button>' : '') + (f.status === 'active' ? '<button type="button" data-f="expire">End now</button>' : '') + (f.status === 'refund_needed' ? '<button type="button" class="gold" data-f="refunded">Refunded</button>' : '') + '</div></div>').join('') : '<div class="empty">Nothing here.</div>';
  } else {
    $('#sub').innerHTML = '<a class="btn gold" href="/api/admin/payments?format=csv">⬇ Export CSV</a>';
    const r = await fetch('/api/admin/payments', { cache: 'no-store' });
    const d = await r.json();
    const tot = d.payments.reduce((a, p) => (a[p.currency] = (a[p.currency] || 0) + p.amount, a), {});
    $('#stats').textContent = d.payments.length + ' payments · ' + Object.entries(tot).map(([c, v]) => v.toFixed(2) + ' ' + c).join(' · ');
    L.innerHTML = d.payments.length ? '<div class="card"><table><tr><th>Date</th><th>Amount</th><th>Type</th><th>Post / code</th><th>From</th></tr>' + d.payments.slice().reverse().map(p => '<tr><td>' + when(p.received_at) + '</td><td>' + p.amount.toFixed(2) + ' ' + esc(p.currency) + '</td><td>' + esc(p.kind) + '</td><td>' + (p.post_id ? '#' + p.post_id + ' ' : '') + esc(p.code || '') + '</td><td>' + esc(p.from_name || '') + '<br><small style="color:#71717a">' + esc(p.kofi_txn_id) + '</small></td></tr>').join('') + '</table></div>' : '<div class="empty">No payments yet.</div>';
  }
}

document.addEventListener('click', e => {
  const topic = e.target.closest('[data-topic]');
  if (topic) { toggleTopic(topic); return; }
  const retry = e.target.closest('[data-retry]');
  if (retry) { const card = retry.closest('.card'); if (card) loadPreview(card, true); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed && !e.target.closest('[data-s]')) {
    const box = ed.closest('.card').querySelector('.df-edit');
    box.hidden = !box.hidden;
    ed.textContent = box.hidden ? 'Edit' : 'Close';
    if (!box.hidden) box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; sub = null; location.hash = tab; return load(); }
  const s = e.target.closest('[data-sub]');
  if (s) { sub = s.dataset.sub; location.hash = tab + ':' + sub; return load(); }
  const a = e.target.closest('[data-s],[data-f]');
  if (!a) return;
  const card = a.closest('.card');
  const id = Number(card.dataset.id);
  if (a.dataset.s === 'build') return buildNow(card);
  if (a.dataset.s === 'edit') return saveEdit(card);
  if (a.dataset.s === 'approve' && card.dataset.defer) return approveDeferred(card);
  if (a.dataset.s) {
    if (a.dataset.s === 'reject' && !confirm('Reject this suggestion?')) return;
    return post('/api/admin/suggestions', { id, action: a.dataset.s });
  }
  const act = a.dataset.f;
  if (act === 'reject' && !confirm('Reject this featured request? If it was paid it will be marked "refund needed".')) return;
  post('/api/admin/features', { id, action: act, note: act === 'reject' ? prompt('Reason (optional, shown only here)') || undefined : undefined });
});
addEventListener('hashchange', () => {
  const [t, u] = (location.hash.slice(1) || 'suggestions').split(':');
  if (t !== tab || u !== sub) { tab = t; sub = u; load(); }
});
load();
