/** Badge catalog. Keep in sync with client/src/shared/badges.ts. */
export const BADGES = {
  first_answer: 'Posted a first answer',
  helpful: 'An answer reached a score of 10',
  first_question: 'First question approved',
  contributor: '5 questions approved',
  first_review: 'Reviewed a company',
  voter: 'Cast 25 votes',
  studied_10: 'Studied 10 questions',
  studied_50: 'Studied 50 questions',
  company_complete: 'Studied every question at a company',
  streak_7: '7-day study streak',
  streak_30: '30-day study streak',
} as const;

export type BadgeKey = keyof typeof BADGES;
