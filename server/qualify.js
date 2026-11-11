// Branch qualification and the single-vs-multiple display decision.
// Pure functions: no X API, no D1. The fetch worker (workers/fetch/src/branches.js) supplies tweets.
// Rules: public/QUALIFICATION.md in the approved mockup, summarized in docs/BRANCHES.md.
import { turnText } from './v2.js';

export const GROK_ID = '1720665183188922368';
export const POST_USD = 0.005;
export const MAX_BRANCHES = 6;
export const MAX_DEPTH = 12;
export const MAX_AI = 6;
// One conversation search is sized to fit the $0.60 per-add ceiling after the root lookup.
export const MAX_SEARCH_RESULTS = 80;

const PUSH = /\b(but|so|wrong|false|actually|you said|obtuse|evidence|no,|rare because)\b/i;
const CRUDE = /\b(ass|asses|shit|fuck|fucking|fucked|piss|dick|cock|pussy|cum|anal|boobs|tits|horny|porn|nude|naked)\b/i;
const INSULT = /\b(retard(?:ed)?|dumbass|idiot|idiots|moron|imbecile|stupid|ignorant|trash|stfu)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

export function isGrok(t, grokId = GROK_ID) {
  if (!t) return false;
  return t.author_id === grokId || t.is_grok === 1 || t.is_grok === true || String(t.author_handle || '').toLowerCase() === 'grok';
}

// The opening post of a conversation is the one whose id is the conversation id.
// A later post (any reply) is not: that add keeps today's single-chain build.
export function isOpeningTweet(t) {
  if (!t) return false;
  const id = String(t.tweet_id || t.id || '');
  const conv = t.conversation_id ? String(t.conversation_id) : '';
  if (id && conv && id === conv) return true;
  if (!conv && id && !t.parent) return true;
  return false;
}

export function addMode(t) { return isOpeningTweet(t) ? 'branches' : 'single'; }

// How many posts to ask for in the one conversation search, given what this add has already spent.
// Estimate matches xGet: max_results * 1.4 * $0.005 (posts plus a cushion for included users).
export function searchPageSize(runCap, spent = 0, { reserve = 0.05, max = MAX_SEARCH_RESULTS } = {}) {
  if (runCap == null) return max;
  const left = Number(runCap) - Number(spent || 0) - reserve;
  if (!(left > 0)) return 0;
  return Math.max(0, Math.min(max, Math.floor(left / (POST_USD * 1.4))));
}

export function openingReadPlan() {
  return { mode: 'branches', searches: 1, contextLookups: 1, maxAiCalls: MAX_AI, maxBranches: MAX_BRANCHES, maxDepth: MAX_DEPTH };
}

