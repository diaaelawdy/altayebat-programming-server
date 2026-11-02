import type { Types } from 'mongoose';
import {
  CompanyCommentRepository,
  CompanyRepository,
  QuestionRepository,
  StudyRepository,
  UserRepository,
  type CompanySort,
} from '../repositories/index.js';
import { authorOf, companyDto, companySubmissionDto, reviewInfo } from '../serializers/index.js';
import { BadRequest, Conflict, NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';
import { AuthzService } from './AuthzService.js';
import { slugify } from '../lib/text.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

export interface CompanyInput {
  name: string;
  nameAr?: string;
  logoUrl?: string;
  website?: string;
  linkedinUrl?: string;
  industry?: string;
  description?: string;
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await CompanyRepository.slugExists(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export const CompanyService = {
  async list(opts: { q?: string; sort: CompanySort } & PageQuery) {
    const w = pageWindow(opts);
    const rows = await CompanyRepository.list({
      q: opts.q,
      sort: opts.sort,
      skip: w.skip,
      limit: w.take,
    });
    const { items, nextCursor } = offsetPage(rows, opts.limit, w.skip);
    return { items: companyDto.many(items), nextCursor };
  },

  async get(slug: string, viewerId?: Types.ObjectId | null, canSeeReviewer = false) {
    const c = await CompanyRepository.findBySlug(slug);
    if (!c) throw new NotFound('Company not found');
    const [studied, authors] = await Promise.all([
      viewerId ? StudyRepository.studiedCountFor(viewerId, c._id) : null,
      UserRepository.publicRefs(
        [c.createdBy, canSeeReviewer ? c.reviewedBy : null].filter((x) => x != null),
      ),
    ]);
    return {
      ...companyDto(c),
      studied,
      createdBy: c.createdBy ? authorOf(authors, c.createdBy) : null,
      review: canSeeReviewer ? reviewInfo(c, authors) : undefined,
    };
  },

  /** Every new company waits for review by someone other than its author. */
  async suggest(input: CompanyInput, userId: Types.ObjectId) {
    const c = await this.create(input, userId, 'pending');
    await events.emit('company.submitted', { companyId: c.id, authorId: userId });
    return c;
  },

  async reviewQueue(viewerId: Types.ObjectId, page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await CompanyRepository.pending(w),
      page.limit,
      w.skip,
    );
    const [authors, selfOk] = await Promise.all([
      UserRepository.publicRefs(items.map((c) => c.createdBy!).filter(Boolean)),
      AuthzService.canSelfReview('companies.review', viewerId),
    ]);
    return {
      nextCursor,
      items: items.map((c) => {
        const own = String(c.createdBy) === String(viewerId);
        return {
          ...companySubmissionDto(c, c.createdBy ? authorOf(authors, c.createdBy) : null),
          own,
          canReview: !own || selfOk,
        };
      }),
    };
  },

  async approve(id: string, reviewerId: Types.ObjectId, edits?: Partial<CompanyInput>) {
    const c = await CompanyRepository.findById(id).catch(() => null);
    if (!c || c.status !== 'pending') throw new NotFound('Nothing to review');
    await AuthzService.assertNotSelfReview('companies.review', c.createdBy, reviewerId);
    if (edits && Object.keys(edits).length) await CompanyRepository.update(id, edits);
    await CompanyRepository.approve(id, reviewerId);
    await events.emit('company.approved', { companyId: c._id, authorId: c.createdBy ?? null });
  },

  async reject(id: string, reviewerId: Types.ObjectId, reason: string) {
    const c = await CompanyRepository.findById(id).catch(() => null);
    if (!c || c.status !== 'pending') throw new NotFound('Nothing to review');
    await AuthzService.assertNotSelfReview('companies.review', c.createdBy, reviewerId);
    if (await QuestionRepository.countPendingFor(c._id))
      throw new BadRequest('A pending question uses this company; review the question instead');
    await CompanyRepository.reject(id, reviewerId, reason);
    await events.emit('company.rejected', {
      companyId: c._id,
      authorId: c.createdBy ?? null,
      reason,
    });
  },

  /** A user's company feedback comments, with the company they belong to (for profiles). */
  async feedbackBy(userId: Types.ObjectId, page: PageQuery) {
    const w = pageWindow(page);
    const { items: comments, nextCursor } = offsetPage(
      await CompanyCommentRepository.byAuthor(userId, w),
      page.limit,
      w.skip,
    );
    const companies = await CompanyRepository.findByIds([
      ...new Set(comments.map((c) => String(c.companyId))),
    ]);
    const cmap = new Map(
      companies
        .filter((c) => c.status === 'approved')
        .map((c) => [String(c._id), { slug: c.slug, name: c.name, nameAr: c.nameAr ?? '' }]),
    );
    const items = comments
      .map((c) => ({
        id: String(c._id),
        excerpt: c.body.slice(0, 180),
        score: c.score ?? 0,
        isReply: Boolean(c.parentId),
        createdAt: c.createdAt ?? null,
        company: cmap.get(String(c.companyId)) ?? null,
      }))
      .filter((c) => c.company);
    return { items, nextCursor };
  },

  /** Companies a user added. The public profile only sees the approved ones. */
  async byCreator(userId: Types.ObjectId, approvedOnly: boolean, page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await CompanyRepository.byCreator(userId, approvedOnly, w),
      page.limit,
      w.skip,
    );
    return { nextCursor, items: items.map((c) => companySubmissionDto(c, null)) };
  },

  async create(
    input: CompanyInput,
    createdBy: Types.ObjectId,
    status: 'approved' | 'pending' = 'approved',
  ) {
    const exists = (await CompanyRepository.list({ q: input.name, sort: 'name', limit: 20 })).find(
      (c) => c.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (exists) throw new Conflict('Company already exists');
    const c = await CompanyRepository.create({
      ...input,
      slug: await uniqueSlug(input.name),
      status,
      createdBy,
    });
    return companyDto(c.toObject());
  },

  async update(id: string, input: Partial<CompanyInput>) {
    const c = await CompanyRepository.update(id, input);
    if (!c) throw new NotFound('Company not found');
    return companyDto(c);
  },

  async remove(id: string) {
    const count = await QuestionRepository.countApprovedFor(id);
    if (count > 0) throw new Conflict('Delete or move its questions first');
    await CompanyRepository.delete(id);
  },

  async listAll(page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await CompanyRepository.listAll(w),
      page.limit,
      w.skip,
    );
    return { items: companyDto.many(items), nextCursor };
  },

  /** Recompute denormalized counters from source of truth. */
  async refreshCounters(companyId: Types.ObjectId | string) {
    const [count, latest] = await Promise.all([
      QuestionRepository.countApprovedFor(companyId),
      QuestionRepository.maxLastAsked(companyId),
    ]);
    await CompanyRepository.update(companyId, {
      questionCount: count,
      lastUpdatedAt: latest?.lastAskedAt ?? null,
    });
  },
};
