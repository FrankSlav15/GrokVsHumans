// Lightweight language detection shared idea with assets/v2/feed.js (kept in sync by hand).
// Returns an ISO 639-1 code or null when unsure. Script ranges first, then stopword scoring for Latin languages.
export const LANGS = {
  en: 'English', es: 'Spanish', de: 'German', fr: 'French', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  tr: 'Turkish', sv: 'Swedish', ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', el: 'Greek', fa: 'Persian', ro: 'Romanian', cs: 'Czech',
};
const SCRIPTS = [[/[\u3040-\u30ff]/g, 'ja'], [/[\uac00-\ud7af]/g, 'ko'], [/[\u4e00-\u9fff]/g, 'zh'], [/[\u0600-\u06ff]/g, 'ar'],
  [/[\u0590-\u05ff]/g, 'he'], [/[\u0900-\u097f]/g, 'hi'], [/[\u0e00-\u0e7f]/g, 'th'], [/[\u0370-\u03ff]/g, 'el'], [/[\u0400-\u04ff]/g, 'ru']];
const STOP = {
  en: 'the and is are you that this what with for not have it was but they of to in be do does how why',
  es: 'el la los las que de y es en un una por para con no se lo como pero más muy está qué porque',
  de: 'der die das und ist nicht ich du sie ein eine mit auf für den dem zu auch wie aber was warum sehr',
  fr: 'le la les et est une des pas que qui pour avec dans ce je tu vous mais très pourquoi',
  pt: 'o os as que de e é em um uma não para com por mais muito você isso mas porque',
  it: 'il lo gli che di e è un una non per con sono ma più molto perché questo',
  nl: 'de het een en is niet dat van ik je met voor op maar ook wat waarom',
  pl: 'nie jest się to że na w i z do co jak ale tak',
  tr: 've bir bu da de ne için çok ama ben sen değil',
  sv: 'och är det att en som inte jag du med för på men',
  id: 'yang dan di ini itu tidak dengan untuk dari saya kamu ada',
};
const SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
export function strip(text) {
  return String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\w+/g, ' ');
}
export function detectLang(text) {
  const s = strip(text);
  for (const [re, code] of SCRIPTS) { const m = s.match(re); if (m && m.length >= 2) {
    if (code === 'ru' && /[іїєґ]/i.test(s)) return 'uk';
    if (code === 'ar' && /[پچژگ]/.test(s)) return 'fa';
    return code; } }
  const words = s.toLowerCase().match(/[a-zà-ÿąćęłńóśźżçğışö]+/g) || [];
  if (words.length < 3) return null;
  const score = {};
  for (const w of words) for (const k in SETS) if (SETS[k].has(w)) score[k] = (score[k] || 0) + 1;
  if (/[ñ¿¡]/.test(s)) score.es = (score.es || 0) + 2;
  if (/[äöüß]/.test(s)) score.de = (score.de || 0) + 1.5;
  if (/[ãõ]/.test(s)) score.pt = (score.pt || 0) + 2;
  const top = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!top.length || top[0][1] < 2) return null;
  if (top[1] && top[1][1] >= top[0][1] * 0.8) return null;   // ambiguous
  return top[0][0];
}
export const normLang = l => { const c = String(l || '').toLowerCase().split(/[-_]/)[0]; return LANGS[c] ? c : null; };
