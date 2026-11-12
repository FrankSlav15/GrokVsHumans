import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPROVED_WAITING, BOOKMARK_WAITING, BUILDING, DEFERRED_READY_WHERE, QA_NOTE,
  applySuggestionPrefs, cachedPreview, chainFromTweet, deferredActions, deferredBuildable,
  deferredDecision, deferredStatus, loadPreview, normalizeTitle, normalizeTopics, oembedText,
  previewFromOembed, suggestionPrefs, synToken, syndicationText,
} from './deferred.js';

const row = (over) => ({ id: 1, state: 'queued', note: QA_NOTE, result: BOOKMARK_WAITING, updated_at: 1_000, ...over });

test('cron skips unreviewed bookmark imports and in-flight builds', () => {
  const now = 10_000;
  assert.equal(deferredBuildable(row(), now), false);
  assert.equal(deferredBuildable(row({ result: APPROVED_WAITING }), now), true);
  assert.equal(deferredBuildable(row({ result: 'waiting: admin_cap' }), now), true);
  assert.equal(deferredBuildable(row({ result: 'waiting: month_cap' }), now), true);
  assert.equal(deferredBuildable(row({ result: 'waiting: day_cap' }), now), true);
  assert.equal(deferredBuildable(row({ result: null }), now), true);
  assert.equal(deferredBuildable(row({ result: BUILDING, updated_at: now - 10 }), now), false);
  assert.equal(deferredBuildable(row({ result: BUILDING, updated_at: now - 901 }), now), true);
  assert.equal(deferredBuildable(row({ note: 'please add this', result: APPROVED_WAITING }), now), false);
  assert.equal(deferredBuildable(row({ state: 'failed', result: APPROVED_WAITING }), now), false);
  assert.match(DEFERRED_READY_WHERE, /waiting: bookmark import/);
  assert.match(DEFERRED_READY_WHERE, /building/);
});

test('actions: bookmark can be approved, a cap-wait cannot, a build in flight is frozen', () => {
  assert.deepEqual(deferredActions(row()), { preview: true, edit: true, build: true, approve: true, reject: true });
  assert.equal(deferredActions(row({ result: APPROVED_WAITING })).approve, false);
  assert.equal(deferredActions(row({ result: 'waiting: admin_cap' })).approve, false);
  assert.equal(deferredActions(row({ result: 'waiting: month_cap' })).build, true);
  assert.deepEqual(deferredActions(row({ result: BUILDING, updated_at: 9_999 })), { preview: true, edit: false, build: false, approve: false, reject: false });
  assert.equal(deferredActions(row({ state: 'failed', result: 'no Grok reply' })).approve, true);
  assert.match(deferredStatus(row()).label, /bookmarks/i);
  assert.match(deferredStatus(row({ result: 'waiting: admin_cap' })).label, /\$1/);
  assert.match(deferredStatus(row({ result: 'waiting: month_cap' })).label, /\$45/);
});

test('approve on a deferred row marks it; a user suggestion is queued the old way', () => {
  assert.equal(deferredDecision(row(), 'approve').op, 'mark');
  assert.equal(deferredDecision(row({ state: 'failed', result: 'gone' }), 'build').op, 'build');
  assert.equal(deferredDecision(row({ result: BUILDING, updated_at: Date.now() / 1000 }), 'edit').error, 'bad_state');
  assert.equal(deferredDecision({ id: 2, state: 'new', note: 'a thread about taxes' }, 'approve').op, 'queue-user');
  assert.equal(deferredDecision({ id: 2, state: 'queued', note: 'a thread' }, 'approve').error, 'bad_state');
  assert.equal(deferredDecision(row(), 'reject').op, 'reject');
  assert.equal(deferredDecision(row(), 'nope').error, 'bad_action');
});

test('title and topics are trimmed to what the build will store', () => {
  assert.equal(normalizeTitle('  Grok vs. @ada:  Is it   real? \n'), 'Grok vs. @ada: Is it real?');
  assert.equal(normalizeTitle('   '), null);
  assert.equal(normalizeTitle(null), null);
  assert.equal(normalizeTitle('x'.repeat(200)).length, 120);
  assert.deepEqual(normalizeTopics(['health', 'Not a topic', 'AI', 'Space']), ['Health', 'AI']);
  assert.deepEqual(normalizeTopics('["Philosophy"]'), ['Philosophy']);
  assert.deepEqual(normalizeTopics('nope'), []);
  assert.deepEqual(suggestionPrefs({ title: '  Hi there ', topics: '["Food","Food","Money"]' }), { title: 'Hi there', topics: ['Food', 'Money'] });
});

test('syndication text keeps the long note and drops the hidden reply prefix', () => {
  assert.equal(syndicationText({ text: '@edent hello there', display_text_range: [7, 18] }), 'hello there');
  assert.equal(syndicationText({ text: 'short', note_tweet: { text: 'the full note' } }), 'the full note');
  assert.equal(synToken('20'), '6dq1a2xwd93');
});

test('chain walks a nested parent and stops when the next post is not included', () => {
  const tweet = {
    id_str: '3', text: 'the bookmark', user: { screen_name: 'ada', name: 'Ada' },
    in_reply_to_status_id_str: '2',
    parent: { id_str: '2', text: 'the reply target', user: { screen_name: 'grok', name: 'Grok' }, in_reply_to_status_id_str: '1' },
  };
  const walked = chainFromTweet(tweet, 3);
  assert.deepEqual(walked.posts.map(p => p.tweet_id), ['2', '3']);
  assert.equal(walked.nextId, '1');
  assert.equal(walked.posts[1].handle, 'ada');
});

function jsonRes(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return { status, ok: status >= 200 && status < 300, async text() { return text; } };
}

