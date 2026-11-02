import { Types } from 'mongoose';
import { ActivityDay, Bookmark, StudyList, StudyProgress } from '../models/index.js';

type Id = Types.ObjectId | string;
const oid = (v: Id) => new Types.ObjectId(String(v));

export const StudyRepository = {
  addBookmark: (userId: Id, questionId: Id, companyId: Id) =>
    Bookmark.updateOne({ userId, questionId }, { $setOnInsert: { companyId } }, { upsert: true }),
  removeBookmark: (userId: Id, questionId: Id) => Bookmark.deleteOne({ userId, questionId }),
  bookmarks: (userId: Id, w: { skip: number; take: number } = { skip: 0, take: 500 }) =>
    Bookmark.find({ userId }).sort({ createdAt: -1, _id: -1 }).skip(w.skip).limit(w.take).lean(),

  /** Returns true when a new studied mark was inserted. */
  async markStudied(userId: Id, questionId: Id, companyId: Id) {
    const r = await StudyProgress.updateOne(
      { userId, questionId },
      { $setOnInsert: { companyId } },
      { upsert: true },
    );
    return r.upsertedCount > 0;
  },
  async unmarkStudied(userId: Id, questionId: Id) {
    const r = await StudyProgress.deleteOne({ userId, questionId });
    return r.deletedCount > 0;
  },
  /** Flags for a batch of questions (avoids N+1 on lists). */
  async flags(userId: Id | null | undefined, questionIds: Id[]) {
    if (!userId || !questionIds.length)
      return { bookmarked: new Set<string>(), studied: new Set<string>() };
    const ids = questionIds.map(oid);
    const [b, s] = await Promise.all([
      Bookmark.find({ userId, questionId: { $in: ids } })
        .select('questionId')
        .lean(),
      StudyProgress.find({ userId, questionId: { $in: ids } })
        .select('questionId')
        .lean(),
    ]);
    return {
      bookmarked: new Set(b.map((x) => String(x.questionId))),
      studied: new Set(s.map((x) => String(x.questionId))),
    };
  },
  progressByCompany: (userId: Id) =>
    StudyProgress.aggregate<{ _id: Types.ObjectId; studied: number }>([
      { $match: { userId: oid(userId) } },
      { $group: { _id: '$companyId', studied: { $sum: 1 } } },
    ]),
  studiedCountFor: (userId: Id, companyId: Id) =>
    StudyProgress.countDocuments({ userId, companyId }),
  studiedCount: (userId: Id) => StudyProgress.countDocuments({ userId }),

  lists: (userId: Id) => StudyList.find({ userId }).sort({ updatedAt: -1 }).lean(),
  findList: (id: Id, userId: Id) => StudyList.findOne({ _id: id, userId }).lean(),
  createList: (userId: Id, name: string) => StudyList.create({ userId, name, questionIds: [] }),
  renameList: (id: Id, userId: Id, name: string) =>
    StudyList.updateOne({ _id: id, userId }, { $set: { name } }),
  deleteList: (id: Id, userId: Id) => StudyList.deleteOne({ _id: id, userId }),
  addToList: (id: Id, userId: Id, questionId: Id) =>
    StudyList.updateOne({ _id: id, userId }, { $addToSet: { questionIds: questionId } }),
  removeFromList: (id: Id, userId: Id, questionId: Id) =>
    StudyList.updateOne({ _id: id, userId }, { $pull: { questionIds: questionId } }),

  bumpActivity: (userId: Id, day: string) =>
    ActivityDay.updateOne({ userId, day }, { $inc: { count: 1 } }, { upsert: true }),
  activitySince: (userId: Id, fromDay: string) =>
    ActivityDay.find({ userId, day: { $gte: fromDay } })
      .select('day count -_id')
      .sort({ day: 1 })
      .lean(),
};
