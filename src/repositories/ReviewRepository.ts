import { Types } from 'mongoose';
import { CompanyReview } from '../models/index.js';
import { afterCursor, decodeCursor, pageOf } from '../lib/cursor.js';

type Id = Types.ObjectId | string;

export const ReviewRepository = {
  async list(companyId: Id, sort: 'helpful' | 'newest', limit: number, cursor?: string) {
    const filter = { companyId: new Types.ObjectId(String(companyId)), deletedAt: null };
    const c = decodeCursor(cursor);
    const field = sort === 'helpful' ? 'score' : '_id';
    const rows = await CompanyReview.find({ ...filter, ...afterCursor(field, c) })
      .sort(sort === 'helpful' ? { score: -1, _id: -1 } : { _id: -1 })
      .limit(limit + 1)
      .lean();
    return pageOf(rows, limit, field);
  },
  findById: (id: Id) => CompanyReview.findById(id).lean(),
  exists: async (companyId: Id, authorId: Id) =>
    Boolean(await CompanyReview.exists({ companyId, authorId, deletedAt: null })),
  findMine: (companyId: Id, authorId: Id) =>
    CompanyReview.findOne({ companyId, authorId, deletedAt: null }).lean(),
  /** One review per user per company; re-rating updates it. */
  upsert: (companyId: Id, authorId: Id, data: Record<string, unknown>) =>
    CompanyReview.findOneAndUpdate(
      { companyId, authorId },
      { $set: { ...data, deletedAt: null } },
      { upsert: true, new: true },
    ).lean(),
  softDelete: (id: Id) => CompanyReview.updateOne({ _id: id }, { $set: { deletedAt: new Date() } }),
  inc: (id: Id, inc: Record<string, number>) =>
    CompanyReview.findByIdAndUpdate(id, { $inc: inc }, { new: true })
      .select('score authorId')
      .lean(),

  async aggregate(companyId: Id) {
    const [agg] = await CompanyReview.aggregate<{
      count: number;
      overall: number;
      experience: number;
      difficulty: number;
      communication: number;
      stars: number[];
    }>([
      { $match: { companyId: new Types.ObjectId(String(companyId)), deletedAt: null } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          overall: { $avg: '$overall' },
          experience: { $avg: '$experience' },
          difficulty: { $avg: '$difficulty' },
          communication: { $avg: '$communication' },
          stars: { $push: '$overall' },
        },
      },
    ]);
    if (!agg)
      return {
        count: 0,
        overall: 0,
        experience: 0,
        difficulty: 0,
        communication: 0,
        distribution: [0, 0, 0, 0, 0],
      };
    const distribution = [0, 0, 0, 0, 0];
    for (const s of agg.stars) distribution[s - 1]! += 1;
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      count: agg.count,
      overall: r(agg.overall),
      experience: r(agg.experience),
      difficulty: r(agg.difficulty),
      communication: r(agg.communication),
      distribution,
    };
  },
};
