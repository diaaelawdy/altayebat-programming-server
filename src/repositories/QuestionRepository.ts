import { Types } from 'mongoose';
import { Question } from '../models/index.js';
import { afterCursor, decodeCursor, pageOf } from '../lib/cursor.js';

type Id = Types.ObjectId | string;
/** Skip/take window from `pageWindow()`. */
type Win = { skip: number; take: number };

export type QuestionSort = 'lastAsked' | 'frequent' | 'newest';
export const SORT_FIELD: Record<QuestionSort, { field: string; isDate: boolean }> = {
  lastAsked: { field: 'lastAskedAt', isDate: true },
  frequent: { field: 'timesAsked', isDate: false },
  newest: { field: 'publishedAt', isDate: true },
};

export interface QuestionFilters {
  companyId?: Id;
  field?: string;
  specialization?: string;
  level?: string;
  stage?: string;
  topic?: string;
  difficulty?: string;
  q?: string;
}

const SUMMARY =
  'companyId slug title field specializations levels stage difficulty topics timesAsked lastAskedAt publishedAt answerCount';

function buildFilter(f: QuestionFilters) {
  const filter: Record<string, unknown> = { status: 'approved' };
  if (f.companyId) filter.companyId = new Types.ObjectId(String(f.companyId));
  if (f.field) filter.field = f.field;
  if (f.specialization) filter.specializations = f.specialization;
  if (f.level) filter.levels = f.level;
  if (f.stage) filter.stage = f.stage;
  if (f.topic) filter.topics = f.topic;
  if (f.difficulty) filter.difficulty = f.difficulty;
  if (f.q) filter.$text = { $search: f.q };
  return filter;
}

export const QuestionRepository = {
  async list(f: QuestionFilters, sort: QuestionSort, limit: number, cursor?: string) {
    const { field, isDate } = SORT_FIELD[sort];
    const filter = { ...buildFilter(f), ...afterCursor(field, decodeCursor(cursor), isDate) };
    const rows = await Question.find(filter)
      .select(SUMMARY)
      .sort({ [field]: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    return pageOf(rows, limit, field);
  },

  /** Previous/next question in the same filtered + sorted list. */
  async neighbors(f: QuestionFilters, sort: QuestionSort, current: Record<string, unknown>) {
    const { field } = SORT_FIELD[sort];
    const base = buildFilter(f);
    const v = current[field];
    const id = current._id;
    const [next, prev] = await Promise.all([
      Question.findOne({
        ...base,
        $or: [{ [field]: { $lt: v } }, { [field]: v, _id: { $lt: id } }],
      })
        .select('slug title')
        .sort({ [field]: -1, _id: -1 })
        .lean(),
      Question.findOne({
        ...base,
        $or: [{ [field]: { $gt: v } }, { [field]: v, _id: { $gt: id } }],
      })
        .select('slug title')
        .sort({ [field]: 1, _id: 1 })
        .lean(),
    ]);
    return { prev, next };
  },

  findApproved: (companyId: Id, slug: string) =>
    Question.findOne({ companyId, slug, status: 'approved' }).lean(),
  findById: (id: Id) => Question.findById(id).lean(),
  findByIds: (ids: Id[]) =>
    Question.find({ _id: { $in: ids } })
      .select(SUMMARY)
      .lean(),
  slugExists: async (companyId: Id, slug: string) =>
    Boolean(await Question.exists({ companyId, slug })),
  create: (data: Record<string, unknown>) => Question.create(data),
  update: (id: Id, data: Record<string, unknown>) =>
    Question.findByIdAndUpdate(id, { $set: data }, { new: true }).lean(),
  delete: (id: Id) => Question.deleteOne({ _id: id }),
  inc: (id: Id, inc: Record<string, number>, set: Record<string, unknown> = {}) =>
    Question.updateOne({ _id: id }, { $inc: inc, $set: set }),

  pending: (w: Win = { skip: 0, take: 200 }) =>
    Question.find({ status: 'pending' })
      .sort({ createdAt: 1, _id: 1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countPending: () => Question.countDocuments({ status: 'pending' }),
  countPendingFor: (companyId: Id) => Question.countDocuments({ companyId, status: 'pending' }),
  byAuthor: (authorId: Id, w: Win = { skip: 0, take: 200 }) =>
    Question.find({ authorId }).sort({ createdAt: -1, _id: -1 }).skip(w.skip).limit(w.take).lean(),
  approvedByAuthor: (authorId: Id, w: Win = { skip: 0, take: 100 }) =>
    Question.find({ authorId, status: 'approved' })
      .select(SUMMARY)
      .sort({ publishedAt: -1, _id: -1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countApprovedByAuthor: (authorId: Id) =>
    Question.countDocuments({ authorId, status: 'approved' }),
  recent: (limit: number) =>
    Question.find({ status: 'approved' })
      .select(SUMMARY)
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit)
      .lean(),
  countApproved: () => Question.countDocuments({ status: 'approved' }),
  nthApproved: (n: number) =>
    Question.findOne({ status: 'approved' }).select(SUMMARY).sort({ _id: 1 }).skip(n).lean(),
  related: (q: { _id: Id; companyId: Id; topics: string[] }, limit: number) =>
    Question.find({
      status: 'approved',
      _id: { $ne: q._id },
      $or: [{ companyId: q.companyId, topics: { $in: q.topics } }, { topics: { $in: q.topics } }],
    })
      .select(SUMMARY)
      .sort({ timesAsked: -1 })
      .limit(limit)
      .lean(),
  countApprovedFor: (companyId: Id) => Question.countDocuments({ companyId, status: 'approved' }),
  maxLastAsked: (companyId: Id) =>
    Question.findOne({ companyId, status: 'approved' })
      .sort({ lastAskedAt: -1 })
      .select('lastAskedAt')
      .lean(),
};
