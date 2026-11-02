import { describe, expect, it } from 'vitest';
import { screen } from '../src/lib/profanity.js';

describe('profanity screen', () => {
  it('passes normal technical text in both languages', () => {
    for (const t of [
      'Use a hash map to count frequencies in O(n).',
      'اكسل شيت فيه زبون وكسب وكسر الحلقة',
      'Dickens wrote books; cockpit and scunthorpe are fine',
      'الحيوانات في المثال ده مجرد objects',
      'احاول احل المسألة وأحاسب الوقت',
      'خبرة في الخوارزميات',
    ])
      expect(screen(t).level, t).toBe('none');
  });

  it('refuses obscene words, including disguised spellings', () => {
    for (const t of [
      'what the fuuuck',
      'f u c k this',
      'fvck'.replace('v', 'u'),
      'يا متنااااك',
      'كسّ امك',
      'يلعن دينك',
      'sh1t f*ck'.replace('*', 'u'),
      'الشرموطه',
    ])
      expect(screen(t).level, t).toBe('severe');
  });

  it('flags everyday insults as mild', () => {
    for (const t of [
      'you are an idiot',
      'إنت غبي',
      'يا حمار',
      'this is stup1d',
      'ده زفت',
      'احا بقى',
      'أحاااا',
      'خخخخخ',
      'ده كلام خخخ',
    ])
      expect(screen(t).level, t).toBe('mild');
  });

  it('catches Franco-Arabic insults without flagging normal Latin text', () => {
    for (const t of [
      'kosomak',
      'ya metnaka',
      'ibn el sharmoota',
      'yel3an deenak',
      'ya khawal',
      '2a7ba',
    ])
      expect(screen(t).level, t).toBe('severe');
    for (const t of ['ya 7mar', 'enta ghaby', 'a7aaa', 'ya wes5a'])
      expect(screen(t).level, t).toBe('mild');
    for (const t of [
      'cosine similarity',
      'nickname',
      'tizen OS',
      'zebra',
      'nike',
      'arsenal',
      'ibn sina',
    ])
      expect(screen(t).level, t).toBe('none');
  });
});
