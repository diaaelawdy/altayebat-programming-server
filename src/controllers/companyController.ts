import type { Request, Response } from 'express';
import { CompanyService } from '../services/CompanyService.js';
import { QuestionService } from '../services/QuestionService.js';
import { CompanyCommentService } from '../services/ThreadService.js';
import { ReviewService } from '../services/ReviewService.js';
import { body, query } from '../middleware/index.js';
import {
  companyApproveSchema,
  pageQuery,
  companyInputSchema,
  companySubmitSchema,
  rejectSchema,
  companyListQuery,
  postSchema,
  questionListQuery,
  reviewQuery,
  reviewSchema,
  threadQuery,
} from '../shared/schemas.js';

const p = (req: Request, k: string) => String(req.params[k]);

export const companyController = {
  async list(req: Request, res: Response) {
    res.json(await CompanyService.list(query(req, companyListQuery)));
  },
  get: async (req: Request, res: Response) =>
    res.json(
      await CompanyService.get(
        p(req, 'slug'),
        req.user?._id,
        Boolean(req.user?.perms.has('moderation.view_reviewer')),
      ),
    ),

  async questions(req: Request, res: Response) {
    const { sort, cursor, limit, ...filters } = query(req, questionListQuery);
    res.json(
      await QuestionService.listForCompany(
        p(req, 'slug'),
        filters,
        sort,
        limit,
        cursor,
        req.user?._id,
      ),
    );
  },

  async question(req: Request, res: Response) {
    const { sort, cursor: _c, limit: _l, ...filters } = query(req, questionListQuery);
    res.json(
      await QuestionService.detail(
        p(req, 'slug'),
        p(req, 'qslug'),
        { filters, sort },
        req.user?._id,
        Boolean(req.user?.perms.has('moderation.view_reviewer')),
      ),
    );
  },

  async comments(req: Request, res: Response) {
    const { sort, limit, cursor } = query(req, threadQuery);
    res.json(await CompanyCommentService.list(p(req, 'slug'), sort, limit, cursor, req.user?._id));
  },
  async addComment(req: Request, res: Response) {
    const { body: text, parentId } = body(req, postSchema);
    res
      .status(201)
      .json(await CompanyCommentService.create(p(req, 'slug'), req.user!._id, text, parentId));
  },

  async reviews(req: Request, res: Response) {
    const { sort, limit, cursor } = query(req, reviewQuery);
    res.json(await ReviewService.list(p(req, 'slug'), sort, limit, cursor, req.user?._id));
  },
  upsertReview: async (req: Request, res: Response) =>
    res.json(await ReviewService.upsert(p(req, 'slug'), req.user!._id, body(req, reviewSchema))),

  create: async (req: Request, res: Response) =>
    res
      .status(201)
      .json(await CompanyService.suggest(body(req, companySubmitSchema), req.user!._id)),
  queue: async (req: Request, res: Response) =>
    res.json(await CompanyService.reviewQueue(req.user!._id, query(req, pageQuery))),
  async approve(req: Request, res: Response) {
    await CompanyService.approve(
      p(req, 'id'),
      req.user!._id,
      body(req, companyApproveSchema).edits,
    );
    res.status(204).end();
  },
  async reject(req: Request, res: Response) {
    await CompanyService.reject(p(req, 'id'), req.user!._id, body(req, rejectSchema).reason);
    res.status(204).end();
  },
  mine: async (req: Request, res: Response) =>
    res.json(await CompanyService.byCreator(req.user!._id, false, query(req, pageQuery))),
  update: async (req: Request, res: Response) =>
    res.json(await CompanyService.update(p(req, 'id'), body(req, companyInputSchema.partial()))),
  async remove(req: Request, res: Response) {
    await CompanyService.remove(p(req, 'id'));
    res.status(204).end();
  },
  adminList: async (req: Request, res: Response) =>
    res.json(await CompanyService.listAll(query(req, pageQuery))),
};
