import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROK_ID, addMode, applyScoreRules, battleTitle, calledGrok, displayMode, groupFeedPosts,
  heuristicScore, isOpeningTweet, normalizeSearch, planStoredThread, qualifyConversation,
  searchPageSize, visibleGrokText, voteLabel,
} from './qualify.js';
import { voteLabel as viewLabel } from '../assets/v2/branch-render.js';

const G = GROK_ID;
const say = (id, handle, parent, text) => ({
  tweet_id: String(id), author_id: handle === 'grok' ? G : 'u-' + handle, author_handle: handle,
  parent: parent == null ? null : String(parent), text, raw: text, conversation_id: '100', media: [],
});
const rounds = (handle, start, parent, lines) => {
  const out = [];
  let p = parent;
  let id = start;
  for (const line of lines) {
    out.push(say(id, handle, p, line[0]));
    out.push(say(id + 1, 'grok', id, line[1]));
    p = id + 1;
    id += 2;
  }
  return out;
};

test('opening post vs a later post', () => {
  assert.equal(isOpeningTweet({ tweet_id: '100', conversation_id: '100' }), true);
  assert.equal(addMode({ tweet_id: '100', conversation_id: '100', parent: null }), 'branches');
  assert.equal(addMode({ tweet_id: '205', conversation_id: '100', parent: '204' }), 'single');
  assert.equal(isOpeningTweet({ tweet_id: '205', conversation_id: '100', parent: '204' }), false);
});

test('leading @grok collapses to one and body mentions stay', () => {
  assert.equal(visibleGrokText('@alice @grok @grok hello there'), '@grok hello there');
  assert.equal(visibleGrokText('@alice @bob hello there'), 'hello there');
  assert.equal(visibleGrokText('hello @grok again'), 'hello @grok again');
  assert.equal(calledGrok('@grok hello', false), true);
  assert.equal(calledGrok('@grok hello', true), false);
});

test('vote labels and the browser copy stay in sync', () => {
  assert.equal(voteLabel(['ada']).text, '@ada');
  assert.equal(voteLabel(['ada', 'bea']).text, '@ada & @bea');
  assert.equal(voteLabel(['ada', 'bea', 'cy']).text, '@ada +2');
  assert.equal(voteLabel(['ada', 'bea', 'cy']).plus, '+2');
  for (const h of [['ada'], ['ada', 'bea'], ['ada', 'bea', 'cy', 'dee']]) assert.deepEqual(voteLabel(h), viewLabel(h));
  assert.equal(battleTitle(['ada', 'bea'], 'Is a checkbox enough?').startsWith('Grok vs. @ada & @bea:'), true);
});

test('search page stays inside the per-add cap', () => {
  const page = searchPageSize(0.6, 0.04);
  assert.ok(page >= 10 && page <= 80);
  const estimate = 0.04 + page * 0.005 * 1.4;
  assert.ok(estimate <= 0.6, 'estimate ' + estimate);
  assert.equal(searchPageSize(0.6, 0.55), 0);
});

