// Mocked Workers AI fixtures only. No env.AI.run against Cloudflare, no X API, no D1.
// Run from the repo root:
//   node --experimental-default-type=module --test workers/fetch/test/tagging.test.js
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestHeadline, suggestTopics } from '../../../server/v2.js';
import { GUARD_MODEL, CLASSIFY_MODEL } from '../../../server/moderation.js';
import { TRANSLATE_MODEL } from '../../../server/translate.js';
import {
  AI_MODEL, AiShapeError, workersAiText, headlineFromModelText, topicsFromModelText, aiHeadline, aiTopics,
} from '../src/tagging.js';

const fixture = name => JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const bindingHeadline = fixture('binding-response.json');
const bindingTopics = fixture('binding-response-topics.json');
const graniteHeadline = fixture('granite-chat-completion.json');
const graniteTopics = fixture('granite-chat-completion-topics.json');
const observed = fixture('granite-observed-combined.json');
const parts = fixture('granite-message-parts.json');
const emptyResponseWithChoices = fixture('granite-empty-response-with-choices.json');
const unrecognized = fixture('unrecognized-generated-text.json');
const brokenChoices = fixture('granite-broken-choices.json');

const OBSERVED_TEXT = '{"topic":"Gas Price Drop Post-Midterms","tags":["Politics","Money"]}';
const GROK_ID = '1720665183188922368';

// Keyword fallback for this thread is Food, and the cleaned headline quotes the pizza question.
// Model output below is deliberately not that, so a silent `.response` miss cannot pass.
const human = { author_id: '101', author_handle: 'Ada', text: '@grok what is the best pizza dough recipe for a saturday night? https://t.co/abc' };
const grok = { author_id: GROK_ID, author_handle: 'grok', text: 'Use high-protein flour, cold ferment, and a hot stone.' };
const tweets = [human, grok];

function capture(fn) {
  const lines = [];
  const prev = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.error = prev; })
    .then(value => ({ value, lines }));
}
function envReturning(raw) {
  const calls = [];
  return {
    calls,
    env: { AI: { async run(model, input) { calls.push({ model, input }); return raw; } } },
  };
}

test('model constant is Granite and the retired Llama id is not the call target', () => {
  assert.equal(AI_MODEL, '@cf/ibm-granite/granite-4.0-h-micro');
  assert.doesNotMatch(AI_MODEL, /llama-3\.2-3b-instruct/);
});

test('fetch worker delegates tagging and no longer names the retired model', () => {
  const indexSrc = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(indexSrc, /from '\.\/tagging\.js'/);
  assert.doesNotMatch(indexSrc, /llama-3\.2-3b-instruct/);
  assert.doesNotMatch(indexSrc, /AI_MODEL/);
});

test('moderation and translation models stay on their own ids', () => {
  assert.equal(GUARD_MODEL, '@cf/meta/llama-guard-3-8b');
  assert.equal(CLASSIFY_MODEL, '@cf/meta/llama-3.1-8b-instruct-fast');
  assert.equal(TRANSLATE_MODEL, '@cf/meta/m2m100-1.2b');
  const mod = readFileSync(new URL('../../../server/moderation.js', import.meta.url), 'utf8');
  const tr = readFileSync(new URL('../../../server/translate.js', import.meta.url), 'utf8');
  assert.doesNotMatch(mod + tr, /granite-4\.0-h-micro/);
});

test('legacy binding {response} and OpenAI choices both yield the assistant text', () => {
  assert.deepEqual(workersAiText(bindingHeadline), { text: 'Does the universe have meaning?', shape: 'response' });
  assert.deepEqual(workersAiText(graniteHeadline), { text: 'Are humans just meat computers?', shape: 'choices.message.content' });
  assert.equal(workersAiText(parts).text, 'Philosophy, Science');
  assert.equal(workersAiText(parts).shape, 'choices.message.parts');
  assert.equal(workersAiText({ result: bindingTopics }).text, 'Philosophy, Science');
  assert.equal(workersAiText({ result: { choices: graniteTopics.choices } }).shape, 'result.choices.message.content');
});

test('the old response-only read is empty on the Granite choices fixture', () => {
  assert.equal(observed.response, undefined);
  assert.equal(String(observed.response || ''), '');
  assert.equal(workersAiText(observed).text, OBSERVED_TEXT);
  assert.equal(workersAiText(observed).shape, 'choices.message.content');
});

