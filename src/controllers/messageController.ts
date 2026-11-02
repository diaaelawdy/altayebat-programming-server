import type { Request, Response } from 'express';
import { MessageService } from '../services/MessageService.js';
import { UserRepository } from '../repositories/index.js';
import { body, query } from '../middleware/index.js';
import { messagesQuery, replyMessageSchema, startMessageSchema } from '../shared/schemas.js';
import { escapeRegex } from '../lib/text.js';
import { User } from '../models/index.js';

export const messageController = {
  list: async (req: Request, res: Response) =>
    res.json(
      await MessageService.list(
        req.user!,
        query(req, messagesQuery).box,
        query(req, messagesQuery),
      ),
    ),
  get: async (req: Request, res: Response) =>
    res.json(await MessageService.get(req.user!, String(req.params.id))),
  start: async (req: Request, res: Response) =>
    res.status(201).json(await MessageService.start(req.user!, body(req, startMessageSchema))),
  reply: async (req: Request, res: Response) =>
    res
      .status(201)
      .json(
        await MessageService.reply(req.user!, String(req.params.id), body(req, replyMessageSchema)),
      ),

  /** Username autocomplete for `messages.send_any`. */
  async recipients(req: Request, res: Response) {
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase();
    if (q.length < 2) return res.json({ items: [] });
    const users = await User.find({ username: new RegExp(`^${escapeRegex(q)}`) })
      .select('_id')
      .limit(8)
      .lean();
    const refs = await UserRepository.publicRefs(users.map((u) => u._id));
    res.json({ items: [...refs.values()] });
  },
};
