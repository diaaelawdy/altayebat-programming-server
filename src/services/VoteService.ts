import type { Types } from 'mongoose';
import {
  AnswerRepository,
  CompanyCommentRepository,
  ReviewRepository,
  VoteRepository,
} from '../repositories/index.js';
import type { VoteTarget } from '../models/index.js';
import { BadRequest, Conflict, NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';

type Id = Types.ObjectId;
type Value = 0 | 1 | -1;

const targets = {
  answer: { find: AnswerRepository.findById, inc: AnswerRepository.inc },
  comment: { find: CompanyCommentRepository.findById, inc: CompanyCommentRepository.inc },
  review: { find: ReviewRepository.findById, inc: ReviewRepository.inc },
} satisfies Record<VoteTarget, unknown>;

function deltas(prev: Value, next: Value) {
  const up = (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
  const down = (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
  return { upvotes: up, downvotes: down, score: up - down };
}

export const VoteService = {
  /**
   * Sets the viewer's vote to `value` (0 clears). Clients send the desired state, so
   * "click again to remove" and "switch" are both just a new value.
   * Vote row changes are compare-and-set, and counters move by $inc, so it is safe under concurrency.
   */
  async cast(targetType: VoteTarget, targetId: string, voterId: Id, value: Value) {
    const t = targets[targetType];
    const target = (await t.find(targetId).catch(() => null)) as {
      _id: Id;
      authorId: Id;
      deletedAt?: Date | null;
      score: number;
    } | null;
    if (!target || target.deletedAt) throw new NotFound();
    if (String(target.authorId) === String(voterId))
      throw new BadRequest('You cannot vote on your own post');

    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await VoteRepository.find(targetType, target._id, voterId);
      const prev = (existing?.value ?? 0) as Value;
      if (prev === value) return { score: target.score, myVote: value };

      let applied = false;
      try {
        if (!existing) {
          await VoteRepository.create(targetType, target._id, voterId, value as 1 | -1);
          applied = true;
        } else if (value === 0) {
          applied = (await VoteRepository.remove(existing._id, prev)).deletedCount === 1;
        } else {
          applied = (await VoteRepository.change(existing._id, prev, value)).modifiedCount === 1;
        }
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
      }
      if (!applied) continue; // lost a race — re-read and retry

      const updated = (await t.inc(target._id, deltas(prev, value))) as { score: number } | null;
      const newScore = updated?.score ?? target.score;
      await events.emit('vote.cast', {
        targetType,
        targetId: target._id,
        targetAuthorId: target.authorId,
        voterId,
        previous: prev,
        value,
        newScore,
      });
      return { score: newScore, myVote: value };
    }
    throw new Conflict('Vote changed concurrently, please retry');
  },
};
