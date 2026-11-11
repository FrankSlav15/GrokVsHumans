// True once migrations-v2/0017_branches.sql has been applied. Cached only after it is true,
// so a deploy of this code before the migration keeps the old feed and queue queries.
let ready = false;
export async function hasBranchSchema(env) {
  if (ready) return true;
  try {
    ready = !!(await env.DB.prepare("SELECT 1 AS ok FROM pragma_table_info('posts') WHERE name = 'thread_id'").first());
  } catch { ready = false; }
  return ready;
}
