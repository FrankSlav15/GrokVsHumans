import test from 'node:test';
import assert from 'node:assert/strict';
import { addOpening } from './branches.js';
import { GROK_ID } from '../../../server/qualify.js';

const G = GROK_ID;

function mem() {
  const db = { threads: [], posts: [], tweets: [], topics: [], rejects: [] };
  let n = 1;
  function exec(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT id FROM posts WHERE conversation_id')) {
      return db.posts.find(p => p.conversation_id === args[0]) || null;
    }
    if (s.startsWith('SELECT handle FROM blocked_authors')) return { results: [] };
    if (s.startsWith('INSERT INTO threads')) {
      const id = n++;
      db.threads.push({ id, args });
      return { id };
    }
    if (s.startsWith('INSERT INTO branch_rejects')) { db.rejects.push(args); return {}; }
    if (s.startsWith('INSERT OR IGNORE INTO posts')) {
      if (db.posts.some(p => p.grok_tweet_id === args[0])) return null;
      const id = n++;
      db.posts.push({ id, grok_tweet_id: args[0], conversation_id: args[1], headline: args[4], status: 'pending', source: args[5] });
      return { id };
    }
    if (s.startsWith('INSERT INTO post_tweets')) { db.tweets.push({ post_id: args[0], pos: args[1], tweet_id: args[2], text: args[9] }); return {}; }
    if (s.startsWith('INSERT OR IGNORE INTO post_topics')) { db.topics.push(args); return {}; }
    if (s.startsWith('UPDATE posts SET thread_id')) {
      const p = db.posts.find(x => x.id === args[0]);
      if (p) Object.assign(p, { thread_id: args[1], battle_score: args[2], battle_borderline: args[8], battle_flags: args[4], status: p.status });
      return {};
    }
    throw new Error('unexpected SQL: ' + s.slice(0, 120));
  }
  const DB = {
    prepare(sql) {
      const stmt = args => ({
        first: async () => {
          const r = exec(sql, args);
          return r && r.results ? (r.results[0] || null) : r;
        },
        run: async () => { exec(sql, args); return { meta: {} }; },
        all: async () => { const r = exec(sql, args); return { results: r.results || [] }; },
      });
      return { ...stmt([]), bind(...args) { return stmt(args); } };
    },
    batch: async stmts => { for (const st of stmts) await st.run(); },
  };
  return { DB, db };
}

function row(id, author, parent, text) {
  return {
    id: String(id), author_id: author === 'grok' ? G : 'u-' + author, text, conversation_id: '900',
    referenced_tweets: parent ? [{ type: 'replied_to', id: String(parent) }] : [],
  };
}
function debate(handle, start, parent) {
  const lines = [
    [`@grok but the report never checks the rolls, so the quiet number is not proof`, 'The report counts cases that were charged, which is a subset of what could be looked for.'],
    [`@grok so if the check is missing, calling it rare is a different claim than you started with`, 'Rare here means few proven cases, and a missing check is a separate limit of the data.'],
    [`@grok actually that concedes the gap: absence of proof is not proof of absence here`, 'A gap in checking does not by itself show a large hidden total either.'],
  ];
  const data = [];
  let p = parent, id = start;
  for (const [h, g] of lines) {
    data.push(row(id, handle, p, h));
    data.push(row(id + 1, 'grok', id, g));
    p = id + 1; id += 2;
  }
  return data;
}

test('mock X search: opening post stores pending battles and does not publish', async () => {
  const root = row(900, 'opener', null, 'Opening post: the state wants the list sequestered before anyone is checked.');
  const json = {
    data: [root, ...debate('ada', 910, 900), ...debate('bea', 920, 900),
      row(930, 'cy', 900, '@grok is that true?'), row(931, 'grok', 930, 'Yes, that part of the opening post matches the report.')],
    includes: { users: [
      { id: 'u-opener', username: 'opener' }, { id: 'u-ada', username: 'ada' },
      { id: 'u-bea', username: 'bea' }, { id: 'u-cy', username: 'cy' }, { id: G, username: 'grok' },
    ] },
  };
  let searches = 0;
  const { normalizeSearch } = await import('../../../server/qualify.js');
  const api = { search(max) { searches += 1; assert.ok(max >= 10 && max <= 80); return { tweets: normalizeSearch(json) }; } };
  const { DB, db } = mem();
  const env = { DB, AI: null };
  const rootRow = normalizeSearch({ data: [root], includes: json.includes })[0];
  const res = await addOpening(env, { runCap: 0.6, spent: 0.04 }, rootRow, { source: 'manual', x_id: '1', handle: 'admin' }, api);
  assert.equal(searches, 1);
  assert.equal(res.state, 'fetched');
  assert.equal(res.battles, 2);
  assert.equal(db.threads.length, 1);
  assert.equal(db.posts.length, 2);
  assert.ok(db.posts.every(p => p.status === 'pending'));
  assert.ok(db.posts.every(p => p.thread_id === db.threads[0].id));
  assert.ok(db.rejects.length >= 1);
  const again = await addOpening(env, { runCap: 0.6, spent: 0.04 }, rootRow, { source: 'manual' }, api);
  assert.equal(again.state, 'duplicate');
  assert.equal(db.posts.length, 2);
});
