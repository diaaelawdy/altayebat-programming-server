import type { Request, Response } from 'express';
import { HistoryService } from '../services/HistoryService.js';
import { query } from '../middleware/index.js';
import { historyQuery } from '../shared/schemas.js';

export const historyController = {
  list: async (req: Request, res: Response) => {
    const q = query(req, historyQuery);
    res.json(await HistoryService.list(req.user!, q.scope, q));
  },
  stacks: async (req: Request, res: Response) =>
    res.json(await HistoryService.stacks(req.user!._id)),
  undo: async (req: Request, res: Response) =>
    res.json(await HistoryService.move(req.user!._id, 'undo')),
  redo: async (req: Request, res: Response) =>
    res.json(await HistoryService.move(req.user!._id, 'redo')),
};
