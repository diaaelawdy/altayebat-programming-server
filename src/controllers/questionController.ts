import type { Request, Response } from 'express';
import { QuestionService } from '../services/QuestionService.js';
import { AnswerService } from '../services/ThreadService.js';
import { StudyService } from '../services/StudyService.js';
import { body, query } from '../middleware/index.js';
import {
  approveSchema,
  askedSchema,
  pageQuery,
  postSchema,
  questionInputSchema,
  rejectSchema,
  submitQuestionSchema,
  bulkQuestionsSchema,
  threadQuery,
} from '../shared/schemas.js';
import { z } from 'zod';

const p = (req: Request, k: string) => String(req.params[k]);
export const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const questionController = {
  search: async (req: Request, res: Response) => {
    const { q, limit } = query(req, searchQuery);
    res.json({ items: await QuestionService.search(q, limit, req.user?._id) });
  },
  recent: async (_req: Request, res: Response) =>
    res.json({ items: await QuestionService.recent(8) }),
  daily: async (_req: Request, res: Response) =>
    res.json({ question: await QuestionService.daily() }),
  related: async (req: Request, res: Response) =>
    res.json({ items: await QuestionService.related(p(req, 'id')) }),

  submit: async (req: Request, res: Response) =>
    res
      .status(201)
      .json(await QuestionService.submit(req.user!._id, body(req, submitQuestionSchema))),
  submitMany: async (req: Request, res: Response) =>
    res
      .status(201)
      .json(await QuestionService.submitMany(req.user!._id, body(req, bulkQuestionsSchema))),
  edit: async (req: Request, res: Response) =>
    res.json(await QuestionService.edit(p(req, 'id'), body(req, questionInputSchema.partial()))),
  async remove(req: Request, res: Response) {
    await QuestionService.remove(p(req, 'id'));
    res.status(204).end();
  },
  asked: async (req: Request, res: Response) =>
    res.json(
      await QuestionService.confirmAsked(p(req, 'id'), req.user!._id, body(req, askedSchema)),
    ),

  async answers(req: Request, res: Response) {
    const { sort, limit, cursor } = query(req, threadQuery);
    res.json(await AnswerService.list(p(req, 'id'), sort, limit, cursor, req.user?._id));
  },
  async addAnswer(req: Request, res: Response) {
    const { body: text, parentId } = body(req, postSchema);
    res.status(201).json(await AnswerService.create(p(req, 'id'), req.user!._id, text, parentId));
  },

  bookmark: (on: boolean) => async (req: Request, res: Response) =>
    res.json(await StudyService.setBookmark(req.user!._id, p(req, 'id'), on)),
  studied: (on: boolean) => async (req: Request, res: Response) =>
    res.json(await StudyService.setStudied(req.user!._id, p(req, 'id'), on)),

  queue: async (req: Request, res: Response) =>
    res.json(await QuestionService.reviewQueue(req.user!._id, query(req, pageQuery))),
  async approve(req: Request, res: Response) {
    await QuestionService.approve(p(req, 'id'), req.user!._id, body(req, approveSchema).edits);
    res.json({ ok: true });
  },
  async reject(req: Request, res: Response) {
    await QuestionService.reject(p(req, 'id'), req.user!._id, body(req, rejectSchema).reason);
    res.json({ ok: true });
  },
};
