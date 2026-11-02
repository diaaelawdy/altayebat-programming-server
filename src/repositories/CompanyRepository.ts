import type { Types } from 'mongoose';
import { Company } from '../models/index.js';
import { escapeRegex } from '../lib/text.js';

type Id = Types.ObjectId | string;
/** Skip/take window from `pageWindow()`. */
type Win = { skip: number; take: number };

export type CompanySort = 'popular' | 'name' | 'rating' | 'recent';
const SORTS: Record<CompanySort, Record<string, 1 | -1>> = {
  popular: { questionCount: -1, name: 1 },
  name: { name: 1 },
  rating: { 'rating.overall': -1, 'rating.count': -1 },
  recent: { lastUpdatedAt: -1, name: 1 },
};

export const CompanyRepository = {
  list: (opts: { q?: string; sort: CompanySort; limit: number; skip?: number }) => {
    const filter: Record<string, unknown> = { status: 'approved' };
    if (opts.q) {
      const rx = new RegExp(escapeRegex(opts.q), 'i');
      filter.$or = [{ name: rx }, { nameAr: rx }, { slug: rx }];
    }
    return Company.find(filter)
      .sort({ ...SORTS[opts.sort], _id: 1 })
      .skip(opts.skip ?? 0)
      .limit(opts.limit)
      .lean();
  },
  findBySlug: (slug: string, includePending = false) =>
    Company.findOne({ slug, ...(includePending ? {} : { status: 'approved' }) }).lean(),
  findById: (id: Id) => Company.findById(id).lean(),
  findByIds: (ids: Id[]) => Company.find({ _id: { $in: ids } }).lean(),
  slugExists: async (slug: string) => Boolean(await Company.exists({ slug })),
  create: (data: Record<string, unknown>) => Company.create(data),
  update: (id: Id, data: Record<string, unknown>) =>
    Company.findByIdAndUpdate(id, { $set: data }, { new: true }).lean(),
  delete: (id: Id) => Company.deleteOne({ _id: id }),
  inc: (id: Id, inc: Record<string, number>, set: Record<string, unknown> = {}) =>
    Company.updateOne({ _id: id }, { $inc: inc, $set: set }),
  setRating: (id: Id, rating: Record<string, unknown>) =>
    Company.updateOne({ _id: id }, { $set: { rating } }),
  approve: (id: Id, reviewerId: Id) =>
    Company.updateOne(
      { _id: id },
      {
        $set: {
          status: 'approved',
          rejectionReason: '',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      },
    ),
  reject: (id: Id, reviewerId: Id, reason: string) =>
    Company.updateOne(
      { _id: id },
      {
        $set: {
          status: 'rejected',
          rejectionReason: reason,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      },
    ),
  pending: (w: Win = { skip: 0, take: 200 }) =>
    Company.find({ status: 'pending' })
      .sort({ createdAt: 1, _id: 1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countPending: () => Company.countDocuments({ status: 'pending' }),
  byCreator: (userId: Id, approvedOnly: boolean, w: Win = { skip: 0, take: 100 }) =>
    Company.find({ createdBy: userId, ...(approvedOnly ? { status: 'approved' } : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countByCreator: (userId: Id) => Company.countDocuments({ createdBy: userId, status: 'approved' }),
  listAll: (w: Win) => Company.find().sort({ name: 1, _id: 1 }).skip(w.skip).limit(w.take).lean(),
};
