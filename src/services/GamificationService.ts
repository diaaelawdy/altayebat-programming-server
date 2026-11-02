import type { Types } from 'mongoose';
import { StudyRepository, UserRepository } from '../repositories/index.js';
import type { BadgeKey } from '../shared/badges.js';
import { cairoDay, previousDay } from '../lib/text.js';
import { NotificationService } from './NotificationService.js';

type Id = Types.ObjectId;

/** Reputation awarded to a post's author per vote, by target type. */
const VOTE_WEIGHTS = {
  answer: { up: 5, down: -1 },
  comment: { up: 2, down: 0 },
  review: { up: 2, down: 0 },
} as const;
export const QUESTION_APPROVED_REP = 15;

export const GamificationService = {
  voteReputation(targetType: keyof typeof VOTE_WEIGHTS, prev: number, next: number) {
    const w = VOTE_WEIGHTS[targetType];
    const val = (v: number) => (v === 1 ? w.up : v === -1 ? w.down : 0);
    return val(next) - val(prev);
  },

  async award(userId: Id, key: BadgeKey) {
    const r = await UserRepository.addBadge(userId, key);
    if (r.modifiedCount) await NotificationService.notify(userId, 'badge.awarded', { badge: key });
  },

  /** Records activity for the heatmap and advances the daily streak. */
  async recordActivity(userId: Id) {
    const today = cairoDay();
    await StudyRepository.bumpActivity(userId, today);
    const user = await UserRepository.findById(userId);
    if (!user) return;
    const s = user.streak ?? { current: 0, longest: 0, lastDay: null };
    if (s.lastDay === today) return;
    const current = s.lastDay === previousDay(today) ? (s.current ?? 0) + 1 : 1;
    const longest = Math.max(s.longest ?? 0, current);
    await UserRepository.setStreak(userId, { current, longest, lastDay: today });
    if (current >= 7) await this.award(userId, 'streak_7');
    if (current >= 30) await this.award(userId, 'streak_30');
  },
};