test('one conversation payload: two battles qualify, a short one does not', () => {
  const root = say(100, 'opener', null, 'The state should not sequester ballots before it has checked citizenship.');
  const ctx = say(150, 'opener', 100, 'California has prosecuted more illegal-voting cases than any other state recently.');
  const rare = rounds('ada', 201, 150, [
    ['@grok but you said cases are rare because nobody actually checks the rolls', 'Proven cases stay rare next to millions of registered voters and decades of records.'],
    ['@grok so rare because it is hard to prove, or rare because it does not happen?', 'Both, and audits still turn up only a tiny fraction of the electorate.'],
    ['@grok actually that is the contradiction: you cannot call it rare if you rarely look', 'Looking more often would still have to separate mistakes from intentional votes.'],
  ]);
  const box = rounds('bea', 301, 100, [
    ['@grok but a sworn checkbox is the only thing stopping a noncitizen from registering', 'Registration does rely on that attestation, with identity checks and felony penalties.'],
    ['@grok so the form is doing the work that a database check would do, which is not the same', 'The attestation is under penalty of perjury, which is the legal control in that state.'],
    ['@grok you said the penalty matters, yet the check never happens before the ballot is counted', 'Penalties apply after the fact, and prosecutions remain uncommon.'],
  ]);
  const tiny = rounds('cy', 401, 100, [
    ['@grok is that true?', 'Yes, the figure matches the report cited in the opening post.'],
  ]);
  const api = {
    data: [root, ctx, ...rare, ...box, ...tiny].map(t => ({
      id: t.tweet_id, author_id: t.author_id, text: t.text, conversation_id: '100',
      referenced_tweets: t.parent ? [{ type: 'replied_to', id: t.parent }] : [],
    })),
    includes: { users: [
      { id: 'u-opener', username: 'opener' }, { id: 'u-ada', username: 'ada' },
      { id: 'u-bea', username: 'bea' }, { id: 'u-cy', username: 'cy' }, { id: G, username: 'grok' },
    ] },
  };
  const tweets = normalizeSearch(api);
  assert.equal(tweets.length, 2 + rare.length + box.length + tiny.length);
  const q = qualifyConversation(tweets, { rootId: '100' });
  assert.equal(q.candidates.length, 2);
  const names = q.candidates.map(c => c.pre.humans[0]).sort();
  assert.deepEqual(names, ['ada', 'bea']);
  const ada = q.candidates.find(c => c.pre.humans[0] === 'ada');
  assert.equal(ada.context.author_handle, 'opener');
  assert.equal(ada.context.tweet_id, '150');
  assert.ok(q.rejects.some(r => /Fails rule 1/.test(r.reason)));
  const judged = q.candidates.map(c => ({ ...c, ...applyScoreRules(heuristicScore(c), c.pre) }));
  const plan = planStoredThread(root, tweets, judged);
  assert.equal(plan.mode, 'branches');
  assert.equal(plan.battles.length, 2);
  for (const b of plan.battles) {
    assert.ok(!b.tweets.some(t => t.tweet_id === '100'), 'root stays on the thread');
    assert.equal(b.mode, 'branch');
    assert.match(b.tweets.find(t => t.author_handle !== 'grok').text, /@grok/i);
  }
  assert.equal(plan.battles.find(b => b.human_handle === 'ada').context.tweet_id, '150');
});

test('a single qualifying chain is stored as one normal post that starts at the root', () => {
  const root = say(100, 'opener', null, 'Opening claim about the list of suspected noncitizen voters in the state.');
  const chain = rounds('ada', 201, 100, [
    ['@bob @grok but the state rarely checks, so the statistic is not evidence', 'The statistic counts convictions, which require a check that found a case.'],
    ['@grok so you are using convictions to prove absence, which only works if someone looks', 'Convictions are the cases that were proven, not a census of every ballot.'],
    ['@grok actually that leaves the original claim untouched: unchecked rolls hide the rest', 'Unchecked rolls are a limit, and the proven cases are still a small share.'],
  ]);
  const q = qualifyConversation([root, ...chain], { rootId: '100' });
  assert.equal(q.candidates.length, 1);
  const judged = q.candidates.map(c => ({ ...c, ...applyScoreRules(heuristicScore(c), c.pre) }));
  const plan = planStoredThread(root, [root, ...chain], judged);
  assert.equal(plan.mode, 'classic');
  assert.equal(displayMode(plan.battles), 'classic');
  assert.equal(plan.battles[0].tweets[0].tweet_id, '100');
  assert.equal(plan.battles[0].context, null);
  assert.doesNotMatch(plan.battles[0].tweets.find(t => t.author_handle === 'ada').text, /^@bob/);
});

