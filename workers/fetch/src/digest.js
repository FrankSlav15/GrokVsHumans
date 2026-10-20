// Daily moderation digest: last 24h of auto-hidden, report-hidden and flagged comments.
// Stored in mod_digests every run; emailed (send_email binding DIGEST_EMAIL) only when there is something to report.
import { EmailMessage } from 'cloudflare:email';

const CAT = { threat: 'Threat / incitement', doxxing: 'Doxxing', minors_sexual: 'Minors (sexual)', spam: 'Spam' };
export const chicagoHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(d));
const chicagoDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);

export async function digest(env, { send = true, force = false } = {}) {
  const t = Math.floor(Date.now() / 1000), day = chicagoDay();
  const prev = await env.DB.prepare('SELECT emailed_at FROM mod_digests WHERE day = ?1').bind(day).first();
  if (prev?.emailed_at && !force) return { day, skipped: 'already sent today' };
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.item_type, c.item_id, c.body, c.status, c.hidden_by, c.mod_state, c.mod_category, c.mod_reason, c.report_count, c.created_at, u.handle
       FROM comments c JOIN users u ON u.x_id = c.x_id
      WHERE c.created_at > ?1 AND (c.status = 'hidden' OR c.mod_state IN ('flagged','error') OR c.report_count > 0)
      ORDER BY c.status = 'hidden' DESC, c.created_at DESC LIMIT 200`).bind(t - 86400).all();
  const hidden = results.filter(r => r.status === 'hidden'), flagged = results.filter(r => r.status !== 'hidden');
  const data = results.map(r => ({ id: r.id, handle: r.handle, item: r.item_type + ' #' + r.item_id, status: r.status, hidden_by: r.hidden_by,
    state: r.mod_state, category: r.mod_category, reason: r.mod_reason, reports: r.report_count, body: r.body.slice(0, 200) }));
  await env.DB.prepare(`INSERT INTO mod_digests (day, created_at, hidden, flagged, data_json) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(day) DO UPDATE SET created_at = ?2, hidden = ?3, flagged = ?4, data_json = ?5`).bind(day, t, hidden.length, flagged.length, JSON.stringify(data)).run();
  const out = { day, hidden: hidden.length, flagged: flagged.length };
  if (!results.length) return { ...out, emailed: false, why: 'nothing to report' };
  if (!send || !env.DIGEST_EMAIL) return { ...out, emailed: false, why: send ? 'no DIGEST_EMAIL binding' : 'dry run' };
  const url = env.REVIEW_URL || 'https://v2-feed.grokvshumans.pages.dev/admin';
  const line = r => `- [${r.status === 'hidden' ? 'HIDDEN' + (r.hidden_by ? ' by ' + r.hidden_by : '') : r.mod_state === 'error' ? 'UNCHECKED' : 'FLAGGED'}] `
    + `${CAT[r.mod_category] || r.mod_category || (r.report_count ? r.report_count + ' reports' : '')} · @${r.handle} on ${r.item_type} #${r.item_id}\n`
    + `  "${r.body.replace(/\s+/g, ' ').slice(0, 160)}"\n` + (r.mod_reason ? `  Why: ${r.mod_reason}\n` : '');
  const text = `Grok vs. Humans moderation digest for the 24 hours before ${new Date().toUTCString()}\n\n`
    + `${hidden.length} hidden · ${flagged.length} flagged (still visible)\n\nReview: ${url}#auto\n\n`
    + (hidden.length ? 'HIDDEN\n' + hidden.map(line).join('') + '\n' : '') + (flagged.length ? 'FLAGGED\n' + flagged.map(line).join('') : '')
    + `\n--\nSent once a day only when there is something to report.\n`;
  const from = env.DIGEST_FROM || 'support@grokvshumans.com', to = env.DIGEST_TO || 'trafrajohn@gmail.com';
  const subj = `GvH moderation: ${hidden.length} hidden, ${flagged.length} flagged`;
  const raw = [`From: Grok vs. Humans <${from}>`, `To: ${to}`, `Subject: ${subj}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <digest-${day}-${t}@grokvshumans.com>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text].join('\r\n');
  try {
    await env.DIGEST_EMAIL.send(new EmailMessage(from, to, raw));
    await env.DB.prepare('UPDATE mod_digests SET emailed_at = ?2, email_error = NULL WHERE day = ?1').bind(day, t).run();
    return { ...out, emailed: true };
  } catch (e) {
    await env.DB.prepare('UPDATE mod_digests SET email_error = ?2 WHERE day = ?1').bind(day, String(e).slice(0, 300)).run();
    return { ...out, emailed: false, error: String(e) };
  }
}
