// "Learn from the admin": a small trait profile built from the posts the admin added by hand (source='manual',
// weight 2) and approved (weight 1). Free: D1 reads only, no X API, no Workers AI. Stored in kv 'learn_profile'.
// Used only to ORDER work (which fetched candidates get expanded first) and to add a few OR-terms to one of the
// two daily searches. It never approves anything; every post still lands in the admin queue as 'pending'.
import { suggestTopics } from '../../../server/v2.js';

const STOP = new Set(('the a an and or but if then of to in on at for with from by is are was were be been being it its this that these those ' +
  'i you he she we they me my your his her our their them us what which who whom whose why how when where do does did done ' +
  'can could would should will shall may might must not no yes so as than too very just about into over under again more most ' +
  'some any all each other such only own same also there here have has had having am get got like one two make made out up ' +
  'grok please tell explain know think say said really now even still well much many way thing things people dont im its thats ' +
  'https www com amp rt via yeah ok okay lol').split(' '));
const GENERIC = new Set('both while case come hand longer ready facts written covered drew fault receive october breaking'.split(' '));
export const words = s => (String(s || '').toLowerCase().replace(/https?:\/\/\S+|@\w+/g, ' ').match(/[a-z][a-z'’]{3,}/g) || [])
  .map(w => w.replace(/['’]s?$/, '')).filter(w => w.length > 3 && !STOP.has(w));

export async function buildProfile(env) {
  const { results: posts } = await env.DB.prepare(`SELECT p.id, p.source, p.x_engagement,
      (SELECT COUNT(*) FROM post_tweets t WHERE t.post_id = p.id) turns,
      (SELECT COUNT(*) FROM post_tweets t WHERE t.post_id = p.id AND t.is_grok = 0) human_turns,
      (SELECT group_concat(t.text, ' ') FROM post_tweets t WHERE t.post_id = p.id AND t.is_grok = 0) htext,
      (SELECT group_concat(topic) FROM post_topics pt WHERE pt.post_id = p.id) topics
    FROM posts p WHERE p.source = 'manual' OR p.status = 'approved' ORDER BY p.id DESC LIMIT 300`).all();
  // Background word frequencies: fetched posts the admin has NOT approved, so the profile keeps words that set
  // the liked posts apart rather than words every Grok thread has.
  const { results: bg } = await env.DB.prepare(`SELECT group_concat(t.text, ' ') htext FROM posts p JOIN post_tweets t ON t.post_id = p.id
    WHERE p.status IN ('pending','skipped') AND p.source = 'fetch' AND t.is_grok = 0 GROUP BY p.id ORDER BY p.id DESC LIMIT 400`).all();
  const df = (rows, wt) => { const m = {}; for (const r of rows) for (const w of new Set(words(r.htext))) m[w] = (m[w] || 0) + wt(r); return m; };
  const W = r => r.source === 'manual' ? 2 : 1;
  const fg = df(posts, W), bgf = df(bg, () => 1);
  const fgN = posts.reduce((a, r) => a + W(r), 0) || 1, bgN = bg.length || 1;
  const keywords = Object.entries(fg).filter(([, n]) => n >= 2)
    .map(([w, n]) => [w, Math.round((n / fgN) / ((bgf[w] || 0) / bgN + 0.02) * 100) / 100, n]).filter(([, l]) => l > 1.5)
    .sort((a, b) => b[1] - a[1]).slice(0, 40);
  const topics = {};
  for (const r of posts) for (const t of String(r.topics || '').split(',').filter(Boolean)) topics[t] = (topics[t] || 0) + W(r);
  for (const t in topics) topics[t] = Math.round(topics[t] / fgN * 100) / 100;     // share of liked posts with this topic
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const htexts = posts.map(r => String(r.htext || ''));
  const profile = {
    built_at: Math.floor(Date.now() / 1000), n_manual: posts.filter(r => r.source === 'manual').length, n_approved: posts.length,
    topics, keywords,
    question_share: Math.round(htexts.filter(t => t.includes('?')).length / (htexts.length || 1) * 100) / 100,
    multi_turn_share: Math.round(posts.filter(r => r.human_turns >= 2).length / (posts.length || 1) * 100) / 100,
    median_turns: med(posts.map(r => r.turns)), median_human_len: med(htexts.map(t => t.length / 1)),
    median_x_engagement: med(posts.map(r => r.x_engagement || 0)),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('learn_profile', ?1)").bind(JSON.stringify(profile)).run();
  return profile;
}

export async function loadProfile(env) {
  const r = await env.DB.prepare("SELECT v FROM kv WHERE k = 'learn_profile'").first().catch(() => null);
  try { return r ? JSON.parse(r.v) : null; } catch { return null; }
}

// 0..30 points: how much a fetched candidate (raw search payload) looks like the admin's picks.
export function likeness(profile, text, annotations = [], { multiTurn = false } = {}) {
  if (!profile || !profile.n_approved) return 0;
  let s = 0;
  const tp = suggestTopics([text], annotations);
  for (const t of tp) s += Math.min(10, (profile.topics?.[t] || 0) * 20);              // topic the admin likes: up to 10
  const kw = new Map(profile.keywords || []), ws = new Set(words(text));
  let k = 0; for (const w of ws) if (kw.has(w)) k += Math.min(3, kw.get(w)); s += Math.min(10, k * 2);   // distinctive words: up to 10
  if (String(text).includes('?')) s += 4 * (profile.question_share || 0);              // question style
  if (multiTurn) s += 4 * (profile.multi_turn_share || 0);                            // back-and-forth
  return Math.min(30, Math.round(s));
}

// A few distinctive words as an OR group for one daily search (same max_results, so same cost).
export function queryTerms(profile, n = 6) {
  const ws = (profile?.keywords || []).filter(([w, , c]) => /^[a-z]+$/.test(w) && c >= 4 && !GENERIC.has(w)).map(([w]) => w).slice(0, n);
  return ws.length >= 3 ? '(' + ws.join(' OR ') + ')' : '';
}
