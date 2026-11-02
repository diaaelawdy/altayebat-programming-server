import { Types } from 'mongoose';
import { Vote, type VoteTarget } from '../models/index.js';

type Id = Types.ObjectId | string;

export const VoteRepository = {
  find: (targetType: VoteTarget, targetId: Id, userId: Id) =>
    Vote.findOne({ targetType, targetId, userId }).lean(),
  create: (targetType: VoteTarget, targetId: Id, userId: Id, value: 1 | -1) =>
    Vote.create({ targetType, targetId, userId, value }),
  /** Compare-and-set on the stored value so concurrent toggles can't double-count. */
  change: (id: Id, from: number, to: 1 | -1) =>
    Vote.updateOne({ _id: id, value: from }, { $set: { value: to } }),
  remove: (id: Id, value: number) => Vote.deleteOne({ _id: id, value }),
  /** Viewer's votes on a batch of targets → Map<targetId, value>. */
  async mine(targetType: VoteTarget, targetIds: Id[], userId?: Id | null) {
    if (!userId || !targetIds.length) return new Map<string, number>();
    const votes = await Vote.find({
      targetType,
      userId,
      targetId: { $in: targetIds.map((i) => new Types.ObjectId(String(i))) },
    })
      .select('targetId value')
      .lean();
    return new Map(votes.map((v) => [String(v.targetId), v.value]));
  },
};
