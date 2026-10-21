// /admin/queue "Add a thread": paste an x.com / twitter.com status URL (any reply in the thread), tap Add.
(() => {
  const box = document.getElementById('qa'); if (!box) return;
  const inp = box.querySelector('input'), btn = box.querySelector('button'), msg = box.querySelector('.qa-msg');
  const say = (t, cls) => { msg.textContent = t; msg.className = 'qa-msg ' + (cls || ''); };
  async function add() {
    const url = inp.value.trim();
    if (!/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/.+\/status(es)?\/\d+/i.test(url)) return say('Paste an x.com or twitter.com status link', 'err');
    btn.disabled = inp.disabled = true; say('Fetching thread from X…');
    let r, d;
    try { r = await fetch('/api/admin/quickadd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }); d = await r.json().catch(() => ({})); }
    catch { d = { error: 'network' }; r = { ok: false }; }
    btn.disabled = inp.disabled = false;
    const cost = d.cost != null ? ' · cost $' + Number(d.cost).toFixed(3) + ' (admin today $' + Number(d.admin_spent_today || 0).toFixed(2) + ' of $' + Number(d.admin_cap || 1).toFixed(2) + ')' : '';
    if (r.ok && d.post_id) {
      inp.value = ''; inp.blur();
      say('Added #' + d.post_id + ': ' + (d.post?.headline || '') + (d.partial ? ' (thread may be incomplete)' : '') + cost, 'ok');
      if (typeof window.load === 'function') { try { await window.load(); } catch {} }
      if (window.openPreview) window.openPreview(Number(d.post_id), [Number(d.post_id)]);
      return;
    }
    const why = { duplicate: 'Already on the site' + (d.post_id ? ' (#' + d.post_id + (d.status ? ', ' + d.status : '') + ')' : ''), admin_cap: 'Admin allowance for today is used up', month_cap: 'Monthly X API cap reached',
      bad_url: 'Not a status link', not_configured: 'Quick-add is not configured (FETCH binding missing)', failed: 'Could not add: ' + (d.result || 'unknown') }[d.error] || ('Failed: ' + (d.error || 'error'));
    say(why + cost, 'err');
    if (d.error === 'duplicate' && d.post_id && window.openPreview) window.openPreview(Number(d.post_id), [Number(d.post_id)]);
  }
  btn.addEventListener('click', add);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
})();
