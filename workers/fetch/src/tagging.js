// Title and topic suggestions for gvh-fetch. Two Workers AI calls, same prompts and validation as before.
// A bad title does not drop a good topic list, and the reverse. Merging them would change that.
//
// Model: @cf/ibm-granite/granite-4.0-h-micro ($0.017 / M input, $0.112 / M output).
// @cf/meta/llama-3.2-3b-instruct stops answering on 2026-11-20 (HTTP 410, error 5028).
// That id is not a permanent rollback target. Switch and rollback: docs/fetch-ai-model.md.
import { TOPICS, suggestTopics, suggestHeadline, mainHuman } from '../../../server/v2.js';

export const AI_MODEL = '@cf/ibm-granite/granite-4.0-h-micro';
// Same id as index.js. Topics label a turn "Grok" only when author_id matches (headline uses the handle).
const GROK_ID = '1720665183188922368';

export class AiShapeError extends Error {
  constructor(shape) {
    super('unrecognized Workers AI response shape: ' + shape);
    this.name = 'AiShapeError';
    this.shape = shape;
  }
}

const shapeSummary = raw => {
  if (raw == null || typeof raw !== 'object') return raw === null ? 'null' : typeof raw;
  if (Array.isArray(raw)) return 'array[' + raw.length + ']';
  return '{' + Object.keys(raw).slice(0, 8).join(',') + '}';
};

// Text from one Workers AI chat result.
// The binding docs say `{ response: string }`. A live Granite run returned an OpenAI chat
// completion (`choices[0].message.content`) and no `response`. Reading only `response` turns
// that into "" and the caller falls back as if the model had declined. An object we cannot
// read is an error, not empty text, so the caller can log it instead of failing silently.
export function workersAiText(raw) {
  const hit = pickText(raw, 0);
  if (!hit) throw new AiShapeError(shapeSummary(raw));
  return hit;
}

function pickText(raw, depth) {
  if (typeof raw === 'string') return { text: raw, shape: 'string' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hasResponse = typeof raw.response === 'string';
  const choice = readChoice(raw);
  // A non-empty documented `response` wins. An empty one must not hide text that arrived on `choices`.
  if (hasResponse && raw.response.trim()) return { text: raw.response, shape: 'response' };
  if (choice?.error) return null;
  if (choice && choice.text.trim()) return { text: choice.text, shape: choice.shape };
  if (hasResponse) return { text: raw.response, shape: 'response' };
  if (choice) return { text: choice.text, shape: choice.shape };
  if (depth < 1 && raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result)) {
    const inner = pickText(raw.result, depth + 1);
    if (inner) return { text: inner.text, shape: 'result.' + inner.shape };
  }
  return null;
}

// null = no `choices` field. { error: true } = the field is there and we cannot read it.
// { text, shape } = understood, including an explicit empty string.
function readChoice(raw) {
  if (!Object.prototype.hasOwnProperty.call(raw, 'choices')) return null;
  if (!Array.isArray(raw.choices) || !raw.choices.length) return { error: true };
  const choice = raw.choices.find(c => c && typeof c === 'object' && (c.message || c.delta || typeof c.text === 'string'));
  if (!choice) return { error: true };
  if (typeof choice.text === 'string') return { text: choice.text, shape: 'choices.text' };
  const msg = choice.message && typeof choice.message === 'object' ? choice.message
    : choice.delta && typeof choice.delta === 'object' ? choice.delta : null;
  if (!msg) return { error: true };
  if (!Object.prototype.hasOwnProperty.call(msg, 'content')) {
    return Array.isArray(msg.tool_calls) ? { text: '', shape: 'choices.tool_calls' } : { error: true };
  }
  const content = msg.content;
  if (typeof content === 'string' || content == null) return { text: content || '', shape: 'choices.message.content' };
  if (!Array.isArray(content)) return { error: true };
  let text = '';
  for (const part of content) {
    if (typeof part === 'string') text += part;
    else if (part && typeof part.text === 'string') text += part.text;
    else if (part && part.type === 'text') continue;
    else return { error: true };
  }
  return { text, shape: 'choices.message.parts' };
}

