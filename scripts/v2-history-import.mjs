// Free check of the old battles (public syndication only, no paid X API) and SQL for
// importing the intact ones into gvh-v2 as pending posts with topic 'History'.
// Usage: node scripts/v2-history-import.mjs > /tmp/history.sql
import fs from 'node:fs';
import { syndicationTweet, tweetFromSyndication, suggestTopics } from '../server/v2.js';
const battles = JSON.parse(fs.readFileSync(new URL('../data/battles.json', import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/@\w+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const q = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const out = [], report = [];
for (const k of Object.keys(battles).sort((a, b) => a - b)) {
  const b = battles[k], m = String(b.xLink || '').match(/status\/(\d+)/);
  if (!m) { report.push([k, 'no status id']); continue; }
  const chain = []; let id = m[1];
  while (id && chain.length < 10) { const r = await syndicationTweet(id); await sleep(250); if (!r.tweet) break; const w = tweetFromSyndication(r.tweet); chain.unshift(w); id = w.parent; }
  const tp = (b.threadPosts || []).filter(p => p.text), texts = chain.map(w => norm(w.text));
  const matched = tp.filter(p => { const n = norm(p.text).slice(0, 30); return n.length > 5 && texts.some(t => t.includes(n)); }).length;
  const grokIdx = chain.map(w => w.author_handle.toLowerCase() === 'grok').lastIndexOf(true);
  const human = chain.find(w => w.author_handle.toLowerCase() !== 'grok');
  const ok = chain.length >= 2 && grokIdx >= 0 && human && tp.length && matched / tp.length >= 0.5;
  report.push([k, b.title, `chain ${chain.length}`, `matched ${matched}/${tp.length}`, ok ? 'QUALIFIES' : 'no']);
  if (!ok) continue;
  const g = chain[grokIdx];
  const topics = ['History', ...suggestTopics(chain.map(w => w.text)).filter(t => t !== 'Wild Card' && t !== 'History')].slice(0, 2);
  out.push(`INSERT OR IGNORE INTO posts (grok_tweet_id, conversation_id, human_x_id, human_handle, headline, status, source, x_engagement, tweet_created_at, fetched_at) VALUES (${q(g.tweet_id)}, ${q(g.conversation_id || chain[0].tweet_id)}, ${q(human.author_id)}, ${q(human.author_handle)}, ${q(b.title)}, 'pending', 'history', 0, ${q(g.created_at)}, strftime('%s','now'));`);
  const pid = `(SELECT id FROM posts WHERE grok_tweet_id = ${q(g.tweet_id)})`;
  out.push(`DELETE FROM post_tweets WHERE post_id = ${pid};`);
  chain.forEach((w, i) => out.push(`INSERT INTO post_tweets (post_id, pos, tweet_id, author_id, author_handle, author_name, author_avatar, verified, is_grok, text, media_json, created_at) VALUES (${pid}, ${i}, ${q(w.tweet_id)}, ${q(w.author_id)}, ${q(w.author_handle)}, ${q(w.author_name)}, ${q(w.author_avatar)}, ${w.verified}, ${w.author_handle.toLowerCase() === 'grok' ? 1 : 0}, ${q(w.text)}, ${q(JSON.stringify(w.media))}, ${q(w.created_at)});`));
  for (const t of topics) out.push(`INSERT OR IGNORE INTO post_topics (post_id, topic, suggested) VALUES (${pid}, ${q(t)}, 1);`);
}
console.error(report.map(r => r.join(' | ')).join('\n'));
console.error('qualified:', report.filter(r => r.at(-1) === 'QUALIFIES').length, 'of', Object.keys(battles).length);
console.log(out.join('\n'));
