// Opening-post branch discovery. One conversation search, then qualify.js, then pending posts.
// A later post never comes through here (suggestionOne keeps buildChain). Nothing is auto-approved.
import { insertPost, suggestTopics } from '../../../server/v2.js';
import {
  GROK_ID, MAX_AI, applyScoreRules, heuristicScore, isGrok, mainGrokAnswer, normalizeSearch,
  openingReadPlan, parseScoreJson, planStoredThread, qualifyConversation, searchPageSize, visibleGrokText,
} from '../../../server/qualify.js';

export { openingReadPlan };

// Cheap model, separate from the title/topic model in index.js (PR #73 retargets that one).
export const QUALIFY_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';

const PROMPT = `You judge whether an X reply chain is a real debate between a human and Grok, for a site where people vote on who won.
Score 0-10 using the rubric. Return only JSON:
{"score":int,"debate_posts":int,"disagreement":bool,"humans":["handle"],"same_line":bool,"troll":"none|contradiction|funny|lowbrow","flags":["crude"|"insults"],"kind":"informative|funny","title":"Grok vs. @name: topic","reason":"<=25 words"}
Rubric: humans are those pushing the SAME line against Grok. debate_posts count only posts that dispute, rebut, or ask a pointed question that exposes a contradiction, each followed by a Grok reply. Neutral questions do not count.
0-2 no debate. 3-4 unfunny low-brow trolling. 5 some pushback but fewer than 3 debate posts. 6-7 at least 3 debate posts with real disagreement, OR contradiction trolling, OR a genuinely funny on-topic bit of at least 3 rounds (crude is ok if it is funny; add the crude flag). 8-10 each human turn adds a new argument and a reader could fairly vote either way.
Hard rules: debate_posts < 3 means score <= 5. troll lowbrow means score <= 4. A crude funny branch with no real argument scores at most 7. same_line false means the humans are not one battle.`;

const now = () => Math.floor(Date.now() / 1000);

function transcript(chain) {
  return (chain || []).slice(0, 12).map(w => {
    const who = isGrok(w) ? 'Grok' : '@' + (w.author_handle || 'human');
    const text = String(w.raw || w.text || '').replace(/\s+/g, ' ').slice(0, 420);
    return `${who}: ${text}`;
  }).join('\n').slice(0, 6000);
}

export async function judgeCandidate(env, candidate, counter = { n: 0 }) {
  let raw = null;
  if (env?.AI && counter.n < MAX_AI) {
    counter.n += 1;
    try {
      const r = await env.AI.run(QUALIFY_MODEL, {
        max_tokens: 240, temperature: 0,
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: transcript(candidate.chain) }],
      });
      raw = parseScoreJson(r?.response || r?.result || r);
    } catch { raw = null; }
  }
  if (!raw) raw = heuristicScore(candidate);
  return { ...candidate, ...applyScoreRules(raw, candidate.pre, { grouped: !!candidate.grouped }) };
}

function feedTweet(w, text) {
  return {
    id: String(w.tweet_id), handle: w.author_handle, name: w.author_name || null, avatar: w.author_avatar || null,
    verified: !!w.verified, grok: isGrok(w), text: text == null ? visibleGrokText(w.raw || w.text || '') : text,
    media: w.media || [], created_at: w.created_at || null,
  };
}

async function blockedHandles(env) {
  const { results } = await env.DB.prepare('SELECT handle FROM blocked_authors').all();
  return new Set((results || []).map(r => String(r.handle || '').toLowerCase()));
}

async function insertThread(env, root, grokAnswer, source) {
  const rootText = visibleGrokText(root.raw || root.text || '');
  let headline = rootText.replace(/\s+/g, ' ');
  if (headline.length > 140) headline = headline.slice(0, 139).replace(/\s+\S*$/, '') + '…';
  const row = await env.DB.prepare(
    `INSERT INTO threads (root_tweet_id, conversation_id, headline, root_json, grok_answer_json, source, fetched_at, reads_used)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0) RETURNING id`
  ).bind(
    String(root.tweet_id), root.conversation_id || String(root.tweet_id), headline || 'Thread',
    JSON.stringify(feedTweet(root, rootText)),
    grokAnswer ? JSON.stringify(feedTweet(grokAnswer, visibleGrokText(grokAnswer.raw || grokAnswer.text || ''))) : null,
    source || 'manual', now(),
  ).first();
  return row?.id || null;
}

