import { Types, type Model } from 'mongoose';
import { Answer, CompanyComment } from '../models/index.js';
import { afterCursor, decodeCursor, pageOf } from '../lib/cursor.js';

type Id = Types.ObjectId | string;

export interface ThreadDoc {
  _id: Types.ObjectId;
  parentId: Types.ObjectId | null;
  rootId: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  depth: number;
  authorId: Types.ObjectId;
  body: string;
  bodyHtml: string;
  score: number;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ThreadSort = 'top' | 'newest';

/** Strategy pattern: each sort is a keyset field + Mongo sort spec. */
export const THREAD_SORT_STRATEGIES: Record<
  ThreadSort,
  { field: string; sort: Record<string, 1 | -1> }
> = {
  top: { field: 'score', sort: { score: -1, _id: -1 } }, // highest-voted first, newest breaks ties
  newest: { field: '_id', sort: { _id: -1 } },
};

/**
 * Generic repository for threaded posts. `scopeField` is the owner key
 * (questionId for answers, companyId for company feedback).
 */
export function createThreadRepository(
  model: Model<never>,
  scopeField: 'questionId' | 'companyId',
) {
  const M = model as unknown as Model<ThreadDoc & Record<string, unknown>>;
  return {
    async listRoots(scopeId: Id, sort: ThreadSort, limit: number, cursor?: string) {
      const filter = { [scopeField]: new Types.ObjectId(String(scopeId)), parentId: null };
      const { field, sort: spec } = THREAD_SORT_STRATEGIES[sort];
      const rows = await M.find({ ...filter, ...afterCursor(field, decodeCursor(cursor)) })
        .sort(spec)
        .limit(limit + 1)
        .lean<ThreadDoc[]>();
      return pageOf(rows, limit, field);
    },
    /** Every reply under the given roots, in one query. */
    descendantsOf: (rootIds: Id[]) =>
      M.find({ rootId: { $in: rootIds } })
        .sort({ createdAt: 1 })
        .limit(2000)
        .lean<ThreadDoc[]>(),
    findById: (id: Id) => M.findById(id).lean<(ThreadDoc & Record<string, unknown>) | null>(),
    create: (data: Record<string, unknown>) => M.create(data),
    update: (id: Id, set: Record<string, unknown>) =>
      M.findByIdAndUpdate(id, { $set: set }, { new: true }).lean<ThreadDoc | null>(),
    inc: (id: Id, inc: Record<string, number>) =>
      M.findByIdAndUpdate(id, { $inc: inc }, { new: true })
        .select('score authorId')
        .lean<ThreadDoc | null>(),
    byAuthor: (authorId: Id, w: { skip: number; take: number } = { skip: 0, take: 100 }) =>
      M.find({ authorId, deletedAt: null })
        .sort({ createdAt: -1, _id: -1 })
        .skip(w.skip)
        .limit(w.take)
        .lean<(ThreadDoc & Record<string, unknown>)[]>(),
    countByAuthor: (authorId: Id) => M.countDocuments({ authorId, deletedAt: null }),
  };
}

export const AnswerRepository = createThreadRepository(Answer as never, 'questionId');
export const CompanyCommentRepository = createThreadRepository(
  CompanyComment as never,
  'companyId',
);
