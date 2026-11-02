import type { Request, Response } from 'express';
import { UserService } from '../services/UserService.js';
import { RoleService } from '../services/RoleService.js';
import { QuestionService } from '../services/QuestionService.js';
import { StudyService } from '../services/StudyService.js';
import { AnalyticsService } from '../services/AnalyticsService.js';
import { NotificationService } from '../services/NotificationService.js';
import {
  CompanyRepository,
  QuestionRepository,
  ReportRepository,
  RoleRequestRepository,
  UserRepository,
} from '../repositories/index.js';
import { body, query } from '../middleware/index.js';
import {
  assignRoleSchema,
  cursorQuery,
  listNameSchema,
  roleSchema,
  userStatusSchema,
  usersQuery,
} from '../shared/schemas.js';
import { z } from 'zod';
import { avatarSchema, pageQuery } from '../shared/schemas.js';

export const avatarBody = z.object({ avatar: avatarSchema });
const profileTab = z.enum(['questions', 'answers', 'feedback', 'companies']);
import { PERMISSIONS } from '../shared/permissions.js';
import { BADGES } from '../shared/badges.js';
import {
  DIFFICULTIES,
  FIELDS,
  LEVELS,
  REVIEW_OUTCOMES,
  SPECIALIZATIONS_BY_FIELD,
  STAGES,
  TOPICS,
} from '../shared/constants.js';

const p = (req: Request, k: string) => String(req.params[k]);
const me = (req: Request) => req.user!._id;

export const userController = {
  meta: (_req: Request, res: Response) =>
    res.json({
      permissions: PERMISSIONS,
      badges: BADGES,
      fields: FIELDS,
      specializationsByField: SPECIALIZATIONS_BY_FIELD,
      levels: LEVELS,
      stages: STAGES,
      difficulties: DIFFICULTIES,
      topics: TOPICS,
      outcomes: REVIEW_OUTCOMES,
    }),

  publicProfile: async (req: Request, res: Response) =>
    res.json(await UserService.publicProfile(p(req, 'username'))),
  contributions: async (req: Request, res: Response) =>
    res.json(
      await UserService.contributions(
        p(req, 'username'),
        profileTab.parse(p(req, 'tab')),
        query(req, pageQuery),
      ),
    ),

  submissions: async (req: Request, res: Response) =>
    res.json(await QuestionService.mySubmissions(me(req), query(req, pageQuery))),
  answers: async (req: Request, res: Response) =>
    res.json(await QuestionService.answersBy(me(req), query(req, pageQuery))),
  bookmarks: async (req: Request, res: Response) =>
    res.json(await StudyService.bookmarks(me(req), query(req, pageQuery))),
  progress: async (req: Request, res: Response) =>
    res.json({ items: await StudyService.progress(me(req)) }),
  activity: async (req: Request, res: Response) =>
    res.json({ items: await StudyService.activity(me(req)) }),

  lists: async (req: Request, res: Response) =>
    res.json({ items: await StudyService.lists(me(req)) }),
  list: async (req: Request, res: Response) =>
    res.json(await StudyService.list(me(req), p(req, 'id'))),
  createList: async (req: Request, res: Response) =>
    res.status(201).json(await StudyService.createList(me(req), body(req, listNameSchema).name)),
  async renameList(req: Request, res: Response) {
    await StudyService.renameList(me(req), p(req, 'id'), body(req, listNameSchema).name);
    res.json({ ok: true });
  },
  async deleteList(req: Request, res: Response) {
    await StudyService.deleteList(me(req), p(req, 'id'));
    res.status(204).end();
  },
  listItem: (on: boolean) => async (req: Request, res: Response) => {
    await StudyService.setInList(me(req), p(req, 'id'), p(req, 'questionId'), on);
    res.json({ ok: true });
  },

  async notifications(req: Request, res: Response) {
    const { cursor, limit } = query(req, cursorQuery);
    res.json(await NotificationService.list(me(req), limit, cursor));
  },
  async readNotifications(req: Request, res: Response) {
    await NotificationService.markAllRead(me(req));
    res.json({ ok: true });
  },

  // ---- admin ----
  async analytics(_req: Request, res: Response) {
    res.json(await AnalyticsService.overview());
  },

  async adminCounts(req: Request, res: Response) {
    const perms = req.user!.perms;
    res.json({
      pendingQuestions: perms.has('questions.review')
        ? await QuestionRepository.countPending()
        : null,
      openReports: perms.has('reports.review') ? await ReportRepository.countOpen('user') : null,
      // Profanity warnings that a reviewer still has to look at.
      flaggedContent: perms.has('reports.review')
        ? await ReportRepository.countOpen('system')
        : null,
      pendingCompanies: perms.has('companies.review')
        ? await CompanyRepository.countPending()
        : null,
      roleRequests: perms.has('users.assign_roles')
        ? await RoleRequestRepository.countPending()
        : null,
    });
  },
  listUsers: async (req: Request, res: Response) =>
    res.json(await UserService.listPrivate(query(req, usersQuery))),
  userDetail: async (req: Request, res: Response) =>
    res.json(await UserService.privateDetail(p(req, 'id'))),

  /** Role assignment without the users page: finds one user by exact username. */
  async lookup(req: Request, res: Response) {
    const { q } = z.object({ q: z.string().trim().toLowerCase().min(1).max(30) }).parse(req.query);
    const u = await UserRepository.findByUsername(q);
    res.json({
      user: u
        ? {
            id: String(u._id),
            username: u.username,
            status: u.status,
            avatar: u.avatar ?? null,
            ban: u.ban?.at
              ? {
                  reason: u.ban.reason,
                  link: u.ban.link,
                  at: u.ban.at,
                  canMessage: u.ban.canMessage !== false,
                }
              : null,
            roleId: u.roleIds?.[0] ? String(u.roleIds[0]) : null,
          }
        : null,
    });
  },
  async assignRoles(req: Request, res: Response) {
    await RoleService.assign(
      { isFounder: req.user!.isFounder },
      p(req, 'id'),
      body(req, assignRoleSchema).roleId,
    );
    res.json({ ok: true });
  },
  async setAvatar(req: Request, res: Response) {
    await UserService.setAvatar(me(req), body(req, avatarBody).avatar);
    res.json({ ok: true });
  },
  async setStatus(req: Request, res: Response) {
    await UserService.setStatus(me(req), p(req, 'id'), body(req, userStatusSchema));
    res.json({ ok: true });
  },

  roles: async (_req: Request, res: Response) => res.json({ items: await RoleService.list() }),
  createRole: async (req: Request, res: Response) =>
    res.status(201).json(await RoleService.create(body(req, roleSchema))),
  async updateRole(req: Request, res: Response) {
    await RoleService.update(p(req, 'id'), body(req, roleSchema.partial()));
    res.json({ ok: true });
  },
  async deleteRole(req: Request, res: Response) {
    await RoleService.remove(p(req, 'id'));
    res.status(204).end();
  },
};
