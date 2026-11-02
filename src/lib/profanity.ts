/**
 * Two-level profanity screen for Arabic (incl. Egyptian) and English.
 * - severe: obscene/sexual words and slurs; the text is refused.
 * - mild: everyday insults; allowed after the author confirms, and auto-reported.
 * Text is normalized first (diacritics, letter variants, repeated letters, leetspeak,
 * spaced-out letters) and matched per word, with common Arabic prefixes/suffixes.
 */
export type ProfanityLevel = 'none' | 'mild' | 'severe';

const SEVERE_WORDS = [
  // English
  'fuck',
  'fucker',
  'fucking',
  'fucked',
  'motherfucker',
  'cunt',
  'pussy',
  'dick',
  'cock',
  'whore',
  'slut',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'porn',
  'blowjob',
  'cum',
  // Arabic
  'كس',
  'كسم',
  'كسمك',
  'كسختك',
  'كسامك',
  'زب',
  'زبر',
  'زبي',
  'طيز',
  'نيك',
  'انيك',
  'ينيك',
  'نيكه',
  'متناك',
  'متناكه',
  'منيوك',
  'منيوكه',
  'شرموط',
  'شرموطه',
  'شرمطه',
  'عرص',
  'معرص',
  'خول',
  'لبوه',
  'قحبه',
  'قحاب',
  'لواط',
  'لوطي',
  'منيك',
];
const SEVERE_STEMS = ['fuck', 'motherf', 'cunt', 'nigg', 'fagg', 'شرموط', 'متناك', 'منيوك', 'معرص'];
const SEVERE_PHRASES = [
  'يلعن دين',
  'دين امك',
  'دين ابوك',
  'كس امك',
  'ابن المتناكه',
  'son of a bitch',
];

const MILD_WORDS = [
  // English
  'shit',
  'damn',
  'crap',
  'bastard',
  'idiot',
  'احا',
  'stupid',
  'moron',
  'dumb',
  'asshole',
  'bitch',
  'wtf',
  'stfu',
  'jerk',
  'loser',
  'retard',
  // Arabic
  'حمار',
  'غبي',
  'اهبل',
  'عبيط',
  'متخلف',
  'زفت',
  'تافه',
  'كلب',
  'يلعن',
  'ملعون',
  'خرا',
  'خره',
  'وسخ',
  'واطي',
  'حقير',
  'قذر',
  'بهيم',
  'جزمه',
  'معفن',
  'غبيه',
  'حماره',
  'هبل',
  'بقره',
];

const PREFIXES = ['وال', 'فال', 'بال', 'لل', 'يال', 'ال', 'يا', 'و', 'ف', 'ب', 'ل'];
const SUFFIXES = ['كم', 'هم', 'ها', 'نا', 'ين', 'ات', 'كي', 'ك', 'ه', 'ي'];
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/(\p{L})\1+/gu, '$1'); // "fuuuck" → "fuck", "كسسس" → "كس"
}

function tokens(text: string) {
  const raw = normalize(text)
    .split(/[^\p{L}\p{N}@$]+/u)
    .filter(Boolean)
    .map((t) =>
      /\p{L}/u.test(t)
        ? [...t]
            .map((ch) => LEET[ch] ?? ch)
            .join('')
            .replace(/[^\p{L}]/gu, '')
        : '',
    )
    .filter(Boolean);
  // Re-join spaced-out letters: "f u c k" → "fuck".
  const out: string[] = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1) out.push(run);
      run = '';
      out.push(t);
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

const norm = (list: string[]) => new Set(list.map(normalize));
const SEVERE = norm(SEVERE_WORDS);
const MILD = norm(MILD_WORDS);
const STEMS = SEVERE_STEMS.map(normalize);
const PHRASES = SEVERE_PHRASES.map(normalize);

function variants(word: string) {
  const out = new Set([word]);
  for (const p of PREFIXES)
    if (word.startsWith(p) && word.length - p.length >= 2) out.add(word.slice(p.length));
  for (const w of [...out])
    for (const s of SUFFIXES)
      if (w.endsWith(s) && w.length - s.length >= 2) out.add(w.slice(0, -s.length));
  return out;
}

