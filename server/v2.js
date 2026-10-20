// v2 shared logic: topic suggestions, text cleanup, oEmbed existence check, feed ranking.
// Used by Pages Functions and by the fetch Worker (workers/fetch).

// To add a topic: add it here (before 'Wild Card'), add a keyword rule in RULES (optional) and a migration
// `INSERT OR IGNORE INTO topics (name, sort) VALUES ('Name', n);`. Feed filters, admin picker and the Worker read this list.
export const TOPICS = ['Politics', 'Technology', 'Memology', 'Sports', 'Pop Culture', 'Life Advice', 'History', 'Science', 'Money', 'Health', 'Religion', 'Philosophy', 'AI', 'Space', 'Gaming', 'Food', 'Animals', 'Wild Card'];

// Free keyword rules (no API cost). Each match adds 1 point; top 2 topics with >=1 point win.
const RULES = {
  Politics: /\b(trump|biden|harris|vance|obama|congress|senate|election|vote[sd]?|democrat|republican|gop|maga|liberal|conservative|president|government|policy|tariff|immigra\w*|border|white house|supreme court|left[- ]wing|right[- ]wing|politic\w*|minister|parliament|war|ukraine|israel|gaza|iran|nato)\b/i,
  Technology: /\b(tesla|spacex|starship|robot\w*|software|code|coding|app|iphone|android|apple|google|microsoft|nvidia|chip|gpu|crypto\w*|bitcoin|internet|algorithm|computer|tech)\b/i,
  Memology: /\b(meme\w*|lol|lmao|based|ratio|cope|seethe|fr fr|skibidi|rizz|sigma|npc|touch grass|💀|😂)\b|💀|😂|🤣/i,
  Sports: /\b(nfl|nba|mlb|nhl|fifa|soccer|football|basketball|baseball|hockey|ufc|boxing|olympic\w*|super bowl|world cup|quarterback|coach|playoff\w*|messi|ronaldo|lebron|f1|formula 1)\b/i,
  'Pop Culture': /\b(movie|film|netflix|tv show|series|celebrity|taylor swift|kanye|drake|beyonce|album|song|music|rapper|hollywood|oscar\w*|grammy|anime|marvel|star wars|game of thrones|tiktok|influencer)\b/i,
  'Life Advice': /\b(should i|advice|relationship|girlfriend|boyfriend|wife|husband|dating|marriage|divorce|parent\w*|kids?|job|career|boss|how do i|what should)\b/i,
  History: /\b(history|historical|ancient|medieval|century|empire|roman|rome|napoleon|hitler|ww2|wwii|world war|civil war|1[0-9]{3}s?|founding fathers|pharaoh|viking)\b/i,
  Science: /\b(science|scientist|physics|chemistry|biology|evolution|quantum|climate|vaccine|virus|dna|gene\w*|study|research|math|atom|gravity)\b/i,
  Money: /\b(money|stock\w*|market|invest\w*|economy|economic\w*|inflation|recession|dollar|tax\w*|salary|rich|billionaire|debt|loan|rent|mortgage|price\w*|cost|bank\w*|fed|interest rate|\$\d)/i,
  Health: /\b(health\w*|medical|medicine|doctor|hospital|disease|cancer|prostate|diabetes|heart attack|symptom\w*|diet\w*|nutrition|calorie\w*|protein|keto|fasting|weight loss|obes\w*|workout|exercise|fitness|gym|muscle|sleep|anxiety|depress\w*|mental health|therapy|vaccine\w*|drug\w*|ketamine|supplement\w*|peptide\w*|pathogen|infection|antibiotic\w*|bacteri\w*)\b/i,
  Religion: /\b(god|jesus|christ\w*|bible|biblical|gospel|church|catholic|pope|islam\w*|muslim\w*|quran|koran|hadith|muhammad|prophet|allah|jew\w*|judaism|torah|talmud|rabbi\w*|hindu\w*|buddh\w*|religio\w*|faith|afterlife|heaven|hell|sin|pray\w*|atheis\w*|antichrist|genesis|scripture|mormon|baptism|hijab|jannah|theolog\w*|spiritual\w*)\b/i,
  Philosophy: /\b(philosoph\w*|meaning of life|meaning|purpose|consciousness|free will|morality|moral\w*|ethic\w*|existential\w*|nihilis\w*|ontolog\w*|metaphysic\w*|hegel|nietzsche|plato|aristotle|kant|socrates|stoic\w*|truth|reality|simulation)\b/i,
  AI: /\b(ai|a\.i\.|artificial intelligence|llm\w*|gpt\w*|chatgpt|openai|anthropic|claude|xai|gemini|chatbot\w*|neural net\w*|machine learning|agi|transformer|grok \d|model\w*)\b/i,
  Space: /\b(space|nasa|spacex|starship|rocket\w*|planet\w*|mars|moon|lunar|orbit\w*|astronaut\w*|galax\w*|universe|cosmos|cosmic|big bang|black holes?|stars?|telescope|asteroid\w*|vacuum decay|alien\w*)\b/i,
  Gaming: /\b(video games?|gaming|gamer\w*|playstation|ps5|xbox|nintendo|switch 2|steam|fortnite|minecraft|roblox|call of duty|gta|zelda|pokemon|final fantasy|ufc 5|fps|rpg|esports|graphics)\b/i,
  Food: /\b(food\w*|eat\w*|recipe\w*|cook\w*|baking|baklava|pizza|burger\w*|restaurant\w*|cuisine|dish|meal\w*|breakfast|lunch|dinner|snack\w*|coffee|beer|wine|meat|vegan|chef)\b/i,
  Animals: /\b(animal\w*|dog\w*|cat|cats|kitten\w*|puppy|puppies|pet\w*|bird\w*|owl\w*|horse\w*|cow\w*|shark\w*|whale\w*|lion\w*|tiger\w*|bear\w*|snake\w*|insect\w*|bee|bees|wasp\w*|ladybug\w*|yellow jacket\w*|wildlife|zoo|species|dinosaur\w*)\b/i,
};
// X context annotation domain names (when the API returns them) -> topic.
const DOMAIN_MAP = [
  [/politic|government|election/i, 'Politics'], [/artificial intelligence|\bai\b|machine learning/i, 'AI'], [/tech|software|digital/i, 'Technology'], [/video game|gaming|esports/i, 'Gaming'], [/food|cuisine|restaurant/i, 'Food'], [/animal|pet|wildlife/i, 'Animals'], [/astronom|space/i, 'Space'],
  [/sport|athlete|league|team/i, 'Sports'], [/music|movie|tv|entertainment|celebrity|actor|musician/i, 'Pop Culture'],
  [/science/i, 'Science'], [/health|medic|fitness/i, 'Health'], [/religio|faith/i, 'Religion'], [/business|financ|stock|cryptocurrenc|economic/i, 'Money'], [/history/i, 'History'],
];

