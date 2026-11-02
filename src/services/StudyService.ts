import { Types } from 'mongoose';
import { CompanyRepository, QuestionRepository, StudyRepository } from '../repositories/index.js';
import { questionSummary } from '../serializers/index.js';
import { NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';
import { cairoDay } from '../lib/text.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

type Id = Types.ObjectId;

async function approvedQuestion(id: string) {
  const q = await QuestionRepository.findById(id).catch(() => null);
  if (!q || q.status !== 'approved') throw new NotFound('Question not found');
  return q;
}

async function summariesWithCompany(ids: Id[]) {
  const qs = await QuestionRepository.findByIds(ids);
  const companies = await CompanyRepository.findByIds(qs.map((q) => q.companyId));
  const cmap = new Map(
    companies.map((c) => [
      String(c._id),
      { slug: c.slug, name: c.name, nameAr: c.nameAr ?? '', logoUrl: c.logoUrl ?? '' },
    ]),
  );
  const byId = new Map(
    qs.map((q) => [
      String(q._id),
      { ...questionSummary(q), company: cmap.get(String(q.companyId)) ?? null },
    ]),
  );
  return ids.map((id) => byId.get(String(id))).filter((x) => x !== undefined);
}

export const StudyService = {
  async setBookmark(userId: Id, questionId: string, on: boolean) {
    const q = await approvedQuestion(questionId);
    if (on) await StudyRepository.addBookmark(userId, q._id, q.companyId);
    else await StudyRepository.removeBookmark(userId, q._id);
    return { bookmarked: on };
  },

  async setStudied(userId: Id, questionId: string, on: boolean) {
    const q = await approvedQuestion(questionId);
    if (on) {
      if (await StudyRepository.markStudied(userId, q._id, q.companyId)) {
        await events.emit('study.marked', { userId, questionId: q._id, companyId: q.companyId });
      }
    } else {
      await StudyRepository.unmarkStudied(userId, q._id);
    }
    return {
      studied: on,
      companyStudied: await StudyRepository.studiedCountFor(userId, q.companyId),
    };
  },

  async bookmarks(userId: Id, page: PageQuery) {
    const w = pageWindow(page);
    const { items, nextCursor } = offsetPage(
      await StudyRepository.bookmarks(userId, w),
      page.limit,
      w.skip,
    );
    return { nextCursor, items: await summariesWithCompany(items.map((r) => r.questionId)) };
  },

  async progress(userId: Id) {
    const rows = await StudyRepository.progressByCompany(userId);
    const companies = await CompanyRepository.findByIds(rows.map((r) => r._id));
    const cmap = new Map(companies.map((c) => [String(c._id), c]));
    return rows
      .map((r) => {
        const c = cmap.get(String(r._id));
        return (
          c && {
            company: {
              slug: c.slug,
              name: c.name,
              nameAr: c.nameAr ?? '',
              logoUrl: c.logoUrl ?? '',
            },
            studied: r.studied,
            total: c.questionCount,
          }
        );
      })
      .filter(Boolean)
      .sort((a, b) => b!.studied / Math.max(b!.total, 1) - a!.studied / Math.max(a!.total, 1));
  },

  /** Daily activity for the last ~year (heatmap). Only ever shown to the owner. */
  async activity(userId: Id) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 371);
    return StudyRepository.activitySince(userId, cairoDay(from));
  },

  async lists(userId: Id) {
    const lists = await StudyRepository.lists(userId);
    return lists.map((l) => ({
      id: String(l._id),
      name: l.name,
      count: l.questionIds.length,
      questionIds: l.questionIds.map(String),
    }));
  },
  async list(userId: Id, id: string) {
    const l = await StudyRepository.findList(id, userId).catch(() => null);
    if (!l) throw new NotFound('List not found');
    return {
      id: String(l._id),
      name: l.name,
      questions: await summariesWithCompany(l.questionIds),
    };
  },
  async createList(userId: Id, name: string) {
    const l = await StudyRepository.createList(userId, name);
    return { id: String(l._id), name: l.name, count: 0, questionIds: [] };
  },
  renameList: (userId: Id, id: string, name: string) =>
    StudyRepository.renameList(id, userId, name),
  deleteList: (userId: Id, id: string) => StudyRepository.deleteList(id, userId),
  async setInList(userId: Id, id: string, questionId: string, on: boolean) {
    const q = await approvedQuestion(questionId);
    const r = on
      ? await StudyRepository.addToList(id, userId, q._id)
      : await StudyRepository.removeFromList(id, userId, q._id);
    if (!r.matchedCount) throw new NotFound('List not found');
  },
};

export const toObjectId = (s: string) => new Types.ObjectId(s);