// Leading @handles collapse to a single visible @grok when the reply prefix contained @grok.
// "@alice @grok @grok hello" -> "@grok hello". Body mentions are left alone.
export function visibleGrokText(raw) {
  let s = String(raw || '');
  s = s.replace(/(\s*https:\/\/t\.co\/\w+)+$/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const m = s.match(/^(?:@[A-Za-z0-9_]+\s*)+/);
  if (m) {
    const handles = m[0].trim().split(/\s+/);
    const rest = s.slice(m[0].length);
    const had = handles.some(h => /^@grok$/i.test(h));
    s = (had ? '@grok ' : '') + rest;
  }
  return s.trim();
}

export function calledGrok(text, grokAuthor = false) {
  if (grokAuthor) return false;
  return /(?:^|[^\w@])@grok\b/i.test(String(text || ''));
}

export function storeText(w, mode) {
  const raw = w?.raw || w?.text || '';
  if (mode === 'classic') return turnText(raw, w?.media);
  const vis = visibleGrokText(raw);
  if (w?.media?.length && /^(@[A-Za-z0-9_]+\s*)*$/.test(vis)) return '';
  return vis;
}

export function countableText(text) {
  return String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/@[A-Za-z0-9_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function countsAsPost(text) {
  const s = countableText(text);
  const chars = [...s].filter(c => !/\s/.test(c));
  if (chars.length < 25) return false;
  const emoji = chars.filter(c => EMOJI.test(c)).length;
  const punct = chars.filter(c => /[\p{P}\p{S}]/u.test(c) && !EMOJI.test(c)).length;
  if (emoji === chars.length) return false;
  if ((emoji + punct) / chars.length > 0.5) return false;
  return true;
}

export function isQuestionOnly(text) {
  const s = countableText(text);
  if (!s.includes('?')) return false;
  return !PUSH.test(s);
}

function trigrams(text) {
  const t = countableText(text).toLowerCase();
  const set = new Set();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}
// True when counted human posts mostly restate each other (goalpost repetition).
export function nearDuplicate(posts) {
  const sets = (posts || []).map(p => trigrams(p.raw || p.text || ''));
  if (sets.length < 2) return false;
  let sum = 0, n = 0;
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { sum += jaccard(sets[i], sets[j]); n++; }
  return n > 0 && sum / n > 0.6;
}

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

export function battleTitle(handles, topic) {
  const base = `Grok vs. ${voteLabel(handles).text}`;
  let t = String(topic || '').replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
  t = t.replace(/^Grok vs\.?\s*/i, '').replace(/^@\S+\s*/, '');
  if (!t) return base.length > 100 ? base.slice(0, 99) + '…' : base;
  let s = `${base}: ${t}`;
  if (s.length > 100) {
    let cut = s.slice(0, 99);
    const sp = cut.lastIndexOf(' ');
    if (sp > base.length + 1) cut = cut.slice(0, sp);
    s = cut.replace(/[\s,:;.\-–—]+$/, '') + '…';
  }
  return s;
}

// 1 public battle (or a legacy post) renders with the existing card. 2+ use layout E.
export function displayMode(publicBattles) {
  const n = Array.isArray(publicBattles) ? publicBattles.filter(Boolean).length : Number(publicBattles) || 0;
  return n >= 2 ? 'branches' : 'classic';
}

// Group feed rows that share a thread. A thread with one row in the list stays a normal post
// (thread_id kept for the caller, no `battles` array). preferId floats a deep-linked battle first.
export function groupFeedPosts(list, { preferId } = {}) {
  const out = [];
  const seen = new Set();
  for (const p of list || []) {
    const tid = p.thread_id == null || p.thread_id === '' ? null : p.thread_id;
    if (tid == null) { out.push(p); continue; }
    if (seen.has(tid)) continue;
    seen.add(tid);
    let mates = list.filter(x => x.thread_id === tid);
    if (preferId != null) {
      const i = mates.findIndex(m => String(m.id) === String(preferId));
      if (i > 0) mates = [mates[i], ...mates.slice(0, i), ...mates.slice(i + 1)];
    }
    if (mates.length < 2) out.push(mates[0]);
    else out.push({ ...mates[0], battles: mates });
  }
  return out;
}

function kidMap(tweets) {
  const kids = new Map();
  for (const t of tweets) {
    const p = t.parent ? String(t.parent) : '';
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(t);
  }
  for (const arr of kids.values()) arr.sort((a, b) => String(a.tweet_id) < String(b.tweet_id) ? -1 : 1);
  return kids;
}

// Alternating human/Grok chains. A fork (two humans answering the same Grok post) is two chains.
// The shared prefix stops at the fork. The opening post itself is never part of a chain.
export function buildChains(tweets, { grokId = GROK_ID, rootId = null, maxDepth = MAX_DEPTH } = {}) {
  const list = (tweets || []).filter(t => t && t.tweet_id != null);
  const kids = kidMap(list);
  const starts = [];
  for (const t of list) {
    if (isGrok(t, grokId)) continue;
    if (rootId != null && String(t.tweet_id) === String(rootId)) continue;
    const replies = (kids.get(String(t.tweet_id)) || []).filter(k => isGrok(k, grokId));
    if (replies.length) starts.push(t);
  }
  const startIds = new Set(starts.map(t => String(t.tweet_id)));
  const byId = new Map(list.map(t => [String(t.tweet_id), t]));
  const continued = new Set();
  for (const h of starts) {
    const parent = byId.get(String(h.parent || ''));
    if (!parent || !isGrok(parent, grokId)) continue;
    const siblings = (kids.get(String(parent.tweet_id)) || []).filter(x => startIds.has(String(x.tweet_id)));
    if (siblings.length === 1) continued.add(String(h.tweet_id));
  }
  const chains = [];
  const seenKey = new Set();
  for (const h of starts) {
    if (continued.has(String(h.tweet_id))) continue;
    const seq = [];
    let cur = h;
    const seen = new Set();
    while (cur && seq.length < maxDepth && !seen.has(String(cur.tweet_id))) {
      seen.add(String(cur.tweet_id));
      const greps = (kids.get(String(cur.tweet_id)) || []).filter(k => isGrok(k, grokId));
      if (!greps.length) break;
      seq.push(cur);
      if (seq.length >= maxDepth) break;
      seq.push(greps[0]);
      if (seq.length >= maxDepth) break;
      const nexts = (kids.get(String(greps[0].tweet_id)) || []).filter(x => startIds.has(String(x.tweet_id)));
      if (nexts.length !== 1) break;
      cur = nexts[0];
    }
    if (seq.length < 2) continue;
    const key = seq.map(t => t.tweet_id).join(',');
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    chains.push(seq.slice(0, maxDepth));
  }
  return chains;
}

export function prefilterChain(chain, { grokId = GROK_ID } = {}) {
  const grokPosts = chain.filter(t => isGrok(t, grokId)).length;
  const counted = [];
  let transitions = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    if (!isGrok(chain[i], grokId) && isGrok(chain[i + 1], grokId) && countsAsPost(chain[i].raw || chain[i].text)) counted.push(chain[i]);
  }
  for (let i = 0; i < chain.length - 2; i++) {
    if (!isGrok(chain[i], grokId) && isGrok(chain[i + 1], grokId) && !isGrok(chain[i + 2], grokId)) transitions++;
  }
  const humans = [];
  for (const t of counted) {
    const h = t.author_handle;
    if (h && h !== '?' && !humans.some(x => x.toLowerCase() === String(h).toLowerCase())) humans.push(h);
  }
  const flags = [];
  for (const t of chain) {
    if (isGrok(t, grokId)) continue;
    const text = t.raw || t.text || '';
    if (CRUDE.test(text) && !flags.includes('crude')) flags.push('crude');
    if (INSULT.test(text) && !flags.includes('insults')) flags.push('insults');
  }
  const base = { counted: counted.length, transitions, grokPosts, humans, flags };
  if (counted.length < 3 || grokPosts < 2 || transitions < 2) return { ...base, keep: false, reason: 'too_short' };
  if (counted.every(t => isQuestionOnly(t.raw || t.text))) return { ...base, keep: false, reason: 'questions_only' };
  if (nearDuplicate(counted)) return { ...base, keep: false, reason: 'near_duplicate' };
  return { ...base, keep: true, reason: null };
}

function reasonText(pre) {
  if (!pre) return 'does not qualify';
  if (pre.reason === 'too_short') return `Fails rule 1: ${pre.counted} debating post(s), ${pre.grokPosts} Grok repl${pre.grokPosts === 1 ? 'y' : 'ies'}, ${pre.transitions} back-and-forth(s). Need at least 3, 2 and 2.`;
  if (pre.reason === 'questions_only') return 'Fails rule 1: every counted post is a neutral question, with no pushback.';
  if (pre.reason === 'near_duplicate') return 'Fails rule 3: counted posts repeat the same point.';
  return pre.reason || 'does not qualify';
}

export function contextFor(chain, byId, { grokId = GROK_ID, rootId = null } = {}) {
  const first = (chain || []).find(t => !isGrok(t, grokId));
  if (!first?.parent) return null;
  const pid = String(first.parent);
  if (rootId != null && pid === String(rootId)) return null;
  const parent = byId.get(pid);
  if (!parent) return { missing: pid };
  if (isGrok(parent, grokId)) return null;
  if (rootId != null && String(parent.tweet_id) === String(rootId)) return null;
  return parent;
}

export function mainGrokAnswer(tweets, rootId, grokId = GROK_ID) {
  return (tweets || []).find(t => isGrok(t, grokId) && String(t.parent || '') === String(rootId)) || null;
}

// Short chains that share the post they reply to can be one group debate.
function bundleShort(failed, grokId) {
  const groups = new Map();
  for (const item of failed) {
    if (item.pre.reason !== 'too_short' || item.pre.counted < 1) continue;
    const key = String(item.chain[0]?.parent || '');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const out = [];
  const used = new Set();
  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    const chain = arr.flatMap(c => c.chain);
    const pre = prefilterChain(chain, { grokId });
    const ids = chain.map(t => String(t.tweet_id));
    if (!pre.keep) continue;
    ids.forEach(id => used.add(id));
    out.push({ chain, pre, grouped: true, anchor: key });
  }
  return { bundled: out, used };
}

export function qualifyConversation(tweets, opts = {}) {
  const grokId = opts.grokId || GROK_ID;
  const rootId = opts.rootId != null ? String(opts.rootId) : null;
  const maxDepth = opts.maxDepth || MAX_DEPTH;
  const byId = new Map((tweets || []).filter(t => t?.tweet_id != null).map(t => [String(t.tweet_id), t]));
  const chains = buildChains(tweets, { grokId, rootId, maxDepth });
  const judged = chains.map(chain => ({ chain, pre: prefilterChain(chain, { grokId }) }));
  const passed = [];
  const failed = [];
  for (const j of judged) (j.pre.keep ? passed : failed).push(j);
  const { bundled, used } = bundleShort(failed, grokId);
  for (const b of bundled) passed.push(b);
  passed.sort((a, b) => b.pre.counted - a.pre.counted || b.chain.length - a.chain.length);
  const cap = opts.maxBranches || MAX_BRANCHES;
  const kept = passed.slice(0, cap);
  const overflow = passed.slice(cap);
  const candidates = kept.map(c => {
    const ctx = contextFor(c.chain, byId, { grokId, rootId });
    return { ...c, context: ctx && !ctx.missing ? ctx : null, missingParent: ctx?.missing || null };
  });
  const rejects = [];
  for (const f of failed) {
    if (f.chain.every(t => used.has(String(t.tweet_id)))) continue;
    rejects.push({ title: battleTitle(f.pre.humans, ''), reason: reasonText(f.pre), score: null, handles: f.pre.humans.join(',') });
  }
  for (const o of overflow) rejects.push({ title: battleTitle(o.pre.humans, ''), reason: 'Over the 6-chain cap for this thread (shorter chains were dropped).', score: null, handles: o.pre.humans.join(',') });
  const missingParents = [...new Set(candidates.map(c => c.missingParent).filter(Boolean))];
  return { candidates, rejects, missingParents };
}

export function parseScoreJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function clipTopic(text) {
  let s = countableText(String(text || '').replace(/\?/g, ''));
  if (s.length > 60) s = s.slice(0, 59).replace(/\s+\S*$/, '');
  return s;
}

export function heuristicScore(candidate) {
  const { pre, chain } = candidate;
  const blob = (chain || []).map(t => t.raw || t.text || '').join('\n');
  const funny = /😂|🤣|💀|😭|\blol\b|\blmao\b|\bjoke\w*|\bfunny\b|\bportal\b/i.test(blob);
  const push = (chain || []).filter(t => !isGrok(t) && PUSH.test(t.raw || t.text || '') && countsAsPost(t.raw || t.text || ''));
  let troll = 'none';
  let score = 4;
  const crude = (pre.flags || []).includes('crude');
  if (crude && !funny && push.length < 3) { troll = 'lowbrow'; score = 3; }
  else if (pre.counted >= 3 && push.length >= 1) {
    troll = funny && crude ? 'funny' : 'none';
    score = funny && crude ? 6 : (pre.counted >= 5 && push.length >= 3 ? 8 : pre.counted >= 4 ? 7 : 6);
  } else if (pre.counted >= 3 && funny) { troll = 'funny'; score = 6; }
  const sample = (push[0] || chain.find(t => !isGrok(t)));
  return {
    score,
    debate_posts: pre.counted,
    disagreement: push.length > 0,
    humans: pre.humans,
    same_line: true,
    troll,
    flags: pre.flags || [],
    kind: troll === 'funny' || funny ? 'funny' : 'informative',
    title: battleTitle(pre.humans, clipTopic(sample?.raw || sample?.text || '')),
    reason: `heuristic: ${pre.counted} counted posts, ${push.length} with pushback${funny ? ', funny' : ''}`,
  };
}

export function applyScoreRules(ai, pre, { grouped = false } = {}) {
  const src = ai || {};
  let score = Number(src.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(10, Math.round(score)));
  let debate = Number(src.debate_posts);
  if (!Number.isFinite(debate)) debate = pre?.counted || 0;
  debate = Math.max(0, Math.min(pre?.counted || 0, debate));
  const troll = ['none', 'contradiction', 'funny', 'lowbrow'].includes(src.troll) ? src.troll : 'none';
  if (debate < 3) score = Math.min(score, 5);
  if (troll === 'lowbrow') score = Math.min(score, 4);
  const flags = [...new Set([...(pre?.flags || []), ...((Array.isArray(src.flags) ? src.flags : []).filter(f => f === 'crude' || f === 'insults'))])];
  if (flags.includes('crude') && (troll === 'funny' || src.kind === 'funny') && !src.disagreement) score = Math.min(score, 7);
  if (grouped && src.same_line === false) score = Math.min(score, 4);
  const known = new Map((pre?.humans || []).map(h => [String(h).toLowerCase(), h]));
  let humans = Array.isArray(src.humans)
    ? src.humans.map(h => known.get(String(h).replace(/^@/, '').toLowerCase())).filter(Boolean)
    : [];
  if (!humans.length) humans = [...(pre?.humans || [])];
  const kind = src.kind === 'funny' || troll === 'funny' ? 'funny' : 'informative';
  let title = String(src.title || '').replace(/\s+/g, ' ').trim();
  if (!/^Grok vs\. @/i.test(title)) title = battleTitle(humans, clipTopic(title));
  if (title.length > 100) title = title.slice(0, 99).replace(/\s+\S*$/, '') + '…';
  const status = score >= 7 ? 'recommended' : score === 6 ? 'borderline' : 'reject';
  return {
    score, debate_posts: debate, disagreement: !!src.disagreement, humans, same_line: src.same_line !== false,
    troll, flags, kind, title, reason: String(src.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    status, borderline: score === 6,
  };
}

export function linearChain(root, chain, byId, grokAnswer) {
  const start = chain?.[0];
  const seen = new Set((chain || []).map(t => String(t.tweet_id)));
  const up = [];
  let p = start && byId?.get(String(start.parent || ''));
  while (p && !seen.has(String(p.tweet_id)) && up.length < 20) {
    up.unshift(p);
    seen.add(String(p.tweet_id));
    if (root && String(p.tweet_id) === String(root.tweet_id)) break;
    p = byId.get(String(p.parent || ''));
  }
  if (root && !seen.has(String(root.tweet_id))) up.unshift(root);
  const seq = [...up, ...(chain || [])];
  if (grokAnswer && !seq.some(t => String(t.tweet_id) === String(grokAnswer.tweet_id))) {
    const ri = root ? seq.findIndex(t => String(t.tweet_id) === String(root.tweet_id)) : -1;
    seq.splice(ri >= 0 ? ri + 1 : 0, 0, grokAnswer);
  }
  const out = [];
  const got = new Set();
  for (const t of seq) {
    const id = String(t.tweet_id);
    if (got.has(id)) continue;
    got.add(id);
    out.push(t);
  }
  return out.slice(0, 40);
}

// What to write for one opening-post add. One keeper is stored as a normal root-to-leaf post.
// Two or more keepers are stored as separate battles (root lives on the thread, not in each chain).
export function planStoredThread(root, tweets, judged, opts = {}) {
  const grokId = opts.grokId || GROK_ID;
  const rootId = String(root?.tweet_id || root?.id || '');
  const byId = new Map((tweets || []).filter(t => t?.tweet_id != null).map(t => [String(t.tweet_id), t]));
  if (root && rootId && !byId.has(rootId)) byId.set(rootId, root);
  const keep = (judged || []).filter(j => j && (j.status === 'recommended' || j.status === 'borderline' || (j.score >= 6 && j.status !== 'reject')));
  const multi = keep.length >= 2;
  const grokAnswer = mainGrokAnswer([...byId.values()], rootId, grokId);
  const battles = [];
  for (const j of keep) {
    const chain = multi ? (j.chain || []).slice(0, opts.maxDepth || MAX_DEPTH) : linearChain(root, j.chain || [], byId, grokAnswer);
    const grok = chain.find(t => isGrok(t, grokId));
    if (!grok) continue;
    const mode = multi ? 'branch' : 'classic';
    const human = (j.humans && j.humans[0]) || chain.find(t => !isGrok(t, grokId))?.author_handle || null;
    battles.push({
      mode,
      grok_tweet_id: String(grok.tweet_id),
      conversation_id: root?.conversation_id || rootId,
      human_handle: human,
      human_x_id: chain.find(t => human && String(t.author_handle || '').toLowerCase() === String(human).toLowerCase())?.author_id || null,
      headline: j.title,
      score: j.score,
      kind: j.kind || 'informative',
      flags: j.flags || [],
      reason: j.reason || '',
      mains: j.humans || (human ? [human] : []),
      borderline: j.score === 6 ? 1 : 0,
      context: multi && j.context && !j.context.missing ? j.context : null,
      tweets: chain.map(w => ({ ...w, text: storeText(w, mode) })),
    });
  }
  return {
    multi, mode: displayMode(battles), battles, grokAnswer: multi ? grokAnswer : null, rootId,
  };
}

// X recent-search (or tweet lookup) JSON -> the row shape qualifyConversation expects.
export function normalizeSearch(json, { grokId = GROK_ID } = {}) {
  const users = Object.fromEntries(((json && json.includes && json.includes.users) || []).map(u => [u.id, u]));
  const tweets = [...((json && json.data) || []), ...((json && json.includes && json.includes.tweets) || [])];
  const out = [];
  const seen = new Set();
  for (const t of tweets) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    const u = users[t.author_id] || {};
    const text = t.note_tweet?.text || t.text || '';
    const parent = (t.referenced_tweets || []).find(x => x.type === 'replied_to');
    out.push({
      tweet_id: String(t.id),
      author_id: t.author_id || null,
      author_handle: u.username || (t.author_id === grokId ? 'grok' : '?'),
      author_name: u.name || null,
      author_avatar: u.profile_image_url || null,
      verified: u.verified ? 1 : 0,
      text, raw: text,
      parent: parent?.id ? String(parent.id) : null,
      conversation_id: t.conversation_id ? String(t.conversation_id) : null,
      media: [],
      created_at: t.created_at ? Math.floor(Date.parse(t.created_at) / 1000) : null,
    });
  }
  return out;
}
