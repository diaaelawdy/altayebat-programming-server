import type { Types } from 'mongoose';
import {
  CompanyRepository,
  ReviewRepository,
  UserRepository,
  VoteRepository,
} from '../repositories/index.js';
import { reviewDto } from '../serializers/index.js';
import { Forbidden, NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';

type Id = Types.ObjectId;

export interface ReviewInput {
  overall: number;
  experience: number;
  difficulty: number;
  communication: number;
  outcome?: string;
  specialization?: string;
  level?: string;
  title?: string;
  body?: string;
}

async function companyBySlug(slug: string) {
  const c = await CompanyRepository.findBySlug(slug);
  if (!c) throw new NotFound('Company not found');
  return c;
}

export const ReviewService = {
  async list(
    slug: string,
    sort: 'helpful' | 'newest',
    limit: number,
    cursor: string | undefined,
    viewerId?: Id | null,
  ) {
    const company = await companyBySlug(slug);
    const page = await ReviewRepository.list(company._id, sort, limit, cursor);
    const [authors, myVotes, mine] = await Promise.all([
      UserRepository.publicRefs(page.items.map((r) => r.authorId)),
      VoteRepository.mine(
        'review',
        page.items.map((r) => r._id),
        viewerId,
      ),
      viewerId && !cursor ? ReviewRepository.findMine(company._id, viewerId) : null,
    ]);
    const mineAuthors = mine ? await UserRepository.publicRefs([mine.authorId]) : new Map();
    return {
      items: page.items.map((r) => reviewDto(r, authors, myVotes)),
      nextCursor: page.nextCursor,
      mine: mine ? reviewDto(mine, mineAuthors, new Map()) : null,
    };
  },

  async upsert(slug: string, authorId: Id, input: ReviewInput) {
    const company = await companyBySlug(slug);
    const created = !(await ReviewRepository.exists(company._id, authorId));
    const review = await ReviewRepository.upsert(company._id, authorId, { ...input });
    await events.emit('review.changed', { companyId: company._id, authorId, created });
    const authors = await UserRepository.publicRefs([authorId]);
    return reviewDto(review!, authors, new Map());
  },

  async remove(id: string, user: { _id: Id; perms: Set<string> }) {
    const r = await ReviewRepository.findById(id).catch(() => null);
    if (!r || r.deletedAt) throw new NotFound();
    if (String(r.authorId) !== String(user._id) && !user.perms.has('ratings.delete_any'))
      throw new Forbidden();
    await ReviewRepository.softDelete(id);
    await events.emit('review.changed', {
      companyId: r.companyId,
      authorId: r.authorId,
      created: false,
    });
  },

  async recompute(companyId: Id) {
    await CompanyRepository.setRating(companyId, await ReviewRepository.aggregate(companyId));
  },
};
