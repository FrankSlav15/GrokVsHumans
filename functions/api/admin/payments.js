// GET /api/admin/payments            -> JSON list (admins only)
// GET /api/admin/payments?format=csv -> CSV export for bookkeeping (optional from=YYYY-MM-DD&to=YYYY-MM-DD, UTC)
import { json, requireAdmin } from '../../../server/lib.js';

const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? Math.floor(Date.parse(s + 'T00:00:00Z') / 1000) : null;
const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]|^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };

export async function onRequestGet({ request, env }) {
  const [, denied] = await requireAdmin(env, request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams, from = day(q.get('from')) ?? 0, to = (day(q.get('to')) ?? 4e9) + 86400;
  const { results } = await env.DB.prepare(`SELECT p.*, f.code, f.tier, f.state AS feature_state FROM payments p LEFT JOIN feature_requests f ON f.id = p.feature_request_id
      WHERE p.received_at >= ?1 AND p.received_at < ?2 ORDER BY p.received_at`).bind(from, to).all();
  if (q.get('format') !== 'csv') return json({ payments: results.map(r => ({ ...r, raw_json: undefined })) });
  const head = ['date_utc', 'amount', 'currency', 'kofi_transaction_id', 'type', 'kofi_type', 'post_id', 'feature_code', 'feature_tier', 'feature_state', 'from_name', 'message'];
  const lines = [head.join(',')].concat(results.map(r => [new Date(r.received_at * 1000).toISOString(), r.amount.toFixed(2), r.currency, r.kofi_txn_id, r.kind, r.kofi_type,
    r.post_id, r.code, r.tier, r.feature_state, r.from_name, r.message].map(cell).join(',')));
  return new Response(lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="gvh-payments-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
