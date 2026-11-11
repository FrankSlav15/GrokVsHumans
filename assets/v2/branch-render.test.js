import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBranchThread } from './branch-render.js';
import { displayMode } from '../../server/qualify.js';

const esc = s => String(s ?? '');
const turn = w => `<div class="tw ${w._ctx ? 'ctx' : ''} ${w._branch ? 'br' : ''}">${w.text}</div>`;
const h = { esc, ago: () => '2h', turn, rank: 0, view: 'hot', isSeen: false, xSvg: '' };

function battle(id, handle, lines, extra = {}) {
  return {
    id, headline: `Grok vs. @${handle}: point ${id}`, kind: 'informative', flags: extra.flags || [],
    mains: extra.mains || [handle], votes: { grok: 1, human: 2 }, likes: 3, dislikes: 0, comments: 4,
    mine: { vote: null, react: 0 }, context: extra.context || null,
    tweets: lines.map((text, i) => ({ id: id + '-' + i, handle: i % 2 ? 'grok' : handle, grok: i % 2 === 1, text, avatar: '' })),
  };
}

test('two battles: featured, next, list, no map, no truncation', () => {
  assert.equal(displayMode([1]), 'classic');
  assert.equal(displayMode([1, 2]), 'branches');
  const lines = ['@grok but this is the full first post and it must not be cut', 'reply one is also complete', 'second human post stays', 'reply two stays', 'third human post stays', 'reply three stays'];
  const p = {
    id: '10', headline: 'root title', created_at: 1, topics: ['Politics'], featured: false,
    root: { id: 'r', handle: 'opener', text: 'The opening post is shown in full, including this long sentence that would have been clamped.', grok: false },
    grok_answer: null, root_title: 'Where the argument started',
    battles: [battle('10', 'ada', lines), battle('11', 'bea', ['@grok so a second battle', 'grok answers'])],
  };
  const html = renderBranchThread(p, h);
  assert.match(html, /post--branches/);
  assert.match(html, /Featured battle/);
  assert.match(html, /Next battle/);
  assert.match(html, /More battles from this thread \(1\)/);
  assert.doesNotMatch(html, /class="map"/);
  assert.doesNotMatch(html, /Show full thread/);
  for (const line of lines) assert.ok(html.includes(line), line);
  assert.ok(html.includes('The opening post is shown in full'));
  assert.match(html, /data-battle="10"/);
  assert.match(html, /class="v-who">@ada</);
});

test('three battles show the map; context and a called-@grok post are marked by the turn hook', () => {
  const p = {
    id: '1', created_at: 1, topics: [], root_title: 'Start',
    root: { id: 'r', handle: 'opener', text: 'root', grok: false },
    battles: [
      battle('1', 'ada', ['@grok one'], { context: { id: 'c', handle: 'sam', text: 'the parent human post', grok: false } }),
      battle('2', 'bea', ['two'], { mains: ['bea', 'cy'] }),
      battle('3', 'dee', ['three'], { mains: ['dee', 'cy', 'fay'] }),
    ],
  };
  const html = renderBranchThread(p, { ...h, featuredId: '2' });
  assert.match(html, /class="map"/);
  assert.match(html, /3 battles in this thread/);
  assert.match(html, /data-battle="2"/);
  assert.match(html, /@bea &amp; @cy|@bea & @cy/);
  assert.match(html, /Humans \(2\), all credited/);
  const featured = renderBranchThread(p, h);
  assert.match(featured, /Replying to/);
  assert.match(featured, /context, not part of the battle/);
  assert.match(featured, /_ctx|ctx/);
  const third = renderBranchThread(p, { ...h, featuredId: '3' });
  assert.match(third, /v-plus">\+2/);
});
