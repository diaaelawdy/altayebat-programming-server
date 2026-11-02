import { Types } from 'mongoose';
import {
  AnswerRepository,
  CompanyRepository,
  QuestionRepository,
  StudyRepository,
  UserRepository,
  type QuestionFilters,
  type QuestionSort,
} from '../repositories/index.js';
import { AskedReport } from '../models/index.js';
import {
  companyDto,
  questionDetail,
  questionSummary,
  reviewInfo,
  submissionDto,
} from '../serializers/index.js';
import { BadRequest, Conflict, NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';
import { AuthzService } from './AuthzService.js';
import { renderMarkdown } from '../lib/markdown.js';
import { cairoDay, slugify } from '../lib/text.js';
import { specializationsFit } from '../shared/constants.js';
import { CompanyService, type CompanyInput } from './CompanyService.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

type Id = Types.ObjectId;

export interface QuestionInput {
  title: string;
  field: string;
  specializations: string[];
  levels: string[];
  stage: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
  problem: string;
  examples: { input: string; output: string; explanation?: string }[];
  constraints: string[];
  lookFor?: string;
  followUps: string[];
  askedMonth?: string; // YYYY-MM
}

/** Edits are partial, so the schema can't check this; it runs on the merged result. */
function assertFit(field: string, specializations: readonly string[]) {
  if (!specializationsFit(field, specializations))
    throw new BadRequest(`Pick specializations that belong to ${field}`);
}

function contentFields(input: Partial<QuestionInput>) {
  const out: Record<string, unknown> = { ...input };
  delete out.askedMonth;
  if (input.problem !== undefined) out.problemHtml = renderMarkdown(input.problem);
  if (input.lookFor !== undefined) out.lookForHtml = renderMarkdown(input.lookFor);
  if (input.askedMonth) out.lastAskedAt = new Date(`${input.askedMonth}-15T12:00:00Z`);
  return out;
}

async function uniqueSlug(companyId: Id | string, title: string) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; await QuestionRepository.slugExists(companyId, slug); i++) slug = `${base}-${i}`;
  return slug;
}

async function withFlags<T extends { id: string }>(items: T[], viewerId?: Id | null) {
  const flags = await StudyRepository.flags(
    viewerId,
    items.map((i) => i.id),
  );
  return items.map((i) => ({
    ...i,
    bookmarked: flags.bookmarked.has(i.id),
    studied: flags.studied.has(i.id),
  }));
}

async function attachCompanies<T extends { companyId: string }>(items: T[]) {
  const companies = await CompanyRepository.findByIds([...new Set(items.map((i) => i.companyId))]);
  const map = new Map(
    companies.map((c) => [
      String(c._id),
      { slug: c.slug, name: c.name, nameAr: c.nameAr ?? '', logoUrl: c.logoUrl ?? '' },
    ]),
  );
  return items.map((i) => ({ ...i, company: map.get(i.companyId) ?? null }));
}