async function insertRejects(env, threadId, rejects) {
  if (!threadId || !rejects?.length) return;
  const t = now();
  const stmts = rejects.slice(0, 40).map(r => env.DB.prepare(
    'INSERT INTO branch_rejects (thread_id, title, reason, score, handles, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(threadId, r.title || null, String(r.reason || '').slice(0, 300), r.score ?? null, r.handles || null, t));
  for (let i = 0; i < stmts.length; i += 20) await env.DB.batch(stmts.slice(i, i + 20));
}

// api.search(maxResults) -> { capped?, tweets: normalized rows }
// api.lookup(ids) -> { capped?, rows: Map of normalized rows }
export async function addOpening(env, b, root, sugg, api) {
  const conv = String(root.conversation_id || root.tweet_id);
  const dup = await env.DB.prepare('SELECT id FROM posts WHERE conversation_id = ?1 LIMIT 1').bind(conv).first();
  if (dup) return { state: 'duplicate', result: 'already on the site', post_id: dup.id };
  const page = searchPageSize(b.runCap, b.spent);
  if (page < 10) return { state: 'queued', result: 'capped:run_cap' };
  const searched = await api.search(page);
  if (searched?.capped && !(searched.tweets || []).length) return { state: 'queued', result: 'capped:' + searched.capped };
  let tweets = mergeTweets(root, searched?.tweets || []);
  let found = qualifyConversation(tweets, { grokId: GROK_ID, rootId: conv });
  if (found.missingParents.length && api.lookup) {
    const ids = found.missingParents.slice(0, 6);
    const room = b.runCap == null || (b.spent + ids.length * 0.02) <= b.runCap;
    if (room) {
      const got = await api.lookup(ids);
      if (got?.rows) {
        tweets = mergeTweets(tweets, [...got.rows.values()]);
        found = qualifyConversation(tweets, { grokId: GROK_ID, rootId: conv });
      }
    }
  }
  const counter = { n: 0 };
  const judged = [];
  for (const c of found.candidates) judged.push(await judgeCandidate(env, c, counter));
  const plan = planStoredThread(root, tweets, judged);
  const blocked = await blockedHandles(env);
  const battles = plan.battles.filter(bt => !(bt.mains || []).some(h => blocked.has(String(h).toLowerCase())));
  const aiRejects = judged.filter(j => j.status === 'reject').map(j => ({
    title: j.title, reason: j.reason || ('score ' + j.score), score: j.score, handles: (j.humans || []).join(','),
  }));
  const rejects = [...found.rejects, ...aiRejects];
  const grokAnswer = plan.multi ? (plan.grokAnswer || mainGrokAnswer(tweets, conv)) : mainGrokAnswer(tweets, conv);
  let threadId = null;
  try {
    threadId = await insertThread(env, root, plan.multi ? grokAnswer : null, sugg?.source || 'manual');
  } catch (e) {
    const again = await env.DB.prepare('SELECT id FROM posts WHERE conversation_id = ?1 LIMIT 1').bind(conv).first();
    if (again) return { state: 'duplicate', result: 'already on the site', post_id: again.id };
    return { state: 'failed', result: 'thread:' + String(e.message || e).slice(0, 80) };
  }
  await insertRejects(env, threadId, rejects);
  if (!battles.length) {
    return { state: 'failed', result: 'no_qualifying_battle', thread_id: threadId, rejected: rejects.length, battles: 0,
      reasons: rejects.slice(0, 6).map(r => r.reason).filter(Boolean) };
  }
  const ids = [];
  for (const bt of battles) {
    const texts = bt.tweets.map(w => w.text);
    const topics = suggestTopics(texts, []);
    const id = await insertPost(env.DB, {
      grok_tweet_id: bt.grok_tweet_id,
      conversation_id: bt.conversation_id,
      human_x_id: bt.human_x_id,
      human_handle: bt.human_handle,
      headline: bt.headline,
      source: sugg?.source || 'manual',
      low_priority: (bt.flags || []).includes('crude') ? 1 : 0,
      x_engagement: 0,
      tweet_created_at: bt.tweets.find(w => String(w.tweet_id) === bt.grok_tweet_id)?.created_at || null,
      tweets: bt.tweets,
      topics,
    });
    if (!id) continue;
    const ctx = bt.context ? feedTweet(bt.context, visibleGrokText(bt.context.raw || bt.context.text || '')) : null;
    await env.DB.prepare(
      `UPDATE posts SET thread_id = ?2, battle_score = ?3, battle_kind = ?4, battle_flags = ?5, battle_reason = ?6,
        battle_mains = ?7, battle_context = ?8, battle_borderline = ?9, suggested_by_x_id = ?10, suggested_by_handle = ?11
       WHERE id = ?1`
    ).bind(id, threadId, bt.score, bt.kind, (bt.flags || []).join(',') || null, bt.reason || null,
      JSON.stringify(bt.mains || []), ctx ? JSON.stringify(ctx) : null, bt.borderline ? 1 : 0,
      sugg?.x_id || null, sugg?.handle || null).run();
    ids.push(id);
  }
  if (!ids.length) return { state: 'failed', result: 'no_qualifying_battle', thread_id: threadId, rejected: rejects.length, battles: 0 };
  return {
    state: 'fetched', result: 'stored:' + ids.length + (ids.length === 1 ? ' battle' : ' battles'),
    post_id: ids[0], post_ids: ids, thread_id: threadId, battles: ids.length, rejected: rejects.length,
  };
}

function mergeTweets(root, more) {
  const out = [];
  const seen = new Set();
  for (const t of [root, ...(more || [])]) {
    if (!t) continue;
    const id = String(t.tweet_id || t.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...t, tweet_id: id, raw: t.raw || t.text || '' });
  }
  return out;
}

// Rows from a paid search response. Includes parent tweets X returned in includes.tweets.
export function tweetsFromSearchJson(json) {
  return normalizeSearch(json);
}
