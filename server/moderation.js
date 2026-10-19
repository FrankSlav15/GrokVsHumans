// Simple content rules for comments. Not a substitute for human moderation:
// reports and the /admin page handle everything this misses.

export const MAX_COMMENT = 500;
export const RATE_WINDOW = 600;   // seconds
export const RATE_MAX = 5;        // comments per window per user
export const AUTO_HIDE_REPORTS = 3;

// Lower-case word stems; matched against a normalised copy of the text
// (lower case, common leetspeak undone, punctuation removed).
const BANNED = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink', 'wetback', 'tranny',
  'coon', 'gook', 'raghead', 'beaner', 'cunt',
  'kill yourself', 'kys',
];

function normalise(text) {
  return ' ' + text.toLowerCase()
    .replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ') + ' ';
}

export function findBannedWord(text) {
  const n = normalise(text);
  for (const w of BANNED) {
    // whole word, or the word followed by a plural/verb suffix
    const re = new RegExp(`\\s${w.replace(/ /g, '\\s')}(s|es|ed|ing)?\\s`);
    if (re.test(n)) return w;
  }
  return null;
}

// Trim, normalise line breaks, cap blank lines. Returns [clean, error].
export function cleanComment(raw) {
  if (typeof raw !== 'string') return [null, 'empty'];
  let s = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return [null, 'empty'];
  if ([...s].length > MAX_COMMENT) return [null, 'too_long'];
  if ((s.match(/https?:\/\//gi) || []).length > 2) return [null, 'too_many_links'];
  if (findBannedWord(s)) return [null, 'blocked_words'];
  return [s, null];
}
