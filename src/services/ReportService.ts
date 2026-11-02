import type { Types } from 'mongoose';
import {
  AnswerRepository,
  CompanyCommentRepository,
  QuestionRepository,
  CompanyRepository,
  ReportRepository,
  ReviewRepository,
  UserRepository,
} from '../repositories/index.js';
import { BadRequest, NotFound } from '../errors/AppError.js';
import { MessageService } from './MessageService.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

type Id = Types.ObjectId;
type Target = 'answer' | 'comment' | 'review' | 'question' | 'message' | 'user';

async function loadTarget(type: Target, id: Id | string) {
  if (type === 'user') {
    const u = await UserRepository.findById(id).catch(() => null);
    return u ? { authorId: u._id, body: '', deleted: false, link: `/u/${u.username}` } : null;
  }
  if (type === 'question') {
    const q = await QuestionRepository.findById(id).catch(() => null);
    if (!q) return null;
    const c = await CompanyRepository.findById(q.companyId);
    return {
      authorId: q.authorId ?? null,
      body: `${q.title}\n${q.problem ?? ''}`,
      deleted: false,
      link: q.status === 'approved' && c ? `/c/${c.slug}/${q.slug}` : '/admin/review',
    };
  }
  if (type === 'message') {
    const m = await MessageService.loadForReport(String(id));
    return m
      ? { authorId: m.authorId, body: m.body, deleted: false, link: `/inbox/${m.conversationId}` }
      : null;
  }
  if (type === 'answer') {
    const a = await AnswerRepository.findById(id).catch(() => null);
    if (!a) return null;
    const q = await QuestionRepository.findById(a.questionId as Id);
    const c = q && (await CompanyRepository.findById(q.companyId));
    return {
      authorId: a.authorId,
      body: a.body,
      deleted: Boolean(a.deletedAt),
      link: c && q ? `/c/${c.slug}/${q.slug}` : null,
    };
  }
  if (type === 'comment') {
    const cm = await CompanyCommentRepository.findById(id).catch(() => null);
    if (!cm) return null;
    const c = await CompanyRepository.findById(cm.companyId as Id);
    return {
      authorId: cm.authorId,
      body: cm.body,
      deleted: Boolean(cm.deletedAt),
      link: c ? `/c/${c.slug}?tab=feedback` : null,
    };
  }
  const r = await ReviewRepository.findById(id).catch(() => null);
  if (!r) return null;
  const c = await CompanyRepository.findById(r.companyId);
  return {
    authorId: r.authorId,
    body: `${r.title ?? ''}\n${r.body ?? ''}`.trim(),
    deleted: Boolean(r.deletedAt),
    link: c ? `/c/${c.slug}?tab=ratings` : null,
  };
}

export const ReportService = {
  async create(reporterId: Id, targetType: Target, targetId: string, reason: string) {
    const t = await loadTarget(targetType, targetId);
    if (!t) throw new NotFound();
    if (targetType === 'user' && String(t.authorId) === String(reporterId))
      throw new BadRequest('You cannot report yourself');
    await ReportRepository.create({ targetType, targetId, reporterId, reason });
  },

  /** Raised by the profanity screen when an author posts past the mild warning. */
  async flag(targetType: Target, targetId: string, words: string[]) {
    await ReportRepository.create({
      targetType,
      targetId,
      reporterId: null,
      source: 'system',
      reason: `Profanity: ${words.join(', ')}`,
    });
  },

  /** Open reports; `source: 'system'` is the profanity warnings waiting for review. */
  async open(page: PageQuery & { source?: 'user' | 'system' }) {
    const w = pageWindow(page);
    const { items: reports, nextCursor } = offsetPage(
      await ReportRepository.open(w, page.source),
      page.limit,
      w.skip,
    );
    const targets = await Promise.all(
      reports.map((r) => loadTarget(r.targetType as Target, r.targetId)),
    );
    const authors = await UserRepository.publicRefs([
      ...reports.map((r) => r.reporterId).filter((x) => x != null),
      ...targets.map((t) => t?.authorId).filter((x): x is Types.ObjectId => Boolean(x)),
    ]);
    const items = reports.map((r, i) => {
      const t = targets[i];
      return {
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        reason: r.reason ?? '',
        source: r.source ?? 'user',
        reporter: r.reporterId ? (authors.get(String(r.reporterId)) ?? null) : null,
        target: t
          ? {
              author: t.authorId ? (authors.get(String(t.authorId)) ?? null) : null,
              authorId: t.authorId ? String(t.authorId) : null,
              body: t.body.slice(0, 600),
              deleted: t.deleted,
              link: t.link,
            }
          : null,
        createdAt: r.createdAt,
      };
    });
    return { items, nextCursor };
  },

  async handle(reportId: string, status: 'resolved' | 'dismissed', handledBy: Id) {
    const r = await ReportRepository.findById(reportId).catch(() => null);
    if (!r) throw new NotFound();
    await ReportRepository.resolveTarget(r.targetType, r.targetId, status, handledBy);
  },
};