test('qualification filters: questions, crude flag, near-duplicates, score clamps', () => {
  const root = say(100, 'opener', null, 'Opening post long enough to be a real post about election procedure and checks.');
  const questions = rounds('ada', 201, 100, [
    ['@grok is that claim about the voter file accurate as stated?', 'It matches the report linked from the opening post in this thread.'],
    ['@grok any video of the official reading that statute out loud?', 'I do not have a video, the text of the statute is public though.'],
    ['@grok what is the citation for the paragraph you just quoted there?', 'The citation is the statute number already given in the previous reply.'],
  ]);
  let q = qualifyConversation([root, ...questions], { rootId: '100' });
  assert.equal(q.candidates.length, 0);
  assert.ok(q.rejects.some(r => /neutral question/.test(r.reason)));

  const crude = rounds('bea', 301, 100, [
    ['@grok but this is fucking ignorant and still a real dispute about the evidence here', 'The evidence in the report is limited to the cases that were charged.'],
    ['@grok so the insult does not erase the contradiction you just walked into again', 'The contradiction is about what the report counts, not about the tone.'],
    ['@grok actually answer the point about the missing check instead of the wording', 'The missing check is a limit of the report and I said that above too.'],
  ]);
  q = qualifyConversation([root, ...crude], { rootId: '100' });
  assert.equal(q.candidates.length, 1);
  assert.ok(q.candidates[0].pre.flags.includes('crude') || q.candidates[0].pre.flags.includes('insults'));

  const dup = rounds('cy', 401, 100, [
    ['@grok but could it fit up his ass if the box was slightly wider than this', 'No, the dimensions in the photo do not leave that kind of room at all.'],
    ['@grok but could it fit up his ass if the box was slightly wider than that', 'No, the dimensions in the photo do not leave that kind of room at all.'],
    ['@grok but could it fit up his ass if the box was slightly wider than them', 'No, the dimensions in the photo do not leave that kind of room at all.'],
  ]);
  q = qualifyConversation([root, ...dup], { rootId: '100' });
  assert.equal(q.candidates.length, 0);
  assert.ok(q.rejects.some(r => /repeat/.test(r.reason)));

  const pre = { counted: 2, humans: ['ada'], flags: [] };
  const clamped = applyScoreRules({ score: 9, debate_posts: 8, disagreement: true, humans: ['ada'], same_line: true, troll: 'none', kind: 'informative', title: 'Grok vs. @ada: too few posts', reason: 'model inflated the count' }, pre);
  assert.ok(clamped.score <= 5);
  assert.equal(clamped.status, 'reject');
  const low = applyScoreRules({ score: 8, debate_posts: 3, disagreement: false, humans: ['ada'], troll: 'lowbrow', flags: ['crude'], kind: 'funny', title: 'Grok vs. @ada: noise', reason: 'unfunny' }, { counted: 3, humans: ['ada'], flags: ['crude'] });
  assert.ok(low.score <= 4);
  assert.equal(low.status, 'reject');
  const border = applyScoreRules({ score: 6, debate_posts: 3, disagreement: true, humans: ['ada'], troll: 'funny', flags: ['crude'], kind: 'funny', title: 'Grok vs. @ada: a bit that lands', reason: 'funny and crude' }, { counted: 3, humans: ['ada'], flags: ['crude'] });
  assert.equal(border.status, 'borderline');
  assert.equal(border.borderline, true);
});

test('group feed rows: one battle stays classic, two become layout E', () => {
  const a = { id: '1', thread_id: null, headline: 'solo' };
  const b = { id: '2', thread_id: 9, headline: 'first' };
  const c = { id: '3', thread_id: 9, headline: 'second' };
  const d = { id: '4', thread_id: 8, headline: 'only' };
  const grouped = groupFeedPosts([a, b, c, d]);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].id, '1');
  assert.equal(grouped[0].battles, undefined);
  assert.equal(displayMode(grouped[0].battles), 'classic');
  assert.equal(grouped[1].battles.length, 2);
  assert.equal(displayMode(grouped[1].battles), 'branches');
  assert.equal(grouped[2].battles, undefined);
  const flipped = groupFeedPosts([b, c], { preferId: '3' });
  assert.equal(flipped[0].id, '3');
  assert.equal(flipped[0].battles[0].id, '3');
});
