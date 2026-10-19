// GET /api/votes -> { totals: { "<battleId>": {grok, human, legacy_grok, legacy_human} }, mine: { "<battleId>": "grok"|"human" } }
import { getSessionUser, voteTotals, json } from '../../server/lib.js';

export async function onRequestGet({ request, env }) {
  const [totals, user] = await Promise.all([voteTotals(env), getSessionUser(env, request)]);
  const mine = {};
  if (user) {
    const { results } = await env.DB.prepare(
      "SELECT item_id, choice FROM votes WHERE item_type = 'battle' AND x_id = ?1").bind(user.x_id).all();
    for (const r of results) mine[r.item_id] = r.choice;
  }
  return json({ totals, mine, signedIn: !!user });
}