test('a blank response does not hide choices text; a real response still wins', () => {
  assert.equal(workersAiText(emptyResponseWithChoices).text, 'Philosophy');
  assert.equal(workersAiText(emptyResponseWithChoices).shape, 'choices.message.content');
  const both = { response: 'Money talk after the vote', choices: graniteHeadline.choices };
  assert.equal(workersAiText(both).text, 'Money talk after the vote');
  assert.equal(workersAiText(both).shape, 'response');
});

test('unreadable shapes throw instead of looking like an empty answer', () => {
  assert.throws(() => workersAiText(unrecognized), AiShapeError);
  assert.throws(() => workersAiText(brokenChoices), AiShapeError);
  assert.throws(() => workersAiText([{ choices: [{ delta: { content: 'Philosophy' } }] }]), AiShapeError);
  assert.equal(workersAiText({ response: '' }).text, '');
  assert.equal(workersAiText({ choices: [{ message: { role: 'assistant', content: '' } }] }).text, '');
});

test('headline and topic validators accept the observed JSON and reject junk', () => {
  assert.equal(headlineFromModelText(OBSERVED_TEXT), 'Gas Price Drop Post-Midterms');
  assert.deepEqual(topicsFromModelText(OBSERVED_TEXT), ['Politics', 'Money']);
  assert.equal(headlineFromModelText('Are humans just meat computers?'), 'Are humans just meat computers?');
  assert.equal(headlineFromModelText('Hi'), null);
  assert.equal(headlineFromModelText('Grok vs. @Ada: too many names here please'), null);
  assert.deepEqual(topicsFromModelText('*"Philosophy"*, Science.'), ['Philosophy', 'Science']);
  assert.deepEqual(topicsFromModelText('Wild Card, Philosophy'), ['Philosophy']);
  assert.deepEqual(topicsFromModelText('Wild Card'), ['Wild Card']);
  assert.deepEqual(topicsFromModelText('{"topic":"Gas Price Drop Post-Midterms"}'), []);
  assert.deepEqual(topicsFromModelText('Nope, Also Nope'), []);
});

test('OpenAI choices become the title and topics, not the pizza fallback', async () => {
  const headline = envReturning(graniteHeadline);
  const { value: title, lines: headlineLogs } = await capture(() => aiHeadline(headline.env, tweets, human));
  assert.equal(title, 'Grok vs. @Ada: Are humans just meat computers?');
  assert.notEqual(title, suggestHeadline(tweets, human));
  assert.deepEqual(headlineLogs, []);
  assert.equal(headline.calls.length, 1);
  assert.equal(headline.calls[0].model, AI_MODEL);
  assert.equal(headline.calls[0].input.max_tokens, 20);
  assert.equal(headline.calls[0].input.temperature, 0.2);
  assert.match(headline.calls[0].input.messages[0].content, /2-6 word topic/);
  assert.match(headline.calls[0].input.messages[1].content, /^Human: @grok what is the best pizza/);
  assert.doesNotMatch(headline.calls[0].input.messages[1].content, /t\.co/);

  const topics = envReturning(graniteTopics);
  const { value: tags, lines: topicLogs } = await capture(() => aiTopics(topics.env, tweets, []));
  assert.deepEqual(tags, ['Philosophy']);
  assert.notDeepEqual(tags, suggestTopics(tweets.map(w => w.text), []));
  assert.deepEqual(topicLogs, []);
  assert.equal(topics.calls[0].model, AI_MODEL);
  assert.equal(topics.calls[0].input.max_tokens, 16);
  assert.equal(topics.calls[0].input.temperature, 0);
  assert.match(topics.calls[0].input.messages[0].content, /Elon Musk/);
  assert.match(topics.calls[0].input.messages[0].content, /not Politics/);
  assert.match(topics.calls[0].input.messages[1].content, /Grok: Use high-protein flour/);
});

test('legacy {response} fixtures still title and tag', async () => {
  const { value: title } = await capture(() => aiHeadline(envReturning(bindingHeadline).env, tweets, human));
  assert.equal(title, 'Grok vs. @Ada: Does the universe have meaning?');
  const { value: tags } = await capture(() => aiTopics(envReturning(bindingTopics).env, tweets, []));
  assert.deepEqual(tags, ['Philosophy', 'Science']);
});