export const QuestionService = {
  async listForCompany(
    slug: string,
    filters: Omit<QuestionFilters, 'companyId'>,
    sort: QuestionSort,
    limit: number,
    cursor: string | undefined,
    viewerId?: Id | null,
  ) {
    const company = await CompanyRepository.findBySlug(slug);
    if (!company) throw new NotFound('Company not found');
    const page = await QuestionRepository.list(
      { ...filters, companyId: company._id },
      sort,
      limit,
      cursor,
    );
    return {
      items: await withFlags(questionSummary.many(page.items), viewerId),
      nextCursor: page.nextCursor,
    };
  },

  async search(q: string, limit: number, viewerId?: Id | null) {
    const page = await QuestionRepository.list({ q }, 'frequent', limit);
    return attachCompanies(await withFlags(questionSummary.many(page.items), viewerId));
  },

  async detail(
    companySlug: string,
    slug: string,
    listCtx: { filters: Omit<QuestionFilters, 'companyId'>; sort: QuestionSort },
    viewerId?: Id | null,
    canSeeReviewer = false,
  ) {
    const company = await CompanyRepository.findBySlug(companySlug);
    if (!company) throw new NotFound('Company not found');
    const q = await QuestionRepository.findApproved(company._id, slug);
    if (!q) throw new NotFound('Question not found');
    const [authors, flags, nb, asked] = await Promise.all([
      UserRepository.publicRefs(
        [q.authorId, canSeeReviewer ? q.reviewedBy : null].filter((x) => x != null),
      ),
      StudyRepository.flags(viewerId, [q._id]),
      QuestionRepository.neighbors({ ...listCtx.filters, companyId: company._id }, listCtx.sort, q),
      viewerId ? AskedReport.exists({ questionId: q._id, userId: viewerId }) : null,
    ]);
    const id = String(q._id);
    return {
      ...questionDetail(q, q.authorId ? (authors.get(String(q.authorId)) ?? null) : null),
      company: companyDto(company),
      review: canSeeReviewer ? reviewInfo(q, authors) : undefined,
      bookmarked: flags.bookmarked.has(id),
      studied: flags.studied.has(id),
      askedByMe: Boolean(asked),
      prev: nb.prev ? { slug: nb.prev.slug, title: nb.prev.title } : null,
      next: nb.next ? { slug: nb.next.slug, title: nb.next.title } : null,
    };
  },

  async related(questionId: string) {
    const q = await QuestionRepository.findById(questionId);
    if (!q) throw new NotFound('Question not found');
    return attachCompanies(questionSummary.many(await QuestionRepository.related(q, 6)));
  },

  async recent(limit: number) {
    return attachCompanies(questionSummary.many(await QuestionRepository.recent(limit)));
  },

  /** Deterministic "question of the day" — same pick for everyone on a given Cairo day. */
  async daily() {
    const total = await QuestionRepository.countApproved();
    if (!total) return null;
    const day = cairoDay();
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const q = await QuestionRepository.nthApproved(h % total);
    if (!q) return null;
    const [withCompany] = await attachCompanies([questionSummary(q)]);
    return withCompany ?? null;
  },

  /** Resolves the picked company, or creates the proposed one as pending. */
  async resolveCompany(authorId: Id, companyId?: string, newCompany?: CompanyInput): Promise<Id> {
    if (companyId) {
      const c = await CompanyRepository.findById(companyId);
      if (!c) throw new BadRequest('Unknown company');
      return c._id;
    }
    if (newCompany) {
      // Proposed companies stay pending and are approved together with the question.
      const c = await CompanyService.create(newCompany, authorId, 'pending');
      return new Types.ObjectId(c.id);
    }
    throw new BadRequest('Pick a company or propose a new one');
  },

  async createPending(authorId: Id, companyId: Id, content: QuestionInput) {
    const q = await QuestionRepository.create({
      ...contentFields(content),
      companyId,
      slug: await uniqueSlug(companyId, content.title),
      status: 'pending',
      authorId,
      timesAsked: 1,
    });
    await events.emit('question.submitted', { questionId: q._id, authorId });
    return String(q._id);
  },

  async submit(
    authorId: Id,
    input: QuestionInput & { companyId?: string; newCompany?: CompanyInput },
  ) {
    const { companyId: cid, newCompany, ...content } = input;
    const companyId = await this.resolveCompany(authorId, cid, newCompany);
    const id = await this.createPending(authorId, companyId, content);
    return { id, status: 'pending' as const };
  },

  /** Several questions for one company in one request (uploaded as a JSON file). */
  async submitMany(
    authorId: Id,
    input: { companyId?: string; newCompany?: CompanyInput; questions: QuestionInput[] },
  ) {
    const companyId = await this.resolveCompany(authorId, input.companyId, input.newCompany);
    const ids: string[] = [];
    for (const q of input.questions) ids.push(await this.createPending(authorId, companyId, q));
    return { ids, count: ids.length, status: 'pending' as const };
  },

  async reviewQueue(viewerId: Id, page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await QuestionRepository.pending(w),
      page.limit,
      w.skip,
    );
    const [authors, companies, selfOk] = await Promise.all([
      UserRepository.publicRefs(items.map((i) => i.authorId!).filter(Boolean)),
      CompanyRepository.findByIds(items.map((i) => i.companyId)),
      AuthzService.canSelfReview('questions.review', viewerId),
    ]);
    const cmap = new Map(companies.map((c) => [String(c._id), companyDto(c)]));
    return {
      nextCursor,
      items: items.map((q) => {
        const own = String(q.authorId) === String(viewerId);
        return {
          ...submissionDto(q, q.authorId ? (authors.get(String(q.authorId)) ?? null) : null),
          company: cmap.get(String(q.companyId)) ?? null,
          own,
          canReview: !own || selfOk,
        };
      }),
    };
  },

  async edit(id: string, input: Partial<QuestionInput>) {
    if (input.field !== undefined || input.specializations !== undefined) {
      const current = await QuestionRepository.findById(id);
      if (!current) throw new NotFound('Question not found');
      assertFit(input.field ?? current.field, input.specializations ?? current.specializations);
    }
    const q = await QuestionRepository.update(id, contentFields(input));
    if (!q) throw new NotFound('Question not found');
    if (q.status === 'approved') await CompanyService.refreshCounters(q.companyId);
    return submissionDto(q, null);
  },

  async approve(id: string, reviewerId: Id, edits?: Partial<QuestionInput>) {
    const q = await QuestionRepository.findById(id);
    if (!q) throw new NotFound('Question not found');
    if (q.status !== 'pending') throw new Conflict('Already reviewed');
    await AuthzService.assertNotSelfReview('questions.review', q.authorId, reviewerId);
    if (edits && (edits.field !== undefined || edits.specializations !== undefined))
      assertFit(edits.field ?? q.field, edits.specializations ?? q.specializations);
    await QuestionRepository.update(id, {
      ...(edits ? contentFields(edits) : {}),
      status: 'approved',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      publishedAt: new Date(),
      rejectionReason: '',
    });
    const company = await CompanyRepository.findById(q.companyId);
    if (company?.status === 'pending') await CompanyRepository.approve(company._id, reviewerId);
    await events.emit('question.approved', {
      questionId: q._id,
      companyId: q.companyId,
      authorId: q.authorId ?? null,
      reviewerId,
    });
  },

  async reject(id: string, reviewerId: Id, reason: string) {
    const q = await QuestionRepository.findById(id);
    if (!q) throw new NotFound('Question not found');
    if (q.status !== 'pending') throw new Conflict('Already reviewed');
    await AuthzService.assertNotSelfReview('questions.review', q.authorId, reviewerId);
    await QuestionRepository.update(id, {
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    });
    await events.emit('question.rejected', {
      questionId: q._id,
      authorId: q.authorId ?? null,
      reason,
    });
  },

  async remove(id: string) {
    const q = await QuestionRepository.findById(id);
    if (!q) throw new NotFound('Question not found');
    await QuestionRepository.delete(id);
    await events.emit('question.deleted', {
      questionId: q._id,
      companyId: q.companyId,
      wasApproved: q.status === 'approved',
    });
  },

  /** "I was asked this too": one per user per question, bumps frequency + recency. */
  async confirmAsked(
    questionId: string,
    userId: Id,
    input: {
      month: string;
      specialization?: string;
      level?: string;
      stage?: string;
      note?: string;
    },
  ) {
    const q = await QuestionRepository.findById(questionId);
    if (!q || q.status !== 'approved') throw new NotFound('Question not found');
    try {
      await AskedReport.create({ questionId: q._id, userId, ...input });
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new Conflict('You already confirmed this question');
      throw e;
    }
    const askedAt = new Date(`${input.month}-15T12:00:00Z`);
    const set = !q.lastAskedAt || askedAt > q.lastAskedAt ? { lastAskedAt: askedAt } : {};
    await QuestionRepository.inc(q._id, { timesAsked: 1 }, set);
    await events.emit('question.asked', { questionId: q._id, companyId: q.companyId, userId });
    const updated = await QuestionRepository.findById(q._id);
    return {
      timesAsked: updated?.timesAsked ?? q.timesAsked + 1,
      lastAskedAt: updated?.lastAskedAt ?? q.lastAskedAt,
    };
  },

  async mySubmissions(userId: Id, page: PageQuery = { limit: 200 }) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await QuestionRepository.byAuthor(userId, w),
      page.limit,
      w.skip,
    );
    const companies = await CompanyRepository.findByIds(items.map((i) => i.companyId));
    const cmap = new Map(companies.map((c) => [String(c._id), { slug: c.slug, name: c.name }]));
    return {
      nextCursor,
      items: items.map((q) => ({
        ...submissionDto(q, null),
        company: cmap.get(String(q.companyId)) ?? null,
      })),
    };
  },

  async approvedBy(userId: Id, page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await QuestionRepository.approvedByAuthor(userId, w),
      page.limit,
      w.skip,
    );
    return { nextCursor, items: await attachCompanies(questionSummary.many(items)) };
  },

  /** Answers by a user, with the question they belong to (for profiles). */
  async answersBy(userId: Id, page: PageQuery = { limit: 100 }) {
    const w = pageWindow(page);
    const { items: answers, nextCursor } = offsetPage(
      await AnswerRepository.byAuthor(userId, w),
      page.limit,
      w.skip,
    );
    const qids = [...new Set(answers.map((a) => String(a.questionId)))];
    const questions = await attachCompanies(
      questionSummary.many(await QuestionRepository.findByIds(qids)),
    );
    const qmap = new Map(questions.map((q) => [q.id, q]));
    const items = answers
      .map((a) => ({
        id: String(a._id),
        excerpt: a.body.slice(0, 180),
        score: a.score,
        isReply: Boolean(a.parentId),
        createdAt: a.createdAt,
        question: qmap.get(String(a.questionId)) ?? null,
      }))
      .filter((a) => a.question);
    return { items, nextCursor };
  },
};
