export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Calendar day in Cairo, used for streaks and the activity heatmap. */
export function cairoDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const ADJ = [
  'calm',
  'clever',
  'quiet',
  'brave',
  'swift',
  'bright',
  'kind',
  'keen',
  'bold',
  'wise',
  'lucky',
  'sunny',
  'nimble',
  'steady',
  'silent',
  'curious',
];
const NOUN = [
  'falcon',
  'otter',
  'lynx',
  'heron',
  'fox',
  'owl',
  'panda',
  'tiger',
  'koala',
  'raven',
  'dolphin',
  'ibis',
  'camel',
  'gazelle',
  'sparrow',
  'cobra',
];

export function randomUsername(): string {
  const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
  return `${pick(ADJ)}_${pick(NOUN)}${Math.floor(100 + Math.random() * 900)}`;
}
