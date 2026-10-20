// POST /api/kofi  - Ko-fi webhook (Ko-fi > Settings > API > Webhook URL).
// Ko-fi sends application/x-www-form-urlencoded with one field "data" holding JSON, including verification_token.
// Every payment is logged to `payments`; a GVH-XXXXXX code in the message marks the matching feature request paid.
import { json, now } from '../../server/lib.js';

async function same(a, b) {   // constant-time compare via SHA-256 digests
  const enc = new TextEncoder(), [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
const KIND = { donation: 'donation', subscription: 'subscription', 'shop order': 'shop', commission: 'other' };

export async function onRequestPost({ request, env }) {
  if (!env.KOFI_VERIFICATION_TOKEN) return json({ error: 'not_configured' }, 503);
  let d;
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) { const b = await request.json(); d = typeof b.data === 'string' ? JSON.parse(b.data) : b.data || b; }
    else { const f = await request.formData(); d = JSON.parse(String(f.get('data') || '')); }
  } catch { return json({ error: 'bad_payload' }, 400); }
  if (!d || !(await same(d.verification_token || '', env.KOFI_VERIFICATION_TOKEN))) return json({ error: 'bad_token' }, 401);
  const txn = String(d.kofi_transaction_id || '').slice(0, 100);
  if (!txn) return json({ error: 'no_txn' }, 400);
  const amount = Number(d.amount) || 0, currency = String(d.currency || 'USD').toUpperCase().slice(0, 8), t = now();
  const message = String(d.message || '').slice(0, 500);
  const code = (message.match(/GVH-[A-HJ-NP-Z2-9]{6}/i) || [])[0]?.toUpperCase() || null;
  const fr = code ? await env.DB.prepare('SELECT * FROM feature_requests WHERE code = ?1').bind(code).first() : null;
  const kind = fr ? 'feature' : (KIND[String(d.type || '').toLowerCase()] || 'other');

  const ins = await env.DB.prepare(`INSERT OR IGNORE INTO payments (received_at, kofi_timestamp, amount, currency, kofi_txn_id, kind, kofi_type, from_name, message,
      feature_request_id, post_id, matched_code, raw_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
    .bind(t, String(d.timestamp || '').slice(0, 40), amount, currency, txn, kind, String(d.type || '').slice(0, 40), String(d.from_name || '').slice(0, 100), message,
      fr?.id || null, fr?.post_id || null, code, JSON.stringify({ ...d, verification_token: undefined, email: undefined, shipping: undefined })).run();
  if (!ins.meta.changes) return json({ ok: true, duplicate: true });   // Ko-fi retries: idempotent on transaction id

  if (fr && ['pending_payment', 'paid', 'rejected', 'cancelled'].includes(fr.state)) {
    const paid = Math.round(((fr.paid_usd || 0) + (currency === 'USD' ? amount : 0)) * 100) / 100;
    const full = paid + 1e-9 >= fr.amount_usd;
    const state = fr.state === 'pending_payment' || fr.state === 'cancelled' ? (full ? 'paid' : 'pending_payment') : fr.state;
    const note = currency !== 'USD' ? `paid in ${currency} ${amount}: check manually` : full ? null : `underpaid: ${paid} of ${fr.amount_usd} USD`;
    await env.DB.prepare(`UPDATE feature_requests SET paid_usd = ?2, state = ?3, paid_at = COALESCE(paid_at, ?4), updated_at = ?4,
        refund_needed = CASE WHEN state = 'rejected' THEN 1 ELSE refund_needed END, admin_note = COALESCE(?5, admin_note) WHERE id = ?1`)
      .bind(fr.id, paid, state, t, note).run();
  }
  return json({ ok: true });
}
