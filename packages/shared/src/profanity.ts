/**
 * Lightweight profanity filter for character names and chat.
 *
 * Two lists avoid the "Scunthorpe problem":
 *  - STRONG terms are blocked even inside longer words (they rarely appear innocently).
 *  - WORD terms are only blocked as whole words ("ass" is blocked, "Cassandra" is fine).
 * ALLOW lists innocent words that contain a STRONG term ("shiitake", "therapist").
 *
 * Covers common English and Filipino/Tagalog terms. This is a first line of
 * defence; mute/report/moderation tools back it up.
 */
const STRONG = [
  'fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nigger', 'nigga', 'faggot',
  'rapist', 'nazi', 'hitler', 'wank', 'dildo', 'penis', 'vagina', 'porn', 'pussy', 'asshole',
  'motherf', 'putangina', 'tangina', 'putangin', 'pakyu', 'tarantado', 'kantot', 'jakol', 'tranny',
];

const WORD = [
  'ass', 'arse', 'cock', 'dick', 'rape', 'raped', 'pedo', 'paedo', 'spic', 'chink', 'kike', 'fag',
  'cum', 'tits', 'retard', 'retarded', 'bastard', 'kys', 'puta', 'gago', 'ulol', 'kupal', 'tite',
];

const ALLOW = ['shiitake', 'shitake', 'scunthorpe', 'therapist', 'therapists', 'cocktail', 'peacock', 'hancock'];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
};

/** Lowercase, strip accents, undo leetspeak, keep letters only. */
export function normalizeForFilter(text: string): string {
  const lower = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of lower) out += LEET[ch] ?? ch;
  return out.replace(/[^a-z]/g, '');
}

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

function hasStrong(text: string): boolean {
  const base = normalizeForFilter(text);
  for (const v of [base, collapse(base)]) {
    let s = v;
    for (const ok of ALLOW) s = s.split(ok).join('|');
    if (STRONG.some((w) => s.includes(w) || s.includes(collapse(w)))) return true;
  }
  return false;
}

function isBadWord(token: string): boolean {
  const n = normalizeForFilter(token);
  if (!n) return false;
  const forms = new Set([n, collapse(n)]);
  for (const f of [...forms]) if (f.length > 3 && f.endsWith('s')) forms.add(f.slice(0, -1));
  return [...forms].some((f) => WORD.includes(f));
}

const splitTokens = (text: string) => text.split(/[\s_.,!?;:'"()\-]+/).filter(Boolean);

/** Chat-style check: each word is judged on its own (no false hits across word boundaries). */
export function containsProfanity(text: string): boolean {
  return splitTokens(text).some((t) => hasStrong(t) || isBadWord(t));
}

/** Names are judged as a whole too, so "F_u_c_k" or "Sh1t_Lord" are caught. */
export function isOffensiveName(name: string): boolean {
  return hasStrong(name) || containsProfanity(name);
}

/** Replace offending words in chat with asterisks, keeping the rest of the message. */
export function maskProfanity(text: string): string {
  return text.replace(/\S+/g, (token) => (hasStrong(token) || isBadWord(token) ? '*'.repeat(Math.min(Math.max(token.length, 3), 8)) : token));
}