test('observed combined JSON is parsed per call and does not replace the two-call prompts', async () => {
  const headline = envReturning(observed);
  const topics = envReturning(observed);
  const { value: title, lines: headlineLogs } = await capture(() => aiHeadline(headline.env, tweets, human));
  const { value: tags, lines: topicLogs } = await capture(() => aiTopics(topics.env, tweets, []));
  assert.equal(title, 'Grok vs. @Ada: Gas Price Drop Post-Midterms');
  assert.deepEqual(tags, ['Politics', 'Money']);
  assert.notEqual(title, suggestHeadline(tweets, human));
  assert.deepEqual(suggestTopics(tweets.map(w => w.text), []), ['Food']);
  assert.deepEqual(headlineLogs, []);
  assert.deepEqual(topicLogs, []);
  assert.equal(headline.calls.length, 1);
  assert.equal(topics.calls.length, 1);
  assert.match(headline.calls[0].input.messages[0].content, /You title debates/);
  assert.match(topics.calls[0].input.messages[0].content, /You categorize X threads/);
  assert.notEqual(headline.calls[0].input.messages[0].content, topics.calls[0].input.messages[0].content);
});

test('message parts are topics; invalid text falls back without a shape error', async () => {
  const { value: tags, lines } = await capture(() => aiTopics(envReturning(parts).env, tweets, []));
  assert.deepEqual(tags, ['Philosophy', 'Science']);
  assert.deepEqual(lines, []);

  const bad = envReturning({ choices: [{ message: { role: 'assistant', content: 'Hi' } }] });
  const { value: title, lines: headlineLogs } = await capture(() => aiHeadline(bad.env, tweets, human));
  assert.equal(title, suggestHeadline(tweets, human));
  assert.match(title, /pizza dough recipe/);
  assert.deepEqual(headlineLogs, []);

  const { value: kw, lines: topicLogs } = await capture(() => aiTopics(envReturning({ response: 'Nope' }).env, tweets, []));
  assert.deepEqual(kw, ['Food']);
  assert.deepEqual(topicLogs, []);
});

test('an unreadable shape logs and falls back; it does not adopt a nearby string', async () => {
  const { value: tags, lines } = await capture(() => aiTopics(envReturning(unrecognized).env, tweets, []));
  assert.deepEqual(tags, ['Food']);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /gvh-fetch ai shape topics @cf\/ibm-granite\/granite-4\.0-h-micro \{generated_text\}/);

  const { value: title, lines: headlineLogs } = await capture(() => aiHeadline(envReturning(brokenChoices).env, tweets, human));
  assert.equal(title, suggestHeadline(tweets, human));
  assert.match(headlineLogs[0], /gvh-fetch ai shape headline/);
  assert.match(headlineLogs[0], /choices/);
});

test('a thrown model error falls back and is logged, without claiming a shape mismatch', async () => {
  const env = { AI: { async run() { throw new Error('410 Gone'); } } };
  const ann = [{ domain: { name: 'Sports' } }];
  const { value: title, lines } = await capture(() => aiHeadline(env, tweets, human));
  const { value: tags, lines: topicLogs } = await capture(() => aiTopics(env, tweets, ann));
  assert.equal(title, suggestHeadline(tweets, human));
  assert.deepEqual(tags, suggestTopics(tweets.map(w => w.text), ann));
  assert.match(lines[0], /gvh-fetch ai headline 410 Gone/);
  assert.doesNotMatch(lines[0], /ai shape/);
  assert.match(topicLogs[0], /gvh-fetch ai topics 410 Gone/);
});

test('missing AI binding does not call a model and uses the existing fallbacks', async () => {
  let ran = false;
  const env = { AI: null, run() { ran = true; } };
  const { value: title, lines } = await capture(() => aiHeadline(env, tweets, human));
  const { value: tags } = await capture(() => aiTopics({}, tweets, []));
  assert.equal(title, suggestHeadline(tweets, human));
  assert.deepEqual(tags, ['Food']);
  assert.equal(ran, false);
  assert.deepEqual(lines, []);
  const { value: noHuman } = await capture(() => aiHeadline({ AI: { async run() { ran = true; return bindingHeadline; } } }, [], null));
  assert.equal(noHuman, 'Grok vs. a human');
  assert.equal(ran, false);
});