/**
 * Franco-Arabic (Arabic in Latin letters and digits: 3=ع, 7=ح, 5=خ, 2=ء).
 * Matched on lowercased raw text with repeated characters collapsed, because the
 * leetspeak step in tokens() would turn 3/7/5 into letters and break these spellings.
 * Each pattern is a whole word: not preceded or followed by a letter or digit.
 */
const FRANCO_SEVERE = [
  /k[ou]s(?:[oe]?m+(?:ak|ek|ik|k)?|okhtak|ekhtak|o5tak|e5tak|ak|ek)?/,
  /(?:a|ya|ye|y)?n[ie]+k(?:ak|ek|o|y|a|ny|ni)?/,
  /(?:el)?m[ei]?t?nak(?:a|ah|ah|ak|en|een|in)?/,
  /(?:el)?man?y[ou]+k(?:a|ah)?/,
  /(?:el)?sh?arm[ou]+[tt](?:a|ah|en|een)?/,
  /sharmata/,
  /m?3[ae]?rs(?:a|ah|een)?/,
  /(?:kh|5)[ae]?wal(?:a|een)?/,
  /z[eo]b(?:r|ry|ri|y|i)?/,
  /t[ie]+z(?:ak|ek|y|i|o)?/,
  /(?:2|a|ka)?a?7ba/,
  /lab?wa/,
  /(?:yel|yl|yi)3a?n\s*d[ei]+n(?:ak|ek|ik|k|o|ha|hom|kom)?/,
  /d[ei]+n\s*(?:omak|om+ak|om+ok|abok|abook|abouk)/,
].map((r) => new RegExp(`(?<![a-z0-9])(?:${r.source})(?![a-z0-9])`, 'g'));
const FRANCO_MILD = [
  /a7a/,
  /(?:ya\s*)?7[ou]?mar(?:a|ah)?/,
  /(?:gh|8)ab[iy](?:a|ah)?/,
  /a[h7]bal/,
  /3ab[ie]+t(?:a|ah)?/,
  /met?(?:kh|5)al(?:l)?[ie]?f(?:a|ah|een)?/,
  /zeft/,
  /w[ie]s(?:kh|5)(?:a|ah)?/,
  /7a(?:2|q|k)[ie]+r(?:a|ah)?/,
  /b[ae]h[ie]+m(?:a|ah)?/,
  /(?:kh|5)ara/,
  /gazma/,
  /m[ei]3af[ie]n/,
  /wa[2t]y/,
].map((r) => new RegExp(`(?<![a-z0-9])(?:${r.source})(?![a-z0-9])`, 'g'));

function francoMatches(text: string, patterns: RegExp[]) {
  const flat = text.toLowerCase().replace(/([a-z0-9])\1+/g, '$1');
  return patterns.flatMap((p) => [...flat.matchAll(p)].map((m) => m[0]));
}

const MILD_PATTERNS = /(?:^|[^\p{L}])خ{3,}(?=$|[^\p{L}])/gu;

export function screen(...texts: (string | undefined | null)[]): {
  level: ProfanityLevel;
  words: string[];
} {
  const joined = texts.filter(Boolean).join('\n');
  if (!joined) return { level: 'none', words: [] };
  const flat = ` ${tokens(joined).join(' ')} `;
  const severe: string[] = [
    ...PHRASES.filter((p) => flat.includes(` ${p}`)),
    ...francoMatches(joined, FRANCO_SEVERE),
  ];
  const mild: string[] = francoMatches(joined, FRANCO_MILD);
  // Mocking laughter ("خخخخ") is matched on the raw text, before repeats are collapsed.
  for (const m of joined.matchAll(MILD_PATTERNS)) mild.push(m[0].trim());
  for (const t of tokens(joined)) {
    const v = variants(t);
    if ([...v].some((w) => SEVERE.has(w)) || STEMS.some((s) => /^[a-z]/.test(s) && t.startsWith(s)))
      severe.push(t);
    else if ([...v].some((w) => MILD.has(w))) mild.push(t);
  }
  if (severe.length) return { level: 'severe', words: [...new Set(severe)] };
  if (mild.length) return { level: 'mild', words: [...new Set(mild)] };
  return { level: 'none', words: [] };
}