function cleanHeadlineLine(raw) {
  return String(raw || '').split('\n')[0].replace(/^["'*\s]+|["'*\s]+$/g, '').replace(/^(topic|title)\s*:\s*/i, '').replace(/\s+/g, ' ');
}
function acceptableHeadline(t) {
  const words = t.split(' ').filter(Boolean).length;
  return !!(t && words >= 2 && words <= 8 && t.length <= 48 && !/[@#<>]|https?:/.test(t));
}
// Plain text, or a JSON object whose topic/title string passes the same checks.
// The observed Granite sample was {"topic":"...","tags":[...]} from a combined prompt.
// Each production call still has its own prompt; this only recovers fields when that shape shows up.
function parseJsonObject(text) {
  let s = String(text || '').trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  try {
    const j = JSON.parse(s);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { return null; }
}
export function headlineFromModelText(text) {
  const plain = cleanHeadlineLine(text);
  if (acceptableHeadline(plain)) return plain;
  const j = parseJsonObject(text);
  if (!j) return null;
  for (const k of ['topic', 'title']) {
    if (typeof j[k] !== 'string') continue;
    const t = cleanHeadlineLine(j[k]);
    if (acceptableHeadline(t)) return t;
  }
  return null;
}
function matchTopic(part) {
  const key = String(part ?? '').trim().replace(/[."*]/g, '').toLowerCase();
  return TOPICS.find(x => x.toLowerCase() === key) || null;
}
export function topicsFromModelText(text) {
  const j = parseJsonObject(text);
  const listed = j && (Array.isArray(j.tags) || Array.isArray(j.topics));
  const parts = listed ? (Array.isArray(j.tags) ? j.tags : j.topics) : j ? [] : String(text || '').split(/[,\n]/);
  const out = [];
  for (const part of parts) {
    const t = matchTopic(part);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.filter(t => t !== 'Wild Card' || out.length === 1).slice(0, 2);
}

function logAi(kind, e) {
  if (e?.name === 'AiShapeError') console.error('gvh-fetch ai shape', kind, AI_MODEL, e.shape);
  else console.error('gvh-fetch ai ' + kind, String(e?.message || e).slice(0, 200));
}

// "Grok vs. @handle: <2-6 word topic>". The @handle is the main human participant (buildChain /
// mainHuman), never simply the opening asker. Falls back to the cleaned-question headline.
export async function aiHeadline(env, tweets, humanIn) {
  const human = humanIn || mainHuman(tweets);
  if (!human || !env.AI) return suggestHeadline(tweets, human);
  try {
    const convo = tweets.slice(0, 6).map(w => `${String(w.author_handle).toLowerCase() === 'grok' ? 'Grok' : 'Human'}: ${String(w.text).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const raw = await env.AI.run(AI_MODEL, { max_tokens: 20, temperature: 0.2, messages: [
      { role: 'system', content: 'You title debates. Reply with ONLY a 2-6 word topic summarizing what the thread is about, ideally a short question (e.g. "Does the universe have meaning?", "Are humans just meat computers?"). No quotes, no names, no hashtags, never copy the user\'s wording.' },
      { role: 'user', content: convo }] });
    const { text } = workersAiText(raw);
    const t = headlineFromModelText(text);
    if (!t) return suggestHeadline(tweets, human);
    return `Grok vs. @${human.author_handle}: ${t.charAt(0).toUpperCase() + t.slice(1)}`;
  } catch (e) {
    logAi('headline', e);
    return suggestHeadline(tweets, human);
  }
}

// 1-2 topics from the root question + the overall thread. Workers AI picks from TOPICS, validated;
// keyword fallback. A JSON `tags`/`topics` array is accepted; a title-only JSON object is not a topic list.
export async function aiTopics(env, tweets, annotations = []) {
  const kw = suggestTopics(tweets.map(w => w.text), annotations);
  if (!env.AI) return kw;
  try {
    const clean = s => String(s || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    const rest = tweets.slice(1).map(w => `${w.author_id === GROK_ID ? 'Grok' : 'Human'}: ${clean(w.text).slice(0, 160)}`).join('\n').slice(0, 2500);
    const raw = await env.AI.run(AI_MODEL, { max_tokens: 16, temperature: 0, messages: [
      { role: 'system', content: `You categorize X threads. Allowed topics: ${TOPICS.join(', ')}. Judge mainly by what the ROOT post asks, then the thread as a whole; ignore passing jokes, emojis and side remarks. A famous person (e.g. Elon Musk) or a company being mentioned is not Politics; use Politics only for government, elections, parties, policy or wars. Reply with ONLY one topic, or two separated by a comma when both clearly apply. Use Wild Card only if nothing fits.` },
      { role: 'user', content: `ROOT: ${clean(tweets[0]?.text).slice(0, 500)}\n\nTHREAD:\n${rest}` }] });
    const { text } = workersAiText(raw);
    const res = topicsFromModelText(text);
    return res.length ? res : kw;
  } catch (e) {
    logAi('topics', e);
    return kw;
  }
}
