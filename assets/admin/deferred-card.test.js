import test from 'node:test';
import assert from 'node:assert/strict';
import { deferredCard, previewBlock } from './deferred-card.js';
import { deferredActions, deferredStatus } from '../../server/deferred.js';
import { TOPICS } from '../../server/v2.js';

const bookmark = {
  id: 33, handle: 'SlavisTon', url: 'https://x.com/i/status/109', title: '', topic_list: [],
  note: 'admin quick-add (deferred)', result: 'waiting: bookmark import', state: 'queued', banned: 0, when: '11/12/2026, 8:07:01 AM',
};
bookmark.status_label = deferredStatus(bookmark).label;
bookmark.actions = deferredActions(bookmark);

test('a bookmark card shows the post actions and does not treat the note as the tweet', () => {
  const html = deferredCard(bookmark, TOPICS);
  assert.match(html, /Build now/);
  assert.match(html, /data-s="approve"/);
  assert.match(html, /data-s="reject"/);
  assert.match(html, /data-edit/);
  assert.match(html, /From your bookmarks/);
  assert.match(html, /open on X/);
  assert.match(html, /Start from this post/);
  assert.doesNotMatch(html, /admin quick-add \(deferred\)/);
  assert.match(html, /id="u33"/);
  assert.match(html, /Pop Culture/);
  for (const name of TOPICS) assert.ok(html.includes(name), name);
});

test('an already-approved card can be built or rejected, not approved twice', () => {
  const s = { ...bookmark, id: 32, result: 'waiting: approved', title: 'Grok vs. @ada: Taxes', topic_list: ['Money'] };
  s.status_label = deferredStatus(s).label;
  s.actions = deferredActions(s);
  const html = deferredCard(s, TOPICS);
  assert.match(html, /Build now/);
  assert.match(html, /data-s="reject"/);
  assert.doesNotMatch(html, /data-s="approve"/);
  assert.match(html, /Grok vs\. @ada: Taxes/);
  assert.match(html, /Topic: Money/);
  assert.match(html, /data-topic="Money"[^>]*class="on"/);
});

test('preview text is escaped and a reply is labelled', () => {
  const html = previewBlock({
    source: 'syndication', context: true, more: true,
    posts: [
      { tweet_id: '1', handle: 'bob', name: 'Bob', text: 'root <script>' },
      { tweet_id: '2', handle: 'ada', name: 'Ada', text: 'the point' },
    ],
  });
  assert.match(html, /Replying to/);
  assert.match(html, /This post/);
  assert.match(html, /root &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /continues above/);
  const gone = previewBlock({ gone: true, reason: 'protected' });
  assert.match(gone, /private/);
  assert.match(previewBlock({ error: 'x' }), /Retry/);
  const only = previewBlock({ source: 'oembed', context: false, posts: [{ handle: 'ada', name: 'Ada', text: 'hi' }] });
  assert.match(only, /isn’t in this free preview/);
});
