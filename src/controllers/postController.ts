import type { Request, Response } from 'express';
import { AnswerService, CompanyCommentService } from '../services/ThreadService.js';
import { VoteService } from '../services/VoteService.js';
import { ReviewService } from '../services/ReviewService.js';
import { ReportService } from '../services/ReportService.js';
import { body, query } from '../middleware/index.js';
import {
  editPostSchema,
  handleReportSchema,
  reportSchema,
  reportsQuery,
  voteSchema,
} from '../shared/schemas.js';

const p = (req: Request, k: string) => String(req.params[k]);
const actor = (req: Request) => ({ _id: req.user!._id, perms: req.user!.perms as Set<string> });

export const postController = {
  editAnswer: async (req: Request, res: Response) =>
    res.json(await AnswerService.edit(p(req, 'id'), req.user!._id, body(req, editPostSchema).body)),
  async deleteAnswer(req: Request, res: Response) {
    await AnswerService.remove(p(req, 'id'), actor(req));
    res.status(204).end();
  },
  editComment: async (req: Request, res: Response) =>
    res.json(
      await CompanyCommentService.edit(p(req, 'id'), req.user!._id, body(req, editPostSchema).body),
    ),
  async deleteComment(req: Request, res: Response) {
    await CompanyCommentService.remove(p(req, 'id'), actor(req));
    res.status(204).end();
  },
  async deleteReview(req: Request, res: Response) {
    await ReviewService.remove(p(req, 'id'), actor(req));
    res.status(204).end();
  },
  async vote(req: Request, res: Response) {
    const { targetType, targetId, value } = body(req, voteSchema);
    res.json(await VoteService.cast(targetType, targetId, req.user!._id, value));
  },
  async report(req: Request, res: Response) {
    const { targetType, targetId, reason } = body(req, reportSchema);
    await ReportService.create(req.user!._id, targetType, targetId, reason);
    res.status(201).json({ ok: true });
  },
  reports: async (req: Request, res: Response) =>
    res.json(await ReportService.open(query(req, reportsQuery))),
  async handleReport(req: Request, res: Response) {
    await ReportService.handle(p(req, 'id'), body(req, handleReportSchema).status, req.user!._id);
    res.json({ ok: true });
  },
};
