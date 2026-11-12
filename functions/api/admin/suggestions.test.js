import test from 'node:test';
import assert from 'node:assert/strict';
import { QA_NOTE, APPROVED_WAITING } from '../../../server/deferred.js';
import { handleSuggestionGet, handleSuggestionPost } from './suggestions.js';

function db(seed) {
  const suggestions = seed.map(s => ({ ...s }));
  const kv = new Map();
  const audits = [];
  const headlines = [];
  const topicRows = [];
  function touch(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM suggestions WHERE id')) return suggestions.find(r => r.id === args[0]) || null;
    if (s.includes('tweet_id = ?1 AND id <>')) return suggestions.find(r => r.tweet_id === args[0] && r.id !== args[1]) || null;
    if (s.includes('FROM post_tweets') || s.includes("grok_tweet_id = ?1 LIMIT 1")) return null;
    if (s.startsWith('UPDATE suggestions SET url')) {
      const row = suggestions.find(r => r.id === args[0]);
      Object.assign(row, { url: args[1], tweet_id: args[2], title: args[3], topics: args[4], updated_at: args[5] });
      return { meta: { changes: 1 } };
    }
    if (s.includes("result = ?2") && s.includes("state = 'queued'")) {
      const row = suggestions.find(r => r.id === args[0]);
      Object.assign(row, { state: 'queued', result: args[1], updated_at: args[2] });
      return { meta: { changes: 1 } };
    }
    if (s.includes("result = NULL")) {
      const row = suggestions.find(r => r.id === args[0]);
      Object.assign(row, { state: 'queued', result: null, updated_at: args[1] });
      return { meta: { changes: 1 } };
    }
    if (s.includes("state = 'rejected'")) {
      const row = suggestions.find(r => r.id === args[0]);
      Object.assign(row, { state: 'rejected', updated_at: args[1] });
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE feature_requests') || (s.includes('feature_requests') && s.startsWith('UPDATE'))) return { meta: {} };
    if (s.includes('admin_log')) { audits.push(args); return { meta: {} }; }
    if (s.startsWith('UPDATE posts SET headline')) { headlines.push(args); return { meta: {} }; }
    if (s.includes('DELETE FROM post_topics') || s.includes('INSERT OR IGNORE INTO post_topics')) { topicRows.push(args); return { meta: {} }; }
    if (s.includes('FROM kv')) return kv.has(args[0]) ? { v: kv.get(args[0]) } : null;
    if (s.includes('INTO kv')) { kv.set(args[0], args[1]); return { meta: {} }; }
    if (s.includes('GROUP BY state')) return { results: [{ state: 'queued', n: suggestions.length }] };
    if (s.includes('FROM suggestions s JOIN')) return { results: suggestions.filter(r => r.state === args[0]) };
    throw new Error('unexpected SQL: ' + s.slice(0, 160));
  }
  const DB = {
    prepare(sql) {
      const stmt = args => ({
        _sql: sql,
        first: async () => {
          const r = touch(sql, args);
          return r && r.results ? (r.results[0] || null) : r;
        },
        run: async () => touch(sql, args) || { meta: {} },
        all: async () => {
          const r = touch(sql, args);
          return r && r.results ? r : { results: [] };
        },
      });
      return { ...stmt([]), bind(...args) { return stmt(args); } };
    },
    batch: async stmts => {
      const out = [];
      for (const st of stmts) out.push(sqlOf(st).includes('SELECT') ? await st.all() : await st.run());
      return out;
    },
  };
  const sqlOf = st => st._sql || '';
  return { DB, suggestions, audits, headlines, topicRows };
}

const admin = { x_id: '1477077739924594696', handle: 'SlavisTon' };
const bookmark = { id: 33, x_id: admin.x_id, handle: 'SlavisTon', tweet_id: '100', url: 'https://x.com/i/status/100', note: QA_NOTE, state: 'queued', result: 'waiting: bookmark import', title: null, topics: null, banned: 0 };

async function body(res) { return { status: res.status, ...(await res.json()) }; }

test('list marks deferred rows and does not call the network', async () => {
  const { DB } = db([bookmark, { ...bookmark, id: 4, note: 'a user note', state: 'new', result: null }]);
  const res = await body(await handleSuggestionGet({ DB }, new URL('https://x.test/api/admin/suggestions?state=queued')));
  assert.equal(res.status, 200);
  assert.equal(res.suggestions.length, 1);
  assert.equal(res.suggestions[0].deferred, true);
  assert.equal(res.suggestions[0].actions.approve, true);
  assert.ok(res.topics.includes('Health'));
});

test('approve marks a bookmark for the next run and does not call the worker', async () => {
  const mem = db([bookmark]);
  let called = false;
  const env = { DB: mem.DB, FETCH: { buildDeferred: async () => { called = true; return { ok: true }; } } };
  const res = await body(await handleSuggestionPost(env, admin, { id: 33, action: 'approve' }));
  assert.equal(res.when, 'next_run');
  assert.equal(mem.suggestions[0].result, APPROVED_WAITING);
  assert.equal(called, false);
});

test('edit changes the start post, title and topics', async () => {
  const mem = db([{ ...bookmark }]);
  const res = await body(await handleSuggestionPost({ DB: mem.DB }, admin, {
    id: 33, action: 'edit', url: 'https://x.com/ada/status/555', title: '  Grok vs. @ada: Taxes ', topics: ['money', 'nope', 'AI'],
  }));
  assert.equal(res.status, 200);
  assert.equal(mem.suggestions[0].tweet_id, '555');
  assert.equal(mem.suggestions[0].url, 'https://x.com/i/status/555');
  assert.equal(mem.suggestions[0].title, 'Grok vs. @ada: Taxes');
  assert.deepEqual(JSON.parse(mem.suggestions[0].topics), ['Money', 'AI']);
  assert.equal(mem.suggestions[0].state, 'queued');
});

test('edit rejects a bad link and a tweet already suggested', async () => {
  const mem = db([bookmark, { ...bookmark, id: 9, tweet_id: '777', state: 'rejected' }]);
  const bad = await body(await handleSuggestionPost({ DB: mem.DB }, admin, { id: 33, action: 'edit', url: 'https://example.com/1' }));
  assert.equal(bad.status, 400);
  assert.equal(bad.error, 'bad_url');
  const dup = await body(await handleSuggestionPost({ DB: mem.DB }, admin, { id: 33, action: 'edit', url: 'https://x.com/i/status/777' }));
  assert.equal(dup.status, 409);
  assert.equal(mem.suggestions[0].tweet_id, '100');
});

test('build now calls the worker and keeps an admin title on the new post', async () => {
  const mem = db([{ ...bookmark, title: 'Grok vs. @ada: Taxes', topics: '["Money"]' }]);
  const env = { DB: mem.DB, FETCH: { buildDeferred: async ({ suggestionId }) => ({ ok: true, post_id: 501, post_ids: [501], cost: 0.04, suggestionId }) } };
  const res = await body(await handleSuggestionPost(env, admin, { id: 33, action: 'build' }));
  assert.equal(res.ok, true);
  assert.equal(res.title_applied, true);
  assert.deepEqual(mem.headlines[0], [501, 'Grok vs. @ada: Taxes']);
  assert.ok(mem.topicRows.some(r => r[1] === 'Money'));
});

test('build now with no allowance tells the page to wait, and reject still rejects', async () => {
  const mem = db([{ ...bookmark }]);
  const env = { DB: mem.DB, FETCH: { buildDeferred: async () => ({ deferred: true, reason: 'admin_cap', cost: 0 }) } };
  const res = await body(await handleSuggestionPost(env, admin, { id: 33, action: 'build' }));
  assert.equal(res.status, 202);
  assert.equal(res.reason, 'admin_cap');
  const rej = await body(await handleSuggestionPost(env, admin, { id: 33, action: 'reject' }));
  assert.equal(rej.ok, true);
  assert.equal(mem.suggestions[0].state, 'rejected');
});

test('a user suggestion still queues on approve', async () => {
  const mem = db([{ id: 4, state: 'new', note: 'look at this', tweet_id: '3', url: 'https://x.com/i/status/3' }]);
  const res = await body(await handleSuggestionPost({ DB: mem.DB }, admin, { id: 4, action: 'approve' }));
  assert.equal(res.ok, true);
  assert.equal(mem.suggestions[0].state, 'queued');
  assert.equal(mem.suggestions[0].result, null);
});

test('preview is admin-shaped JSON from the free lookup, not a paid call', async () => {
  const mem = db([{ ...bookmark, tweet_id: '20' }]);
  const res = await body(await handleSuggestionGet({ DB: mem.DB }, new URL('https://x.test/api/admin/suggestions?preview=33'), async () => ({
    status: 200, ok: true, async text() {
      return JSON.stringify({ __typename: 'Tweet', id_str: '20', text: 'just setting up my twttr', user: { name: 'jack', screen_name: 'jack' } });
    },
  })));
  assert.equal(res.preview.posts[0].handle, 'jack');
  assert.equal(res.preview.posts[0].text, 'just setting up my twttr');
  assert.equal(res.preview.source, 'syndication');
});