export function suggestTopics(texts, annotations = []) {
  const all = texts.join('\n');
  const score = {};
  for (const [t, re] of Object.entries(RULES)) {
    const m = all.match(new RegExp(re.source, 'gi'));
    if (m) score[t] = m.length;
  }
  for (const a of annotations || []) {
    const name = a?.domain?.name || '';
    for (const [re, t] of DOMAIN_MAP) if (re.test(name)) score[t] = (score[t] || 0) + 2;
  }
  const out = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  return out.length ? out : ['Wild Card'];
}

// Strip leading @mentions of reply chains and trailing t.co media links.
// Text for a turn that carries media or a quoted post: mentions-only text is dropped (the media/quote is the content).
export function turnText(text, media) {
  const s = cleanText(text);
  return media?.length && /^(@\w+\s*)*$/.test(s) ? '' : s;
}
export function cleanText(text, range) {
  let s = text;
  if (Array.isArray(range) && range[0] > 0) s = [...s].slice(range[0]).join('');
  const noLink = s.replace(/(\s*https:\/\/t\.co\/\w+)+$/, '');
  s = noLink.replace(/^(@\w+\s*)+/, '');
  if (!s.trim()) s = noLink;   // mentions-only reply: keep the mentions rather than an empty turn
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// oEmbed: free existence check used by the daily re-check of approved posts.
export async function oembedAlive(tweetId, fetchImpl = fetch) {
  const r = await fetchImpl(`https://publish.twitter.com/oembed?url=${encodeURIComponent('https://twitter.com/i/status/' + tweetId)}&omit_script=1`, { redirect: 'follow' });
  if (r.status === 404 || r.status === 403) return false;   // deleted / protected
  return r.ok ? true : null;                                // null = unknown (rate limit, outage)
}

// Ranking (same formula as the approved mockup).
export const engagement = p => p.votes.grok + p.votes.human + 2 * p.likes + 3 * p.comments - p.dislikes;
export const hotScore = (p, nowSec) => (engagement(p) + (p.featured ? 5 : 0) + 1) / Math.pow((nowSec - p.approved_at) / 3600 + 2, 1.5);

// Insert a post with its chain + suggested topics. Returns the new id (or null if it existed).
export async function insertPost(DB, p) {
  const t = Math.floor(Date.now() / 1000);
  const row = await DB.prepare(
    `INSERT OR IGNORE INTO posts (grok_tweet_id, conversation_id, human_x_id, human_handle, headline, status, source, x_engagement, tweet_created_at, fetched_at, low_priority)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?10) RETURNING id`)
    .bind(p.grok_tweet_id, p.conversation_id, p.human_x_id, p.human_handle, p.headline || null, p.source || 'fetch',
      p.x_engagement || 0, p.tweet_created_at || null, t, p.low_priority ? 1 : 0).first();
  if (!row) return null;
  const stmts = p.tweets.slice(0, 20).map((w, i) => DB.prepare(
    `INSERT INTO post_tweets (post_id, pos, tweet_id, author_id, author_handle, author_name, author_avatar, verified, is_grok, text, media_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
    .bind(row.id, i, w.tweet_id, w.author_id, w.author_handle, w.author_name, w.author_avatar, w.verified ? 1 : 0,
      String(w.author_handle).toLowerCase() === 'grok' ? 1 : 0, w.text, JSON.stringify(w.media || []), w.created_at));
  for (const topic of p.topics || []) stmts.push(DB.prepare('INSERT OR IGNORE INTO post_topics (post_id, topic, suggested) VALUES (?1, ?2, 1)').bind(row.id, topic));
  await DB.batch(stmts);
  return row.id;
}

// Old format (kept to recognise auto-generated, never-edited headlines when regenerating).
export function legacyHeadline(tweets) {
  const human = tweets.find(w => String(w.author_handle).toLowerCase() !== 'grok');
  let s = (human?.text || tweets[0]?.text || '').replace(/@grok\b/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 80) s = s.slice(0, 77).replace(/\s+\S*$/, '') + '…';
  return s || 'Grok vs. a human';
}
// Fallback "Grok vs. @handle: <question>", capped at ~60 chars on a word boundary.
export const HEADLINE_MAX = 60;
export function suggestHeadline(tweets) {
  const human = tweets.find(w => String(w.author_handle).toLowerCase() !== 'grok' && w.author_handle && w.author_handle !== '?');
  if (!human) return 'Grok vs. a human';
  const q = (human.text || '').replace(/@grok\b/gi, '').replace(/https?:\/\/\S+/g, '').replace(/^(\s*@\w+)+/, '')
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?=[,;:.!?])/g, '')
    .replace(/^(hey|hi|yo|ok|okay|so)\s*[,:!.]\s*$/i, '').replace(/^[\s,:;.!\-–—]+/, '').trim();
  const head = `Grok vs. @${human.author_handle}`;
  if (!q) return head;
  let s = `${head}: ${q}`;
  if (s.length > HEADLINE_MAX) {
    let cut = s.slice(0, HEADLINE_MAX - 1);
    const sp = cut.lastIndexOf(' ');
    if (sp > head.length + 1) cut = cut.slice(0, sp);
    s = cut.replace(/[\s,:;.\-–—]+$/, '') + '…';
  }
  return s;
}