test('preview uses one syndication call when the parent is nested, and oEmbed when it is down', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (String(url).includes('tweet-result')) {
      return jsonRes(200, {
        __typename: 'Tweet', id_str: '30', text: '@bob @grok why', display_text_range: [5, 14],
        user: { name: 'Ada', screen_name: 'ada' }, in_reply_to_status_id_str: '20', in_reply_to_screen_name: 'bob',
        parent: { id_str: '20', text: 'opening question', user: { name: 'Bob', screen_name: 'bob' } },
      });
    }
    return jsonRes(500, {});
  };
  const preview = await loadPreview('30', fetchImpl);
  assert.equal(preview.source, 'syndication');
  assert.equal(calls.length, 2); // bookmark, then the oldest post to see if the thread continues
  assert.deepEqual(preview.posts.map(p => p.handle), ['bob', 'ada']);
  assert.equal(preview.posts[1].text, '@grok why');
  assert.equal(preview.more, false);

  const down = [];
  const preview2 = await loadPreview('30', async (url) => {
    down.push(url);
    if (String(url).includes('oembed')) {
      return jsonRes(200, { author_name: 'Ada', author_url: 'https://x.com/ada', html: '<blockquote><p lang="en">Hello &amp; welcome</p></blockquote>' });
    }
    return jsonRes(429, 'no');
  });
  assert.equal(preview2.source, 'oembed');
  assert.equal(preview2.context, false);
  assert.equal(preview2.posts[0].text, 'Hello & welcome');
  assert.equal(preview2.posts[0].handle, 'ada');
  assert.ok(down.some(u => u.includes('oembed')));
});

test('a deleted post is gone, and a parent id without a nested body is fetched', async () => {
  const gone = await loadPreview('9', async (url) => jsonRes(String(url).includes('oembed') ? 404 : 404, ''));
  assert.equal(gone.gone, true);

  const ids = [];
  const preview = await loadPreview('5', async (url) => {
    const id = new URL(url).searchParams.get('id');
    ids.push(id);
    if (id === '5') return jsonRes(200, { __typename: 'Tweet', id_str: '5', text: 'leaf', user: { screen_name: 'ada' }, in_reply_to_status_id_str: '4' });
    return jsonRes(200, { __typename: 'Tweet', id_str: '4', text: 'root', user: { screen_name: 'bob' } });
  });
  assert.deepEqual(ids, ['5', '4']);
  assert.deepEqual(preview.posts.map(p => p.tweet_id), ['4', '5']);
  assert.equal(preview.more, false);
});

test('oEmbed html keeps link text and decodes entities', () => {
  assert.equal(oembedText('<p>Hello <a href="https://t.co/x">example.com</a> &amp; co</p>'), 'Hello example.com & co');
  const p = previewFromOembed({ author_name: 'Ada', author_url: 'https://x.com/ada', html: '<p>Hi</p>' });
  assert.equal(p.posts[0].handle, 'ada');
  assert.equal(p.context, false);
});

test('preview cache skips a fresh hit and refills when asked', async () => {
  const kv = new Map();
  const DB = {
    prepare(sql) {
      return { bind(...args) {
        return {
          first: async () => (sql.includes('FROM kv') && kv.has(args[0]) ? { v: kv.get(args[0]) } : null),
          run: async () => { if (sql.includes('INTO kv')) kv.set(args[0], args[1]); return { meta: {} }; },
        };
      } };
    },
  };
  let n = 0;
  const fetchImpl = async () => { n += 1; return jsonRes(200, { __typename: 'Tweet', id_str: '8', text: 'once', user: { screen_name: 'ada' } }); };
  const a = await cachedPreview(DB, '8', fetchImpl, { nowSec: 1_000 });
  const b = await cachedPreview(DB, '8', fetchImpl, { nowSec: 1_100 });
  const c = await cachedPreview(DB, '8', fetchImpl, { fresh: true, nowSec: 1_100 });
  assert.equal(a.cached, undefined);
  assert.equal(b.cached, true);
  assert.equal(c.posts[0].text, 'once');
  assert.equal(n, 2);
});

test('admin title is kept for one post and topics are marked admin-set; several battles keep their own titles', async () => {
  const seen = [];
  const DB2 = {
    prepare(sql) {
      return { bind(...args) {
        return { run: async () => { seen.push([sql.replace(/\s+/g, ' '), ...args]); return {}; } };
      } };
    },
    batch: async stmts => { for (const st of stmts) await st.run(); },
  };
  const one = await applySuggestionPrefs(DB2, [9], { title: 'Grok vs. @ada: Taxes', topics: '["Money"]' });
  assert.equal(one.title, true);
  assert.equal(one.topics, true);
  assert.ok(seen.some(r => r[0].startsWith('UPDATE posts') && r[2] === 'Grok vs. @ada: Taxes'));
  assert.ok(seen.some(r => String(r[0]).includes('post_topics') && r[0].includes(', 0)') && r[2] === 'Money'));
  seen.length = 0;
  const many = await applySuggestionPrefs(DB2, [3, 4], { title: 'Only one title', topics: ['AI'] });
  assert.equal(many.title, false);
  assert.equal(many.battles, 2);
  assert.equal(seen.filter(r => r[0].startsWith('UPDATE posts')).length, 0);
});

test('the fetching tab no longer says the worker runs every 10 minutes', () => {
  const help = readFileSync(new URL('../assets/admin/deferred-card.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../functions/admin/featured.js', import.meta.url), 'utf8');
  assert.match(help, /8:30 AM and 6:30 PM CST/);
  assert.doesNotMatch(help, /10 min/);
  assert.doesNotMatch(page, /every 10 min/);
  assert.match(page, /featured-app\.js/);
});
