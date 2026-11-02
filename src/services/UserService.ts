import type { Types } from 'mongoose';
import {
  AnswerRepository,
  CompanyCommentRepository,
  CompanyRepository,
  IpBanRepository,
  QuestionRepository,
  RoleRepository,
  UserRepository,
  displayRoleResolver,
} from '../repositories/index.js';
import { CompanyService } from './CompanyService.js';
import { privateUserDto, publicProfile } from '../serializers/index.js';
import { BadRequest, Forbidden, NotFound } from '../errors/AppError.js';
import { isOwner } from '../config/env.js';
import { QuestionService } from './QuestionService.js';
import { CompanyReview } from '../models/index.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';

type Id = Types.ObjectId;

async function roleNameMap() {
  const roles = await RoleRepository.findAll();
  return new Map(roles.map((r) => [String(r._id), r.name]));
}

export const UserService = {
  async publicProfile(username: string) {
    const u = await UserRepository.findByUsername(username);
    if (!u) throw new NotFound('User not found');
    const [questions, answers, companies, feedback, roleOf] = await Promise.all([
      QuestionRepository.countApprovedByAuthor(u._id),
      AnswerRepository.countByAuthor(u._id),
      CompanyRepository.countByCreator(u._id),
      CompanyCommentRepository.countByAuthor(u._id),
      displayRoleResolver(),
    ]);
    // Contributions load per tab (`contributions()`). Reviews and "I was asked"
    // reports stay off profiles: together they could reveal where someone interviewed.
    return {
      ...publicProfile({ ...u, role: roleOf(u.roleIds ?? []) }),
      counts: { questions, answers, feedback, companies },
    };
  },

  /** One page of a public profile tab. */
  async contributions(
    username: string,
    tab: 'questions' | 'answers' | 'feedback' | 'companies',
    page: PageQuery,
  ) {
    const u = await UserRepository.findByUsername(username);
    if (!u) throw new NotFound('User not found');
    if (tab === 'questions') return QuestionService.approvedBy(u._id, page);
    if (tab === 'answers') return QuestionService.answersBy(u._id, page);
    if (tab === 'feedback') return CompanyService.feedbackBy(u._id, page);
    return CompanyService.byCreator(u._id, true, page);
  },

  async listPrivate(opts: { q?: string; roleId?: string } & PageQuery) {
    const w = pageWindow(opts);
    const [{ items: rows, total }, names] = await Promise.all([
      UserRepository.listPrivate({ q: opts.q, roleId: opts.roleId, ...w }),
      roleNameMap(),
    ]);
    const { items, nextCursor } = offsetPage(rows, opts.limit, w.skip);
    return { items: items.map((u) => privateUserDto(u, names)), total, nextCursor };
  },

  async privateDetail(id: string) {
    const u = await UserRepository.findById(id).catch(() => null);
    if (!u) throw new NotFound('User not found');
    const [names, submissions, answers, comments, reviews] = await Promise.all([
      roleNameMap(),
      QuestionService.mySubmissions(u._id).then((r) => r.items),
      QuestionService.answersBy(u._id).then((r) => r.items),
      CompanyCommentRepository.byAuthor(u._id),
      CompanyReview.find({ authorId: u._id, deletedAt: null })
        .populate('companyId', 'slug name')
        .lean(),
    ]);
    return {
      ...privateUserDto(u, names),
      contributions: {
        submissions: submissions.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          slug: s.slug,
          company: s.company,
        })),
        answers,
        comments: comments.map((c) => ({
          id: String(c._id),
          excerpt: c.body.slice(0, 180),
          companyId: String(c.companyId),
          createdAt: c.createdAt,
        })),
        reviews: reviews.map((r) => ({
          id: String(r._id),
          overall: r.overall,
          company: r.companyId as unknown as { slug: string; name: string },
        })),
      },
    };
  },

  async setStatus(
    actorId: Id,
    id: string,
    input:
      | { status: 'active' }
      | { status: 'disabled' | 'banned'; reason: string; link: string; canMessage: boolean },
  ) {
    if (String(actorId) === id) throw new BadRequest('You cannot restrict yourself');
    const founder = await RoleRepository.findFounder();
    const target = await UserRepository.findAuthById(id).catch(() => null);
    if (!target) throw new NotFound('User not found');
    // Any change lifts IP bans; only a ban puts them back.
    await IpBanRepository.unbanUser(target._id);
    if (input.status === 'active') {
      await UserRepository.setBan(target._id, 'active', {
        reason: '',
        link: '',
        by: null,
        at: null,
        canMessage: true,
      });
      return;
    }
    if (isOwner(target.username)) throw new Forbidden('The owner account cannot be restricted');
    if (founder && target.roleIds?.some((r) => String(r) === String(founder._id)))
      throw new BadRequest('A Founder cannot be restricted');
    await UserRepository.setBan(target._id, input.status, {
      reason: input.reason,
      link: input.link,
      by: actorId,
      at: new Date(),
      canMessage: input.canMessage,
    });
    // Ban every IP the account used, so a fresh sign-up from there is blocked too.
    if (input.status === 'banned')
      await IpBanRepository.banAll(await UserRepository.ipHashesOf(target._id), target._id);
  },

  async setAvatar(userId: Id, avatar: string) {
    await UserRepository.setAvatar(userId, avatar);
  },
};
